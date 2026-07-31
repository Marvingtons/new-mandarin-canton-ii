/**
 * WHERE THE KITCHEN SCREEN LIVES, as one answer.
 *
 * The staff board used to be at a hardcoded `/kitchen`, which is the first
 * path anyone would try on a restaurant site. `KITCHEN_ROUTE_SLUG` moves it —
 * `orders-x7k2`, or whatever the owner sets — and the screen mounts at
 * `/{slug}` through a dynamic segment that checks the value server-side, the
 * same shape the CloudPRNT route uses for its path secret. Changing where the
 * board lives is a variable and a deploy; it is never a code change.
 *
 * ⚠️ THE SLUG IS NOT SECURITY, AND NOTHING HERE MAY BE TRADED FOR IT.
 *
 * ADMIN_DASH_PASSWORD and the httpOnly HMAC session are what actually protect
 * this screen, exactly as before, and they are unchanged. The slug is a speed
 * bump: it keeps the board out of opportunistic scans and out of a referrer a
 * staff member pastes somewhere. A URL travels in browser history, in a
 * bookmark on a shared tablet, in whatever a phone syncs to the cloud — it is
 * not a credential and cannot be treated as one. If anyone ever proposes
 * dropping the password "because the URL is secret", this paragraph is the
 * answer: an unguessable URL that leaks stays leaked, and a password can be
 * changed.
 *
 * ⚠️ AND IT IS NEVER PUBLISHED. Not in robots.txt (a Disallow line is a
 * directory of the paths worth trying), not in a sitemap, not in a redirect
 * from the old path. A wrong slug 404s like any other unknown page.
 *
 * No `server-only`: the value is a URL, not a credential, and the login
 * redirect needs it. It is still only ever read on the server — nothing in
 * this file runs in a browser bundle today, and if that changes the slug is
 * the least of what leaks.
 */

/** What the board answers on when nothing is configured — the old path. */
const DEFAULT_SLUG = "kitchen";

/**
 * The configured slug, sanitised.
 *
 * A path segment, so anything that is not URL-safe is rejected rather than
 * escaped: a slug containing a slash would mount the board somewhere nobody
 * intended, and one containing a space or a percent would half-work in ways
 * that are miserable to debug. An unusable value falls back to the default,
 * loudly, rather than taking the board offline — a typo in a variable must not
 * be able to hide the screen the kitchen runs on.
 */
export function kitchenSlug(): string {
  const raw = process.env.KITCHEN_ROUTE_SLUG?.trim();
  if (!raw) return DEFAULT_SLUG;
  if (!/^[A-Za-z0-9._~-]+$/.test(raw)) {
    console.warn(
      `[kitchen] KITCHEN_ROUTE_SLUG=${JSON.stringify(raw)} is not a usable path ` +
        `segment (letters, digits, . _ ~ - only) — falling back to /${DEFAULT_SLUG}.`,
    );
    return DEFAULT_SLUG;
  }
  return raw;
}

/** The board's path, e.g. "/orders-x7k2". The one string every caller uses. */
export function kitchenPath(): string {
  return `/${kitchenSlug()}`;
}

/**
 * Does this request's path segment address the board?
 *
 * Plain comparison, not constant-time, and that is a considered choice rather
 * than an oversight: the slug is not a secret (see the header), and a timing
 * oracle against a value that is already in the staff's browser history buys
 * an attacker nothing. The password comparison, which IS security, is
 * constant-time in lib/auth/kitchenSession.
 */
export function isKitchenSlug(segment: string | undefined): boolean {
  return typeof segment === "string" && segment === kitchenSlug();
}
