/**
 * Presentation overrides layered onto the menu catalogue, plus the generic
 * POS vocabulary the kitchen ticket needs.
 *
 * ⚠️ DISH 中文 NO LONGER LIVES HERE. Every item in `src/data/menu.ts` now
 * carries its own `chineseName`, transcribed from the printed-menu document
 * alongside its price, and `menu/catalog.ts` reads it directly. The name-keyed
 * override map this file used to hold is gone: it matched fuzzily, it covered a
 * quarter of the menu, and keeping a second dish-name table beside a complete
 * first one is the drift this file's own header used to warn about.
 *
 * WHAT IS LEFT is everything that is NOT a dish name:
 *
 *  - `itemOverridesById` — vegetarian / chef's-special / hidden markers, keyed
 *    by the item's id in menu.ts. Exact matches only; there is no name-keyed
 *    fallback any more, so a renamed dish cannot silently pick up a marker
 *    meant for a different one.
 *  - category, size-tier and modifier 中文 — generic culinary and POS words
 *    rather than dish names, shared across every item that uses them.
 */

/**
 * ⚠️ NO `spicy` FIELD, deliberately. The printed menu's 🌶 set is transcribed
 * in src/data/menu.ts and read from there alone. It used to be settable here
 * too, which meant a dish could be marked hot in one file and not the other,
 * and a heat warning is not something to keep in two places.
 *
 * ⚠️ NO `nameZh` FIELD either, for the same reason — see the header.
 */
export interface MenuItemOverride {
  /** Overrides the catalogue name when it is abbreviated or internal. */
  nameEn?: string;
  description?: string;
  vegetarian?: boolean;
  chefSpecial?: boolean;
  /** Force-hide from online ordering while keeping it on the printed menu. */
  hidden?: boolean;
}

/**
 * Normalize an English name for fuzzy matching: case-folded, punctuation and
 * whitespace stripped. "Sweet & Sour Pork" and "sweet and sour pork" collide
 * on purpose. Used for the category / size / modifier maps below, whose keys
 * are vocabulary rather than identifiers.
 */
export function overrideKey(nameEn: string): string {
  return nameEn
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Id-keyed markers. These are claims about a dish that the printed menu does
 * not print — it has no vegetarian symbol — so they live outside menu.ts,
 * which is a transcription.
 */
export const itemOverridesById: Record<string, MenuItemOverride> = {
  "mixed-vegetable": { vegetarian: true },
  "tofu-vegetable": { vegetarian: true },
  "vegetarian-fried-rice": { vegetarian: true },
  "vegetarian-egg-foo-young": { vegetarian: true },
  "kung-pao-tofu": { vegetarian: true },
  "salted-pepper-tofu": { vegetarian: true },
  "spicy-hot-egg-plant": { vegetarian: true },
  "hot-egg-plant-tofu": { vegetarian: true },
};

/**
 * Category 中文, keyed by normalized English category name. These are generic
 * culinary words rather than dish names, matching the existing MenuSection.
 * ⚠️ CONFIRM with the family that these read naturally on the printed ticket.
 */
const RAW_CATEGORY_ZH: Record<string, string> = {
  Chicken: "雞類",
  Beef: "牛類",
  Pork: "豬類",
  Seafood: "海鮮",
  Vegetables: "蔬菜",
  "Fried Rice": "炒飯",
  Noodles: "麵類",
  "Mandarin Specialties": "招牌菜",
  Appetizers: "前菜",
  Soup: "湯類",
};

export const categoryZhByName: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_CATEGORY_ZH).map(([name, zh]) => [overrideKey(name), zh]),
);

/** Resolve the marker override for an item. Id only — see the header. */
export function resolveItemOverride(itemId: string): MenuItemOverride | undefined {
  return itemOverridesById[itemId];
}

/* ------------------------------------------------------- ticket 中文 ----- *
 * The kitchen ticket prints 中文 under every dish, so it needs 中文 for the two
 * things a dish name does not carry: size tiers and modifiers. Both are generic
 * culinary/POS vocabulary rather than dish names.
 *
 * ⚠️ TODO(confirm): unlike the dish names in menu.ts — which are transcribed
 * from the printed-menu document — these two maps are standard trade terms that
 * the family has NOT yet reviewed. Anything unmatched falls back to English, so
 * an unreviewed entry is the only way a wrong character can reach the kitchen.
 * Confirm both maps before the first real service.
 * ------------------------------------------------------------------------ */

/**
 * Size-tier 中文, keyed by normalized English size label.
 *
 * 單點 (individual) and 例 (regular) are the DEFAULT tiers and never print —
 * see the size chip in lib/ticket/render.ts. They are kept because a size a
 * customer chose is still stored on the order, and a stored label with no 中文
 * would be a hole in the data even where the ticket stays quiet about it.
 */
const RAW_SIZE_ZH: Record<string, string> = {
  Regular: "例",
  Individual: "單點",
  // 餐盤, not the older 大盤: 餐盤 is what the ticket's tray chip prints.
  "Party Tray": "餐盤",
  Small: "小",
  Large: "大",
  // 杯裝 is the document's own wording for the Egg Drop Soup cup.
  Cup: "杯裝",
  Bowl: "碗",
  // Roasted duck, priced by the half and the whole bird.
  Half: "半隻",
  Whole: "全隻",
  Pint: "小盒",
  Quart: "大盒",
  // Family-dinner head counts (see data/combo-items.ts). The printed menu
  // prices these per person from two up.
  "2 people": "二人",
  "3 people": "三人",
  "4 people": "四人",
  "5 people": "五人",
  "6 people": "六人",
};

export const sizeZhByLabel: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_SIZE_ZH).map(([label, zh]) => [overrideKey(label), zh]),
);

/** Modifier 中文, keyed by normalized English modifier name. */
const RAW_MODIFIER_ZH: Record<string, string> = {
  "Extra Spicy": "加辣",
  Spicy: "辣",
  "Mild Spicy": "小辣",
  "Not Spicy": "不辣",
  "No Spice": "不辣",
  "No MSG": "不要味精",
  "No Onion": "走蔥",
  "No Garlic": "走蒜",
  "No Peanuts": "走花生",
  "Extra Sauce": "多汁",
  "Sauce on the Side": "汁另上",
  "Steamed Rice": "白飯",
  "Fried Rice": "炒飯",
  "Brown Rice": "糙米飯",
  "No Rice": "不要飯",
  "Extra Rice": "加飯",
  "Add Chicken": "加雞",
  "Add Beef": "加牛",
  "Add Shrimp": "加蝦",
  "Add Tofu": "加豆腐",
  "Add Vegetables": "加菜",
  // The two priced add-ons the printed menu actually prints.
  "Add Noodle": "加麵",
  "Skinny Egg Noodle": "幼蛋麵",
};

export const modifierZhByName: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_MODIFIER_ZH).map(([name, zh]) => [overrideKey(name), zh]),
);

/** 中文 for a size label, or null when we have none. */
export function resolveSizeZh(label: string): string | null {
  return sizeZhByLabel[overrideKey(label)] ?? null;
}

/** 中文 for a modifier name, or null when we have none. */
export function resolveModifierZh(nameEn: string): string | null {
  return modifierZhByName[overrideKey(nameEn)] ?? null;
}
