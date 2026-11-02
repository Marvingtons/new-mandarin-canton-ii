import "server-only";

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Session for the /kitchen board.
 *
 * A single shared password (ADMIN_DASH_PASSWORD) is the right shape here: the
 * users are a family and a counter tablet, not an identity directory. What
 * matters is that the weaknesses of that shape are not compounded:
 *
 *  - The password NEVER goes in the cookie. The cookie carries an expiry plus
 *    an HMAC over it, keyed by the password, so a stolen cookie cannot be
 *    turned back into the password.
 *  - Comparison is constant-time, on both the password and the HMAC.
 *  - httpOnly + sameSite=lax + secure in production. No client-side check
 *    decides anything; every /kitchen route re-verifies server-side.
 *  - No password in a URL, ever. Login is a POST.
 *
 * ⚠️ TODO(confirm): a single shared password has no per-person audit trail. If
 * the owner ever wants to know WHICH staff member tapped 完成, this needs real
 * accounts. Ask before assuming it does not matter.
 */

const COOKIE_NAME = "nmc_kitchen";

/** Sessions last a full shift, so a tablet is not logged out mid-service. */
const SESSION_SECONDS = 12 * 60 * 60;

function configuredPassword(): string | null {
  const value = process.env.ADMIN_DASH_PASSWORD;
  return value && value.length > 0 ? value : null;
}

export function isKitchenAuthConfigured(): boolean {
  return configuredPassword() !== null;
}

/** Constant-time string compare that does not leak length via early return. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Burn an equivalent comparison so timing cannot distinguish a wrong
    // length from a wrong value.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function sign(expiresAt: number, password: string): string {
  return createHmac("sha256", password)
    .update(`kitchen.${expiresAt}`)
    .digest("hex");
}

/** Build the cookie value for a session expiring at `expiresAt` (epoch ms). */
function tokenFor(expiresAt: number, password: string): string {
  return `${expiresAt}.${sign(expiresAt, password)}`;
}

/**
 * Verify a submitted password. Returns the cookie value on success.
 * Returns null when the password is wrong OR when none is configured — an
 * unconfigured dashboard must be closed, not open.
 */
export function login(submitted: string): string | null {
  const password = configuredPassword();
  if (!password) return null;
  if (!safeEqual(submitted, password)) return null;

  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  return tokenFor(expiresAt, password);
}

/** Is this cookie value a live, untampered session? */
export function verifyToken(token: string | undefined): boolean {
  const password = configuredPassword();
  if (!password || !token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const expiresAt = Number.parseInt(token.slice(0, separator), 10);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  return safeEqual(token.slice(separator + 1), sign(expiresAt, password));
}

/** Read the session from the incoming request cookies. */
export async function hasKitchenSession(): Promise<boolean> {
  const store = await cookies();
  return verifyToken(store.get(COOKIE_NAME)?.value);
}

/** Same check for route handlers, which get the cookie off the Request. */
export function hasKitchenSessionFromRequest(request: Request): boolean {
  const header = request.headers.get("cookie");
  if (!header) return false;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return verifyToken(rest.join("="));
  }
  return false;
}

export async function setKitchenCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearKitchenCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * Deliberate, constant-ish delay on a failed login. Not a real defence on its
 * own — it just makes an online guessing run against a shared password tedious
 * rather than instant.
 */
export async function loginFailureDelay(): Promise<void> {
  const jitter = randomBytes(1)[0];
  await new Promise((resolve) => setTimeout(resolve, 400 + jitter));
}
