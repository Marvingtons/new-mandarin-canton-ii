import "server-only";

import type { Menu, MenuCategory, MenuItem, MenuSize } from "@/lib/menu/types";

/**
 * Seed menu for the online PICKUP ordering flow.
 *
 * A deliberately small, real subset (~15 items) so the cart and checkout are
 * testable immediately, before the merchant's Clover inventory is populated.
 * Menu sync (cloverMenuSource) swaps in behind getMenu() with no downstream
 * changes — nothing imports this file except the seed source.
 *
 * Money is INTEGER CENTS everywhere. Two-tier items carry both an
 * "Individual" and a "Party Tray" size; single items carry one size.
 *
 * TODO(confirm): party-tray serving counts ("feeds 8–10") are estimates.
 */

const c = (cents: number) => cents;

interface SeedItemInput {
  id: string;
  nameEn: string;
  categoryId: string;
  sizes: MenuSize[];
  description?: string;
  spicy?: boolean;
}

/** Convenience builder — most seed items have no modifier groups. */
function item(input: SeedItemInput): MenuItem {
  return {
    id: input.id,
    nameEn: input.nameEn,
    nameZh: null,
    description: input.description ?? null,
    // priceCents mirrors the first (individual) size so legacy readers work.
    priceCents: input.sizes[0]?.priceCents ?? 0,
    sizes: input.sizes,
    categoryId: input.categoryId,
    modifierGroups: [],
    spicy: input.spicy ?? false,
    vegetarian: false,
    chefSpecial: false,
    available: true,
  };
}

const CATEGORIES: MenuCategory[] = [
  { id: "appetizers", nameEn: "Appetizers", nameZh: null, sortOrder: 0, items: [] },
  { id: "soup", nameEn: "Soup", nameZh: null, sortOrder: 1, items: [] },
  { id: "chicken", nameEn: "Chicken", nameZh: null, sortOrder: 2, items: [] },
  { id: "beef", nameEn: "Beef", nameZh: null, sortOrder: 3, items: [] },
  { id: "seafood", nameEn: "Seafood", nameZh: null, sortOrder: 4, items: [] },
  {
    id: "rice-noodles",
    nameEn: "Rice & Noodles",
    nameZh: null,
    sortOrder: 5,
    items: [],
  },
];

/** individual + party-tray size pair. */
function tiers(individualCents: number, trayCents: number): MenuSize[] {
  return [
    { id: "individual", label: "Individual", priceCents: c(individualCents) },
    {
      id: "party-tray",
      label: "Party Tray",
      priceCents: c(trayCents),
      servesNote: "feeds 8–10", // TODO(confirm): serving count
    },
  ];
}

/** single size (no size choice). */
function one(cents: number): MenuSize[] {
  return [{ id: "regular", label: "Regular", priceCents: c(cents) }];
}

const ITEMS: MenuItem[] = [
  // --- Appetizers ---
  item({ id: "egg-rolls", nameEn: "Egg Rolls (2)", categoryId: "appetizers", sizes: one(350) }),
  item({
    id: "cream-cheese-wonton",
    nameEn: "Fried Cream Cheese Wonton (8)",
    categoryId: "appetizers",
    sizes: one(995),
  }),
  item({
    id: "salt-pepper-wings",
    nameEn: "Salt Pepper Chicken Wings (6)",
    categoryId: "appetizers",
    sizes: one(1295),
  }),

  // --- Soup ---
  item({ id: "egg-drop-soup", nameEn: "Egg Drop Soup (cup)", categoryId: "soup", sizes: one(650) }),
  item({
    id: "hot-sour-soup",
    nameEn: "Hot & Sour Soup",
    categoryId: "soup",
    spicy: true,
    sizes: one(1695),
  }),

  // --- Chicken ---
  item({
    id: "orange-chicken",
    nameEn: "Orange Flavored Chicken",
    categoryId: "chicken",
    spicy: true,
    sizes: tiers(1995, 7500),
  }),
  item({
    id: "kung-pao-chicken",
    nameEn: "Kung Pao Chicken",
    categoryId: "chicken",
    spicy: true,
    sizes: tiers(2250, 9000),
  }),
  item({
    id: "chicken-broccoli",
    nameEn: "Chicken with Broccoli",
    categoryId: "chicken",
    sizes: tiers(1950, 7000),
  }),
  item({
    id: "sesame-chicken",
    nameEn: "Sesame Chicken",
    categoryId: "chicken",
    sizes: tiers(1995, 7500),
  }),

  // --- Beef ---
  item({
    id: "mongolian-beef",
    nameEn: "Mongolian Beef",
    categoryId: "beef",
    sizes: tiers(2150, 7500),
  }),
  item({
    id: "beef-broccoli",
    nameEn: "Beef with Broccoli",
    categoryId: "beef",
    sizes: tiers(2050, 7200),
  }),

  // --- Seafood ---
  item({
    id: "honey-walnut-shrimp",
    nameEn: "Honey Walnut Shrimp",
    categoryId: "seafood",
    sizes: tiers(2595, 9500),
  }),
  item({
    id: "kung-pao-shrimp",
    nameEn: "Kung-Pao Shrimp",
    categoryId: "seafood",
    spicy: true,
    sizes: tiers(2550, 10000),
  }),

  // --- Rice & Noodles ---
  item({
    id: "fried-steamed-rice",
    nameEn: "Fried/Steamed Rice",
    categoryId: "rice-noodles",
    sizes: one(300),
  }),
  item({
    id: "house-fried-rice",
    nameEn: "House Special Fried Rice",
    categoryId: "rice-noodles",
    sizes: tiers(1950, 6500),
  }),
  item({
    id: "house-soft-noodle",
    nameEn: "House Soft Noodle",
    categoryId: "rice-noodles",
    sizes: tiers(1995, 6800),
  }),
];

/** The seed menu as a fully-formed normalized Menu (source: "seed"). */
export function seedMenuData(): Menu {
  const byCategory = new Map<string, MenuItem[]>();
  for (const it of ITEMS) {
    const list = byCategory.get(it.categoryId) ?? [];
    list.push(it);
    byCategory.set(it.categoryId, list);
  }
  const categories = CATEGORIES.map((cat) => ({
    ...cat,
    items: byCategory.get(cat.id) ?? [],
  }));
  return { categories, source: "seed", fetchedAt: 0 };
}
