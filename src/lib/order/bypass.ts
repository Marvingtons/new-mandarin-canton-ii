import "server-only";

import { timingSafeEqual } from "node:crypto";
import { orderGateBypassSecret } from "@/config/tenant.server";

/**
 * ORDER_GATE_BYPASS — a keyed skip for the order path's TIME gates, so real
 * end-to-end orders can be placed outside business hours (late-night deploys,
 * printer troubleshooting, owner demos).
 *
 * It skips exactly two things, both of them clocks:
 *   - the business-hours gate, including the 20-minute pre-close cutoff
 *   - the lunch-special 11–3 window
 *
 * It skips NOTHING else. A bypassed order still needs a verified phone, still
 * has its prices recomputed from the menu, still counts against the per-phone
 * daily cap, still honours idempotency, and still gets its pickup window
 * computed the same way. Those are the controls that stand in for payment;
 * they are not time gates and they are not negotiable.
 *
 * `import "server-only"` is load-bearing. lib/order/gates.ts and
 * lib/order/pickup.ts — where the gates themselves live — are imported by
 * client components (OrderMenu, Checkout), so the comparison could not go
 * there without risking the secret reaching the browser. Putting it in a
 * server-only module means an accidental client import FAILS THE BUILD rather
 * than shipping the key.
 *
 * When the secret is unset, or the header is missing or wrong, every one of
 * these returns false and the order path behaves exactly as it always has.
 * A wrong header is deliberately NOT an error: a distinct response would tell
 * a prober that a bypass exists.
 */

/** The header a bypassing request must present. */
const BYPASS_HEADER = "x-gate-bypass";

/** Constant-time string compare that also doesn't leak length via timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do the work, so a wrong-length guess is not faster than a
    // right-length one.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Does this request carry a valid bypass key?
 *
 * False whenever ORDER_GATE_BYPASS is unset — an unconfigured deploy has no
 * bypass to present, whatever the caller sends.
 */
export function isGateBypassRequest(request: Request): boolean {
  const secret = orderGateBypassSecret();
  if (!secret) return false;

  const presented = request.headers.get(BYPASS_HEADER);
  if (!presented) return false;

  return safeEqual(presented, secret);
}

/**
 * Shape-only validation of a pickup value, for bypassed requests.
 *
 * The normal path validates the submitted slot with `isValidPickup`, which
 * asks the slot GENERATOR whether it would offer that time — and the generator
 * returns nothing at all outside ordering hours. So on a bypassed request it
 * would refuse every value, including "asap", and the bypass would not work.
 *
 * This is the substitute: accept "asap" or a real 24h wall clock, and let
 * every other bound still apply (the max-pickup-hours cap, resolution against
 * the current business date). Hours are the only thing not checked, which is
 * the entire point of the bypass.
 *
 * Bounded on purpose — "99:99" would otherwise resolve to an absurd instant
 * and get stored on the order.
 */
export function isWellFormedPickupValue(value: string): boolean {
  if (value === "asap") return true;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return false;
  const hours = Number.parseInt(m[1], 10);
  const minutes = Number.parseInt(m[2], 10);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}
