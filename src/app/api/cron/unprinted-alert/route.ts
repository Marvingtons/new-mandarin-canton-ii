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
  findUnprintedForAlert,
  markAlerted,
  releaseAlertClaim,
} from "@/lib/orders/repository";
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
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. When no secret is
 * configured the endpoint stays open — it leaks nothing (it returns counts,
 * not order data) and the alternative is an alert that silently never fires
 * because someone forgot an env var.
 */
function authorized(request: Request): boolean {
  const expected = cronSecret();
  if (!expected) return true;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && secretMatches(token, expected);
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
    return Response.json({ ok: true, found: 0, alerted: 0 });
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
  });
}
