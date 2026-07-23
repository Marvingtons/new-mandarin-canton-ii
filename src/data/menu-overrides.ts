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
