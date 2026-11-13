import "server-only";

import type { OtpStartResult } from "@/lib/otp/twilio";

/**
 * One SMS per number per CLAIM_TTL_MS, however many /api/otp/start requests
 * arrive for it at once.
 *
 * A double-tapped "Text me a code", a retried fetch, or two tabs racing used to
 * be two (or five) Twilio Verify sends: the burst limit allows 3 per 15
 * minutes, and the requests all passed it before the first one finished. Now
 * the first request for a normalized number takes a claim holding its Twilio
 * call; every request for the same number while the claim stands gets THAT
 * call's outcome (the same success response) and never reaches Twilio.
 *
 *   - In flight: duplicates await the same promise.
 *   - Sent: the claim stands for CLAIM_TTL_MS from the send, so a duplicate
 *     arriving just after it finished is answered too.
 *   - Failed: the claim is released at once, so the customer can retry.
 *
 * 30 seconds: Twilio Verify documents no resend window to align with, so the
 * fallback the fix spec gives. A real "Resend code" inside it is answered with
 * success and no new text; the first text is normally still arriving then.
 *
 * In memory, like lib/http/rateLimit: per isolate. Concurrent duplicates from
 * one browser land on one warm isolate in practice; this is a guard on spend,
 * not a ledger, and Twilio's own per-number limits remain the backstop.
 */
export const CLAIM_TTL_MS = 30_000;

/** Bounded, so a flood of distinct numbers cannot grow it without limit. */
const MAX_CLAIMS = 5_000;

interface Claim {
  result: Promise<OtpStartResult>;
  /** Epoch ms after which a SETTLED claim no longer answers. */
  expiresAt: number;
}

const claims = new Map<string, Claim>();

/**
 * The outcome of a start already claimed for this number, or null when the
 * caller should make one. Synchronous, so a caller that checks and then calls
 * claimOtpStart with no await in between cannot race another request.
 */
export function joinOtpStart(phoneE164: string, now = Date.now()): Promise<OtpStartResult> | null {
  const claim = claims.get(phoneE164);
  if (!claim) return null;
  if (claim.expiresAt <= now) {
    claims.delete(phoneE164);
    return null;
  }
  return claim.result;
}

/** Make the one Twilio call for this number and hold the claim on it. */
export function claimOtpStart(
  phoneE164: string,
  send: () => Promise<OtpStartResult>,
): Promise<OtpStartResult> {
  if (claims.size >= MAX_CLAIMS) {
    const oldest = claims.keys().next().value;
    if (oldest !== undefined) claims.delete(oldest);
  }
  const claim: Claim = {
    result: send().then(
      (result) => {
        if (result.status === "sent") claim.expiresAt = Date.now() + CLAIM_TTL_MS;
        else if (claims.get(phoneE164) === claim) claims.delete(phoneE164);
        return result;
      },
      (err: unknown) => {
        if (claims.get(phoneE164) === claim) claims.delete(phoneE164);
        throw err;
      },
    ),
    // Unsettled: stands until the send settles (then TTL, or released).
    expiresAt: Number.POSITIVE_INFINITY,
  };
  claims.set(phoneE164, claim);
  return claim.result;
}
