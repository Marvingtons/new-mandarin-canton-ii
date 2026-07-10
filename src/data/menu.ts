/**
 * Menu data for New Mandarin Canton II — the restaurant's real menu.
 *
 * Prices transcribed exactly from the source menu. Chinese names are
 * included only for classic dishes with a single standard culinary
 * name; where the standard name is uncertain, it is omitted rather
 * than guessed.
 *
 * NOTE: the source's Mandarin Specialties section also listed
 * Mongolian Beef, Mandarin Chicken, Salted Pepper Chicken Wings, and
 * Orange Flavored Chicken at older lower prices — duplicates of items
 * in their own categories, intentionally excluded here.
 */

export interface MenuItem {
  id: string;
  name: string;
  /** Standard Chinese culinary name, e.g. "宮保雞丁". Omitted when uncertain. */
  chineseName?: string;
  description?: string;
  price: number;
  spicy?: boolean;
  tags?: string[];
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export const menu: MenuCategory[] = [
  {
    id: "chicken",
    name: "Chicken",
    items: [
      {
        id: "salted-pepper-chicken-wings",
        name: "Salted Pepper Chicken Wings",
        chineseName: "椒鹽雞翼",
        price: 19.95,
      },
      {
        id: "orange-flavored-chicken",
        name: "Orange Flavored Chicken",
        price: 22.5,
      },
      {
        id: "kung-pao-chicken",
        name: "Kung Pao Chicken",
        chineseName: "宮保雞丁",
        price: 19.5,
        spicy: true,
      },
      {
        id: "curry-chicken",
        name: "Curry Chicken",
        chineseName: "咖喱雞",
        price: 19.5,
        spicy: true,
      },
      {
        id: "chicken-black-bean-sauce",
        name: "Chicken with Black Bean Sauce",
        price: 22.5,
      },
      {
        id: "chicken-cashew-nuts",
        name: "Chicken with Cashew Nuts",
        chineseName: "腰果雞丁",
        price: 19.5,
      },
      {
        id: "chicken-broccoli",
        name: "Chicken with Broccoli",
        price: 20.95,
      },
      {
        id: "chicken-snow-peas",
        name: "Chicken with Snow Peas",
        price: 19.5,
      },
      {
        id: "almond-chicken",
        name: "Almond Chicken",
        price: 19.95,
      },
      {
        id: "sesame-chicken",
        name: "Sesame Chicken",
        chineseName: "芝麻雞",
        price: 19.95,
      },
      {
        id: "mandarin-chicken",
        name: "Mandarin Chicken",
        price: 19.95,
      },
      {
        id: "garlic-chicken",
        name: "Garlic Chicken",
        price: 19.95,
      },
      {
        id: "lemon-chicken",
        name: "Lemon Chicken",
        price: 19.95,
      },
      {
        id: "sweet-sour-chicken",
        name: "Sweet & Sour Chicken",
        price: 19.5,
      },
      {
        id: "moo-goo-gai-pan",
        name: "Moo Goo Gai Pan",
        chineseName: "蘑菇雞片",
        price: 19.5,
      },
      {
        id: "chicken-chop-suey",
        name: "Chicken Chop Suey",
        price: 19.5,
      },
      {
        id: "chicken-egg-foo-young",
        name: "Chicken Egg Foo Young",
        chineseName: "芙蓉蛋",
        price: 20.95,
      },
      {
        id: "chicken-cantonese",
        name: "Chicken Cantonese",
        price: 19.5,
      },
      {
        id: "chicken-vegetables",
        name: "Chicken with Vegetables",
        price: 19.95,
      },
      {
        id: "chicken-bok-choy",
        name: "Chicken with Bok Choy",
        price: 19.95,
      },
    ],
  },
  {
    id: "beef",
    name: "Beef",
    items: [
      {
        id: "mongolian-beef",
        name: "Mongolian Beef",
        chineseName: "蒙古牛",
        price: 21.5,
      },
      {
        id: "beef-broccoli",
        name: "Beef with Broccoli",
        price: 20.5,
      },
      {
        id: "beef-snow-peas",
        name: "Beef with Snow Peas",
        price: 21.5,
      },
      {
        id: "beef-oyster-sauce",
        name: "Beef with Oyster Sauce",
        chineseName: "蠔油牛肉",
        price: 22.5,
      },
      {
        id: "green-pepper-beef",
        name: "Green Pepper Beef",
        chineseName: "青椒牛肉",
        price: 20.5,
      },
      {
        id: "black-mushroom-beef",
        name: "Black Mushroom Beef",
        price: 24.5,
      },
      {
        id: "szechuan-style-beef",
        name: "Szechuan Style Beef",
        price: 21.5,
        spicy: true,
      },
      {
        id: "orange-flavored-beef",
        name: "Orange Flavored Beef",
        price: 22.5,
      },
      {
        id: "kung-pao-beef",
        name: "Kung Pao Beef",
        chineseName: "宮保牛肉",
        price: 23.5,
        spicy: true,
      },
      {
        id: "beef-black-bean-sauce",
        name: "Beef with Black Bean Sauce",
        price: 20.5,
      },
      {
        id: "crispy-beef-spicy-sauce",
        name: "Crispy Beef with Spicy Sauce",
        price: 22.5,
        spicy: true,
      },
      {
        id: "curry-beef",
        name: "Curry Beef",
        chineseName: "咖喱牛肉",
        price: 20.5,
        spicy: true,
      },
      {
        id: "beef-chop-suey",
        name: "Beef Chop Suey",
        price: 20.5,
      },
      {
        id: "beef-egg-foo-young",
        name: "Beef Egg Foo Young",
        chineseName: "芙蓉蛋",
        price: 21.5,
      },
      {
        id: "beef-vegetables",
        name: "Beef with Vegetables",
        price: 21.5,
      },
      {
        id: "beef-bok-choy",
        name: "Beef with Bok Choy",
        price: 21.5,
      },
    ],
  },
  {
    id: "pork",
    name: "Pork",
    items: [
      {
        id: "pork-chop-peking",
        name: "Pork Chop Peking",
        chineseName: "京都豬扒",
        price: 22.95,
      },
      {
        id: "salted-pepper-pork-chop",
        name: "Salted Pepper Pork Chop",
        chineseName: "椒鹽豬扒",
        price: 22.95,
      },
      {
        id: "yu-hsiang-pork",
        name: "Yu Hsiang Pork",
        chineseName: "魚香肉絲",
        price: 19.5,
        spicy: true,
      },
      {
        id: "mandarin-pork",
        name: "Mandarin Pork",
        price: 19.5,
      },
      {
        id: "mapo-tofu",
        name: "Mapo Tofu",
        chineseName: "麻婆豆腐",
        price: 19.5,
        spicy: true,
      },
      {
        id: "bbq-pork-egg-foo-young",
        name: "BBQ Pork Egg Foo Young",
        chineseName: "芙蓉蛋",
        price: 21.5,
      },
      {
        id: "sweet-sour-pork",
        name: "Sweet & Sour Pork",
        chineseName: "咕嚕肉",
        price: 19.95,
      },
      {
        id: "sesame-pork",
        name: "Sesame Pork",
        price: 19.5,
      },
      {
        id: "pork-chop-suey",
        name: "Pork Chop Suey",
        price: 19.5,
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
        price: 23.5,
      },
      {
        id: "salted-fried-shrimp-no-shell",
        name: "Salted & Deep Fried Shrimp (no shell)",
        price: 25.5,
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
      },
      {
        id: "kung-pao-shrimp",
        name: "Kung Pao Shrimp",
        chineseName: "宮保蝦仁",
        price: 25.5,
        spicy: true,
      },
      {
        id: "shrimp-cantonese",
        name: "Shrimp Cantonese",
        price: 21.95,
      },
      {
        id: "shrimp-chop-suey",
        name: "Shrimp Chop Suey",
        price: 21.95,
      },
      {
        id: "shrimp-lobster-sauce",
        name: "Shrimp with Lobster Sauce",
        price: 21.95,
      },
      {
        id: "shrimp-broccoli",
        name: "Shrimp with Broccoli",
        price: 21.95,
      },
      {
        id: "shrimp-snow-peas",
        name: "Shrimp with Snow Peas",
        price: 24.5,
      },
      {
        id: "shrimp-egg-foo-young",
        name: "Shrimp Egg Foo Young",
        chineseName: "芙蓉蛋",
        price: 23.5,
      },
      {
        id: "curry-shrimp",
        name: "Curry Shrimp",
        chineseName: "咖喱蝦",
        price: 21.95,
        spicy: true,
      },
      {
        id: "sweet-sour-shrimp",
        name: "Sweet & Sour Shrimp",
        price: 22.5,
      },
      {
        id: "almond-shrimp",
        name: "Almond Shrimp",
        price: 22.5,
      },
    ],
  },
  {
    id: "vegetables",
    name: "Vegetables",
    items: [
      {
        id: "mixed-vegetables",
        name: "Mixed Vegetables",
        price: 18.95,
      },
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
      {
        id: "sauteed-snow-peas",
        name: "Sautéed Snow Peas",
        price: 19.95,
      },
      {
        id: "spicy-hot-eggplant",
        name: "Spicy Hot Eggplant",
        price: 19.95,
        spicy: true,
      },
      {
        id: "vegetarian-egg-foo-young",
        name: "Vegetarian Egg Foo Young",
        chineseName: "芙蓉蛋",
        price: 20.95,
      },
      {
        id: "bean-sprout-saute",
        name: "Bean Sprout Sauté",
        price: 16.95,
      },
      {
        id: "tofu-vegetables",
        name: "Tofu with Vegetables",
        price: 18.95,
      },
      {
        id: "hot-eggplant-tofu",
        name: "Hot Eggplant with Tofu",
        price: 20.5,
        spicy: true,
      },
      {
        id: "kung-pao-tofu",
        name: "Kung Pao Tofu",
        chineseName: "宮保豆腐",
        price: 19.95,
        spicy: true,
      },
      {
        id: "sauteed-bok-choy-garlic",
        name: "Sautéed Bok Choy with Garlic",
        price: 18.95,
      },
      {
        id: "salted-pepper-tofu",
        name: "Salted Pepper Tofu",
        chineseName: "椒鹽豆腐",
        price: 19.95,
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
      {
        id: "shrimp-fried-rice",
        name: "Shrimp Fried Rice",
        chineseName: "蝦仁炒飯",
        price: 19.5,
      },
      {
        id: "bbq-pork-fried-rice",
        name: "BBQ Pork Fried Rice",
        chineseName: "叉燒炒飯",
        price: 18.5,
      },
      {
        id: "chicken-fried-rice",
        name: "Chicken Fried Rice",
        price: 18.5,
      },
      {
        id: "beef-fried-rice",
        name: "Beef Fried Rice",
        price: 18.5,
      },
      {
        id: "vegetarian-fried-rice",
        name: "Vegetarian Fried Rice",
        price: 17.5,
      },
      {
        id: "steamed-rice",
        name: "Steamed Rice",
        chineseName: "白飯",
        price: 3.0,
      },
    ],
  },
  {
    id: "noodles",
    name: "Noodles",
    items: [
      {
        id: "house-soft-noodle",
        name: "House Soft Noodle",
        price: 19.95,
      },
      {
        id: "seafood-soft-noodle",
        name: "Seafood Soft Noodle",
        price: 19.95,
      },
      {
        id: "shrimp-soft-noodle",
        name: "Shrimp Soft Noodle",
        price: 19.95,
      },
      {
        id: "beef-soft-noodle",
        name: "Beef Soft Noodle",
        price: 18.95,
      },
      {
        id: "chicken-soft-noodle",
        name: "Chicken Soft Noodle",
        price: 18.95,
      },
      {
        id: "bbq-pork-soft-noodle",
        name: "BBQ Pork Soft Noodle",
        price: 18.95,
      },
      {
        id: "singapore-style-rice-noodle",
        name: "Singapore Style Rice Noodle",
        chineseName: "星洲炒米",
        price: 20.5,
        spicy: true,
      },
      {
        id: "seafood-chow-fun",
        name: "Seafood Chow Fun",
        price: 20.5,
      },
      {
        id: "chow-fun-chicken-or-beef",
        name: "Chow Fun (Chicken or Beef)",
        chineseName: "炒粉",
        price: 19.95,
      },
      {
        id: "vegetarian-noodle",
        name: "Vegetarian Noodle",
        price: 17.95,
      },
    ],
  },
  {
    id: "mandarin-specialties",
    name: "Mandarin Specialties",
    items: [
      {
        id: "mandarin-house-special",
        name: "Mandarin House Special",
        price: 21.75,
      },
      {
        id: "honey-walnut-shrimp",
        name: "Honey Walnut Shrimp",
        price: 23.75,
      },
      {
        id: "honey-walnut-chicken",
        name: "Honey Walnut Chicken",
        price: 21.25,
      },
      {
        id: "kung-pao-san-shein",
        name: "Kung Pao San Shein",
        chineseName: "宮保三鮮",
        price: 20.25,
        spicy: true,
      },
      {
        id: "crispy-game-hen",
        name: "Crispy Game Hen",
        price: 16.75,
      },
      {
        id: "upside-down-pan-fried-noodles",
        name: "Upside Down Pan Fried Noodles",
        price: 17.75,
      },
      {
        id: "oceania-seafood-mix",
        name: "Oceania (Seafood Mix)",
        price: 22.75,
      },
    ],
  },
];
