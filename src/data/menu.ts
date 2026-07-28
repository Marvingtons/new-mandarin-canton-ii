/**
 * Menu data for New Mandarin Canton II — transcribed from the printed
 * menu (rev. 9/25, September 2025).
 *
 * SCOPE / CONVENTIONS
 * - Prices are display DOLLARS and the INDIVIDUAL price only. The printed
 *   menu also lists a "party tray" price for most entrées; those were never
 *   transcribed here and live in src/data/party-trays.ts — read the
 *   provenance warning in that file before trusting them.
 * - THIS FILE IS THE ORDERABLE MENU. src/lib/menu/catalog.ts adapts it into
 *   the normalized shape the cart, the ticket and the totals use, converting
 *   dollars to integer cents at that single boundary.
 * - English-only: dish Chinese names are intentionally omitted. 富源 (the
 *   seal) is the site's only Chinese text by design.
 * - `spicy` mirrors the printed menu's 🌶 markers.
 * - Names follow the printed menu verbatim, including its own spellings
 *   ("Bac Choy", "Egg Plant", singular "Vegetable").
 *
 * ⚠️ UNVERIFIED PRICES: the scallop/squid block (Seafood) was hard to
 * read on the source and is flagged in the transcription — spot-check
 * these against the physical menu before relying on them.
 */

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
  price: number;
  spicy?: boolean;
  tags?: string[];
}

export interface MenuCategory {
  id: string;
  name: string;
  /** Optional footnote under the section, e.g. "Add noodles +$3.00". */
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
        price: 24.95,
      },
      {
        id: "oceania",
        name: "Oceania",
        description:
          "Shrimp, scallops, squid, fish fillet, mushrooms, snow peas, vegetables.",
        price: 26.5,
      },
      {
        id: "orange-flavored-chicken-special",
        name: "Orange Flavored Chicken",
        description: "Chef's special tangerine sauce.",
        price: 19.95,
        spicy: true,
      },
      {
        id: "salted-pepper-chicken-wings-special",
        name: "Salted Pepper Chicken Wings",
        description: "Crispy fried, sautéed with hot pepper.",
        price: 19.95,
        spicy: true,
      },
      {
        id: "kung-po-san-shein",
        name: "Kung-Po San Shein",
        description:
          "Shrimp, chicken, beef, green onion, peanuts, spicy sauce.",
        price: 22.95,
        spicy: true,
      },
      {
        id: "mongolian-beef-special",
        name: "Mongolian Beef",
        description: "Sliced tenderloin, jade green scallions, natural sauce.",
        price: 21.5,
      },
      {
        id: "upside-down-pan-fried-noodles",
        name: "Upside Down Pan Fried Noodles",
        description: "Beef, chicken, shrimp, vegetables.",
        price: 20.95,
      },
      {
        id: "honey-walnut-shrimp",
        name: "Honey Walnut Shrimp",
        description: "Special mayonnaise dressing, honey walnut.",
        price: 25.95,
      },
      {
        id: "black-pepper-beef-or-chicken",
        name: "Black Pepper Beef or Chicken",
        price: 21.5,
      },
      {
        id: "steamed-fish-filet-special",
        name: "Steamed Fish Filet",
        price: 24.5,
      },
      {
        id: "salted-pepper-squid-special",
        name: "Salted Pepper Squid",
        price: 24.5,
      },
    ],
  },
  {
    id: "appetizers",
    name: "Appetizers",
    items: [
      { id: "egg-rolls", name: "Egg Rolls (2)", price: 3.5 },
      {
        id: "salt-pepper-chicken-wings-app",
        name: "Salt Pepper Chicken Wings (6)",
        price: 12.95,
      },
      { id: "bbq-pork-app", name: "B.B.Q. Pork", price: 14.95 },
      { id: "bbq-spareribs", name: "B.B.Q. Spareribs", price: 16.95 },
      { id: "roasted-duck-half", name: "Roasted Duck (Half)", price: 20.0 },
      { id: "roasted-duck-whole", name: "Roasted Duck (Whole)", price: 38.0 },
      {
        id: "steamed-or-fried-dumplings",
        name: "Steamed or Fried Dumplings (8)",
        price: 15.95,
      },
      {
        id: "fried-cream-cheese-wonton",
        name: "Fried Cream Cheese Wonton (8)",
        price: 9.95,
      },
    ],
  },
  {
    id: "soup",
    name: "Soup",
    note: "Add noodles $3.00 extra.",
    items: [
      { id: "seafood-soup", name: "Seafood Soup (for 2)", price: 18.95 },
      {
        id: "three-flavor-sizzling-rice-soup",
        name: "Three Flavor Sizzling Rice Soup (for 2)",
        price: 18.95,
      },
      { id: "hot-sour-soup", name: "Hot & Sour Soup", price: 16.95, spicy: true },
      {
        id: "chicken-corn-soup",
        name: "Chicken and Corn Soup",
        price: 16.95,
      },
      { id: "wor-wonton-soup", name: "Wor Wonton Soup", price: 16.95 },
      { id: "wonton-soup", name: "Wonton Soup", price: 13.95 },
      {
        id: "egg-drop-soup",
        name: "Egg Drop Soup",
        description: "Cup $6.50.",
        price: 13.95,
      },
      { id: "vegetables-soup", name: "Vegetables Soup", price: 14.95 },
      {
        id: "chicken-vegetable-soup",
        name: "Chicken Vegetable Soup",
        price: 16.95,
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
        price: 19.95,
        spicy: true,
      },
      {
        id: "orange-flavored-chicken",
        name: "Orange Flavored Chicken",
        price: 19.95,
        spicy: true,
      },
      {
        id: "kung-pao-chicken",
        name: "Kung Pao Chicken",
        price: 22.5,
        spicy: true,
      },
      { id: "curry-chicken", name: "Curry Chicken", price: 19.5, spicy: true },
      {
        id: "chicken-black-bean-sauce",
        name: "Chicken with Black Bean Sauce",
        price: 19.5,
        spicy: true,
      },
      {
        id: "chicken-cashew-nuts",
        name: "Chicken with Cashew Nuts",
        price: 22.5,
      },
      { id: "chicken-broccoli", name: "Chicken with Broccoli", price: 19.5 },
      { id: "chicken-snow-peas", name: "Chicken with Snow Peas", price: 20.95 },
      { id: "almond-chicken", name: "Almond Chicken", price: 19.5 },
      { id: "sesame-chicken", name: "Sesame Chicken", price: 19.95 },
      {
        id: "mandarin-chicken",
        name: "Mandarin Chicken",
        price: 19.95,
        spicy: true,
      },
      {
        id: "garlic-chicken",
        name: "Garlic Chicken",
        price: 19.95,
        spicy: true,
      },
      { id: "lemon-chicken", name: "Lemon with Chicken", price: 19.95 },
      { id: "sweet-sour-chicken", name: "Sweet & Sour Chicken", price: 19.5 },
      { id: "moo-goo-gai-pan", name: "Moo Goo Gai Pan", price: 19.5 },
      { id: "chicken-chop-suey", name: "Chicken Chop Suey", price: 19.5 },
      {
        id: "chicken-egg-foo-young",
        name: "Chicken Egg Foo Young",
        price: 20.95,
      },
      { id: "chicken-cantonese", name: "Chicken Cantonese", price: 19.95 },
      {
        id: "chicken-vegetable",
        name: "Chicken with Vegetable",
        price: 19.95,
      },
      { id: "chicken-bac-choy", name: "Chicken with Bac Choy", price: 19.95 },
    ],
  },
  {
    id: "seafood",
    name: "Seafood",
    items: [
      {
        id: "salted-fried-shrimp-with-shell",
        name: "Salted & Deep Fried Shrimp (with shell)",
        price: 23.5,
        spicy: true,
      },
      {
        id: "salted-pepper-shrimp-no-shell",
        name: "Salted Pepper Shrimp (no shell)",
        price: 25.5,
        spicy: true,
      },
      {
        id: "szechuan-style-shrimp",
        name: "Szechuan Style Shrimp",
        price: 25.5,
        spicy: true,
      },
      {
        id: "shrimp-black-bean-sauce",
        name: "Shrimp with Black Bean Sauce",
        price: 21.5,
        spicy: true,
      },
      {
        id: "kung-pao-shrimp",
        name: "Kung-Pao Shrimp",
        price: 25.5,
        spicy: true,
      },
      { id: "shrimp-cantonese", name: "Shrimp Cantonese", price: 21.95 },
      { id: "shrimp-chop-suey", name: "Shrimp Chop Suey", price: 21.95 },
      {
        id: "shrimp-lobster-sauce",
        name: "Shrimp with Lobster Sauce",
        price: 21.95,
      },
      { id: "shrimp-broccoli", name: "Shrimp with Broccoli", price: 21.95 },
      { id: "shrimp-snow-peas", name: "Shrimp with Snow Peas", price: 24.5 },
      { id: "curry-shrimp", name: "Curry Shrimp", price: 21.95, spicy: true },
      { id: "sweet-sour-shrimp", name: "Sweet & Sour Shrimp", price: 22.5 },
      { id: "almond-shrimp", name: "Almond Shrimp", price: 22.5 },
      {
        id: "shrimp-egg-foo-young",
        name: "Shrimp Egg Foo Young",
        price: 23.5,
      },
      { id: "house-egg-foo-young", name: "House Egg Foo Young", price: 23.5 },
      { id: "chow-san-shein", name: "Chow San Shein", price: 21.95 },
      { id: "house-chop-suey", name: "House Chop Suey", price: 21.95 },
      {
        id: "shrimp-vegetable",
        name: "Shrimp with Vegetable",
        price: 22.5,
      },
      {
        id: "sweet-sour-fish-fillet",
        name: "Sweet & Sour Fish Fillet",
        price: 22.5,
      },
      {
        id: "fish-fillet-black-bean-sauce",
        name: "Fish Fillet with Black Bean Sauce",
        price: 22.5,
      },
      {
        id: "salt-pepper-fish-filet",
        name: "Salt Pepper Fish Filet",
        price: 24.5,
      },
      {
        id: "scallops-black-bean-sauce",
        name: "Scallops with Black Bean Sauce",
        price: 19.5,
      },
      {
        id: "kung-pao-scallops",
        name: "Kung-Pao Scallops",
        price: 26.5,
        spicy: true,
      },
      {
        id: "yu-hsiang-scallops",
        name: "Yu-Hsiang Scallops",
        price: 25.5,
        spicy: true,
      },
      { id: "kung-pao-squid", name: "Kung Pao Squid", price: 24.5, spicy: true },
      {
        id: "squid-black-bean-sauce",
        name: "Squid with Black Bean Sauce",
        price: 23.95,
      },
      { id: "salted-pepper-squid", name: "Salted Pepper Squid", price: 24.5 },
      { id: "sauteed-scallops", name: "Sauteed Scallops", price: 25.5 },
    ],
  },
  {
    id: "beef",
    name: "Beef",
    items: [
      { id: "mongolian-beef", name: "Mongolian Beef", price: 21.5 },
      { id: "beef-broccoli", name: "Beef with Broccoli", price: 20.5 },
      { id: "beef-snow-peas", name: "Beef with Snow Peas", price: 21.5 },
      {
        id: "beef-oyster-sauce",
        name: "Beef with Oyster Sauce",
        price: 22.5,
      },
      { id: "green-pepper-beef", name: "Green Pepper Beef", price: 20.5 },
      { id: "black-mushroom-beef", name: "Black Mushroom Beef", price: 24.5 },
      {
        id: "szechuan-style-beef",
        name: "Szechuan Style Beef",
        price: 20.5,
        spicy: true,
      },
      {
        id: "orange-flavored-beef",
        name: "Orange Flavored Beef",
        price: 22.5,
        spicy: true,
      },
      { id: "kung-pao-beef", name: "Kung Pao Beef", price: 23.5, spicy: true },
      {
        id: "beef-black-bean-sauce",
        name: "Beef with Black Bean Sauce",
        price: 20.5,
        spicy: true,
      },
      {
        id: "crispy-beef-spicy-sauce",
        name: "Crispy Beef with Spicy Sauce",
        price: 22.5,
        spicy: true,
      },
      { id: "curry-beef", name: "Curry Beef", price: 20.5, spicy: true },
      { id: "beef-chop-suey", name: "Beef Chop Suey", price: 20.5 },
      { id: "beef-egg-foo-young", name: "Beef Egg Foo Young", price: 21.5 },
      { id: "beef-vegetable", name: "Beef with Vegetable", price: 21.5 },
      { id: "beef-bac-choy", name: "Beef with Bac Choy", price: 21.5 },
    ],
  },
  {
    id: "pork",
    name: "Pork",
    items: [
      { id: "pork-chop-peking", name: "Pork Chop Peking", price: 22.95 },
      {
        id: "salted-pepper-pork-chop",
        name: "Salted Pepper Pork Chop",
        price: 22.95,
        spicy: true,
      },
      {
        id: "yu-hsiang-pork",
        name: "Yu Hsiang Pork",
        price: 19.95,
        spicy: true,
      },
      {
        id: "mandarin-pork",
        name: "Mandarin Pork",
        price: 19.95,
        spicy: true,
      },
      { id: "sweet-sour-pork", name: "Sweet & Sour Pork", price: 19.5 },
      { id: "sesame-pork", name: "Sesame Pork", price: 19.95 },
      { id: "pork-chop-suey", name: "Pork Chop Suey", price: 19.5 },
      {
        id: "bbq-pork-egg-foo-young",
        name: "B.B.Q. Pork Egg Foo Young",
        price: 21.5,
      },
      { id: "mapo-tofu", name: "Mapo Tofu", price: 19.5, spicy: true },
    ],
  },
  {
    id: "sizzling-hot-pot",
    name: "Sizzling Hot Pot",
    items: [
      {
        id: "seafood-combination-hot-pot",
        name: "Seafood Combination Hot Pot",
        price: 23.95,
      },
      {
        id: "house-special-combination-hot-pot",
        name: "House Special Combination Hot Pot",
        price: 23.95,
      },
      { id: "sizzling-san-shein", name: "Sizzling San Shein", price: 22.95 },
      { id: "sizzling-shrimp", name: "Sizzling Shrimp", price: 22.95 },
      {
        id: "sizzling-double-happiness",
        name: "Sizzling Double Happiness",
        price: 25.5,
      },
      {
        id: "sizzling-fish-fillet",
        name: "Sizzling Fish Fillet",
        price: 22.95,
      },
      { id: "sizzling-chicken", name: "Sizzling Chicken", price: 20.5 },
      { id: "sizzling-beef", name: "Sizzling Beef", price: 20.95 },
    ],
  },
  {
    id: "vegetables",
    name: "Vegetables",
    items: [
      { id: "mixed-vegetable", name: "Mixed Vegetable", price: 18.95 },
      {
        id: "black-mushrooms-oyster-sauce",
        name: "Black Mushrooms with Oyster Sauce",
        price: 20.95,
      },
      {
        id: "broccoli-oyster-sauce",
        name: "Broccoli with Oyster Sauce",
        price: 17.95,
      },
      { id: "sauteed-snow-peas", name: "Sauteed Snow Peas", price: 19.95 },
      {
        id: "spicy-hot-egg-plant",
        name: "Spicy Hot Egg Plant",
        price: 19.95,
        spicy: true,
      },
      {
        id: "vegetarian-egg-foo-young",
        name: "Vegetarian Egg Foo Young",
        price: 19.95,
      },
      { id: "bean-sprout-saute", name: "Bean Sprout Saute", price: 16.95 },
      { id: "tofu-vegetable", name: "Tofu with Vegetable", price: 18.95 },
      {
        id: "sauteed-bac-choy-garlic",
        name: "Sauteed Bac Choy with Garlic",
        price: 18.95,
      },
      { id: "salted-pepper-tofu", name: "Salted Pepper Tofu", price: 19.95 },
      {
        id: "kung-pao-tofu",
        name: "Kung Pao Tofu",
        price: 19.95,
        spicy: true,
      },
      {
        id: "hot-egg-plant-tofu",
        name: "Hot Egg Plant with Tofu",
        price: 20.5,
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
        price: 19.5,
      },
      { id: "shrimp-fried-rice", name: "Shrimp Fried Rice", price: 19.5 },
      { id: "chicken-fried-rice", name: "Chicken Fried Rice", price: 18.5 },
      { id: "beef-fried-rice", name: "Beef Fried Rice", price: 18.5 },
      {
        id: "vegetarian-fried-rice",
        name: "Vegetarian Fried Rice",
        price: 17.5,
      },
      {
        id: "bbq-pork-fried-rice",
        name: "B.B.Q. Pork Fried Rice",
        price: 18.5,
      },
      { id: "fried-steamed-rice", name: "Fried/Steamed Rice", price: 3.0 },
    ],
  },
  {
    id: "noodles",
    name: "Noodles",
    note: "Skinny egg noodle $3.00 extra.",
    items: [
      { id: "house-soft-noodle", name: "House Soft Noodle", price: 19.95 },
      { id: "seafood-soft-noodle", name: "Seafood Soft Noodle", price: 19.95 },
      { id: "shrimp-soft-noodle", name: "Shrimp Soft Noodle", price: 19.95 },
      { id: "beef-soft-noodle", name: "Beef Soft Noodle", price: 18.95 },
      { id: "chicken-soft-noodle", name: "Chicken Soft Noodle", price: 18.95 },
      {
        id: "bbq-pork-soft-noodle",
        name: "B.B.Q. Pork Soft Noodle",
        price: 18.95,
      },
      {
        id: "vegetarian-soft-noodle",
        name: "Vegetarian Soft Noodle",
        price: 17.95,
      },
      {
        id: "chow-fun-chicken-or-beef",
        name: "Chicken or Beef Chow Fun (Dry)",
        price: 19.95,
      },
      {
        id: "seafood-chow-fun",
        name: "Seafood Chow Fun (Dry)",
        price: 20.5,
      },
      {
        id: "singapore-style-rice-noodle",
        name: "Singapore Style Rice Noodle",
        price: 19.95,
        spicy: true,
      },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Prix-fixe / combination sections. These are per-person or fixed-price
 * sets, not single orderable line items, so they render through
 * MenuCombos rather than MenuSection. Party trays and à la carte pricing
 * are not individually orderable online; these mirror the printed menu's
 * combo panels, including the lunch "no soup on pickup orders" rule.
 * ------------------------------------------------------------------ */

export interface ComboAddOn {
  /** e.g. "For 4 people". */
  label: string;
  /** e.g. "Almond Chicken". */
  dish: string;
}

export interface ComboSet {
  id: string;
  /** e.g. "$15.75 per person", "Family Dinner No. 1", "$128". */
  name: string;
  price: number;
  /** e.g. "per person"; omitted for flat-price sets. */
  priceUnit?: string;
  /** Serving line, e.g. "Good for 4–6 people". */
  serves?: string;
  /** One-line "served with" summary (lunch specials). */
  includes?: string;
  /** Labeled course lines (family dinners): {label:"Appetizer", value:"…"}. */
  courses?: { label: string; value: string }[];
  /** Fixed included dishes (big family dinner). */
  dishes?: string[];
  /** Choose-your-entrée options (lunch specials). */
  choices?: string[];
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
    note: "Served 11:00 AM–3:00 PM. Pickup orders do not include soup. Except Noodle & Rice. No lunch on holidays.",
    sets: [
      {
        id: "lunch-15-75",
        name: "$15.75 per person",
        price: 15.75,
        priceUnit: "per person",
        includes: "Egg Roll, Chicken Wing & Fried Rice or Steamed Rice",
        choices: [
          "Chicken Chop Suey",
          "Almond Chicken",
          "Sweet & Sour Pork",
          "Beef Szechuan Style",
          "Chicken Szechuan Style",
          "Beef with Broccoli",
          "Chicken with Black Bean Sauce",
          "Chicken with Broccoli",
          "Mixed Vegetable",
          "Beef with Black Bean Sauce",
        ],
      },
      {
        id: "lunch-16-25",
        name: "$16.25 per person",
        price: 16.25,
        priceUnit: "per person",
        includes: "Egg Roll & Fried Rice or Steamed Rice",
        choices: [
          "Salt Pepper Chicken Wings",
          "Kung Pao Chicken",
          "Chicken with Broccoli",
          "Chicken or Beef Chow Fun (Dry)",
          "Chicken with Vegetable",
          "Orange Flavor Chicken",
          "Sweet & Sour Chicken",
          "Curry Chicken",
          "Chicken Cantonese",
          "Beef with Green Pepper",
          "Mongolian Beef",
          "Curry Beef",
          "Yu-Hsiang Beef",
          "Beef Chop Suey",
          "Kung Pao Squid",
          "Squid with Black Bean Sauce",
          "Shrimp with Black Bean Sauce",
          "Shrimp Chop Suey",
          "Shrimp with Broccoli",
          "Shrimp with Lobster Sauce",
          "Chow San Shein",
          "Fish Fillet with Black Bean Sauce",
          "House Soft Noodles",
          "Chicken Soft Noodles",
          "House Fried Rice",
          "Shrimp Fried Rice",
          "Chicken Fried Rice",
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
        price: 21.95,
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
        price: 22.95,
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
        price: 128.0,
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
        price: 178.0,
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
