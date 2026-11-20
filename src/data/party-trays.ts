/**
 * Party-tray presentation constants.
 *
 * ⚠️ THERE IS NO TRAY PRICE TABLE HERE ANY MORE. This file used to carry a
 * twelve-entry map of tray prices carried over from the deleted seed data,
 * where they were flagged as estimates rather than transcriptions. Three of
 * them disagreed with the printed menu. Tray prices now live beside their
 * dish, as `trayCents` in src/data/menu.ts, so an item's individual price and
 * its tray price cannot drift apart — there is exactly one price source.
 *
 * What remains are two display strings that are NOT on the printed menu and
 * therefore cannot come from the menu data.
 */

/**
 * How many people a party tray feeds.
 *
 * ⚠️ TODO(confirm): capacity claim is owner-provided, NOT on the printed menu
 * (rev. 9/25), whose tray column carries a price and nothing else. It is one
 * constant precisely so the owner can correct it in one edit — never inline
 * this into copy.
 */
export const PARTY_TRAY_SERVES = {
  en: "feeds 15–20 people",
  /** Bilingual surfaces only. Never reaches the ticket — see build:ticket-font. */
  zh: "餐盤 · 15–20人份",
  /** Short form for tight spots, e.g. a size dropdown. */
  short: "feeds 15–20",
} as const;

/* The prep-time warning that used to live here as PARTY_TRAY_PREP_NOTE is now
   `cart.longPrep` in lib/i18n/dictionary.ts.
   Two reasons it had to move. It was English on the Spanish cart; and it named
   only trays while the condition that shows it (`item.longPrep === true ||
   size.id === "party-tray"`, see CartDrawer) also fires for family dinners, so
   a customer with a family dinner and no tray was warned about trays. The
   confirmation screen already said "Party trays & family dinners"; the cart
   now says the same thing one screen earlier. */
