/**
 * Menu data for New Mandarin Canton II — reconciled against
 * `docs/nmc-menu-prices-authoritative.md` (physical menu rev. 9/25).
 *
 * SCOPE / CONVENTIONS
 * - THIS FILE IS THE ONLY PRICE SOURCE. Individual price, party-tray price,
 *   size tiers and per-item add-ons all live here; `src/lib/menu/catalog.ts`
 *   adapts them into the normalized shape the cart, the ticket and the totals
 *   use. There is no second table to keep in sync — the tray prices that used
 *   to live in `src/data/party-trays.ts` were estimates and are gone.
 * - Money is INTEGER CENTS everywhere. 24.95 is stored as 2495. A float never
 *   enters the data, so one can never enter a price calculation.
 * - `trayCents` is set only where the printed menu prints a party-tray price.
 *   Appetizers and soups have no tray column, so they carry none and the UI
 *   shows no tray option for them.
 * - English-only: dish Chinese names are intentionally omitted. 富源 (the
 *   seal) is the site's only Chinese text by design.
 * - `spicy` mirrors the printed menu's 🌶 markers and is the ONLY source of
 *   that flag — see the note in src/data/menu-overrides.ts.
 * - Names follow the printed menu verbatim, including its own spellings
 *   ("Bac Choy", "Egg Plant", singular "Vegetable"). Where the site's existing
 *   spelling differs from the price document the SITE wins: this pass
 *   reconciles prices and flags, it does not rename dishes.
 *
 * ⚠️ TODO(confirm) markers below flag the five prices the source photographs
 * could not resolve. They carry the document's value and need the owner's
 * confirmation against the physical menu.
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
   * Standard Chinese culinary name.
   *
   * Populated on ZERO items today, and unused on the marketing site by design
   * (English-only menu; 富源 is the only Chinese text there). The kitchen
   * ticket IS Chinese-primary, so its 中文 comes from src/data/menu-overrides.ts
   * instead. Setting it here would take precedence — see menu/catalog.ts.
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
        description:
          "Duck, shrimp, chicken, roast pork, broccoli, mushroom, water chestnuts, snow peas, chef's special sauce.",
        priceCents: 2495,
        trayCents: 9200,
      },
      {
        id: "oceania",
        name: "Oceania",
        description:
          "Shrimp, scallops, squid, fish fillet, mushrooms, snow peas, vegetables.",
        priceCents: 2650,
        trayCents: 10000,
      },
      {
        id: "orange-flavored-chicken-special",
        name: "Orange Flavored Chicken",
        description: "Chef's special tangerine sauce.",
        priceCents: 1995,
        trayCents: 7200,
        spicy: true,
      },
      {
        id: "salted-pepper-chicken-wings-special",
        name: "Salted Pepper Chicken Wings",
        description: "Crispy fried, sautéed with hot pepper.",
        priceCents: 1995,
        trayCents: 7500,
        spicy: true,
      },
      {
        id: "kung-po-san-shein",
        name: "Kung-Po San Shein",
        description:
          "Shrimp, chicken, beef, green onion, peanuts, spicy sauce.",
        priceCents: 2295,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "mongolian-beef-special",
        name: "Mongolian Beef",
        description: "Sliced tenderloin, jade green scallions, natural sauce.",
        priceCents: 2150,
        trayCents: 7500,
      },
      {
        id: "upside-down-pan-fried-noodles",
        name: "Upside Down Pan Fried Noodles",
        description: "Beef, chicken, shrimp, vegetables.",
        priceCents: 2095,
        trayCents: 7400,
      },
      {
        id: "honey-walnut-shrimp",
        name: "Honey Walnut Shrimp",
        description: "Special mayonnaise dressing, honey walnut.",
        priceCents: 2550,
        trayCents: 9500,
      },
      {
        id: "black-pepper-beef-or-chicken",
        name: "Black Pepper Beef or Chicken",
        priceCents: 2150,
        trayCents: 7500,
        spicy: true,
      },
      {
        id: "steamed-fish-filet-special",
        name: "Steamed Fish Filet",
        priceCents: 2450,
        trayCents: 9200,
      },
      {
        id: "salted-pepper-squid-special",
        name: "Salted Pepper Squid",
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
      { id: "egg-rolls", name: "Egg Rolls (2)", priceCents: 350 },
      {
        id: "salt-pepper-chicken-wings-app",
        name: "Salt Pepper Chicken Wings (6)",
        priceCents: 1295,
      },
      { id: "bbq-pork-app", name: "B.B.Q. Pork", priceCents: 1495 },
      { id: "bbq-spareribs", name: "B.B.Q. Spareribs", priceCents: 1695 },
      {
        // One dish, two printed weights — a size pair, not two items. The old
        // `roasted-duck-whole` row is folded in here as the second tier.
        id: "roasted-duck",
        name: "Roasted Duck",
        priceCents: 2000,
        sizes: [
          { id: "half", label: "Half", priceCents: 2000 },
          { id: "whole", label: "Whole", priceCents: 3800 },
        ],
      },
      {
        id: "steamed-or-fried-dumplings",
        name: "Steamed or Fried Dumplings (8)",
        priceCents: 1595,
      },
      {
        // The printed menu says "Fired"; the site's corrected spelling stands.
        id: "fried-cream-cheese-wonton",
        name: "Fried Cream Cheese Wonton (8)",
        priceCents: 995,
      },
    ],
  },
  {
    id: "soup",
    name: "Soup",
    items: [
      { id: "seafood-soup", name: "Seafood Soup (for 2)", priceCents: 1895 },
      {
        id: "three-flavor-sizzling-rice-soup",
        name: "Three Flavor Sizzling Rice Soup (for 2)",
        priceCents: 1895,
      },
      {
        id: "hot-sour-soup",
        name: "Hot & Sour Soup",
        priceCents: 1695,
        spicy: true,
      },
      {
        id: "chicken-corn-soup",
        name: "Chicken and Corn Soup",
        priceCents: 1695,
      },
      { id: "wor-wonton-soup", name: "Wor Wonton Soup", priceCents: 1895 },
      { id: "wonton-soup", name: "Wonton Soup", priceCents: 1695 },
      {
        id: "egg-drop-soup",
        name: "Egg Drop Soup",
        priceCents: 1395,
        sizes: [
          { id: "cup", label: "Cup", priceCents: 650 },
          { id: "bowl", label: "Bowl", priceCents: 1395 },
        ],
      },
      { id: "vegetables-soup", name: "Vegetables Soup", priceCents: 1495 },
      {
        id: "chicken-vegetable-soup",
        name: "Chicken Vegetable Soup",
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
        priceCents: 1995,
        trayCents: 7500,
        spicy: true,
      },
      {
        id: "orange-flavored-chicken",
        name: "Orange Flavored Chicken",
        priceCents: 1995,
        trayCents: 7200,
        spicy: true,
      },
      {
        id: "kung-pao-chicken",
        name: "Kung Pao Chicken",
        priceCents: 2250,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "curry-chicken",
        name: "Curry Chicken",
        priceCents: 1950,
        trayCents: 7000,
        spicy: true,
      },
      {
        id: "chicken-black-bean-sauce",
        name: "Chicken with Black Bean Sauce",
        priceCents: 1950,
        trayCents: 7000,
        spicy: true,
      },
      {
        id: "chicken-cashew-nuts",
        name: "Chicken with Cashew Nuts",
        priceCents: 2250,
        trayCents: 9000,
      },
      {
        id: "chicken-broccoli",
        name: "Chicken with Broccoli",
        priceCents: 1950,
        trayCents: 7000,
      },
      {
        id: "chicken-snow-peas",
        name: "Chicken with Snow Peas",
        priceCents: 2095,
        trayCents: 8000,
      },
      { id: "almond-chicken", name: "Almond Chicken", priceCents: 1950, trayCents: 7000 },
      { id: "sesame-chicken", name: "Sesame Chicken", priceCents: 1995, trayCents: 7000 },
      {
        id: "mandarin-chicken",
        name: "Mandarin Chicken",
        priceCents: 1995,
        trayCents: 7000,
        spicy: true,
      },
      {
        id: "garlic-chicken",
        name: "Garlic Chicken",
        priceCents: 1995,
        trayCents: 7000,
        spicy: true,
      },
      {
        id: "lemon-chicken",
        name: "Lemon with Chicken",
        priceCents: 1995,
        trayCents: 7000,
      },
      {
        id: "sweet-sour-chicken",
        name: "Sweet & Sour Chicken",
        priceCents: 1950,
        trayCents: 7000,
      },
      { id: "moo-goo-gai-pan", name: "Moo Goo Gai Pan", priceCents: 1995, trayCents: 7200 },
      {
        id: "chicken-chop-suey",
        name: "Chicken Chop Suey",
        priceCents: 1950,
        trayCents: 6500,
      },
      {
        id: "chicken-egg-foo-young",
        name: "Chicken Egg Foo Young",
        priceCents: 2095,
        trayCents: 7500,
      },
      {
        id: "chicken-cantonese",
        name: "Chicken Cantonese",
        priceCents: 1950,
        trayCents: 7000,
      },
      {
        id: "chicken-vegetable",
        name: "Chicken with Vegetable",
        priceCents: 1995,
        trayCents: 7200,
      },
      {
        id: "chicken-bac-choy",
        name: "Chicken with Bac Choy",
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
        priceCents: 2350,
        trayCents: 9500,
        spicy: true,
      },
      {
        // The price document calls this "Salted & Deep Fried Shrimp (no
        // shell)"; the site's existing name stands — prices only in this pass.
        id: "salted-pepper-shrimp-no-shell",
        name: "Salted Pepper Shrimp (no shell)",
        priceCents: 2550,
        trayCents: 9800,
        spicy: true,
      },
      {
        id: "szechuan-style-shrimp",
        name: "Szechuan Style Shrimp",
        priceCents: 2550,
        trayCents: 9500,
        spicy: true,
      },
      {
        id: "shrimp-black-bean-sauce",
        name: "Shrimp with Black Bean Sauce",
        priceCents: 2150,
        trayCents: 8200,
        spicy: true,
      },
      {
        id: "kung-pao-shrimp",
        name: "Kung-Pao Shrimp",
        priceCents: 2550,
        trayCents: 10000,
        spicy: true,
      },
      {
        id: "shrimp-cantonese",
        name: "Shrimp Cantonese",
        priceCents: 2195,
        trayCents: 8000,
      },
      {
        id: "shrimp-chop-suey",
        name: "Shrimp Chop Suey",
        priceCents: 2195,
        trayCents: 7800,
      },
      {
        id: "shrimp-lobster-sauce",
        name: "Shrimp with Lobster Sauce",
        priceCents: 2195,
        trayCents: 8200,
      },
      {
        id: "shrimp-broccoli",
        name: "Shrimp with Broccoli",
        priceCents: 2195,
        trayCents: 8200,
      },
      {
        id: "shrimp-snow-peas",
        name: "Shrimp with Snow Peas",
        priceCents: 2450,
        trayCents: 9200,
      },
      {
        id: "curry-shrimp",
        name: "Curry Shrimp",
        priceCents: 2195,
        trayCents: 8200,
        spicy: true,
      },
      {
        id: "sweet-sour-shrimp",
        name: "Sweet & Sour Shrimp",
        priceCents: 2250,
        trayCents: 8200,
      },
      { id: "almond-shrimp", name: "Almond Shrimp", priceCents: 2250, trayCents: 8200 },
      {
        id: "shrimp-egg-foo-young",
        name: "Shrimp Egg Foo Young",
        priceCents: 2350,
        trayCents: 9000,
      },
      {
        id: "house-egg-foo-young",
        name: "House Egg Foo Young",
        priceCents: 2350,
        trayCents: 9000,
      },
      { id: "chow-san-shein", name: "Chow San Shein", priceCents: 2195, trayCents: 8500 },
      { id: "house-chop-suey", name: "House Chop Suey", priceCents: 2195, trayCents: 7800 },
      {
        id: "shrimp-vegetable",
        name: "Shrimp with Vegetable",
        priceCents: 2250,
        trayCents: 8500,
      },
      {
        id: "sweet-sour-fish-fillet",
        name: "Sweet & Sour Fish Fillet",
        priceCents: 2250,
        trayCents: 8200,
      },
      {
        id: "fish-fillet-black-bean-sauce",
        name: "Fish Fillet with Black Bean Sauce",
        priceCents: 2250,
        // TODO(confirm): price partially obscured on menu photo — owner to confirm
        trayCents: 8200,
        spicy: true,
      },
      {
        id: "salt-pepper-fish-filet",
        name: "Salt Pepper Fish Filet",
        priceCents: 2450,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "scallops-black-bean-sauce",
        name: "Scallops with Black Bean Sauce",
        priceCents: 2550,
        trayCents: 10000,
        spicy: true,
      },
      {
        id: "kung-pao-scallops",
        name: "Kung-Pao Scallops",
        priceCents: 2650,
        trayCents: 11000,
        spicy: true,
      },
      {
        id: "yu-hsiang-scallops",
        name: "Yu-Hsiang Scallops",
        priceCents: 2550,
        trayCents: 10000,
        spicy: true,
      },
      {
        id: "kung-pao-squid",
        name: "Kung Pao Squid",
        priceCents: 2450,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "squid-black-bean-sauce",
        name: "Squid with Black Bean Sauce",
        priceCents: 2395,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "salted-pepper-squid",
        name: "Salted Pepper Squid",
        priceCents: 2450,
        trayCents: 9200,
        spicy: true,
      },
      { id: "sauteed-scallops", name: "Sauteed Scallops", priceCents: 2550, trayCents: 10000 },
    ],
  },
  {
    id: "beef",
    name: "Beef",
    items: [
      { id: "mongolian-beef", name: "Mongolian Beef", priceCents: 2150, trayCents: 7500 },
      { id: "beef-broccoli", name: "Beef with Broccoli", priceCents: 2050, trayCents: 7200 },
      {
        id: "beef-snow-peas",
        name: "Beef with Snow Peas",
        priceCents: 2150,
        // TODO(confirm): price partially obscured on menu photo — owner to confirm
        trayCents: 8200,
      },
      {
        id: "beef-oyster-sauce",
        name: "Beef with Oyster Sauce",
        priceCents: 2250,
        // TODO(confirm): price partially obscured on menu photo — owner to confirm
        trayCents: 8300,
      },
      { id: "green-pepper-beef", name: "Green Pepper Beef", priceCents: 2050, trayCents: 7200 },
      {
        id: "black-mushroom-beef",
        name: "Black Mushroom Beef",
        priceCents: 2450,
        trayCents: 9200,
      },
      {
        id: "szechuan-style-beef",
        name: "Szechuan Style Beef",
        // TODO(confirm): price partially obscured on menu photo — owner to confirm
        priceCents: 2150,
        trayCents: 7200,
        spicy: true,
      },
      {
        id: "orange-flavored-beef",
        name: "Orange Flavored Beef",
        priceCents: 2250,
        trayCents: 7500,
        spicy: true,
      },
      {
        id: "kung-pao-beef",
        name: "Kung Pao Beef",
        priceCents: 2350,
        trayCents: 9000,
        spicy: true,
      },
      {
        id: "beef-black-bean-sauce",
        name: "Beef with Black Bean Sauce",
        priceCents: 2050,
        trayCents: 7200,
        spicy: true,
      },
      {
        id: "crispy-beef-spicy-sauce",
        name: "Crispy Beef with Spicy Sauce",
        priceCents: 2250,
        trayCents: 7500,
        spicy: true,
      },
      {
        id: "curry-beef",
        name: "Curry Beef",
        priceCents: 2050,
        trayCents: 7200,
        spicy: true,
      },
      { id: "beef-chop-suey", name: "Beef Chop Suey", priceCents: 2050, trayCents: 6800 },
      {
        id: "beef-egg-foo-young",
        name: "Beef Egg Foo Young",
        priceCents: 2150,
        trayCents: 7500,
      },
      { id: "beef-vegetable", name: "Beef with Vegetable", priceCents: 2150, trayCents: 7500 },
      { id: "beef-bac-choy", name: "Beef with Bac Choy", priceCents: 2150, trayCents: 7500 },
    ],
  },
  {
    id: "pork",
    name: "Pork",
    items: [
      { id: "pork-chop-peking", name: "Pork Chop Peking", priceCents: 2295, trayCents: 8500 },
      {
        id: "salted-pepper-pork-chop",
        name: "Salted Pepper Pork Chop",
        priceCents: 2295,
        trayCents: 8500,
        spicy: true,
      },
      {
        id: "yu-hsiang-pork",
        name: "Yu Hsiang Pork",
        priceCents: 1950,
        trayCents: 7000,
        spicy: true,
      },
      {
        id: "mandarin-pork",
        name: "Mandarin Pork",
        priceCents: 1995,
        trayCents: 7000,
        spicy: true,
      },
      { id: "sweet-sour-pork", name: "Sweet & Sour Pork", priceCents: 1950, trayCents: 7000 },
      { id: "sesame-pork", name: "Sesame Pork", priceCents: 1995, trayCents: 7000 },
      { id: "pork-chop-suey", name: "Pork Chop Suey", priceCents: 1950, trayCents: 6500 },
      {
        id: "bbq-pork-egg-foo-young",
        name: "B.B.Q. Pork Egg Foo Young",
        priceCents: 2150,
        trayCents: 7500,
      },
      {
        id: "mapo-tofu",
        name: "Mapo Tofu",
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
        priceCents: 2395,
        trayCents: 8800,
      },
      {
        id: "house-special-combination-hot-pot",
        name: "House Special Combination Hot Pot",
        priceCents: 2395,
        trayCents: 8800,
      },
      {
        id: "sizzling-san-shein",
        name: "Sizzling San Shein",
        priceCents: 2295,
        trayCents: 8500,
        spicy: true,
      },
      {
        id: "sizzling-shrimp",
        name: "Sizzling Shrimp",
        priceCents: 2295,
        trayCents: 8500,
        spicy: true,
      },
      {
        id: "sizzling-double-happiness",
        name: "Sizzling Double Happiness",
        priceCents: 2550,
        trayCents: 9500,
        spicy: true,
      },
      {
        id: "sizzling-fish-fillet",
        name: "Sizzling Fish Fillet",
        priceCents: 2295,
        trayCents: 8500,
        spicy: true,
      },
      {
        id: "sizzling-chicken",
        name: "Sizzling Chicken",
        priceCents: 2050,
        trayCents: 7200,
        spicy: true,
      },
      {
        id: "sizzling-beef",
        name: "Sizzling Beef",
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
      { id: "mixed-vegetable", name: "Mixed Vegetable", priceCents: 1895, trayCents: 7000 },
      {
        id: "black-mushrooms-oyster-sauce",
        name: "Black Mushrooms with Oyster Sauce",
        priceCents: 2095,
        trayCents: 8000,
      },
      {
        id: "broccoli-oyster-sauce",
        name: "Broccoli with Oyster Sauce",
        priceCents: 1795,
        trayCents: 5800,
      },
      { id: "sauteed-snow-peas", name: "Sauteed Snow Peas", priceCents: 1995, trayCents: 8000 },
      {
        id: "spicy-hot-egg-plant",
        name: "Spicy Hot Egg Plant",
        priceCents: 1995,
        trayCents: 7800,
        spicy: true,
      },
      {
        id: "vegetarian-egg-foo-young",
        name: "Vegetarian Egg Foo Young",
        priceCents: 2095,
        trayCents: 7500,
      },
      { id: "bean-sprout-saute", name: "Bean Sprout Saute", priceCents: 1695, trayCents: 5200 },
      { id: "tofu-vegetable", name: "Tofu with Vegetable", priceCents: 1895, trayCents: 6800 },
      {
        id: "sauteed-bac-choy-garlic",
        name: "Sauteed Bac Choy with Garlic",
        priceCents: 1895,
        trayCents: 7000,
      },
      {
        id: "salted-pepper-tofu",
        name: "Salted Pepper Tofu",
        priceCents: 1995,
        trayCents: 6800,
        spicy: true,
      },
      {
        id: "kung-pao-tofu",
        name: "Kung Pao Tofu",
        priceCents: 1995,
        trayCents: 6800,
        spicy: true,
      },
      {
        id: "hot-egg-plant-tofu",
        name: "Hot Egg Plant with Tofu",
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
        priceCents: 1950,
        trayCents: 6500,
      },
      { id: "shrimp-fried-rice", name: "Shrimp Fried Rice", priceCents: 1950, trayCents: 6500 },
      { id: "chicken-fried-rice", name: "Chicken Fried Rice", priceCents: 1850, trayCents: 6200 },
      { id: "beef-fried-rice", name: "Beef Fried Rice", priceCents: 1850, trayCents: 6200 },
      {
        id: "vegetarian-fried-rice",
        name: "Vegetarian Fried Rice",
        priceCents: 1750,
        trayCents: 5800,
      },
      {
        id: "bbq-pork-fried-rice",
        name: "B.B.Q. Pork Fried Rice",
        priceCents: 1850,
        trayCents: 6200,
      },
      { id: "fried-steamed-rice", name: "Fried/Steamed Rice", priceCents: 300, trayCents: 3800 },
    ],
  },
  {
    id: "noodles",
    name: "Noodles",
    items: [
      { id: "house-soft-noodle", name: "House Soft Noodle", priceCents: 1995, trayCents: 6800 },
      {
        id: "seafood-soft-noodle",
        name: "Seafood Soft Noodle",
        priceCents: 1995,
        trayCents: 7000,
      },
      { id: "shrimp-soft-noodle", name: "Shrimp Soft Noodle", priceCents: 1995, trayCents: 7000 },
      { id: "beef-soft-noodle", name: "Beef Soft Noodle", priceCents: 1895, trayCents: 6500 },
      {
        id: "chicken-soft-noodle",
        name: "Chicken Soft Noodle",
        priceCents: 1895,
        trayCents: 6500,
      },
      {
        id: "bbq-pork-soft-noodle",
        name: "B.B.Q. Pork Soft Noodle",
        priceCents: 1895,
        trayCents: 6500,
      },
      {
        // The price document lists this as "Vegetarian Noodle"; the site's
        // existing name stands.
        id: "vegetarian-soft-noodle",
        name: "Vegetarian Soft Noodle",
        priceCents: 1795,
        trayCents: 6000,
      },
      {
        id: "chow-fun-chicken-or-beef",
        name: "Chicken or Beef Chow Fun (Dry)",
        priceCents: 1995,
        trayCents: 7000,
      },
      {
        id: "seafood-chow-fun",
        name: "Seafood Chow Fun (Dry)",
        priceCents: 2050,
        trayCents: 7200,
      },
      {
        id: "singapore-style-rice-noodle",
        name: "Singapore Style Rice Noodle",
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
