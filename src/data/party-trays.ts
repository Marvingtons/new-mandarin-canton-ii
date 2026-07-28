/**
 * Party-tray pricing, keyed by menu item id.
 *
 * ⚠️ PROVENANCE — READ BEFORE TRUSTING THESE NUMBERS.
 *
 * The printed menu (rev. 9/25) lists a party-tray price beside most entrées,
 * but `src/data/menu.ts` deliberately transcribed only the INDIVIDUAL prices —
 * its header says tray pricing was to be "modeled in Clover as size variants".
 * Clover is now gone, so this file is where tray pricing lives instead.
 *
 * The ten entries below are carried over from the deleted `seed-menu.ts`, where
 * they were explicitly flagged as estimates rather than transcriptions. Their
 * INDIVIDUAL prices were verified to match `menu.ts` exactly (15 of 16 items),
 * which is why the file is trustworthy as a mapping — but that says nothing
 * about the tray prices themselves.
 *
 * ⚠️ TODO(confirm): every value here must be checked against the printed menu
 * before a tray can be sold. Until an id appears in this map the item is sold
 * single-size only, which is the safe default — an item with no tray option
 * cannot be mispriced.
 *
 * Money is INTEGER CENTS. Nothing in the orders path may introduce a float.
 */

export interface PartyTray {
  /** Integer cents. */
  priceCents: number;
  /** Display-only serving hint. */
  servesNote?: string;
}

/**
 * ⚠️ TODO(confirm): unverified tray prices AND unverified serving counts.
 * Two ids appear for the same dish where the printed menu lists it under both
 * Specials and its own section; both carry the same tray price on purpose.
 */
export const partyTraysByItemId: Record<string, PartyTray> = {
  // Chicken
  "orange-flavored-chicken": { priceCents: 7500, servesNote: "feeds 8–10" },
  "orange-flavored-chicken-special": { priceCents: 7500, servesNote: "feeds 8–10" },
  "kung-pao-chicken": { priceCents: 9000, servesNote: "feeds 8–10" },
  "chicken-broccoli": { priceCents: 7000, servesNote: "feeds 8–10" },
  "sesame-chicken": { priceCents: 7500, servesNote: "feeds 8–10" },
  // Beef
  "mongolian-beef": { priceCents: 7500, servesNote: "feeds 8–10" },
  "mongolian-beef-special": { priceCents: 7500, servesNote: "feeds 8–10" },
  "beef-broccoli": { priceCents: 7200, servesNote: "feeds 8–10" },
  // Seafood
  "honey-walnut-shrimp": { priceCents: 9500, servesNote: "feeds 8–10" },
  "kung-pao-shrimp": { priceCents: 10000, servesNote: "feeds 8–10" },
  // Rice & noodles
  "house-special-fried-rice": { priceCents: 6500, servesNote: "feeds 8–10" },
  "house-soft-noodle": { priceCents: 6800, servesNote: "feeds 8–10" },
};

export function partyTrayFor(itemId: string): PartyTray | undefined {
  return partyTraysByItemId[itemId];
}
