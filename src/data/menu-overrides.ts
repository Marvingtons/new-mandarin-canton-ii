/**
 * Bilingual + presentation overrides layered on top of the live Clover menu.
 *
 * Clover items carry ONE name field, so every piece of 中文 (and every spicy /
 * vegetarian / chef's-special marker) comes from this file and is merged over
 * the Clover data at fetch time.
 *
 * TWO KEYING STRATEGIES, on purpose:
 *
 *  1. `itemOverridesByCloverId` — the durable one. Clover item IDs are stable
 *     and unambiguous, so this wins whenever it has an entry. It is empty
 *     until the first real sync tells us the IDs. ⚠️ FILL THIS IN after the
 *     first successful menu sync (the dev-only report prints the IDs).
 *
 *  2. `itemOverridesByName` — the transitional one, seeded from the 中文 names
 *     already verified in src/data/menu.ts. It matches on a normalized English
 *     name so the site is bilingual on day one, before anyone has typed a
 *     single Clover ID. If the owner renames an item in Clover the match drops
 *     and the item falls back to its Clover name (never a wrong translation).
 *
 * Nothing here invents a translation: every 中文 string below already shipped
 * in this repo's static menu.
 */

export interface MenuItemOverride {
  nameZh?: string;
  /** Overrides the Clover name when the POS name is abbreviated or internal. */
  nameEn?: string;
  description?: string;
  spicy?: boolean;
  vegetarian?: boolean;
  chefSpecial?: boolean;
  /** Force-hide from online ordering even if Clover has it visible. */
  hidden?: boolean;
}

/**
 * Normalize an English name for fuzzy matching: case-folded, punctuation and
 * whitespace stripped. "Sweet & Sour Pork" and "sweet and sour pork" collide
 * on purpose.
 */
export function overrideKey(nameEn: string): string {
  return nameEn
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * ⚠️ CONFIRM — authoritative, ID-keyed overrides. Empty until the first sync.
 * Example of the shape once a real Clover ID is known:
 *
 *   "9J1F7WW503CZW": { nameZh: "宮保雞丁", spicy: true },
 */
export const itemOverridesByCloverId: Record<string, MenuItemOverride> = {};

/** Transitional name-keyed overrides, seeded from verified repo data. */
const RAW_NAME_OVERRIDES: Record<string, MenuItemOverride> = {
  // Chicken
  "Salted Pepper Chicken Wings": { nameZh: "椒鹽雞翼" },
  "Kung Pao Chicken": { nameZh: "宮保雞丁", spicy: true },
  "Curry Chicken": { nameZh: "咖喱雞", spicy: true },
  "Chicken with Cashew Nuts": { nameZh: "腰果雞丁" },
  "Sesame Chicken": { nameZh: "芝麻雞" },
  "Moo Goo Gai Pan": { nameZh: "蘑菇雞片" },
  "Chicken Egg Foo Young": { nameZh: "芙蓉蛋" },
  // Beef
  "Mongolian Beef": { nameZh: "蒙古牛" },
  "Beef with Oyster Sauce": { nameZh: "蠔油牛肉" },
  "Green Pepper Beef": { nameZh: "青椒牛肉" },
  "Kung Pao Beef": { nameZh: "宮保牛肉", spicy: true },
  "Curry Beef": { nameZh: "咖喱牛肉", spicy: true },
  "Szechuan Style Beef": { spicy: true },
  "Crispy Beef with Spicy Sauce": { spicy: true },
  "Beef Egg Foo Young": { nameZh: "芙蓉蛋" },
  // Pork
  "Pork Chop Peking": { nameZh: "京都豬扒" },
  "Salted Pepper Pork Chop": { nameZh: "椒鹽豬扒" },
  "Yu Hsiang Pork": { nameZh: "魚香肉絲", spicy: true },
  "Mapo Tofu": { nameZh: "麻婆豆腐", spicy: true },
  "BBQ Pork Egg Foo Young": { nameZh: "芙蓉蛋" },
  "Sweet & Sour Pork": { nameZh: "咕嚕肉" },
  // Seafood
  "Kung Pao Shrimp": { nameZh: "宮保蝦仁", spicy: true },
  "Szechuan Style Shrimp": { spicy: true },
  "Shrimp Egg Foo Young": { nameZh: "芙蓉蛋" },
  "Curry Shrimp": { nameZh: "咖喱蝦", spicy: true },
  // Vegetables
  "Vegetarian Egg Foo Young": { nameZh: "芙蓉蛋", vegetarian: true },
  "Kung Pao Tofu": { nameZh: "宮保豆腐", spicy: true, vegetarian: true },
  "Salted Pepper Tofu": { nameZh: "椒鹽豆腐", vegetarian: true },
  "Spicy Hot Eggplant": { spicy: true, vegetarian: true },
  "Hot Eggplant with Tofu": { spicy: true, vegetarian: true },
  "Mixed Vegetables": { vegetarian: true },
  "Tofu with Vegetables": { vegetarian: true },
  // Rice & noodles
  "Shrimp Fried Rice": { nameZh: "蝦仁炒飯" },
  "BBQ Pork Fried Rice": { nameZh: "叉燒炒飯" },
  "Steamed Rice": { nameZh: "白飯" },
  "Singapore Style Rice Noodle": { nameZh: "星洲炒米", spicy: true },
  "Chow Fun (Chicken or Beef)": { nameZh: "炒粉" },
  // Mandarin specialties
  "Kung Pao San Shein": { nameZh: "宮保三鮮", spicy: true },
};

export const itemOverridesByName: Record<string, MenuItemOverride> =
  Object.fromEntries(
    Object.entries(RAW_NAME_OVERRIDES).map(([name, o]) => [overrideKey(name), o]),
  );

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

/** Resolve the override for an item, ID first then name fallback. */
export function resolveItemOverride(
  cloverId: string,
  nameEn: string,
): MenuItemOverride | undefined {
  return (
    itemOverridesByCloverId[cloverId] ?? itemOverridesByName[overrideKey(nameEn)]
  );
}

/* ------------------------------------------------------- ticket 中文 ----- *
 * The kitchen ticket is Chinese-primary, so it needs 中文 for two things the
 * dish-name map above does not carry: size tiers and modifiers. Both are
 * generic culinary/POS vocabulary rather than dish names.
 *
 * ⚠️ TODO(confirm): unlike the dish names above — which all shipped in this
 * repo already — these two maps are standard trade terms that the family has
 * NOT yet reviewed. Anything unmatched falls back to English and the ticket
 * marks it visibly, so an unreviewed entry is the only way a wrong character
 * can reach the kitchen. Confirm both maps before the first real service.
 * ------------------------------------------------------------------------ */

/** Size-tier 中文, keyed by normalized English size label. */
const RAW_SIZE_ZH: Record<string, string> = {
  Regular: "例",
  Individual: "單點",
  "Party Tray": "大盤",
  Small: "小",
  Large: "大",
  Cup: "杯",
  Bowl: "碗",
  Pint: "小盒",
  Quart: "大盒",
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
};

export const modifierZhByName: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_MODIFIER_ZH).map(([name, zh]) => [overrideKey(name), zh]),
);

/** 中文 for a size label, or null when we have none (ticket marks it). */
export function resolveSizeZh(label: string): string | null {
  return sizeZhByLabel[overrideKey(label)] ?? null;
}

/** 中文 for a modifier name, or null when we have none (ticket marks it). */
export function resolveModifierZh(nameEn: string): string | null {
  return modifierZhByName[overrideKey(nameEn)] ?? null;
}
