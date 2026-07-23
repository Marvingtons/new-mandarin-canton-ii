import { menu as staticMenu } from "@/data/menu";
import { categoryZhByName, overrideKey } from "@/data/menu-overrides";
import type { Menu, MenuCategory } from "@/lib/menu/types";

/**
 * Last-resort menu, adapted from the hand-maintained static file that predates
 * the Clover integration (src/data/menu.ts — real transcribed prices).
 *
 * This exists so a Clover outage on a cold cache still renders a real menu
 * instead of an error page. It is explicitly tagged `source: "seed"`, and
 * checkout refuses to take payment against it: these prices are a snapshot of
 * a printed menu, not the merchant's live register.
 *
 * The static file stores dollars; everything downstream is integer cents.
 */
export function seedMenu(): Menu {
  const categories: MenuCategory[] = staticMenu.map((category, index) => ({
    id: category.id,
    nameEn: category.name,
    nameZh: categoryZhByName[overrideKey(category.name)] ?? null,
    sortOrder: index,
    items: category.items.map((item) => ({
      id: item.id,
      nameEn: item.name,
      nameZh: item.chineseName ?? null,
      description: item.description ?? null,
      // Dollars -> cents. Rounded, never floored, so 19.95 is exactly 1995.
      priceCents: Math.round(item.price * 100),
      categoryId: category.id,
      // The static file predates modifier support; seed items are plain.
      modifierGroups: [],
      spicy: item.spicy ?? false,
      vegetarian: false,
      chefSpecial: false,
    })),
  }));

  return { categories, source: "seed", fetchedAt: 0 };
}
