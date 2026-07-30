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
 * ⚠️ After adding a label here, or 中文 to any override map, re-run
 * `npm run build:ticket-font`. Forgetting is not silent: the renderer checks
 * coverage and falls back to English with a visible marker.
 *
 * Pure data. No `server-only`, so the build script can import it too.
 */

import {
  categoryZhByName,
  modifierZhByName,
  sizeZhByLabel,
  itemOverridesById,
  itemOverridesByName,
} from "@/data/menu-overrides";
import { restaurant } from "@/data/restaurant";

/**
 * Every fixed string the ticket renders. render.tsx must use these constants
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
  /** Copy 1 of 2 — stays with the cooks. */
  copyKitchen: "廚房",
  /** Copy 2 of 2 — goes on the bag. */
  copyBag: "袋",
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
  // Symbols the layout depends on: quantity, separator, the missing-中文 mark,
  // the modifier bullet.
  "×·⚠✓●○→";

/** Fixed chrome: the labels above plus the Latin/symbol set. */
export const TICKET_UI_GLYPHS =
  Object.values(TICKET_LABELS).join("") + LATIN_AND_SYMBOLS;

/**
 * Every codepoint the ticket could need: the fixed chrome above plus all 中文
 * currently configured in the override maps and the restaurant record.
 */
export function collectTicketGlyphs(): string {
  const parts: string[] = [TICKET_UI_GLYPHS];

  if (restaurant.chineseName) parts.push(restaurant.chineseName);
  parts.push(restaurant.name);

  for (const override of [
    ...Object.values(itemOverridesById),
    ...Object.values(itemOverridesByName),
  ]) {
    if (override.nameZh) parts.push(override.nameZh);
    if (override.nameEn) parts.push(override.nameEn);
  }

  parts.push(...Object.values(categoryZhByName));
  parts.push(...Object.values(sizeZhByLabel));
  parts.push(...Object.values(modifierZhByName));

  // Deduplicate to codepoints — subsetters take a plain string, and a shorter
  // one keeps the build log readable.
  return [...new Set([...parts.join("")])].sort().join("");
}
