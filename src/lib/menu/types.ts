/**
 * Normalized menu types — the shape the rest of the app consumes.
 *
 * Deliberately decoupled from Clover's wire format so a Clover schema change
 * is a compile error in normalize.ts only. Money stays in INTEGER CENTS all
 * the way to the charge call; it is formatted for display at the very edge.
 * Floating-point dollars never enter a price calculation.
 */

export interface MenuModifier {
  id: string;
  nameEn: string;
  nameZh: string | null;
  /** Integer cents. 0 = free. */
  priceCents: number;
}

export interface MenuModifierGroup {
  id: string;
  nameEn: string;
  nameZh: string | null;
  /** Minimum selections required. >= 1 means the customer must choose. */
  minRequired: number;
  /** Maximum selections allowed. null = unlimited. */
  maxAllowed: number | null;
  modifiers: MenuModifier[];
}

export interface MenuItem {
  id: string;
  nameEn: string;
  nameZh: string | null;
  description: string | null;
  /** Integer cents. Only FIXED-price items reach this type. */
  priceCents: number;
  categoryId: string;
  modifierGroups: MenuModifierGroup[];
  spicy: boolean;
  vegetarian: boolean;
  chefSpecial: boolean;
}

export interface MenuCategory {
  id: string;
  nameEn: string;
  nameZh: string | null;
  sortOrder: number;
  items: MenuItem[];
}

/**
 * Where the menu currently being served came from.
 *  clover — live read (the only source allowed to take a payment)
 *  cache  — last-good snapshot from Supabase; Clover was unreachable
 *  seed   — the static file in src/data/menu.ts; last resort
 */
export type MenuSource = "clover" | "cache" | "seed";

export interface Menu {
  categories: MenuCategory[];
  source: MenuSource;
  /** Epoch ms the underlying data was read from Clover. */
  fetchedAt: number;
}

/** Flat lookup used by the server-side price recompute at checkout. */
export function indexItems(menu: Menu): Map<string, MenuItem> {
  const map = new Map<string, MenuItem>();
  for (const category of menu.categories) {
    for (const item of category.items) map.set(item.id, item);
  }
  return map;
}
