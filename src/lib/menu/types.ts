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

/**
 * A selectable size / price tier for an item, e.g. individual vs. party tray.
 * Money is INTEGER CENTS. Every orderable item has at least one size; a
 * single-size item simply has one entry (no size choice shown).
 */
export interface MenuSize {
  id: string;
  label: string;
  priceCents: number;
  /** e.g. "feeds 8–10". Optional, display-only. */
  servesNote?: string;
}

export interface MenuItem {
  id: string;
  nameEn: string;
  nameZh: string | null;
  description: string | null;
  /**
   * Base individual price, integer cents. Retained for callers that predate
   * sizes and for the seed adapter. `itemSizes()` is the authoritative reader:
   * it returns `sizes` when present, otherwise a single tier from this value.
   */
  priceCents: number;
  /** Price tiers (individual / party tray / …). Optional; see itemSizes(). */
  sizes?: MenuSize[];
  categoryId: string;
  modifierGroups: MenuModifierGroup[];
  spicy: boolean;
  vegetarian: boolean;
  chefSpecial: boolean;
  /** False = 86'd / hidden; the cart and checkout refuse it. Defaults true. */
  available?: boolean;
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

/**
 * Authoritative size reader. Returns the item's explicit `sizes` when set,
 * otherwise a single implicit tier derived from `priceCents`. Both the cart
 * (display) and the server price recompute (authority) resolve sizes through
 * this, so a single-price item and a multi-size item are handled identically.
 */
export function itemSizes(item: MenuItem): MenuSize[] {
  if (item.sizes && item.sizes.length > 0) return item.sizes;
  return [{ id: "regular", label: "Regular", priceCents: item.priceCents }];
}

/** True unless the item is explicitly marked unavailable. */
export function isAvailable(item: MenuItem): boolean {
  return item.available !== false;
}
