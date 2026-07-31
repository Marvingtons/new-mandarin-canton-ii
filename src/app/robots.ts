import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";

/**
 * Crawl the four marketing pages; stay out of everything else.
 *
 * ⚠️ ROBOTS.TXT IS NOT ACCESS CONTROL. It is a request, honoured by the
 * crawlers that choose to, and a published list of paths worth looking at for
 * anyone who does not. So nothing here is the only thing protecting anything:
 *
 *   /api/    — the CloudPRNT endpoint's protection is an unguessable secret in
 *              the path, and it is deliberately NOT named here; `/api/` is
 *              enough to keep crawlers out without publishing the shape of
 *              what is behind it.
 *   /order/  — checkout and confirmation. The confirmation page shows a
 *              customer's name, phone number and order number; it is also
 *              unreachable without their own session cookie.
 *
 * /order itself redirects to /menu, so disallowing the prefix costs nothing:
 * the destination is the page that is meant to be indexed.
 *
 * ⚠️ THE KITCHEN BOARD IS DELIBERATELY ABSENT, and used to be listed here.
 * Its path is configurable now (KITCHEN_ROUTE_SLUG — see lib/kitchenRoute), and
 * a Disallow line is the one place on a website guaranteed to publish a path
 * to anyone curious enough to read it. Printing the slug here would hand out
 * the thing the variable exists to keep quiet, for no benefit: what actually
 * keeps that screen out of an index is `robots: { index: false }` in its own
 * layout — which is the directive that removes a page ALREADY indexed, where a
 * Disallow only stops the crawl — and what actually protects it is the
 * password. Not listing it costs nothing and gives nothing away.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/order/", "/order"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
