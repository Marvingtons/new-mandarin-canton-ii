import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The owner PIN (OWNER_PIN), required for every change on the printers page:
 * assigning a printer, changing a route, changing copies.
 *
 * The kitchen session is one shared password for the whole staff, which is
 * right for seeing what the printers are doing and wrong for deciding which
 * printer prints the takeout tickets. The PIN is a second, owner-only secret,
 * sent with each change and never stored in a cookie, so there is no elevated
 * session to leave open on a counter tablet.
 *
 * Compared as SHA-256 digests with timingSafeEqual: both sides are always 32
 * bytes, so neither the length nor the first wrong character leaks through
 * timing. Unset means NO changes at all, never "no PIN needed".
 *
 * Rate limiting lives with the callers: an in-memory per-IP limiter as the
 * cheap first layer, and a database count of wrong PINs per tenant as the
 * lockout that holds across Worker isolates (lib/print/printers.ts).
 */

function configuredPin(): string | null {
  const value = process.env.OWNER_PIN?.trim();
  return value && value.length > 0 ? value : null;
}

export function ownerPinConfigured(): boolean {
  return configuredPin() !== null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** True only when a PIN is configured AND the submitted one matches it. */
export function ownerPinMatches(submitted: string): boolean {
  const pin = configuredPin();
  if (!pin) return false;
  return timingSafeEqual(digest(submitted.trim()), digest(pin));
}
