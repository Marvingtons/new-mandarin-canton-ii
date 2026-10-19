/**
 * Which deployment is this request on: production, a preview, or a
 * developer's own machine.
 *
 * WHY THIS EXISTS. Every Workers Builds branch gets a preview URL
 * (<branch>-nmc-web.<account>.workers.dev), and a preview runs with the
 * PRODUCTION bindings: the same Hyperdrive database, the same Twilio
 * account, the same kitchen printer queue. An order placed on a preview
 * is a real order. Until previews get their own bindings, this is the
 * line between "look at the branch" and "cook the food".
 *
 * THE PRODUCTION HOST IS A CONSTANT, deliberately not siteUrl(). That
 * one is overridable by NEXT_PUBLIC_SITE_URL precisely so a preview can
 * advertise its own address, and a guard that a preview can configure its
 * way past is not a guard.
 *
 * LOCALHOST IS ALLOWED TO ORDER. `next dev` and `next start` run against
 * the local database (npm run dev:db), and blocking them would break the
 * order flow's own verification. It cannot be used to slip past the guard
 * in deployment: Cloudflare routes a request to this Worker by its Host,
 * so a request that reaches a workers.dev or custom hostname carries that
 * hostname, never "localhost".
 */

export const PRODUCTION_HOST = "newmandarincantonii.com";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Hostname only, lowercased, port dropped. From a URL or a Host header. */
export function normalizeHost(host: string | null | undefined): string {
  if (!host) return "";
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

export function requestHost(request: Request): string {
  return normalizeHost(request.headers.get("host") ?? new URL(request.url).host);
}

export function isProductionHost(host: string): boolean {
  return normalizeHost(host) === PRODUCTION_HOST;
}

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(normalizeHost(host));
}

/** Ordering (and the SMS verification in front of it) runs only here. */
export function orderingAllowedOn(host: string): boolean {
  return isProductionHost(host) || isLocalHost(host);
}

/**
 * The response every ordering endpoint returns on a preview, BEFORE it
 * reads the body, touches the database, sends a text or queues a ticket.
 * null means carry on. Same `{ ok: false, error }` shape the checkout
 * already displays.
 */
export function previewOrderingBlocked(request: Request): Response | null {
  if (orderingAllowedOn(requestHost(request))) return null;
  return Response.json(
    {
      ok: false,
      error:
        "This is a preview of the website. Ordering is disabled here. · 此為預覽網站，無法下單。",
      reason: "preview_host",
    },
    { status: 403 },
  );
}
