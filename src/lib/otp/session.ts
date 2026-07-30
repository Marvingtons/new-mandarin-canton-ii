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

/* --------------------------------------------------- remembered numbers -- */

/**
 * The long-lived "this browser already proved this number" cookie.
 *
 * Separate cookie, separate lifetime, separate SIGNATURE DOMAIN. It reuses
 * OTP_SIGNING_SECRET rather than adding a variable — one more secret to set is
 * one more to forget, and a forgotten one here fails open into "nobody is ever
 * remembered", which is silent — but it is domain-separated by signing
 * `remember-v1.<payload>` instead of the payload alone.
 *
 * That separation is load-bearing: without it the two token formats are close
 * enough that a 15-minute order token could be pasted into this cookie and be
 * honoured for 90 days. With it, a signature made for one is meaningless to the
 * other.
 *
 * Payload: `<e164>.<issuedAt>.<hmac>`. Age is checked against the CURRENT TTL
 * rather than baked in, so shortening VERIFIED_PHONE_TTL_DAYS retroactively
 * expires cookies already out there instead of honouring their old promise.
 */
const REMEMBER_COOKIE = "nmc_verified";
const REMEMBER_DOMAIN = "remember-v1";

function rememberSign(payload: string): string {
  return createHmac("sha256", signingKey())
    .update(`${REMEMBER_DOMAIN}.${payload}`)
    .digest("hex");
}

export function mintRememberToken(e164: string, now: number = Date.now()): string {
  const payload = `${e164}.${now}`;
  return `${payload}.${rememberSign(payload)}`;
}

/**
 * Verify a remember token and return the number it binds, or null.
 *
 * `ttlDays` of 0 disables the feature outright — every token is refused, which
 * is what makes VERIFIED_PHONE_TTL_DAYS=0 a real off switch rather than a
 * shorter leash.
 */
export function readRememberToken(
  token: string | undefined,
  ttlDays: number,
  now: number = Date.now(),
): VerifiedPhone | null {
  if (!token || ttlDays <= 0) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [e164, issuedAtRaw, mac] = parts;

  if (!safeEqual(mac, rememberSign(`${e164}.${issuedAtRaw}`))) return null;

  const issuedAt = Number.parseInt(issuedAtRaw, 10);
  if (!Number.isFinite(issuedAt)) return null;
  // A future-dated token is a clock problem or a forgery attempt; either way
  // it is not evidence of anything.
  if (issuedAt > now) return null;
  if (now - issuedAt > ttlDays * 86_400_000) return null;

  return { e164, verifiedAt: issuedAt };
}

/** Set the 90-day cookie. No-op when the feature is switched off. */
export async function setRememberCookie(
  e164: string,
  ttlDays: number,
): Promise<void> {
  if (ttlDays <= 0) return;
  const store = await cookies();
  store.set(REMEMBER_COOKIE, mintRememberToken(e164), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlDays * 86_400,
  });
}

/**
 * The remembered number for this request, or null.
 *
 * Decodes for the same reason readVerifiedPhoneFromRequest does: the payload
 * starts with "+" and Next percent-encodes cookie values on the way out.
 */
export function readRememberedPhoneFromRequest(
  request: Request,
  ttlDays: number,
): VerifiedPhone | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== REMEMBER_COOKIE) continue;
    const raw = rest.join("=");
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      /* fall through to the raw form */
    }
    return (
      readRememberToken(decoded, ttlDays) ?? readRememberToken(raw, ttlDays)
    );
  }
  return null;
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
