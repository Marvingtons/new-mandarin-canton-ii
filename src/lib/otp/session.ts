import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { requireAdminPassword } from "@/config/tenant.server";

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
 *  - It is HMAC-signed and carries its own expiry, so it cannot be edited to
 *    say a different number or to last longer.
 *  - 15 minutes. Long enough to finish a cart, short enough that a shared
 *    device does not leave a usable token behind.
 */

const COOKIE_NAME = "nmc_phone";
const TTL_SECONDS = 15 * 60;

/**
 * Signing key.
 *
 * ⚠️ TODO(confirm): this reuses ADMIN_DASH_PASSWORD rather than introducing
 * yet another secret to configure. That is a deliberate trade — one fewer env
 * var to forget — but it does mean rotating the kitchen password invalidates
 * every in-flight verification. Customers mid-order would have to re-verify.
 * If that becomes annoying, give this its own OTP_SIGNING_SECRET; nothing else
 * changes.
 */
function signingKey(): string {
  return requireAdminPassword();
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

/** Same, for route handlers reading the raw Request. */
export function readVerifiedPhoneFromRequest(
  request: Request,
): VerifiedPhone | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return readToken(rest.join("="));
  }
  return null;
}
