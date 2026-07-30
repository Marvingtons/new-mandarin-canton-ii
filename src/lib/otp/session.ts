import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { requireOtpSigningSecret } from "@/config/tenant.server";

/**
 * Proof that THIS browser session verified THAT phone number.
 *
 * This is the load-bearing part of the anti-abuse design. Without a card,
 * the only thing standing between the kitchen and a prank order is that
 * someone held the phone that received the code. So:
 *
 *  - The token is an httpOnly cookie. JavaScript on the page cannot read it,
 *    so an XSS or a curious customer cannot lift it and replay it.
 *  - It BINDS the phone number. The order route re-derives the number from the
 *    token and compares it to the one on the order; a client-supplied
 *    `phoneVerified: true` is meaningless and a mismatched phone is rejected.
 *  - It is HMAC-signed with OTP_SIGNING_SECRET and carries its own expiry, so
 *    it cannot be edited to say a different number or to last longer.
 *  - 15 minutes. Long enough to finish a cart, short enough that a shared
 *    device does not leave a usable token behind.
 */

const COOKIE_NAME = "nmc_phone";
const TTL_SECONDS = 15 * 60;

/**
 * Signing key — OTP_SIGNING_SECRET, and nothing else.
 *
 * This used to reuse ADMIN_DASH_PASSWORD to save an env var. The trade was not
 * worth it: the kitchen password is shared aloud among staff and rotated
 * whenever someone leaves, and every one of those rotations silently
 * invalidated every in-flight customer verification.
 *
 * There is no fallback on purpose. If OTP_SIGNING_SECRET is missing this
 * throws a named error at the point of use, which is a deploy that fails
 * loudly — far better than one that silently signs with the kitchen password
 * and rebuilds the coupling this removed.
 */
function signingKey(): string {
  return requireOtpSigningSecret();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export interface VerifiedPhone {
  e164: string;
  /** Epoch ms the verification happened. Stored on the order. */
  verifiedAt: number;
}

/**
 * Build the cookie value. Format: `<e164>.<verifiedAt>.<expiresAt>.<hmac>`.
 * The phone number is inside the signed payload, which is what binds it.
 */
export function mintToken(e164: string, now: number = Date.now()): string {
  const expiresAt = now + TTL_SECONDS * 1000;
  const payload = `${e164}.${now}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/** Parse and verify a token. Returns null for anything not currently valid. */
export function readToken(
  token: string | undefined,
  now: number = Date.now(),
): VerifiedPhone | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [e164, verifiedAtRaw, expiresAtRaw, mac] = parts;

  const payload = `${e164}.${verifiedAtRaw}.${expiresAtRaw}`;
  if (!safeEqual(mac, sign(payload))) return null;

  const expiresAt = Number.parseInt(expiresAtRaw, 10);
  const verifiedAt = Number.parseInt(verifiedAtRaw, 10);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(verifiedAt)) return null;
  if (expiresAt < now) return null;

  return { e164, verifiedAt };
}

export async function setVerifiedCookie(e164: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, mintToken(e164), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function clearVerifiedCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** The verified phone for the current request, or null. */
export async function readVerifiedPhone(): Promise<VerifiedPhone | null> {
  const store = await cookies();
  return readToken(store.get(COOKIE_NAME)?.value);
}

/**
 * Same, for route handlers reading the raw Request.
 *
 * THE VALUE IS PERCENT-ENCODED ON THE WIRE and must be decoded here.
 *
 * The token's first field is an E.164 number, so it starts with "+", and
 * Next's cookie serializer encodes the value on the way out: the browser
 * stores `%2B18582077770.<issued>.<expires>.<hmac>`. `cookies().get()` decodes
 * on the way back in, which is why readVerifiedPhone() above never noticed —
 * but this function parses the raw header, and without a decode the payload it
 * verifies ("%2B1858…") is not the payload that was signed ("+1858…"). The
 * HMAC then fails for every order, and the customer sees the checkout claim
 * "✓ Number verified" while the server answers "Please verify your phone
 * number before ordering". Both were true: the code WAS verified, and this
 * function could not prove it.
 */
export function readVerifiedPhoneFromRequest(
  request: Request,
): VerifiedPhone | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== COOKIE_NAME) continue;
    const raw = rest.join("=");
    // Tolerate both forms. A malformed percent-escape must not throw here —
    // an unparseable cookie is "not verified", not a 500.
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      /* leave it raw; readToken will reject it if it is genuinely broken */
    }
    return readToken(decoded) ?? readToken(raw);
  }
  return null;
}
