/**
 * The site's canonical origin, for the one pair of files that cannot use a
 * relative URL: sitemap.ts and robots.ts, which are consumed by crawlers that
 * have no page context to resolve against.
 *
 * The zone is inferred nowhere and configured here. `NEXT_PUBLIC_SITE_URL`
 * overrides it — set that on a preview deployment, or a staging crawl will
 * advertise production URLs and a production crawl will advertise staging's.
 *
 * Trailing slashes are stripped so callers can always write `${siteUrl()}/menu`.
 */
const DEFAULT_ORIGIN = "https://newmandarincantonii.com";

export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const origin = configured && configured.length > 0 ? configured : DEFAULT_ORIGIN;
  return origin.replace(/\/+$/, "");
}
