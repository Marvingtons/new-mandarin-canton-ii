import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";

/**
 * The four pages worth indexing.
 *
 * A sitemap is a statement about what this site IS, not a dump of its routes.
 * Deliberately absent, and each for its own reason:
 *
 *   the kitchen board     — staff-only, and its path is configurable
 *                           (KITCHEN_ROUTE_SLUG). Already noindex'd at its own
 *                           layout; naming it in a public file would undo both
 *                           that and the point of making it configurable.
 *   /api/*                — not pages. The CloudPRNT endpoint's whole security
 *                           model is an unguessable path segment.
 *   /order                — a redirect to /menu. Listing both would ask Google
 *                           to pick a canonical between a page and its own
 *                           forwarding address.
 *   /order/checkout       — a form that is meaningless without a cart, and
 *   /order/confirmation     one that shows a customer's name, phone and order
 *                           number. Neither should ever be a search result.
 *
 * `changeFrequency` and `priority` are hints crawlers are free to ignore, and
 * mostly do. They are set anyway because the honest values are cheap: the menu
 * moves when the printed menu is reprinted, and the story does not move at all.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  // One timestamp for the whole build. Per-page dates would be a lie unless
  // they came from the content, and none of this content has a date.
  const lastModified = new Date();

  return [
    {
      url: base,
      lastModified,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      // The page that both hero CTAs land on, and the only one that can take
      // an order. If one URL from this site is indexed, it should be this one.
      url: `${base}/menu`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${base}/about`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${base}/contact`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.6,
    },
  ];
}
