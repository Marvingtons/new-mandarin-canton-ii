/**
 * The exact glyph set the kitchen ticket can print.
 *
 * The full Noto Sans TC is ~11 MB, which no serverless bundle should carry, so
 * `scripts/build-ticket-font.ts` subsets it to precisely the characters this
 * file can produce. That makes the font tiny — and makes THIS file the single
 * definition of what is printable.
 *
 * EVERY Chinese string the ticket prints itself lives in TICKET_LABELS below,
 * and the glyph set is DERIVED from it. That is deliberate: the first draft
 * kept the labels in render.tsx and the glyph list here, they drifted within
 * the hour, and "已付款" printed as "已". A label that is not in this file
 * cannot reach the paper.
 *
 * ⚠️ After adding a label here, or 中文 to menu.ts / combo-items.ts / any
 * override map, re-run `npm run build:ticket-font`, then
 * `npm run verify:ticket-glyphs` to prove the subset really contains them.
 * Forgetting is not silent: the renderer logs every codepoint it had to draw as
 * .notdef, and the verify script fails the build.
 *
 * WHAT THE COLLECTOR MUST WALK. Everything that can reach a ticket, which is
 * more than the override maps this file used to read:
 *
 *   - the fixed chrome (TICKET_LABELS + Latin/symbols)
 *   - every à la carte item's English name AND `chineseName` (menu.ts)
 *   - every size label the catalogue can produce, and its 中文
 *   - every modifier name the catalogue can produce, and its 中文
 *   - EVERY COMBO: lunch specials, family dinners, big family dinners — their
 *     item names, their per-head size labels, and the entrée choices that reach
 *     a ticket as modifier lines. This was the gap: combo names were never
 *     collected, so 午市套餐 and 家庭套餐一 were one order away from printing □.
 *
 * Pure data. No `server-only`, so the build script can import it too — which is
 * why it reads the DATA modules rather than `menu/catalog.ts`.
 */

import { menu } from "@/data/menu";
import { comboCategories } from "@/data/combo-items";
import {
  categoryZhByName,
  modifierZhByName,
  sizeZhByLabel,
  itemOverridesById,
} from "@/data/menu-overrides";
import { restaurant } from "@/data/restaurant";

/**
 * Every fixed string the ticket renders. render.ts must use these constants
 * rather than inline 中文 — that is what keeps the subset honest.
 */
export const TICKET_LABELS = {
  /** Header: this is a takeout order. */
  takeout: "外賣單",
  reprint: "重印",
  pickup: "取餐時間",
  note: "備註",
  customer: "客人",
  phone: "電話",
  placed: "落單",
  subtotal: "小計",
  tax: "稅金",
  tip: "小費",
  total: "合計",
  payAtCounter: "到店付款",
  /** The copy bar at the top of each ticket. */
  copyKitchen: "廚房",
  copyBag: "袋",
  copyRegister: "收銀",
} as const;

/**
 * Latin, digits, punctuation and symbols the layout uses. Kept separate from
 * the 中文 so it is obvious which half is which.
 */
const LATIN_AND_SYMBOLS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "abcdefghijklmnopqrstuvwxyz" +
  "0123456789" +
  " .,:;'\"!?()[]{}#$%&*+-–—/\\@_=<>|~^`" +
  // Symbols the layout depends on: quantity, separator, the modifier bullet,
  // and the brackets that box a non-default size chip.
  "×·✓●○→【】";

/** Fixed chrome: the labels above plus the Latin/symbol set. */
export const TICKET_UI_GLYPHS =
  Object.values(TICKET_LABELS).join("") + LATIN_AND_SYMBOLS;

/**
 * Every codepoint the ticket could need.
 *
 * Reads the same data the order pipeline reads, so a name that can be ordered
 * is a name that can be printed. Anything added here costs one glyph in a
 * subset that is already only ~100 KB per weight.
 */
export function collectTicketGlyphs(): string {
  const parts: string[] = [TICKET_UI_GLYPHS];

  if (restaurant.chineseName) parts.push(restaurant.chineseName);
  parts.push(restaurant.name);

  // À la carte: the catalogue is now the only source of dish 中文.
  for (const category of menu) {
    parts.push(category.name);
    for (const item of category.items) {
      parts.push(item.name);
      if (item.chineseName) parts.push(item.chineseName);
      for (const size of item.sizes ?? []) parts.push(size.label);
      for (const mod of item.modifiers ?? []) parts.push(mod.name);
    }
  }

  // Combos, through the same builder the cart and the ticket see. Item names,
  // per-head size labels, and every entrée choice — the choice is what reaches
  // a ticket as a modifier line.
  for (const section of comboCategories()) {
    parts.push(section.nameEn);
    if (section.nameZh) parts.push(section.nameZh);
    for (const item of section.items) {
      parts.push(item.nameEn);
      if (item.nameZh) parts.push(item.nameZh);
      for (const size of item.sizes ?? []) parts.push(size.label);
      for (const group of item.modifierGroups) {
        // The group's own name does not reach a ticket today — an order line
        // stores the chosen modifiers, not the question they answered — but it
        // costs two glyphs to make that a layout decision rather than a
        // constraint the subset silently enforces.
        parts.push(group.nameEn);
        if (group.nameZh) parts.push(group.nameZh);
        for (const mod of group.modifiers) {
          parts.push(mod.nameEn);
          if (mod.nameZh) parts.push(mod.nameZh);
        }
      }
    }
  }

  // Markers can rename an item; the renamed English is what would print.
  for (const override of Object.values(itemOverridesById)) {
    if (override.nameEn) parts.push(override.nameEn);
  }

  parts.push(...Object.values(categoryZhByName));
  parts.push(...Object.values(sizeZhByLabel));
  parts.push(...Object.values(modifierZhByName));

  // Deduplicate to codepoints — subsetters take a plain string, and a shorter
  // one keeps the build log readable.
  return [...new Set([...parts.join("")])].sort().join("");
}
