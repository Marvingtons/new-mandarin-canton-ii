/**
 * Restaurant info for New Mandarin Canton II.
 */

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface DailyHours {
  open: string;
  close: string;
  closed?: boolean;
}

export interface RestaurantFeatures {
  /**
   * Year the family first opened here. Drives the "Est. YYYY" heritage
   * mark; null drops the mark entirely and falls the heritage line back
   * to a phrasing that asserts no date, rather than printing a guess.
   *
   * Set this ONLY against something checkable — a permit, a sign, a
   * dated menu, the owner on the record. A wrong founding year on a
   * family restaurant's own website is a trust cost, and it is the one
   * fact here that no customer can correct for us.
   */
  foundingYear: number | null;
  /**
   * Most recent San Diego County health-inspection score, out of 100.
   * null until confirmed — the Health Score chip stays dark until then.
   * ⚠️ CONFIRM the real current score.
   */
  healthScore: number | null;
  /**
   * Amenity flags. null = UNCONFIRMED and is never rendered as fact
   * (claiming an amenity the restaurant lacks misleads customers). Set
   * true only once the owner verifies it, and the matching trust chip
   * lights up on its own. ⚠️ CONFIRM each.
   */
  beerWine: boolean | null;
  freeParking: boolean | null;
  familyFriendly: boolean | null;
  takesReservations: boolean | null;
}

export interface RestaurantInfo {
  name: string;
  /** Verified Chinese name from the restaurant's sign — null until confirmed. */
  chineseName: string | null;
  tagline: string;
  /** Cuisines served, as published across the site. Feeds the trust strip. */
  cuisines: string[];
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  /**
   * Every number on the printed menu (rev. 9/25), in the menu's own order —
   * the first is primary. Both are staffed lines; a customer who cannot get
   * through on one should be given the other, so every "call us" surface
   * shows the whole list rather than just `phones[0]`.
   */
  phones: string[];
  /**
   * IANA zone the hours below are written in. Every open/closed
   * computation resolves through this — never through the visitor's
   * clock, or a guest in New York reads a Chula Vista restaurant as
   * closed three hours early.
   */
  timezone: string;
  hours: Record<DayOfWeek, DailyHours>;
  /** Trust-strip facts, each gated behind confirmation (see above). */
  features: RestaurantFeatures;
}

export const restaurant: RestaurantInfo = {
  name: "New Mandarin Canton II",
  chineseName: "富源", // verified — the name on the restaurant's seal
  // No date here: see the TODO(confirm) on features.foundingYear.
  tagline: "Mandarin, Szechuan & Cantonese cuisine · Chula Vista.",
  cuisines: ["Mandarin", "Szechuan", "Cantonese"], // published everywhere on the site
  address: {
    street: "543 Telegraph Canyon Rd",
    city: "Chula Vista",
    state: "CA",
    zip: "91910",
  },
  phones: ["(619) 656-6888", "(619) 656-6787"],
  timezone: "America/Los_Angeles",
  hours: {
    monday: { open: "11:00 AM", close: "9:00 PM" },
    tuesday: { open: "11:00 AM", close: "9:00 PM" },
    wednesday: { open: "11:00 AM", close: "9:00 PM" },
    thursday: { open: "11:00 AM", close: "9:00 PM" },
    friday: { open: "11:00 AM", close: "9:00 PM" },
    saturday: { open: "11:00 AM", close: "9:30 PM" },
    sunday: { open: "11:00 AM", close: "8:30 PM" },
  },
  // All null = unconfirmed. Fill in each real value and the matching
  // trust-strip chip lights up automatically — no component changes.
  features: {
    // TODO(confirm): founding year with owner. This read `1995` with the
    // comment "confirmed by the owner", but nothing in the repo records
    // that confirmation, and the About page's own draft says "(No dates
    // until confirmed.)" — the same builder, contradicting himself. Every
    // other confirmed fact here names a checkable artifact (the seal for
    // chineseName, the printed menu rev. 9/25 for the phones); this one
    // named none. Until it does, the site asserts no year and the
    // heritage line falls back to its no-date phrasing.
    foundingYear: null,
    healthScore: null, // ⚠️ CONFIRM SD County score → "Health Score N/100"
    beerWine: null, // ⚠️ CONFIRM
    freeParking: null, // ⚠️ CONFIRM
    familyFriendly: null, // ⚠️ CONFIRM
    takesReservations: null, // ⚠️ CONFIRM
  },
};

/* ------------------------------------------------------------------ *
 * Derived values. Everything below is computed from the record above —
 * no component re-derives an address, a tel: href, or a maps URL, so a
 * single edit up there moves the whole site.
 * ------------------------------------------------------------------ */

/** "543 Telegraph Canyon Rd, Chula Vista, CA 91910" — one line. */
export const fullAddress = `${restaurant.address.street}, ${restaurant.address.city}, ${restaurant.address.state} ${restaurant.address.zip}`;

/** `tel:` href for one formatted number, digits only, with the country code. */
export function telHrefFor(phone: string): string {
  return `tel:+1${phone.replace(/\D/g, "")}`;
}

/** The primary number, for surfaces that genuinely only have room for one. */
export const primaryPhone = restaurant.phones[0];

/** `tel:` href for the primary number. */
export const telHref = telHrefFor(primaryPhone);

/** Both numbers with their hrefs, in menu order. */
export const phoneLinks = restaurant.phones.map((phone) => ({
  phone,
  href: telHrefFor(phone),
}));

/** "(619) 656-6888 or (619) 656-6787" — for plain-text and error copy. */
export const phonesSentence = restaurant.phones.join(" or ");

const mapsQuery = encodeURIComponent(fullAddress);

/** Keyless Google Maps iframe source — no API key, no billing account. */
export const mapEmbedUrl = `https://www.google.com/maps?q=${mapsQuery}&output=embed`;

/** Opens Google Maps (app or web) pointed at the restaurant. */
export const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

/**
 * "Open 7 days from 11:00 AM" — derived, never written by hand.
 *
 * The footer used to summarise the week as "Open 7 days · 11 AM to
 * close", sitting inches from a per-day table that closes at 9:00, 9:30
 * and 8:30 depending on the day. A summary that contradicts the table
 * below it is worse than no summary, so this only states what every open
 * day genuinely shares: that we are open, and when we open. If the days
 * ever stop agreeing on the opening time it says less rather than
 * something false.
 */
export const weeklyOpeningSummary: string = (() => {
  const all = Object.values(restaurant.hours);
  const open = all.filter((h) => !h.closed);
  if (open.length === 0) return "";
  const days =
    open.length === all.length
      ? "Open 7 days"
      : `Open ${open.length} days a week`;
  const sameOpening = open.every((h) => h.open === open[0].open);
  return sameOpening ? `${days} from ${open[0].open}` : days;
})();

/** "Est. 1995", or null while the founding year is unconfirmed. */
export const establishedLabel = restaurant.features.foundingYear
  ? `Est. ${restaurant.features.foundingYear}`
  : null;

/**
 * The heritage line, always safe to print.
 *
 * With a confirmed founding year it is precise, bucketed DOWN to a round
 * decade ("30+ years on Telegraph Canyon") so the claim stays true every
 * day of the year without a yearly edit.
 *
 * Without one it keeps the warmth and drops the number. This is the only
 * place on the site that phrasing is decided, so confirming the year
 * upgrades every surface at once.
 */
export function tenureLine(now: Date = new Date()): string {
  const { foundingYear } = restaurant.features;
  if (foundingYear == null) return "Family-run on Telegraph Canyon for decades";
  const decades = Math.floor((now.getFullYear() - foundingYear) / 10) * 10;
  if (decades < 10) return "Family-run on Telegraph Canyon";
  return `${decades}+ years on Telegraph Canyon`;
}
