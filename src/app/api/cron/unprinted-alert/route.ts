import { timingSafeEqual } from "node:crypto";
import {
  cronSecret,
  isSmsConfigured,
  ownerAlertPhone,
  publicTenant,
} from "@/config/tenant.server";
import { restaurant } from "@/data/restaurant";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import {
  countQueuedOrders,
  findUnprintedForAlert,
  markAlerted,
  releaseAlertClaim,
} from "@/lib/orders/repository";
import {
  claimPrinterAlert,
  readPrinterStatus,
  releasePrinterAlert,
} from "@/lib/print/healthStore";
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

/**
 * THE PRINTER ITSELF, checked once per sweep.
 *
 * The per-order alert above catches an order that did not print. This catches
 * the cause a few minutes earlier — and, more usefully, catches it ONCE for
 * the whole outage instead of once per order. Ten orders behind a dead printer
 * should be one text saying the printer is dead, not ten saying ten tickets
 * are missing.
 *
 * Alert-once has its own stamp per condition (offline_alerted_at,
 * paper_alerted_at), claimed by the same conditional UPDATE the order sweep
 * uses. The stamps are cleared by the poll route the moment the condition
 * clears, so this is once per OUTAGE and not once ever.
 *
 * Returns a description for the sweep's JSON, or null when there is nothing to
 * say. No-ops entirely when there is no printer configured, no status row yet,
 * or nothing queued.
 */
async function alertOnPrinter(
  tenantId: string,
  owner: string | null,
  smsReady: boolean,
): Promise<{ condition: string; queued: number; sent: boolean } | null> {
  if (!cloudPrntConfigured()) return null;

  const row = await readPrinterStatus(tenantId);
  if (!row) return null;

  const silentFor = (Date.now() - Date.parse(row.lastSeenAt)) / 1000;
  const blockedFor =
    row.blockedSince === null
      ? 0
      : (Date.now() - Date.parse(row.blockedSince)) / 1000;

  // Offline wins when both are true: a printer that is not answering cannot be
  // fixed by putting paper in it, and the owner should be told the bigger fact.
  const kind: "offline" | "paper" | null =
    silentFor > PRINTER_ALERT_SECONDS
      ? "offline"
      : (row.paperOut || row.coverOpen) && blockedFor > PRINTER_ALERT_SECONDS
        ? "paper"
        : null;
  if (kind === null) return null;

  // The condition that makes it an incident rather than a closed restaurant.
  const queued = await countQueuedOrders(tenantId);
  if (queued === 0) return null;

  const condition =
    kind === "offline"
      ? `offline for ${Math.round(silentFor / 60)} min`
      : `${row.paperOut ? "out of paper" : "cover open"} for ${Math.round(blockedFor / 60)} min`;

  // Loud in the log whether or not a text can go out — the same rule the order
  // sweep follows, for the same reason.
  console.warn(
    `[alert] printer ${condition} with ${queued} order(s) queued behind it.`,
  );

  if (!owner || !smsReady) return { condition, queued, sent: false };

  // Claim before sending. A concurrent sweep that loses the claim stays quiet.
  if (!(await claimPrinterAlert(tenantId, kind))) {
    return { condition, queued, sent: false };
  }

  const body =
    `${restaurant.name}: the printer is ${condition} and ${queued} order` +
    `${queued === 1 ? " is" : "s are"} waiting. Check paper, power and network, ` +
    "then open the kitchen screen.";

  const result = await sendSms(owner, body);
  if (result.sent) return { condition, queued, sent: true };

  // Nobody was told, so the claim is a lie. Give it back for the next sweep —
  // uncapped on purpose, unlike the per-order retry: the condition is ongoing
  // and self-clearing, so a failed send retries only while the printer is
  // still down rather than forever.
  await releasePrinterAlert(tenantId, kind);
  console.error(
    `[alert] could not text the owner about the printer (${condition}): ${result.error}`,
  );
  return { condition, queued, sent: false };
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
  let printerAlert = null;
  try {
    printerAlert = await alertOnPrinter(tenant.tenantId, owner, isSmsConfigured());
  } catch (err) {
    console.error(
      "[alert] printer health check failed:",
      err instanceof Error ? err.message : "unknown error",
    );
  }

  let due;
  try {
    due = await findUnprintedForAlert(tenant.tenantId, THRESHOLD_SECONDS);
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
      `Check the printer and open the kitchen screen.`;

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
