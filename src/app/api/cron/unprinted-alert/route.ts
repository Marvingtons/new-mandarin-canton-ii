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
  countReroutedAwaySince,
  findUnprintedForAlert,
  markAlerted,
  releaseAlertClaim,
} from "@/lib/orders/repository";
import {
  claimAllDownAlert,
  claimPrinterDownAlert,
  clearAllDownAlert,
  listPrinters,
  markSilentPrintersDown,
  releaseAllDownAlert,
  releasePrinterDownAlert,
  type PrinterView,
} from "@/lib/print/printers";
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
 * PRINTER TEXTS (migration 011, owner decision 5 Nov 2026). "Down" is the
 * routing rule's: silent for 60s and not mid-print, or paper-out / cover-open
 * for 60s.
 *
 *   ONE printer down, another up and carrying its tickets: one text naming it
 *   after 5 minutes. Once per down spell; a paper-out that turns into offline
 *   is the same spell. Only if at least one ticket was actually rerouted away
 *   from it: switching the POS printer off at night while the takeout printer
 *   stays on must not text anyone.
 *
 *   EVERY active printer down: an URGENT text after 2 minutes, repeated every
 *   10 minutes until one recovers. Only with orders waiting: a restaurant
 *   switched off at closing time is not an incident. With a single printer,
 *   that printer down is this case.
 */
const ONE_DOWN_ALERT_SECONDS = 300;
const ALL_DOWN_ALERT_SECONDS = 120;
const ALL_DOWN_REPEAT_SECONDS = 600;
/** Cron jitter: a sweep a few seconds early must not skip a whole repeat. */
const REPEAT_SLACK_SECONDS = 15;

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
 * THE PRINTERS THEMSELVES, checked once per sweep.
 *
 * The per-order alert below catches an order that did not print. This catches
 * the cause a few minutes earlier, and catches it ONCE for the whole outage
 * instead of once per order. Ten orders behind a dead printer should be one
 * text saying the printer is dead, not ten saying ten tickets are missing.
 *
 * Every claim is a conditional UPDATE (printer_health.down_alerted_at,
 * print_alert_state.all_down_alerted_at), so overlapping sweeps send one text,
 * and a failed send gives the claim back for the next sweep.
 */
interface PrinterAlertSummary {
  kind: "one-down" | "all-down";
  printers: string[];
  minutes: number;
  sent: boolean;
}

function condition(p: PrinterView): string {
  if (p.paperOut && !(p.secondsSinceSeen === null || p.secondsSinceSeen > 60)) return "out of paper";
  if (p.coverOpen && !(p.secondsSinceSeen === null || p.secondsSinceSeen > 60)) return "cover open";
  return "offline";
}

async function alertOnPrinters(
  tenantId: string,
  owner: string | null,
  smsReady: boolean,
): Promise<PrinterAlertSummary[] | null> {
  if (!cloudPrntConfigured()) return null;

  // A silent printer cannot stamp itself down; the sweep does it too, so a
  // restaurant whose only printer died still gets its down_since.
  await markSilentPrintersDown(tenantId);
  const active = (await listPrinters(tenantId)).filter((p) => p.active && p.role !== null);
  if (active.length === 0) return null;

  const now = Date.now();
  const downFor = (p: PrinterView) =>
    p.downStartedAt ? Math.max(0, (now - Date.parse(p.downStartedAt)) / 1000) : 0;
  const down = active.filter((p) => p.down);
  const out: PrinterAlertSummary[] = [];

  /* ---------------- every printer down ---------------- */
  if (down.length === active.length) {
    // Measured from the LAST printer to go down: that is when nothing could
    // print any more.
    const allFor = Math.min(...down.map(downFor));
    if (allFor < ALL_DOWN_ALERT_SECONDS) return out;
    const queued = await countQueuedOrders(tenantId);
    if (queued === 0) return out;

    const minutes = Math.round(allFor / 60);
    const names = down.map((p) => `${p.label} (${condition(p)})`);
    console.warn(
      `[alert] ALL printers down for ${minutes} min with ${queued} order(s) waiting: ${names.join(", ")}`,
    );
    const summary: PrinterAlertSummary = { kind: "all-down", printers: names, minutes, sent: false };
    out.push(summary);
    if (!owner || !smsReady) return out;

    const claim = await claimAllDownAlert(tenantId, ALL_DOWN_REPEAT_SECONDS - REPEAT_SLACK_SECONDS);
    if (!claim.claimed) return out;
    const body =
      `URGENT ${restaurant.name}: ${active.length === 1 ? "the printer is" : "ALL printers are"} down ` +
      `(${names.join(", ")}) for ${minutes} min and ${queued} order` +
      `${queued === 1 ? " is" : "s are"} waiting. Nothing is printing. Check paper, power and ` +
      "network, and read orders off the kitchen screen.";
    const result = await sendSms(owner, body);
    if (result.sent) {
      summary.sent = true;
    } else {
      await releaseAllDownAlert(tenantId, claim.previous);
      console.error(`[alert] could not text the owner that all printers are down: ${result.error}`);
    }
    return out;
  }

  /* ---------------- one printer down, another covering ---------------- */
  await clearAllDownAlert(tenantId);
  const covering = active.find((p) => !p.down);

  for (const p of down) {
    const seconds = downFor(p);
    if (seconds < ONE_DOWN_ALERT_SECONDS || !p.downStartedAt) continue;
    if (p.downAlertedAt !== null) continue;
    // Gate: it is only an incident if tickets actually went elsewhere.
    const moved = await countReroutedAwaySince(tenantId, p.id, new Date(p.downStartedAt));
    if (moved === 0) continue;

    const minutes = Math.round(seconds / 60);
    console.warn(
      `[alert] ${p.label} down (${condition(p)}) for ${minutes} min; ${moved} ticket(s) ` +
        `printed on ${covering?.label ?? "another printer"} instead.`,
    );
    const summary: PrinterAlertSummary = { kind: "one-down", printers: [p.label], minutes, sent: false };
    out.push(summary);
    if (!owner || !smsReady) continue;
    if (!(await claimPrinterDownAlert(p.id))) continue;

    const body =
      `${restaurant.name}: ${p.label} has been down (${condition(p)}) for ${minutes} min. ` +
      `Its tickets are printing on ${covering?.label ?? "the other printer"}, marked REROUTED. ` +
      "Check its paper, power and network.";
    const result = await sendSms(owner, body);
    if (result.sent) {
      summary.sent = true;
    } else {
      await releasePrinterDownAlert(p.id);
      console.error(`[alert] could not text the owner about ${p.label}: ${result.error}`);
    }
  }
  return out;
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
