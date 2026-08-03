/**
 * Restaurant info for New Mandarin Canton II.
 */

import { yearsSince } from "@/lib/years";

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
  /**
   * The last time an ONLINE order may be placed today, 12-hour like the
   * others. The dining room stays open until `close`; this is only about
   * the website's Place Order button.
   *
   * PER DAY, and living here rather than in an env var on purpose. The
   * weekly hours table renders through the footer, which is in the root
   * layout, so these strings are baked into every prerendered page at
   * build time. An env-sourced cutoff would change the API gate the
   * moment it was set while the marketing pages kept advertising the old
   * time until the next deploy. Keeping it in this file means the gate
   * and the printed promise can only ever move together.
   *
   * Required, not optional: a day without one would silently fall back to
   * some default, and "which days have a cutoff" is exactly the question
   * nobody should have to answer by reading code.
   */
  lastOnlineOrder: string;
}

export interface RestaurantFeatures {
  /**
   * Year the family first opened here. Drives the "Est. YYYY" heritage
   * mark and the counted years in the About story; null drops the mark
   * entirely and falls the heritage line back to a phrasing that asserts
   * no date, rather than printing a guess.
   *
   * Set this ONLY against something checkable — a permit, a sign, a
   * dated menu, the owner on the record. A wrong founding year on a
   * family restaurant's own website is a trust cost, and it is the one
   * fact here that no customer can correct for us.
   *
   * CONFIRMED. The family's own written history opens "我们的餐厅创立于
   * 1995年" / "Our restaurant opened its doors in 1995" — the owner on
   * the record, in writing, which is the strongest source this field has
   * ever had. See app/about/page.tsx, which prints that sentence.
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
  // No date in the tagline: <Established /> states it, and the footer
  // renders both within four lines of each other.
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
  /*
   * `close` is when the DOORS shut. `lastOnlineOrder` is when the website
   * stops taking orders.
   *
   * OWNER-CONFIRMED, and it replaced both halves of the question that used
   * to sit here. The old Saturday TODO asked whether an 8:30 PM cutoff
   * against a 9:30 PM close was really intended; the answer came back as
   * neither of the two options it offered. Saturday closes at 9:00 PM now,
   * not 9:30, and the cutoff is not a separate decision at all:
   *
   *   THE CUTOFF IS THE CLOSING TIME, EVERY DAY. No buffer, anywhere.
   *
   * 8:30 PM Sun–Fri, 9:00 PM Saturday, opening unchanged at 11:00 AM
   * daily. The flag is gone because it is answered, not because it was
   * tidied away.
   *
   * ⚠️ EVERY DAY IS NOW THE ZERO-BUFFER DAY. What used to be true of
   * Sunday alone is true of the whole week: an order may be placed in the
   * same minute the doors are locked. That is safe for exactly one
   * reason — readyWindow() caps BOTH ends of the quoted pickup window at
   * closing time (lib/order/readyWindow.ts), so an 8:29 PM order quotes
   * "8:30 PM" and not the 8:44 or 8:59 its prep range would otherwise
   * produce. That cap used to be a belt over one day's braces. It is now
   * the only thing standing between the site and promising seven days a
   * week a pickup after close. scripts/verify-order-cutoff.ts pins it at
   * the boundary minute on a weekday, on Saturday and on Sunday; if the
   * cap is ever removed, that file fails rather than a customer arriving
   * at a locked door.
   *
   * The other consequence, and it is deliberate: `lastOnlineOrder` no
   * longer agrees across the week, so `sharedLastOnlineOrder` below is
   * null and every surface that quotes a cutoff names TODAY's. See
   * lib/hours.ts's todaysCutoff().
   */
  hours: {
    monday: { open: "11:00 AM", close: "8:30 PM", lastOnlineOrder: "8:30 PM" },
    tuesday: { open: "11:00 AM", close: "8:30 PM", lastOnlineOrder: "8:30 PM" },
    wednesday: { open: "11:00 AM", close: "8:30 PM", lastOnlineOrder: "8:30 PM" },
    thursday: { open: "11:00 AM", close: "8:30 PM", lastOnlineOrder: "8:30 PM" },
    friday: { open: "11:00 AM", close: "8:30 PM", lastOnlineOrder: "8:30 PM" },
    saturday: { open: "11:00 AM", close: "9:00 PM", lastOnlineOrder: "9:00 PM" },
    sunday: { open: "11:00 AM", close: "8:30 PM", lastOnlineOrder: "8:30 PM" },
  },
  // All null = unconfirmed. Fill in each real value and the matching
  // trust-strip chip lights up automatically — no component changes.
  features: {
    // 1995, and no longer on an artifact's word. The family's written
    // history states it themselves; see the field's doc comment above.
    foundingYear: 1995,
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

/**
 * "8:30 PM" when every open day agrees, otherwise null.
 *
 * ⚠️ IT IS NULL NOW, and that is the expected value rather than a fault.
 * Same discipline as weeklyOpeningSummary above: it states a single time
 * only when a single time is true. Saturday's cutoff is 9:00 PM against
 * 8:30 the rest of the week, so there is no single time to state — the
 * exact case the previous version of this comment predicted.
 *
 * Every surface that quotes a cutoff therefore names TODAY's, through
 * `todaysCutoff()` in lib/hours.ts. This export is kept because it is
 * still the right question ("is one number true for the whole week?") and
 * a week-wide phrasing is still the better copy on the day it is honest —
 * if the owner ever levels Saturday, the surfaces read it again with no
 * code change. Callers must treat null as "say today's", never as
 * "say nothing": three of them used to drop their whole line on null,
 * which turned a Saturday hours change into a Saturday with no cutoff
 * published anywhere.
 */
export const sharedLastOnlineOrder: string | null = (() => {
  const open = Object.values(restaurant.hours).filter((h) => !h.closed);
  if (open.length === 0) return null;
  const first = open[0].lastOnlineOrder;
  return open.every((h) => h.lastOnlineOrder === first) ? first : null;
})();

/** "Est. 1995", or null while the founding year is unconfirmed. */
export const establishedLabel = restaurant.features.foundingYear
  ? `Est. ${restaurant.features.foundingYear}`
  : null;

/**
 * WHOLE YEARS OPEN — the single source for every year figure the site
 * states, and null while the founding year is unconfirmed.
 *
 * Everything that counts years goes through here: the About story's
 * "Thirty-one years have passed…", and `tenureLine` below. Before this
 * there was one count, inline in `tenureLine`, and the About page's
 * years were prose — so the page and the footer could disagree and
 * nothing would catch it.
 *
 * Takes `now` so a caller can pin the date; defaults to the real clock,
 * which is what every render uses.
 */
export function yearsOpen(now: Date = new Date()): number | null {
  const { foundingYear } = restaurant.features;
  return foundingYear == null ? null : yearsSince(foundingYear, now);
}

/**
 * Whole decades open, rounded DOWN, or null under ten years and while
 * the founding year is unconfirmed.
 *
 * ROUNDED ON PURPOSE, and deliberately not the About story's exact
 * count. This feeds the heritage line in the footer of every page, which
 * is a standing mark that has to stay true on every day of every year
 * without an edit; the story's "thirty-one years" is one sentence the
 * family wrote about a specific moment. Same utility underneath
 * (`yearsOpen`), two different jobs.
 *
 * The PHRASING that wraps this lives in the dictionary, not here — see
 * `established.tenure` — because it is copy, and copy on this site has
 * to exist in Spanish too. This function is the arithmetic.
 */
export function tenureDecades(now: Date = new Date()): number | null {
  const years = yearsOpen(now);
  if (years == null) return null;
  const decades = Math.floor(years / 10) * 10;
  return decades < 10 ? null : decades;
}
