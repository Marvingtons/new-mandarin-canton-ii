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
import { riceGlyphStrings } from "@/lib/menu/rice";
import { preparationGlyphStrings } from "@/lib/menu/preparation";

/**
 * Every fixed string the ticket renders. render.ts must use these constants
 * rather than inline 中文 — that is what keeps the subset honest.
 */
export const TICKET_LABELS = {
  reprint: "重印",
  /**
   * Timed failover: "轉自網上 REROUTED FROM ONLINE" / "轉自店內 REROUTED FROM
   * STORE", one line under the copy bar, on a ticket printed by the other
   * printer because its own had gone silent.
   */
  reroutedFrom: "轉自",
  stationOnline: "網上",
  stationStore: "店內",
  pickup: "取餐時間",
  /** A store order staff scheduled for a time: 預訂 SCHEDULED 5:30 PM. */
  scheduled: "預訂",
  /** A staff order taken as ASAP: 取餐時間 PICKUP / 盡快 ASAP. */
  asap: "盡快",
  note: "備註",
  customer: "客人",
  phone: "電話",
  placed: "落單",
  subtotal: "小計",
  tax: "稅金",
  tip: "小費",
  total: "合計",
  payAtCounter: "到店付款",
  /**
   * Header line on a staff-entered order, so the kitchen knows there is no
   * customer waiting on the website for it. Web orders print neither.
   */
  phoneOrder: "電話訂單",
  walkIn: "到店",
  /**
   * 改單 EDIT ORDER (docs/edit-order.md). The change ticket's top band reads
   * 改單 CHANGE · A-002 with 第2次 REVISION 2 under it, then three blocks:
   * + 加 ADDED, - 減 REMOVED, 改 CHANGED, and the footer
   * 其餘不變 OTHER N ITEMS UNCHANGED; the register copy adds
   * 新合計 NEW TOTAL ... 原 WAS. A full ticket of an edited order (the
   * Receipt view, a 重印) carries 已改 REVISED 第2次 beside the number.
   */
  change: "改單",
  added: "加",
  removed: "減",
  changed: "改",
  unchanged: "其餘不變",
  revisionBefore: "第",
  revisionAfter: "次",
  newTotal: "新合計",
  was: "原",
  revised: "已改",
} as const;

/**
 * Every fixed 中文 string the 日結 DAILY REPORT prints (lib/ticket/report.ts).
 * Same rule as TICKET_LABELS: report.ts may print no 中文 that is not here, and
 * this object feeds the subset, so a label here is a glyph in the font.
 */
export const REPORT_LABELS = {
  dailyReport: "日結",
  orders: "訂單",
  online: "網上",
  /** Phone + walk-in (and a retired dine-in day): the one till the owner counts. */
  store: "店內",
  all: "合計",
  totals: "金額",
  subtotal: "小計",
  charges: "加價",
  tax: "稅",
  tip: "小費",
  trays: "餐盤",
  halfTray: "半盤",
  partyTray: "餐盤",
  top: "熱賣",
  none: "無",
  /** The reconcile line: 對數：合計 vs 刷卡機 + 現金. */
  reconcile: "對數",
  cardTerminal: "刷卡機",
  cash: "現金",
  /** Full-width colon, as 中文 sets it. */
  colon: "：",
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
  Object.values(TICKET_LABELS).join("") +
  Object.values(REPORT_LABELS).join("") +
  LATIN_AND_SYMBOLS;

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

  // The rice group is injected in catalog.ts, AFTER the raw catalogue this
  // loop walks — so 白飯 and 炒飯 would be invisible here for every à la
  // carte dish and the printer would draw .notdef boxes on ~130 items.
  // Combo items would have been covered (their groups are walked below),
  // which is exactly the kind of half-coverage that ships.
  parts.push(...riceGlyphStrings());

  // The preparation group (#116's steamed/fried choice) is injected in
  // catalog.ts too, after this loop. Its printed options are the same 白飯/炒飯
  // strings the rice group already covers, so this adds no glyph today — it is
  // here so the coverage stops silently depending on the rice group naming its
  // options identically.
  parts.push(...preparationGlyphStrings());

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
