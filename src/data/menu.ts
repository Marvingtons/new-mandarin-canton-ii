/**
 * Menu data for New Mandarin Canton II — reconciled against
 * `docs/nmc-menu-prices-with-traditional-chinese.md` (physical menu rev. 9/25).
 *
 * SCOPE / CONVENTIONS
 * - THIS FILE IS THE ONLY PRICE SOURCE, AND NOW THE ONLY DISH-中文 SOURCE.
 *   Individual price, party-tray price, size tiers, per-item add-ons and the
 *   Chinese name all live here; `src/lib/menu/catalog.ts` adapts them into the
 *   normalized shape the cart, the ticket and the totals use. There is no
 *   second table to keep in sync — the tray prices that used to live in
 *   `src/data/party-trays.ts` were estimates and are gone, and the dish 中文
 *   that used to live in `src/data/menu-overrides.ts` is gone with them.
 * - Money is INTEGER CENTS everywhere. 24.95 is stored as 2495. A float never
 *   enters the data, so one can never enter a price calculation.
 * - `trayCents` is set only where the printed menu prints a party-tray price.
 *   Appetizers and soups have no tray column, so they carry none and the UI
 *   shows no tray option for them.
 * - `chineseName` is Traditional, Cantonese-leaning restaurant vocabulary,
 *   transcribed from the same document as the prices. It is set on EVERY item;
 *   an unset one is a bug, not a fallback, because the kitchen ticket prints it
 *   under every dish. The marketing pages stay English-only — 富源 (the seal)
 *   is still the site's only Chinese text by design.
 * - `spicy` mirrors the printed menu's 🌶 markers and is the ONLY source of
 *   that flag — see the note in src/data/menu-overrides.ts. The document's 中文
 *   lines repeat the 🌶; it is stripped here, because spiciness is a flag and
 *   not part of a dish's name.
 * - Names follow the printed menu verbatim, including its own spellings
 *   ("Bac Choy", "Egg Plant", singular "Vegetable"). Where the site's existing
 *   spelling differs from the price document the SITE wins — the document
 *   itself says so, in as many words, about "Fired Cream Cheese Wonton".
 *
 * ⚠️ TODO(confirm) markers below flag two different things: the five prices the
 * source photographs could not resolve, and the dish names whose 中文 is a
 * descriptive translation rather than an established one. Both carry the
 * document's value and need the owner's confirmation.
 *
 * ⚠️ Adding or changing a `chineseName` adds glyphs. Re-run
 * `npm run build:ticket-font`, or the new characters print as □ on paper.
 */

/** A price tier beyond the plain individual price (Half/Whole, Cup/Bowl). */
export interface MenuItemSize {
  id: string;
  label: string;
  /** Integer cents. */
  priceCents: number;
}

/** A printed per-item add-on, e.g. "Add Noodle $3.00 Extra". */
export interface MenuItemModifier {
  id: string;
  name: string;
  /** Integer cents. */
  priceCents: number;
}

export interface MenuItem {
  id: string;
  name: string;
  /**
   * Traditional Chinese culinary name, from the printed-menu document.
   *
   * Set on EVERY item. This is what the kitchen ticket prints under the
   * English, so a missing one is a hole in the ticket rather than a soft
   * fallback — `npm run ticket:sample` reports the count.
   *
   * Optional in the type only because the marketing pages predate it and one
   * new item added in a hurry should not fail to compile; `verify:ticket-glyphs`
   * fails instead, which is the check that would have caught it anyway.
   */
  chineseName?: string;
  description?: string;
  /** Integer cents. The printed menu's INDIVIDUAL price. */
  priceCents: number;
  /** Integer cents. The printed menu's PARTY TRAY price, where it prints one. */
  trayCents?: number;
  /**
   * Explicit tiers, when the printed menu prices one dish two ways (Roasted
   * Duck half/whole, Egg Drop Soup cup/bowl). Replaces the single individual
   * tier; a party tray, if any, is still appended after these.
   */
  sizes?: MenuItemSize[];
  /** Printed per-item add-ons. Real priced options, never prose. */
  modifiers?: MenuItemModifier[];
  spicy?: boolean;
  tags?: string[];
}

export interface MenuCategory {
  id: string;
  name: string;
  /** Optional footnote under the section. */
  note?: string;
  items: MenuItem[];
}

export const menu: MenuCategory[] = [
  {
    id: "specials",
    name: "Specials",
    items: [
      {
        id: "mandarin-special",
        name: "Mandarin Special",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "招牌大拼盤",
        description:
          "Duck, shrimp, chicken, roast pork, broccoli, mushroom, water chestnuts, snow peas, chef's special sauce.",
        priceCents: 2495,
        trayCents: 9200,
      },
      {
        id: "oceania",
        name: "Oceania",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "海鮮大會",
        description:
          "Shrimp, scallops, squid, fish fillet, mushrooms, snow peas, vegetables.",
        priceCents: 2650,
        trayCents: 10000,
      },
      {
        id: "orange-flavored-chicken-special",
        name: "Orange Flavored Chicken",
        chineseName: "陳皮雞",
        description: "Chef's special tangerine sauce.",
        priceCents: 1995,
        trayCents: 7200,
        spicy: true,
      },
      {
        id: "salted-pepper-chicken-wings-special",
        name: "Salted Pepper Chicken Wings",
        chineseName: "椒鹽雞翼",
        description: "Crispy fried, sautéed with hot pepper.",
        priceCents: 1995,
        trayCents: 7500,
        spicy: true,
      },
      {
        id: "kung-po-san-shein",
        name: "Kung-Po San Shein",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "宮保三鮮",
        description:
          "Shrimp, chicken, beef, green onion, peanuts, spicy sauce.",
        priceCents: 2295,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "mongolian-beef-special",
        name: "Mongolian Beef",
        chineseName: "蒙古牛肉",
        description: "Sliced tenderloin, jade green scallions, natural sauce.",
        priceCents: 2150,
        trayCents: 7500,
      },
      {
        id: "upside-down-pan-fried-noodles",
        name: "Upside Down Pan Fried Noodles",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "三鮮兩面黃",
        description: "Beef, chicken, shrimp, vegetables.",
        priceCents: 2095,
        trayCents: 7400,
      },
      {
        id: "honey-walnut-shrimp",
        name: "Honey Walnut Shrimp",
        chineseName: "蜜汁核桃蝦",
        description: "Special mayonnaise dressing, honey walnut.",
        priceCents: 2550,
        trayCents: 9500,
      },
      {
        id: "black-pepper-beef-or-chicken",
        name: "Black Pepper Beef or Chicken",
        chineseName: "黑椒牛肉或雞肉",
        priceCents: 2150,
        trayCents: 7500,
        spicy: true,
      },
      {
        id: "steamed-fish-filet-special",
        name: "Steamed Fish Filet",
        chineseName: "清蒸魚片",
        priceCents: 2450,
        trayCents: 9200,
      },
      {
        id: "salted-pepper-squid-special",
        name: "Salted Pepper Squid",
        chineseName: "椒鹽鮮魷",
        priceCents: 2450,
        trayCents: 9200,
        spicy: true,
      },
    ],
  },
  {
    id: "appetizers",
    name: "Appetizers",
    items: [
      { id: "egg-rolls", name: "Egg Rolls (2)", chineseName: "春卷（2條）", priceCents: 350 },
      {
        id: "salt-pepper-chicken-wings-app",
        name: "Salt Pepper Chicken Wings (6)",
        chineseName: "椒鹽雞翼（6隻）",
        priceCents: 1295,
      },
      { id: "bbq-pork-app", name: "B.B.Q. Pork", chineseName: "蜜汁叉燒", priceCents: 1495 },
      { id: "bbq-spareribs", name: "B.B.Q. Spareribs", chineseName: "燒排骨", priceCents: 1695 },
      {
        // One dish, two printed weights — a size pair, not two items. The old
        // `roasted-duck-whole` row is folded in here as the second tier.
        id: "roasted-duck",
        name: "Roasted Duck",
        chineseName: "燒鴨",
        priceCents: 2000,
        sizes: [
          { id: "half", label: "Half", priceCents: 2000 },
          { id: "whole", label: "Whole", priceCents: 3800 },
        ],
      },
      {
        id: "steamed-or-fried-dumplings",
        name: "Steamed or Fried Dumplings (8)",
        chineseName: "蒸餃或煎餃（8隻）",
        priceCents: 1595,
      },
      {
        // The printed menu says "Fired"; the site's corrected spelling stands.
        id: "fried-cream-cheese-wonton",
        name: "Fried Cream Cheese Wonton (8)",
        chineseName: "炸忌廉芝士雲吞（8隻）",
        priceCents: 995,
      },
    ],
  },
  {
    id: "soup",
    name: "Soup",
    items: [
      { id: "seafood-soup", name: "Seafood Soup (for 2)", chineseName: "海鮮羹（兩位用）", priceCents: 1895 },
      {
        id: "three-flavor-sizzling-rice-soup",
        name: "Three Flavor Sizzling Rice Soup (for 2)",
        chineseName: "三鮮鍋巴湯（兩位用）",
        priceCents: 1895,
      },
      {
        id: "hot-sour-soup",
        name: "Hot & Sour Soup",
        chineseName: "酸辣湯",
        priceCents: 1695,
        spicy: true,
      },
      {
        id: "chicken-corn-soup",
        name: "Chicken and Corn Soup",
        chineseName: "粟米雞茸羹",
        priceCents: 1695,
      },
      { id: "wor-wonton-soup", name: "Wor Wonton Soup", chineseName: "窩雲吞湯", priceCents: 1895 },
      { id: "wonton-soup", name: "Wonton Soup", chineseName: "雲吞湯", priceCents: 1695 },
      {
        id: "egg-drop-soup",
        name: "Egg Drop Soup",
        chineseName: "蛋花湯",
        priceCents: 1395,
        sizes: [
          { id: "cup", label: "Cup", priceCents: 650 },
          { id: "bowl", label: "Bowl", priceCents: 1395 },
        ],
      },
      { id: "vegetables-soup", name: "Vegetables Soup", chineseName: "雜菜湯", priceCents: 1495 },
      {
        id: "chicken-vegetable-soup",
        name: "Chicken Vegetable Soup",
        chineseName: "雞肉雜菜湯",
        priceCents: 1695,
        modifiers: [
          { id: "add-noodle", name: "Add Noodle", priceCents: 300 },
        ],
      },
    ],
  },
  {
    id: "chicken",
    name: "Chicken",
    items: [
      {
        id: "salted-pepper-chicken-wings",
        name: "Salted Pepper Chicken Wings",
        chineseName: "椒鹽雞翼",
        priceCents: 1995,
        trayCents: 7500,
        spicy: true,
      },
      {
        id: "orange-flavored-chicken",
        name: "Orange Flavored Chicken",
        chineseName: "陳皮雞",
        priceCents: 1995,
        trayCents: 7200,
        spicy: true,
      },
      {
        id: "kung-pao-chicken",
        name: "Kung Pao Chicken",
        chineseName: "宮保雞丁",
        priceCents: 2250,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "curry-chicken",
        name: "Curry Chicken",
        chineseName: "咖喱雞",
        priceCents: 1950,
        trayCents: 7000,
        spicy: true,
      },
      {
        id: "chicken-black-bean-sauce",
        name: "Chicken with Black Bean Sauce",
        chineseName: "豉椒雞",
        priceCents: 1950,
        trayCents: 7000,
        spicy: true,
      },
      {
        id: "chicken-cashew-nuts",
        name: "Chicken with Cashew Nuts",
        chineseName: "腰果雞丁",
        priceCents: 2250,
        trayCents: 9000,
      },
      {
        id: "chicken-broccoli",
        name: "Chicken with Broccoli",
        chineseName: "西蘭花雞",
        priceCents: 1950,
        trayCents: 7000,
      },
      {
        id: "chicken-snow-peas",
        name: "Chicken with Snow Peas",
        chineseName: "雪豆雞片",
        priceCents: 2095,
        trayCents: 8000,
      },
      { id: "almond-chicken", name: "Almond Chicken", chineseName: "杏仁雞", priceCents: 1950, trayCents: 7000 },
      { id: "sesame-chicken", name: "Sesame Chicken", chineseName: "芝麻雞", priceCents: 1995, trayCents: 7000 },
      {
        id: "mandarin-chicken",
        name: "Mandarin Chicken",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "招牌辣雞",
        priceCents: 1995,
        trayCents: 7000,
        spicy: true,
      },
      {
        id: "garlic-chicken",
        name: "Garlic Chicken",
        chineseName: "魚香雞",
        priceCents: 1995,
        trayCents: 7000,
        spicy: true,
      },
      {
        id: "lemon-chicken",
        name: "Lemon with Chicken",
        chineseName: "檸檬雞",
        priceCents: 1995,
        trayCents: 7000,
      },
      {
        id: "sweet-sour-chicken",
        name: "Sweet & Sour Chicken",
        chineseName: "咕嚕雞",
        priceCents: 1950,
        trayCents: 7000,
      },
      { id: "moo-goo-gai-pan", name: "Moo Goo Gai Pan", chineseName: "蘑菇雞片", priceCents: 1995, trayCents: 7200 },
      {
        id: "chicken-chop-suey",
        name: "Chicken Chop Suey",
        chineseName: "雜碎雞",
        priceCents: 1950,
        trayCents: 6500,
      },
      {
        id: "chicken-egg-foo-young",
        name: "Chicken Egg Foo Young",
        chineseName: "雞肉芙蓉蛋",
        priceCents: 2095,
        trayCents: 7500,
      },
      {
        id: "chicken-cantonese",
        name: "Chicken Cantonese",
        chineseName: "廣東雞",
        priceCents: 1950,
        trayCents: 7000,
      },
      {
        id: "chicken-vegetable",
        name: "Chicken with Vegetable",
        chineseName: "雜菜雞",
        priceCents: 1995,
        trayCents: 7200,
      },
      {
        id: "chicken-bac-choy",
        name: "Chicken with Bac Choy",
        chineseName: "白菜雞",
        priceCents: 1995,
        trayCents: 7200,
      },
    ],
  },
  {
    id: "seafood",
    name: "Seafood",
    items: [
      {
        id: "salted-fried-shrimp-with-shell",
        name: "Salted & Deep Fried Shrimp (with shell)",
        chineseName: "椒鹽有殼蝦",
        priceCents: 2350,
        trayCents: 9500,
        spicy: true,
      },
      {
        // The price document calls this "Salted & Deep Fried Shrimp (no
        // shell)"; the site's existing name stands — prices only in this pass.
        id: "salted-pepper-shrimp-no-shell",
        name: "Salted Pepper Shrimp (no shell)",
        chineseName: "椒鹽蝦球",
        priceCents: 2550,
        trayCents: 9800,
        spicy: true,
      },
      {
        id: "szechuan-style-shrimp",
        name: "Szechuan Style Shrimp",
        chineseName: "四川蝦",
        priceCents: 2550,
        trayCents: 9500,
        spicy: true,
      },
      {
        id: "shrimp-black-bean-sauce",
        name: "Shrimp with Black Bean Sauce",
        chineseName: "豉椒蝦",
        priceCents: 2150,
        trayCents: 8200,
        spicy: true,
      },
      {
        id: "kung-pao-shrimp",
        name: "Kung-Pao Shrimp",
        chineseName: "宮保蝦",
        priceCents: 2550,
        trayCents: 10000,
        spicy: true,
      },
      {
        id: "shrimp-cantonese",
        name: "Shrimp Cantonese",
        chineseName: "廣東蝦",
        priceCents: 2195,
        trayCents: 8000,
      },
      {
        id: "shrimp-chop-suey",
        name: "Shrimp Chop Suey",
        chineseName: "雜碎蝦",
        priceCents: 2195,
        trayCents: 7800,
      },
      {
        id: "shrimp-lobster-sauce",
        name: "Shrimp with Lobster Sauce",
        chineseName: "蝦龍糊",
        priceCents: 2195,
        trayCents: 8200,
      },
      {
        id: "shrimp-broccoli",
        name: "Shrimp with Broccoli",
        chineseName: "西蘭花蝦",
        priceCents: 2195,
        trayCents: 8200,
      },
      {
        id: "shrimp-snow-peas",
        name: "Shrimp with Snow Peas",
        chineseName: "雪豆蝦",
        priceCents: 2450,
        trayCents: 9200,
      },
      {
        id: "curry-shrimp",
        name: "Curry Shrimp",
        chineseName: "咖喱蝦",
        priceCents: 2195,
        trayCents: 8200,
        spicy: true,
      },
      {
        id: "sweet-sour-shrimp",
        name: "Sweet & Sour Shrimp",
        chineseName: "咕嚕蝦",
        priceCents: 2250,
        trayCents: 8200,
      },
      { id: "almond-shrimp", name: "Almond Shrimp", chineseName: "杏仁蝦", priceCents: 2250, trayCents: 8200 },
      {
        id: "shrimp-egg-foo-young",
        name: "Shrimp Egg Foo Young",
        chineseName: "蝦仁芙蓉蛋",
        priceCents: 2350,
        trayCents: 9000,
      },
      {
        id: "house-egg-foo-young",
        name: "House Egg Foo Young",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "招牌芙蓉蛋",
        priceCents: 2350,
        trayCents: 9000,
      },
      {
        id: "chow-san-shein",
        name: "Chow San Shein",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "炒三鮮",
        priceCents: 2195,
        trayCents: 8500,
      },
      {
        id: "house-chop-suey",
        name: "House Chop Suey",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "招牌雜碎",
        priceCents: 2195,
        trayCents: 7800,
      },
      {
        id: "shrimp-vegetable",
        name: "Shrimp with Vegetable",
        chineseName: "雜菜蝦",
        priceCents: 2250,
        trayCents: 8500,
      },
      {
        id: "sweet-sour-fish-fillet",
        name: "Sweet & Sour Fish Fillet",
        chineseName: "咕嚕魚片",
        priceCents: 2250,
        trayCents: 8200,
      },
      {
        id: "fish-fillet-black-bean-sauce",
        name: "Fish Fillet with Black Bean Sauce",
        chineseName: "豉椒魚片",
        priceCents: 2250,
        // TODO(confirm): price partially obscured on menu photo — owner to confirm
        trayCents: 8200,
        spicy: true,
      },
      {
        id: "salt-pepper-fish-filet",
        name: "Salt Pepper Fish Filet",
        chineseName: "椒鹽魚片",
        priceCents: 2450,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "scallops-black-bean-sauce",
        name: "Scallops with Black Bean Sauce",
        chineseName: "豉椒帶子",
        priceCents: 2550,
        trayCents: 10000,
        spicy: true,
      },
      {
        id: "kung-pao-scallops",
        name: "Kung-Pao Scallops",
        chineseName: "宮保帶子",
        priceCents: 2650,
        trayCents: 11000,
        spicy: true,
      },
      {
        id: "yu-hsiang-scallops",
        name: "Yu-Hsiang Scallops",
        chineseName: "魚香帶子",
        priceCents: 2550,
        trayCents: 10000,
        spicy: true,
      },
      {
        id: "kung-pao-squid",
        name: "Kung Pao Squid",
        chineseName: "宮保鮮魷",
        priceCents: 2450,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "squid-black-bean-sauce",
        name: "Squid with Black Bean Sauce",
        chineseName: "豉椒鮮魷",
        priceCents: 2395,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "salted-pepper-squid",
        name: "Salted Pepper Squid",
        chineseName: "椒鹽鮮魷",
        priceCents: 2450,
        trayCents: 9200,
        spicy: true,
      },
      { id: "sauteed-scallops", name: "Sauteed Scallops", chineseName: "清炒帶子", priceCents: 2550, trayCents: 10000 },
    ],
  },
  {
    id: "beef",
    name: "Beef",
    items: [
      { id: "mongolian-beef", name: "Mongolian Beef", chineseName: "蒙古牛肉", priceCents: 2150, trayCents: 7500 },
      { id: "beef-broccoli", name: "Beef with Broccoli", chineseName: "西蘭花牛肉", priceCents: 2050, trayCents: 7200 },
      {
        id: "beef-snow-peas",
        name: "Beef with Snow Peas",
        chineseName: "雪豆牛肉",
        priceCents: 2150,
        // TODO(confirm): price partially obscured on menu photo — owner to confirm
        trayCents: 8200,
      },
      {
        id: "beef-oyster-sauce",
        name: "Beef with Oyster Sauce",
        chineseName: "蠔油牛肉",
        priceCents: 2250,
        // TODO(confirm): price partially obscured on menu photo — owner to confirm
        trayCents: 8300,
      },
      { id: "green-pepper-beef", name: "Green Pepper Beef", chineseName: "青椒牛肉", priceCents: 2050, trayCents: 7200 },
      {
        id: "black-mushroom-beef",
        name: "Black Mushroom Beef",
        chineseName: "冬菇牛肉",
        priceCents: 2450,
        trayCents: 9200,
      },
      {
        id: "szechuan-style-beef",
        name: "Szechuan Style Beef",
        chineseName: "四川牛肉",
        // TODO(confirm): price partially obscured on menu photo — owner to confirm
        priceCents: 2150,
        trayCents: 7200,
        spicy: true,
      },
      {
        id: "orange-flavored-beef",
        name: "Orange Flavored Beef",
        chineseName: "陳皮牛肉",
        priceCents: 2250,
        trayCents: 7500,
        spicy: true,
      },
      {
        id: "kung-pao-beef",
        name: "Kung Pao Beef",
        chineseName: "宮保牛肉",
        priceCents: 2350,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "beef-black-bean-sauce",
        name: "Beef with Black Bean Sauce",
        chineseName: "豉椒牛肉",
        priceCents: 2050,
        trayCents: 7200,
        spicy: true,
      },
      {
        id: "crispy-beef-spicy-sauce",
        name: "Crispy Beef with Spicy Sauce",
        chineseName: "香辣脆牛肉",
        priceCents: 2250,
        trayCents: 7500,
        spicy: true,
      },
      {
        id: "curry-beef",
        name: "Curry Beef",
        chineseName: "咖喱牛肉",
        priceCents: 2050,
        trayCents: 7200,
        spicy: true,
      },
      { id: "beef-chop-suey", name: "Beef Chop Suey", chineseName: "雜碎牛肉", priceCents: 2050, trayCents: 6800 },
      {
        id: "beef-egg-foo-young",
        name: "Beef Egg Foo Young",
        chineseName: "牛肉芙蓉蛋",
        priceCents: 2150,
        trayCents: 7500,
      },
      { id: "beef-vegetable", name: "Beef with Vegetable", chineseName: "雜菜牛肉", priceCents: 2150, trayCents: 7500 },
      { id: "beef-bac-choy", name: "Beef with Bac Choy", chineseName: "白菜牛肉", priceCents: 2150, trayCents: 7500 },
    ],
  },
  {
    id: "pork",
    name: "Pork",
    items: [
      { id: "pork-chop-peking", name: "Pork Chop Peking", chineseName: "京都肉排", priceCents: 2295, trayCents: 8500 },
      {
        id: "salted-pepper-pork-chop",
        name: "Salted Pepper Pork Chop",
        chineseName: "椒鹽豬扒",
        priceCents: 2295,
        trayCents: 8500,
        spicy: true,
      },
      {
        id: "yu-hsiang-pork",
        name: "Yu Hsiang Pork",
        chineseName: "魚香肉絲",
        priceCents: 1950,
        trayCents: 7000,
        spicy: true,
      },
      {
        id: "mandarin-pork",
        name: "Mandarin Pork",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "招牌辣豬肉",
        priceCents: 1995,
        trayCents: 7000,
        spicy: true,
      },
      { id: "sweet-sour-pork", name: "Sweet & Sour Pork", chineseName: "咕嚕肉", priceCents: 1950, trayCents: 7000 },
      { id: "sesame-pork", name: "Sesame Pork", chineseName: "芝麻豬肉", priceCents: 1995, trayCents: 7000 },
      { id: "pork-chop-suey", name: "Pork Chop Suey", chineseName: "雜碎豬肉", priceCents: 1950, trayCents: 6500 },
      {
        id: "bbq-pork-egg-foo-young",
        name: "B.B.Q. Pork Egg Foo Young",
        chineseName: "叉燒芙蓉蛋",
        priceCents: 2150,
        trayCents: 7500,
      },
      {
        id: "mapo-tofu",
        name: "Mapo Tofu",
        chineseName: "麻婆豆腐",
        priceCents: 1950,
        trayCents: 6800,
        spicy: true,
      },
    ],
  },
  {
    id: "sizzling-hot-pot",
    name: "Sizzling Hot Pot",
    items: [
      {
        id: "seafood-combination-hot-pot",
        name: "Seafood Combination Hot Pot",
        chineseName: "海鮮煲",
        priceCents: 2395,
        trayCents: 8800,
      },
      {
        id: "house-special-combination-hot-pot",
        name: "House Special Combination Hot Pot",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "招牌什錦煲",
        priceCents: 2395,
        trayCents: 8800,
      },
      {
        id: "sizzling-san-shein",
        name: "Sizzling San Shein",
        chineseName: "鐵板三鮮",
        priceCents: 2295,
        trayCents: 8500,
        spicy: true,
      },
      {
        id: "sizzling-shrimp",
        name: "Sizzling Shrimp",
        chineseName: "鐵板蝦",
        priceCents: 2295,
        trayCents: 8500,
        spicy: true,
      },
      {
        id: "sizzling-double-happiness",
        name: "Sizzling Double Happiness",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "鐵板雙喜",
        priceCents: 2550,
        trayCents: 9500,
        spicy: true,
      },
      {
        id: "sizzling-fish-fillet",
        name: "Sizzling Fish Fillet",
        chineseName: "鐵板魚片",
        priceCents: 2295,
        trayCents: 8500,
        spicy: true,
      },
      {
        id: "sizzling-chicken",
        name: "Sizzling Chicken",
        chineseName: "鐵板雞",
        priceCents: 2050,
        trayCents: 7200,
        spicy: true,
      },
      {
        id: "sizzling-beef",
        name: "Sizzling Beef",
        chineseName: "鐵板牛肉",
        priceCents: 2095,
        trayCents: 7200,
        spicy: true,
      },
    ],
  },
  {
    id: "vegetables",
    name: "Vegetables",
    items: [
      { id: "mixed-vegetable", name: "Mixed Vegetable", chineseName: "炒雜菜", priceCents: 1895, trayCents: 7000 },
      {
        id: "black-mushrooms-oyster-sauce",
        name: "Black Mushrooms with Oyster Sauce",
        chineseName: "蠔油冬菇",
        priceCents: 2095,
        trayCents: 8000,
      },
      {
        id: "broccoli-oyster-sauce",
        name: "Broccoli with Oyster Sauce",
        chineseName: "蠔油西蘭花",
        priceCents: 1795,
        trayCents: 5800,
      },
      { id: "sauteed-snow-peas", name: "Sauteed Snow Peas", chineseName: "清炒雪豆", priceCents: 1995, trayCents: 8000 },
      {
        id: "spicy-hot-egg-plant",
        name: "Spicy Hot Egg Plant",
        chineseName: "魚香茄子",
        priceCents: 1995,
        trayCents: 7800,
        spicy: true,
      },
      {
        id: "vegetarian-egg-foo-young",
        name: "Vegetarian Egg Foo Young",
        chineseName: "素芙蓉蛋",
        priceCents: 2095,
        trayCents: 7500,
      },
      { id: "bean-sprout-saute", name: "Bean Sprout Saute", chineseName: "清炒芽菜", priceCents: 1695, trayCents: 5200 },
      { id: "tofu-vegetable", name: "Tofu with Vegetable", chineseName: "雜菜豆腐", priceCents: 1895, trayCents: 6800 },
      {
        id: "sauteed-bac-choy-garlic",
        name: "Sauteed Bac Choy with Garlic",
        chineseName: "蒜蓉炒白菜",
        priceCents: 1895,
        trayCents: 7000,
      },
      {
        id: "salted-pepper-tofu",
        name: "Salted Pepper Tofu",
        chineseName: "椒鹽豆腐",
        priceCents: 1995,
        trayCents: 6800,
        spicy: true,
      },
      {
        id: "kung-pao-tofu",
        name: "Kung Pao Tofu",
        chineseName: "宮保豆腐",
        priceCents: 1995,
        trayCents: 6800,
        spicy: true,
      },
      {
        id: "hot-egg-plant-tofu",
        name: "Hot Egg Plant with Tofu",
        chineseName: "魚香茄子豆腐",
        priceCents: 2050,
        trayCents: 7500,
        spicy: true,
      },
    ],
  },
  {
    id: "fried-rice",
    name: "Fried Rice",
    items: [
      {
        id: "house-special-fried-rice",
        name: "House Special Fried Rice",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "招牌炒飯",
        priceCents: 1950,
        trayCents: 6500,
      },
      { id: "shrimp-fried-rice", name: "Shrimp Fried Rice", chineseName: "蝦仁炒飯", priceCents: 1950, trayCents: 6500 },
      { id: "chicken-fried-rice", name: "Chicken Fried Rice", chineseName: "雞肉炒飯", priceCents: 1850, trayCents: 6200 },
      { id: "beef-fried-rice", name: "Beef Fried Rice", chineseName: "牛肉炒飯", priceCents: 1850, trayCents: 6200 },
      {
        id: "vegetarian-fried-rice",
        name: "Vegetarian Fried Rice",
        chineseName: "素炒飯",
        priceCents: 1750,
        trayCents: 5800,
      },
      {
        id: "bbq-pork-fried-rice",
        name: "B.B.Q. Pork Fried Rice",
        chineseName: "叉燒炒飯",
        priceCents: 1850,
        trayCents: 6200,
      },
      { id: "fried-steamed-rice", name: "Fried/Steamed Rice", chineseName: "炒飯／白飯", priceCents: 300, trayCents: 3800 },
    ],
  },
  {
    id: "noodles",
    name: "Noodles",
    items: [
      {
        id: "house-soft-noodle",
        name: "House Soft Noodle",
        // TODO(confirm): descriptive translation, family to approve
        chineseName: "招牌炒麵",
        priceCents: 1995,
        trayCents: 6800,
      },
      {
        id: "seafood-soft-noodle",
        name: "Seafood Soft Noodle",
        chineseName: "海鮮炒麵",
        priceCents: 1995,
        trayCents: 7000,
      },
      { id: "shrimp-soft-noodle", name: "Shrimp Soft Noodle", chineseName: "蝦仁炒麵", priceCents: 1995, trayCents: 7000 },
      { id: "beef-soft-noodle", name: "Beef Soft Noodle", chineseName: "牛肉炒麵", priceCents: 1895, trayCents: 6500 },
      {
        id: "chicken-soft-noodle",
        name: "Chicken Soft Noodle",
        chineseName: "雞肉炒麵",
        priceCents: 1895,
        trayCents: 6500,
      },
      {
        id: "bbq-pork-soft-noodle",
        name: "B.B.Q. Pork Soft Noodle",
        chineseName: "叉燒炒麵",
        priceCents: 1895,
        trayCents: 6500,
      },
      {
        // The price document lists this as "Vegetarian Noodle"; the site's
        // existing name stands.
        id: "vegetarian-soft-noodle",
        name: "Vegetarian Soft Noodle",
        chineseName: "素炒麵",
        priceCents: 1795,
        trayCents: 6000,
      },
      {
        id: "chow-fun-chicken-or-beef",
        name: "Chicken or Beef Chow Fun (Dry)",
        chineseName: "乾炒雞肉或牛肉河粉",
        priceCents: 1995,
        trayCents: 7000,
      },
      {
        id: "seafood-chow-fun",
        name: "Seafood Chow Fun (Dry)",
        chineseName: "乾炒海鮮河粉",
        priceCents: 2050,
        trayCents: 7200,
      },
      {
        id: "singapore-style-rice-noodle",
        name: "Singapore Style Rice Noodle",
        chineseName: "星洲炒米粉",
        priceCents: 2050,
        trayCents: 7200,
        spicy: true,
        modifiers: [
          { id: "skinny-egg-noodle", name: "Skinny Egg Noodle", priceCents: 300 },
        ],
      },
    ],
  },
];

/* ------------------------------------------------------- dish 中文 lookup -- */

/**
 * Normalize a dish name for matching: case-folded, punctuation and whitespace
 * stripped. Deliberately the same rule as `overrideKey` in menu-overrides.ts —
 * duplicated rather than imported so this file, which is pure data, keeps
 * importing nothing.
 */
function dishKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Combo panels name dishes their own way.
 *
 * The lunch and family-dinner lists were transcribed from a different column of
 * the same printed menu, and that column abbreviates: "Beef Szechuan Style" for
 * "Szechuan Style Beef", "House Fried Rice" for "House Special Fried Rice",
 * plurals that the à la carte list keeps singular. Two entries name dishes that
 * have no à la carte row at all and carry their 中文 directly.
 *
 * Aliases rather than renames: the printed menu really does print both
 * spellings, and the combo lists are quoting it.
 */
const DISH_ALIASES: Record<string, string> = {
  "Beef Szechuan Style": "Szechuan Style Beef",
  "Shrimp Szechuan Style": "Szechuan Style Shrimp",
  "Beef with Green Pepper": "Green Pepper Beef",
  "Broccoli Beef": "Beef with Broccoli",
  "Broccoli Chicken": "Chicken with Broccoli",
  "Cashew Chicken": "Chicken with Cashew Nuts",
  "Orange Flavor Chicken": "Orange Flavored Chicken",
  "House Fried Rice": "House Special Fried Rice",
  "House Soft Noodles": "House Soft Noodle",
  "Chicken Soft Noodles": "Chicken Soft Noodle",
  "Salt Pepper Chicken Wings": "Salted Pepper Chicken Wings",
  "Salted Pepper Chicken Wing": "Salted Pepper Chicken Wings",
};

/**
 * 中文 for dishes the à la carte menu does not list at all.
 *
 * Both are lunch-tier entrées, so both reach a kitchen ticket as a modifier
 * line; neither has a row above to read a name from.
 *
 * ⚠️ TODO(confirm): descriptive translation, family to approve.
 */
const OFF_CATALOGUE_ZH: Record<string, string> = {
  "Chicken Szechuan Style": "四川雞",
  "Yu-Hsiang Beef": "魚香牛肉",
};

let dishIndex: Map<string, string> | null = null;

function buildDishIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const category of menu) {
    for (const item of category.items) {
      if (!item.chineseName) continue;
      // First writer wins: a dish listed under both Specials and its own
      // section keeps the section's name, and the two agree anyway.
      const key = dishKey(item.name);
      if (!index.has(key)) index.set(key, item.chineseName);
    }
  }
  for (const [name, zh] of Object.entries(OFF_CATALOGUE_ZH)) {
    index.set(dishKey(name), zh);
  }
  for (const [alias, target] of Object.entries(DISH_ALIASES)) {
    const zh = index.get(dishKey(target));
    if (zh) index.set(dishKey(alias), zh);
  }
  return index;
}

/**
 * 中文 for a dish named in English, or null.
 *
 * The one lookup the combo panels use, so a lunch entrée prints the same 宮保雞丁
 * the à la carte dish prints. There is no second translation to keep in sync.
 */
export function dishZh(nameEn: string): string | null {
  dishIndex ??= buildDishIndex();
  return dishIndex.get(dishKey(nameEn)) ?? null;
}

/* ------------------------------------------------------------------ *
 * Prix-fixe / combination sections. These are per-person or fixed-price
 * sets, not single orderable line items, so they render through
 * MenuCombos rather than MenuSection.
 *
 * LUNCH PRICING IS INDEPENDENT OF DINNER PRICING. A lunch entrée is
 * priced by its TIER ($15.75 or $16.25 per person), never by the à la
 * carte price of the same-named dish. The entrée list below is a set of
 * references into the tier, and carries no price of its own.
 * ------------------------------------------------------------------ */

export interface ComboAddOn {
  /** e.g. "For 4 people". */
  label: string;
  /** e.g. "Almond Chicken". */
  dish: string;
}

/**
 * One entrée on a lunch tier. Deliberately NOT a price — the tier price is
 * the price. `noRiceSide` carries the printed menu's "Except Noodle & Rice"
 * rule: a noodle or rice entrée arrives without the included rice side.
 */
export interface LunchChoice {
  name: string;
  noRiceSide?: boolean;
}

export interface ComboSet {
  id: string;
  /** e.g. "$15.75 per person", "Family Dinner No. 1", "$128". */
  name: string;
  /** Integer cents. Per person where `priceUnit` says so, else flat. */
  priceCents: number;
  /** e.g. "per person"; omitted for flat-price sets. */
  priceUnit?: string;
  /** Serving line, e.g. "Good for 4–6 people". */
  serves?: string;
  /** Included sides (lunch specials), as data rather than one prose line. */
  sides?: string[];
  /** Labeled course lines (family dinners): {label:"Appetizer", value:"…"}. */
  courses?: { label: string; value: string }[];
  /** Fixed included dishes (big family dinner). */
  dishes?: string[];
  /** Choose-your-entrée options (lunch specials). */
  choices?: LunchChoice[];
  /** Per-additional-person add-ons (family dinners). */
  addOns?: ComboAddOn[];
}

export interface ComboSection {
  id: string;
  name: string;
  /** Rules / time window shown under the heading. */
  note?: string;
  sets: ComboSet[];
}

export const combos: ComboSection[] = [
  {
    id: "lunch-specials",
    name: "Lunch Specials",
    note: "Served 11:00 AM–3:00 PM. Pickup orders do not include soup. No lunch on holidays.",
    sets: [
      {
        id: "lunch-15-75",
        name: "$15.75 per person",
        priceCents: 1575,
        priceUnit: "per person",
        sides: [
          "Egg Drop Soup",
          "Egg Roll",
          "Chicken Wing",
          "Fried Rice or Steamed Rice",
        ],
        choices: [
          { name: "Chicken Chop Suey" },
          { name: "Almond Chicken" },
          { name: "Sweet & Sour Pork" },
          { name: "Beef Szechuan Style" },
          { name: "Chicken Szechuan Style" },
          { name: "Beef with Broccoli" },
          { name: "Chicken with Black Bean Sauce" },
          { name: "Chicken with Broccoli" },
          { name: "Mixed Vegetable" },
          { name: "Beef with Black Bean Sauce" },
        ],
      },
      {
        id: "lunch-16-25",
        name: "$16.25 per person",
        priceCents: 1625,
        priceUnit: "per person",
        sides: ["Egg Drop Soup", "Fried Rice or Steamed Rice"],
        choices: [
          { name: "Salt Pepper Chicken Wings" },
          { name: "Kung Pao Chicken" },
          // TODO(confirm): price partially obscured on menu photo — owner to confirm
          // (entrée 13: the NAME is partially obscured, not the tier price.)
          { name: "Chicken with Broccoli" },
          { name: "Chicken or Beef Chow Fun (Dry)", noRiceSide: true },
          { name: "Chicken with Vegetable" },
          { name: "Orange Flavor Chicken" },
          { name: "Sweet & Sour Chicken" },
          { name: "Curry Chicken" },
          { name: "Chicken Cantonese" },
          { name: "Beef with Green Pepper" },
          { name: "Mongolian Beef" },
          { name: "Curry Beef" },
          { name: "Yu-Hsiang Beef" },
          { name: "Beef Chop Suey" },
          { name: "Kung Pao Squid" },
          { name: "Squid with Black Bean Sauce" },
          { name: "Shrimp with Black Bean Sauce" },
          { name: "Shrimp Chop Suey" },
          { name: "Shrimp with Broccoli" },
          { name: "Shrimp with Lobster Sauce" },
          { name: "Chow San Shein" },
          { name: "Fish Fillet with Black Bean Sauce" },
          { name: "House Soft Noodles", noRiceSide: true },
          { name: "Chicken Soft Noodles", noRiceSide: true },
          { name: "House Fried Rice", noRiceSide: true },
          { name: "Shrimp Fried Rice", noRiceSide: true },
          { name: "Chicken Fried Rice", noRiceSide: true },
        ],
      },
    ],
  },
  {
    id: "family-dinners",
    name: "Family Dinners",
    note: "For two or more, priced per person. Please call to confirm soup for pickup orders.",
    sets: [
      {
        id: "family-dinner-1",
        name: "Family Dinner No. 1",
        priceCents: 2195,
        priceUnit: "per person",
        courses: [
          { label: "Soup", value: "Egg Drop Soup" },
          { label: "Appetizer", value: "Egg Roll, B.B.Q. Pork" },
          {
            label: "Entrées",
            value:
              "Chicken Chop Suey, Sweet & Sour Chicken, Steamed or Fried Rice",
          },
        ],
        addOns: [
          { label: "For 3 people", dish: "Broccoli Beef" },
          { label: "For 4 people", dish: "Almond Chicken" },
          { label: "For 5 people", dish: "House Soft Noodles" },
          { label: "For 6 people", dish: "Salted Pepper Chicken Wings" },
        ],
      },
      {
        id: "family-dinner-2",
        name: "Family Dinner No. 2",
        priceCents: 2295,
        priceUnit: "per person",
        courses: [
          { label: "Soup", value: "Wonton Soup" },
          { label: "Appetizer", value: "Egg Roll, B.B.Q. Pork" },
          {
            label: "Entrées",
            value: "Mongolian Beef, Cashew Chicken, Steamed or Fried Rice",
          },
        ],
        addOns: [
          { label: "For 3 people", dish: "Shrimp Szechuan Style" },
          { label: "For 4 people", dish: "Almond Shrimp" },
          { label: "For 5 people", dish: "Chow San Shein" },
          { label: "For 6 people", dish: "Salted Pepper Chicken Wings" },
        ],
      },
    ],
  },
  {
    id: "big-family-dinner",
    name: "Big Family Dinner Special",
    sets: [
      {
        id: "big-family-128",
        name: "Good for 4 to 6 people",
        priceCents: 12800,
        dishes: [
          "Wor Wonton Soup",
          "B.B.Q. Pork",
          "Salted & Deep Fried Shrimp (with shell)",
          "Broccoli Chicken",
          "Fish Fillet with Black Bean Sauce",
          "Salted Pepper Chicken Wings",
        ],
      },
      {
        id: "big-family-178",
        name: "Good for 6 to 8 people",
        priceCents: 17800,
        dishes: [
          "Wor Wonton Soup",
          "B.B.Q. Pork",
          "Salted & Deep Fried Shrimp (with shell)",
          "Chef's Scallop",
          "Fish Fillet with Black Bean Sauce",
          "Salted Pepper Chicken Wings",
          "Pork Chop Peking",
          "Sauteed Seasonal Vegetable",
        ],
      },
    ],
  },
];
