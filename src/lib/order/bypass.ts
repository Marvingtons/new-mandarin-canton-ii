import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  orderGateBypassSecret,
  requireOtpSigningSecret,
} from "@/config/tenant.server";

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

/* ------------------------------------------------------ browser sessions -- */

/**
 * TEST MODE — the same bypass, reachable from a real browser.
 *
 * The header works fine for curl and is useless in a browser: you cannot add
 * one to a normal navigation, so end-to-end testing of the actual order UI
 * outside business hours meant not testing the UI at all. This trades the
 * header for a cookie ONCE, at /api/test-mode, and nothing else changes — the
 * cookie is a second way to present the same signal, not a second signal.
 *
 * WHY THE KEY IS NOT IN THE COOKIE. The cookie carries only an expiry and a
 * signature over it. So the value is useless anywhere else: it cannot be
 * replayed as a header, it does not identify the key, and a leaked cookie
 * expires on its own. What it proves is "this browser presented the key at
 * some point in the last four hours", which is exactly the claim being made.
 *
 * Signed with OTP_SIGNING_SECRET rather than a new secret, and
 * DOMAIN-SEPARATED by the "testmode." prefix in the payload so a signature
 * minted here can never be mistaken for a phone-verification token, or the
 * reverse. That is the same technique lib/otp/session.ts uses between its own
 * two cookie types.
 *
 * Four hours: long enough for a night of deploy testing, short enough that
 * forgetting about it costs one shift rather than indefinitely. The badge
 * exists because that "forgetting" is the real risk here, not the crypto.
 */
export const TEST_MODE_COOKIE = "nmc_test_mode";

/** 4 hours, in seconds — for the cookie's Max-Age. */
export const TEST_MODE_TTL_SECONDS = 4 * 60 * 60;

function testModeSign(payload: string): string {
  return createHmac("sha256", requireOtpSigningSecret())
    .update(`testmode.${payload}`)
    .digest("hex");
}

/** `<expiresAtMs>.<hmac>` — no key, no identity, just a bounded claim. */
export function issueTestModeCookie(now: Date = new Date()): string {
  const expiresAt = String(now.getTime() + TEST_MODE_TTL_SECONDS * 1000);
  return `${expiresAt}.${testModeSign(expiresAt)}`;
}

/**
 * Is this a cookie we minted, still inside its window?
 *
 * Expiry is checked against the payload we signed, so editing it invalidates
 * the signature — the browser's own cookie expiry is a convenience, never the
 * control.
 */
export function isValidTestModeCookie(
  value: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!value) return false;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (!safeEqual(mac, testModeSign(payload))) return false;
  const expiresAt = Number.parseInt(payload, 10);
  return Number.isFinite(expiresAt) && now.getTime() < expiresAt;
}

/** Pull one cookie out of a raw Cookie header without pulling in a parser. */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Does this request carry a valid bypass — by header OR by test-mode cookie?
 *
 * ONE function on purpose. The route below asks this exactly once and logs
 * exactly once, so a cookie-bypassed order takes the identical code path, hits
 * the identical GATE BYPASSED warning, and skips the identical two clocks. A
 * second entry point would have been a second thing to keep in step.
 *
 * False whenever ORDER_GATE_BYPASS is unset — an unconfigured deploy has no
 * bypass to present, whatever the caller sends, cookie included.
 */
export function isGateBypassRequest(request: Request): boolean {
  const secret = orderGateBypassSecret();
  if (!secret) return false;

  const presented = request.headers.get(BYPASS_HEADER);
  if (presented && safeEqual(presented, secret)) return true;

  return isValidTestModeCookie(readCookie(request, TEST_MODE_COOKIE));
}

/** Constant-time check of a presented key, for the test-mode route. */
export function isGateBypassKey(presented: string | null | undefined): boolean {
  const secret = orderGateBypassSecret();
  if (!secret || !presented) return false;
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
