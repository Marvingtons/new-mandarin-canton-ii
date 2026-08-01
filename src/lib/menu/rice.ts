import type { MenuModifierGroup } from "@/lib/menu/types";

/**
 * The included rice side, as a required $0 choice.
 *
 * RICE IS INCLUDED. Every option here is priceCents 0, and that is the
 * whole point: this is not an add-on, it is the entrée asking which of
 * the two rices it should come with. Modelling it as a priced extra
 * would put a $0.00 next to every dish and teach customers to read the
 * group as an upsell they can decline. `verify:rice` asserts the
 * price-invariance rather than leaving it to a comment.
 *
 * The group is REQUIRED (minRequired 1) so the kitchen never gets a
 * ticket that fails to say which rice. Steamed is listed first and is
 * what the sheet preselects, so the required choice costs a customer who
 * does not care exactly nothing.
 *
 * ⚠️ This file must stay client-safe. It is imported by catalog.ts
 * (server-only) AND reached from the item sheet through the menu prop,
 * and it is read by the ticket-font glyph collector at build time. No
 * server-only imports, no data fetching, just the shapes.
 */

/**
 * One group id for every item, and that is safe: modifier ids are
 * resolved against the ITEM's own groups (see cart/pricing.ts), never
 * globally, so "rice" on a beef dish and "rice" on a family dinner
 * cannot collide. A shared id also means the kitchen board and the
 * ticket show the same identity for the same choice across the menu.
 */
export const RICE_GROUP_ID = "rice";

export const RICE_STEAMED_ID = "rice-steamed";
export const RICE_FRIED_ID = "rice-fried";
export const RICE_BOTH_ID = "rice-both";

/**
 * Categories whose entrées come with rice, i.e. everything that arrives as
 * a dish to eat over rice.
 *
 * Appetizers and Soup are not entrées. Fried Rice and Noodles ARE the
 * starch — offering a rice side with an order of fried rice is how a
 * kitchen ends up bagging two rices. Those four are the exclusions the
 * owner gave, and this set is the only place they are written down.
 */
export const RICE_CATEGORY_IDS: ReadonlySet<string> = new Set([
  "specials",
  "chicken",
  "seafood",
  "beef",
  "pork",
  "sizzling-hot-pot",
  "vegetables",
]);

/** Categories that feed 2+ people and may therefore split the rice. */
export const RICE_SPLIT_CATEGORY_IDS: ReadonlySet<string> = new Set([
  "family-dinners",
  "big-family-dinner",
]);

/**
 * The rice group.
 *
 * `allowSplit` adds the half-and-half option, which exists only on the
 * family sets because it only makes sense for a table. A single entrée
 * cannot be served half one rice and half the other.
 *
 * The Both option carries three strings on purpose, and each has one job:
 *   nameEn "Both"           — the label in the sheet
 *   nameZh "白飯+炒飯"       — what TRAVELS and what PRINTS, and it is
 *                             explicit rather than clever, because a cook
 *                             reading a ticket at speed should not have to
 *                             infer two rices from one word
 *   note   "各一半 …"        — display-only by the type's own contract, so
 *                             the sheet can say it the way the menu says
 *                             it without that phrasing reaching the kitchen
 */
export function riceGroup(allowSplit: boolean): MenuModifierGroup {
  return {
    id: RICE_GROUP_ID,
    nameEn: "Rice",
    nameZh: "飯",
    minRequired: 1,
    maxAllowed: 1,
    modifiers: [
      {
        id: RICE_STEAMED_ID,
        nameEn: "Steamed Rice",
        nameZh: "白飯",
        priceCents: 0,
      },
      {
        id: RICE_FRIED_ID,
        nameEn: "Fried Rice",
        nameZh: "炒飯",
        priceCents: 0,
      },
      ...(allowSplit
        ? [
            {
              id: RICE_BOTH_ID,
              nameEn: "Both",
              nameZh: "白飯+炒飯",
              priceCents: 0,
              note: "各一半, half steamed and half fried",
            },
          ]
        : []),
    ],
  };
}

/**
 * Which group an item in this category should get, or null for none.
 * One function so the à la carte builder and the combo builder cannot
 * disagree about who gets rice.
 */
export function riceGroupForCategory(
  categoryId: string,
): MenuModifierGroup | null {
  if (RICE_SPLIT_CATEGORY_IDS.has(categoryId)) return riceGroup(true);
  if (RICE_CATEGORY_IDS.has(categoryId)) return riceGroup(false);
  return null;
}

/**
 * Every string the rice group can put ON A TICKET, for the font subset.
 *
 * The glyph collector walks `src/data/menu.ts` for à la carte modifiers,
 * and the rice group is injected later in catalog.ts — so without this
 * the subset would simply not know 白飯 or 炒飯 existed for ~130 dishes and
 * the printer would draw .notdef boxes. Combo items are walked through
 * their built modifierGroups and would have been fine; this covers both
 * regardless, because "which builder was it added in" is not a thing the
 * font subset should have an opinion about.
 *
 * `note` IS DELIBERATELY EXCLUDED. It is display-only by the type's own
 * contract — it never enters the stored order and never reaches paper —
 * so its glyphs are the browser's problem, not the printer's. Including
 * it would drag 各 (U+5404) into a subset that is shipped as two .ttf
 * files, to render a character no ticket can ever contain.
 */
export function riceGlyphStrings(): string[] {
  const out: string[] = [];
  for (const group of [riceGroup(false), riceGroup(true)]) {
    out.push(group.nameEn);
    if (group.nameZh) out.push(group.nameZh);
    for (const mod of group.modifiers) {
      out.push(mod.nameEn);
      if (mod.nameZh) out.push(mod.nameZh);
    }
  }
  return out;
}
