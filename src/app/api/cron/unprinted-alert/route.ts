import { timingSafeEqual } from "node:crypto";
import {
  cronSecret,
  isSmsConfigured,
  ownerAlertPhone,
  publicTenant,
} from "@/config/tenant.server";
import { restaurant } from "@/data/restaurant";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { businessDateFor } from "@/lib/orders/businessDate";
import {
  countQueuedOrders,
  findUnprintedForAlert,
  markAlerted,
  releaseAlertClaim,
} from "@/lib/orders/repository";
import {
  claimPrinterAlert,
  readAllPrinterStatus,
  releasePrinterAlert,
  type PrinterAlertKind,
  type PrinterStatusRow,
} from "@/lib/print/healthStore";
import { stationCoverage } from "@/lib/print/printerIdentity";
import {
  STATIONS,
  STATION_LABEL,
  STATION_PRINTER_NAME,
  type Station,
} from "@/config/stations";
import { cloudPrntConfigured } from "@/lib/print/status";
import { sendSms } from "@/lib/otp/twilio";

/**
 * GET /api/cron/unprinted-alert — the highest-value safety net in the system.
 *
 * With nothing prepaid, the failure that actually hurts is silent: a customer
 * believes they ordered, the printer never printed, and nobody is looking at
 * the tablet. Two minutes later the owner's phone buzzes.
 *
 * Runs every minute via vercel.json. Idempotent per order: `alerted_at` is
 * stamped by a conditional UPDATE, so two overlapping runs cannot both text
 * about the same order — exactly one wins the claim.
 *
 * No-ops cleanly when the phone or Twilio credentials are unset, because a
 * half-configured deploy must not spew errors every sixty seconds.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Minutes an order may sit unprinted before the owner is told. */
const THRESHOLD_SECONDS = 120;

/**
 * How long a printer may be gone, or out of paper, before the owner hears —
 * PROVIDED something is waiting on it.
 *
 * Five minutes, and the "with orders waiting" condition is the important half.
 * A printer switched off at closing time is not an incident; a printer switched
 * off with four tickets queued behind it is. Alerting on the printer alone
 * would text the owner every night and train them to ignore it, which is the
 * failure mode that matters more than a slightly late alert.
 *
 * Deliberately shorter than the 120s-per-order threshold above compounds to:
 * that sweep waits for an individual order to age, and with the printer known
 * to be down there is nothing to wait for.
 */
const PRINTER_ALERT_SECONDS = 300;

/**
 * How long a roll must report near-end before the owner hears. Long enough
 * that a sensor flickering at the edge of the threshold texts nobody; the
 * text itself goes once per roll, whether or not anything is queued, because
 * "change it before the rush" is useful any time.
 */
const PAPER_LOW_ALERT_SECONDS = 120;

/**
 * Alert sends attempted per order before the claim is left in place for good.
 *
 * A transient Twilio error must not silence an order's alert forever, but an
 * OWNER_ALERT_PHONE that is simply wrong fails identically every time — and
 * retrying that every sixty seconds would burn spend and bury the real problem
 * in log noise. Five is roughly five minutes of trying at the cron's cadence.
 * Past it the /kitchen board is the remaining net, which is what makes
 * stopping safe.
 */
const MAX_ALERT_ATTEMPTS = 5;

/** Constant-time compare that does not leak length via early return. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * The sweep is reachable two ways, and both present the same bearer token:
 *
 *   - Cloudflare's cron trigger, via the scheduled() handler in
 *     custom-worker.ts, which synthesizes a request carrying CRON_SECRET.
 *   - An operator, by hand, to force a sweep.
 *
 * CRON_SECRET IS NOW REQUIRED. It used to be optional — unset meant "open" —
 * because on Vercel the cron path was implicitly privileged and the failure
 * mode of a forgotten variable was an alert that never fired. Neither holds
 * here: this endpoint has a public URL like any other, and a stranger who
 * fires it repeatedly can burn the owner's alert budget and race the real
 * sweep for claims. Refusing loudly when it is unset is the safer default,
 * and the deploy runbook lists it as required.
 */
function authorized(request: Request): boolean {
  const expected = cronSecret();
  if (!expected) {
    console.error(
      "[alert] CRON_SECRET is not set — refusing the sweep. Set it with " +
        "`wrangler secret put CRON_SECRET` (see docs/DEPLOY_RUNBOOK.md).",
    );
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && secretMatches(token, expected);
}

/** What one printer's alert says, for the sweep's JSON. */
interface PrinterAlertOutcome {
  station: Station;
  condition: string;
  queued: number;
  sent: boolean;
}

/**
 * Which alert, if any, this printer's row calls for right now. Offline wins
 * over everything (a silent printer's last paper reading is stale), then a
 * blocked printer, then a low roll.
 */
function printerAlertFor(
  row: PrinterStatusRow,
): { kind: PrinterAlertKind; condition: string } | null {
  const now = Date.now();
  const silentFor = (now - Date.parse(row.lastSeenAt)) / 1000;
  if (silentFor > PRINTER_ALERT_SECONDS) {
    return { kind: "offline", condition: `offline for ${Math.round(silentFor / 60)} min` };
  }
  const blockedFor = row.blockedSince === null ? 0 : (now - Date.parse(row.blockedSince)) / 1000;
  if ((row.paperOut || row.coverOpen) && blockedFor > PRINTER_ALERT_SECONDS) {
    const what = row.paperOut ? "out of paper" : "open (cover)";
    return { kind: "paper", condition: `${what} for ${Math.round(blockedFor / 60)} min` };
  }
  const lowFor = row.paperLowSince === null ? 0 : (now - Date.parse(row.paperLowSince)) / 1000;
  if (row.paperLow && lowFor > PAPER_LOW_ALERT_SECONDS) {
    return { kind: "paper-low", condition: "low on paper" };
  }
  return null;
}

/**
 * EACH PRINTER, checked once per sweep.
 *
 * The per-order alert below catches an order that did not print. This catches
 * the cause a few minutes earlier, and catches it ONCE per outage per printer
 * instead of once per order: ten orders behind a dead printer should be one
 * text naming that printer, not ten saying ten tickets are missing.
 *
 * Offline and paper-out / cover-open text only with something waiting on that
 * printer, so a printer switched off at closing time texts nobody. Paper-low
 * texts once per roll regardless. Every text names the station and what it
 * prints, so the owner knows which of the two to walk to.
 *
 * Alert-once is a stamp per printer per condition, claimed by conditional
 * UPDATE and cleared by that printer's own poll when the condition clears.
 */
async function alertOnPrinters(
  tenantId: string,
  owner: string | null,
  smsReady: boolean,
): Promise<PrinterAlertOutcome[]> {
  if (!cloudPrntConfigured()) return [];

  const rows = await readAllPrinterStatus(tenantId);
  const coverage = stationCoverage();
  const outcomes: PrinterAlertOutcome[] = [];

  for (const station of STATIONS) {
    const row = rows[station];
    if (!row) continue;
    const alert = printerAlertFor(row);
    if (!alert) continue;

    // Everything this printer is printing for: its own station, plus one it is
    // covering while that station has no printer of its own.
    const serves = STATIONS.filter((s) => coverage[s] === station);
    const queued = await countQueuedOrders(tenantId, serves);
    if (alert.kind !== "paper-low" && queued === 0) continue;

    const outcome: PrinterAlertOutcome = { station, condition: alert.condition, queued, sent: false };
    outcomes.push(outcome);
    console.warn(
      `[alert] ${station} printer ${alert.condition} with ${queued} order(s) queued behind it.`,
    );

    if (!owner || !smsReady) continue;
    if (!(await claimPrinterAlert(tenantId, station, alert.kind))) continue;

    const result = await sendSms(owner, printerAlertText(station, serves, alert, queued));
    if (result.sent) {
      outcome.sent = true;
      continue;
    }
    await releasePrinterAlert(tenantId, station, alert.kind);
    console.error(
      `[alert] could not text the owner about the ${station} printer (${alert.condition}): ${result.error}`,
    );
  }
  return outcomes;
}

/** "the STORE printer (phone, walk-in and dine-in orders) is out of paper..." */
function printerAlertText(
  station: Station,
  serves: Station[],
  alert: { kind: PrinterAlertKind; condition: string },
  queued: number,
): string {
  const prints = serves.map((s) => STATION_LABEL[s].toLowerCase()).join(" and ");
  const name = `${STATION_PRINTER_NAME[station]} (${prints} orders)`;
  if (alert.kind === "paper-low") {
    return (
      `${restaurant.name}: the ${name} is running low on paper. ` +
      "Change the roll before it runs out."
    );
  }
  const waiting = `${queued} order${queued === 1 ? " is" : "s are"} waiting`;
  const check =
    alert.kind === "offline"
      ? "Check its power and network"
      : "Check its paper and cover";
  return (
    `${restaurant.name}: the ${name} is ${alert.condition} and ${waiting}. ` +
    `${check}, then open the kitchen screen.`
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  if (!isOrdersDbConfigured()) {
    return Response.json({ ok: true, skipped: "no database" });
  }

  const tenant = publicTenant();
  const owner = ownerAlertPhone();

  // The printer check runs FIRST and independently of the per-order scan: an
  // outage is worth reporting before any single order has aged past two
  // minutes, and a failure in either half must not silence the other.
  let printerAlert: PrinterAlertOutcome[] = [];
  try {
    printerAlert = await alertOnPrinters(tenant.tenantId, owner, isSmsConfigured());
  } catch (err) {
    console.error(
      "[alert] printer health check failed:",
      err instanceof Error ? err.message : "unknown error",
    );
  }

  let due;
  try {
    due = await findUnprintedForAlert(
      tenant.tenantId,
      THRESHOLD_SECONDS,
      businessDateFor(tenant.timezone),
      MAX_ALERT_ATTEMPTS,
    );
  } catch (err) {
    console.error(
      "[alert] could not scan for unprinted orders:",
      err instanceof Error ? err.message : "unknown error",
    );
    return Response.json({ ok: false }, { status: 503 });
  }

  if (due.length === 0) {
    return Response.json({ ok: true, found: 0, alerted: 0, printer: printerAlert });
  }

  // Loud in the logs even when SMS cannot go out — an operator reading logs
  // should not need a phone to discover the kitchen is missing tickets.
  console.warn(
    `[alert] ${due.length} order(s) unprinted for over ${THRESHOLD_SECONDS}s: ` +
      due.map((o) => o.orderNumber).join(", "),
  );

  if (!owner || !isSmsConfigured()) {
    return Response.json({
      ok: true,
      found: due.length,
      alerted: 0,
      skipped: owner ? "SMS is not configured" : "OWNER_ALERT_PHONE is not set",
      printer: printerAlert,
    });
  }

  let alerted = 0;
  let retrying = 0;
  let exhausted = 0;

  for (const order of due) {
    // Claim FIRST. If a concurrent run already claimed it, skip — better a
    // missed duplicate than two texts, and the claim is the only thing that
    // makes "once per order" true. The returned timestamp is the claim token.
    const claimedAt = await markAlerted(tenant.tenantId, order.id);
    if (!claimedAt) continue;

    const itemCount = order.items.reduce((n, line) => n + line.quantity, 0);
    const body =
      `${restaurant.name}: order ${order.orderNumber} (${itemCount} item` +
      `${itemCount === 1 ? "" : "s"}) has NOT printed. ` +
      `Check the ${STATION_PRINTER_NAME[stationCoverage()[order.station]]} ` +
      "and open the kitchen screen.";

    const result = await sendSms(owner, body);
    if (result.sent) {
      alerted++;
      continue;
    }

    // The send failed, so the claim we are holding is a lie: nobody was told.
    // Give it back so the next sweep retries — capped, and only ever undoing
    // OUR OWN claim (see releaseAlertClaim).
    const release = await releaseAlertClaim(
      tenant.tenantId,
      order.id,
      claimedAt,
      MAX_ALERT_ATTEMPTS,
    );
    if (release?.released) retrying++;
    else exhausted++;

    console.error(
      `[alert] could not text the owner about ${order.orderNumber} ` +
        `(attempt ${release?.attempts ?? "?"}/${MAX_ALERT_ATTEMPTS}, ` +
        `${release?.released ? "will retry next sweep" : "giving up — /kitchen is the net now"}): ` +
        `${result.error}`,
    );
  }

  return Response.json({
    ok: true,
    found: due.length,
    alerted,
    retrying,
    exhausted,
    printer: printerAlert,
  });
}
