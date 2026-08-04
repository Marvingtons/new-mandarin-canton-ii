/**
 * JSON-LD builders — what this restaurant is, in the shape a machine reads.
 *
 * WHY THIS EXISTS. An answer engine asked "Chinese restaurant in Chula
 * Vista" cannot infer a business from a beautiful page. It reads
 * structured data or it reads nothing. Everything here is generated from
 * the same records the pages render — data/restaurant.ts and
 * data/menu.ts — so there is exactly one copy of every fact and the
 * markup cannot drift from the page.
 *
 * ⚠️ TWO RULES, AND THEY OUTRANK COMPLETENESS.
 *
 * 1. NOTHING IS INVENTED. Every field here traces to a confirmed value.
 *    A property whose source is null is OMITTED, never guessed and never
 *    filled with a plausible default: `priceRange`, `geo`, `sameAs`,
 *    `acceptsReservations` and the amenity flags are all absent for that
 *    reason, and each absence is noted where it would have gone. An
 *    absent field costs a little richness. A wrong one is a business
 *    telling search engines something untrue about itself.
 *
 * 2. NOTHING IS MARKED UP THAT A READER CANNOT SEE. Google's structured
 *    data policy prohibits it, and the penalty is a manual action. This
 *    is why the 137 `chineseName` values in data/menu.ts are NOT in the
 *    menu graph: they are real, they are the restaurant's own names for
 *    those dishes, and they currently render nowhere on /menu (see the
 *    note on `menuGraph`). The moment they are visible they belong here.
 *
 * Absolute URLs throughout — a crawler has no page to resolve against.
 */

import { menu } from "@/data/menu";
import {
  directionsUrl,
  primaryPhone,
  restaurant,
  type DayOfWeek,
} from "@/data/restaurant";
import { siteUrl } from "@/lib/siteUrl";

/** Loose JSON-LD node. The shapes are schema.org's, not ours to retype. */
type Node = Record<string, unknown>;

/** Stable @ids, so nodes can reference each other across pages. */
const ids = {
  restaurant: () => `${siteUrl()}/#restaurant`,
  website: () => `${siteUrl()}/#website`,
  menu: () => `${siteUrl()}/menu#menu`,
};

const SCHEMA_DAY: Record<DayOfWeek, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

/**
 * "9:00 PM" → "21:00". Schema wants ISO 8601 local time; the data file
 * is written in the 12-hour clock the printed menu and the door use.
 *
 * Returns null rather than a guess if the string is not the shape it
 * expects, and a null drops that day from the specification instead of
 * publishing a wrong opening time.
 */
export function to24Hour(time: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!m) return null;
  const [, h, min, mer] = m;
  let hour = Number(h) % 12;
  if (mer.toUpperCase() === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${min}`;
}

/**
 * When the DOORS are open, per day.
 *
 * Deliberately the doors and not `lastOnlineOrder`: this property
 * answers "are they open right now", and a customer standing outside at
 * 8:45 PM on a Saturday is not turned away. The website's earlier
 * ordering cutoff is a fact about this website, not about the
 * restaurant, and there is no schema.org property that means it.
 */
function openingHours(): Node[] {
  const specs: Node[] = [];
  for (const [day, hours] of Object.entries(restaurant.hours) as [
    DayOfWeek,
    (typeof restaurant.hours)[DayOfWeek],
  ][]) {
    if (hours.closed) continue;
    const opens = to24Hour(hours.open);
    const closes = to24Hour(hours.close);
    if (!opens || !closes) continue;
    specs.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: SCHEMA_DAY[day],
      opens,
      closes,
    });
  }
  return specs;
}

/**
 * The business itself.
 *
 * `Restaurant` rather than the generic `LocalBusiness`: it is the most
 * specific type that is actually true, which is what the spec asks for.
 *
 * OMITTED ON PURPOSE, each because data/restaurant.ts holds it as null
 * and that file's rule is that an unconfirmed fact is never rendered as
 * one — `priceRange`, `geo` (no coordinates are recorded anywhere; the
 * map is a keyless embed built from the address string), `sameAs` (no
 * social or review profile URL exists in this codebase), `servesBeer` /
 * `servesWine`, `acceptsReservations`, and the health rating. Every one
 * of them is on the confirm-with-the-family list rather than in here.
 */
export function restaurantNode(): Node {
  const base = siteUrl();
  return {
    "@type": "Restaurant",
    "@id": ids.restaurant(),
    name: restaurant.name,
    // The name on the seal, the sign and the header. Verified.
    ...(restaurant.chineseName ? { alternateName: restaurant.chineseName } : {}),
    url: base,
    logo: `${base}/icon.png`,
    image: `${base}/images/storefront.jpg`,
    // One number, though both are staffed and every "call us" surface on
    // the site shows both. `telephone` is singular by definition; the
    // second line is reachable from every page and from the FAQ answer.
    telephone: primaryPhone,
    address: {
      "@type": "PostalAddress",
      streetAddress: restaurant.address.street,
      addressLocality: restaurant.address.city,
      addressRegion: restaurant.address.state,
      postalCode: restaurant.address.zip,
      addressCountry: "US",
    },
    hasMap: directionsUrl,
    servesCuisine: restaurant.cuisines,
    menu: `${base}/menu`,
    // Confirmed by the family's own written history. Year only: the
    // month is not recorded anywhere checkable.
    ...(restaurant.features.foundingYear
      ? { foundingDate: String(restaurant.features.foundingYear) }
      : {}),
    openingHoursSpecification: openingHours(),
  };
}

/** The site, and who publishes it. */
export function websiteNode(): Node {
  const base = siteUrl();
  return {
    "@type": "WebSite",
    "@id": ids.website(),
    name: restaurant.name,
    url: base,
    publisher: { "@id": ids.restaurant() },
  };
}

/** Home > Page. Built from a list so a page states its own trail. */
export function breadcrumbNode(
  trail: { name: string; path: string }[],
): Node {
  const base = siteUrl();
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: `${base}${step.path}`,
    })),
  };
}

/**
 * The whole printed menu, from data/menu.ts.
 *
 * GENERATED, NEVER TRANSCRIBED. The visible menu and this graph read the
 * same array, so a price corrected on the printed menu moves both or
 * neither. Hand-copying 143 dishes into markup would have created a
 * second menu that silently goes stale, which is the failure this whole
 * file is arranged to avoid.
 *
 * `offers` mirrors what the page shows: an item priced two ways on the
 * printed menu (Roasted Duck half/whole, Egg Drop Soup cup/bowl) gets an
 * offer per tier with its own name, and everything else gets one. Party
 * tray prices are included where the printed menu prints one.
 *
 * ⚠️ NO `alternateName`, and it is the one thing here that hurts to
 * leave out. 137 items carry a `chineseName` and none of them render on
 * /menu — DESIGN.md specifies "Chinese dish names inline and muted" for
 * this page, so their absence looks like a regression rather than a
 * decision. Marking up 137 names a visitor cannot see would breach
 * Google's visible-content rule. Render them and this becomes three
 * lines.
 */
export function menuGraph(): Node {
  return {
    "@type": "Menu",
    "@id": ids.menu(),
    name: "Menu",
    inLanguage: "en",
    hasMenuSection: menu.map((category) => ({
      "@type": "MenuSection",
      name: category.name,
      hasMenuItem: category.items.map((item) => {
        const offers: Node[] = item.sizes?.length
          ? item.sizes.map((size) => ({
              "@type": "Offer",
              name: size.label,
              price: (size.priceCents / 100).toFixed(2),
              priceCurrency: "USD",
            }))
          : [
              {
                "@type": "Offer",
                price: (item.priceCents / 100).toFixed(2),
                priceCurrency: "USD",
              },
            ];
        if (item.trayCents) {
          offers.push({
            "@type": "Offer",
            name: "Party tray",
            price: (item.trayCents / 100).toFixed(2),
            priceCurrency: "USD",
          });
        }
        return {
          "@type": "MenuItem",
          name: item.name,
          // Rendered on the row by describeItem(), so it is visible.
          ...(item.description ? { description: item.description } : {}),
          offers,
        };
      }),
    })),
  };
}

/* NO faqNode HERE ANY MORE, and it must not come back on its own. It
   emitted a FAQPage whose questions came from the same dictionary keys
   the visible <dl> rendered — the only honest way to build one. The
   visible FAQ is gone from /contact, and FAQPage markup describing
   questions no page shows is a structured-data violation Google acts on,
   not a harmless leftover. If a FAQ ever returns, the schema returns
   with the component that renders it, from the same strings. */

/** Wrap nodes in the @graph envelope a page embeds. */
export function graph(...nodes: Node[]): Node {
  return { "@context": "https://schema.org", "@graph": nodes };
}
