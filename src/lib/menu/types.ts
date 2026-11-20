/**
 * Normalized menu types — the shape the rest of the app consumes.
 *
 * Deliberately decoupled from the raw catalogue in src/data/menu.ts, which
 * stores display dollars for the marketing pages. The conversion happens once,
 * in menu/catalog.ts. From here on money is INTEGER CENTS all the way to the
 * printed ticket; floating-point dollars never enter a price calculation.
 */

import type { TranslationKey } from "@/lib/i18n/dictionary";

export interface MenuModifier {
  id: string;
  nameEn: string;
  nameZh: string | null;
  /** Integer cents. 0 = free. */
  priceCents: number;
  /**
   * A menu RULE attached to this choice, e.g. the lunch menu's "Except Noodle
   * & Rice" — a noodle or rice entrée comes without the included rice side.
   * Display only: it is not a customer instruction, so it does not travel to
   * the stored order or the kitchen ticket.
   */
  note?: string;
  /**
   * Offered on the staff POS only (走飯 No Rice): the customer sheet never
   * shows it and POST /api/orders refuses it. Staff relay a caller who says
   * "no rice"; the website keeps its two-rice choice.
   */
  staffOnly?: boolean;
}

export interface MenuModifierGroup {
  id: string;
  nameEn: string;
  nameZh: string | null;
  /**
   * The web sheet's label from the dictionary, when the group has one in
   * every locale (an "or" dish's question). Unset: nameEn, as before.
   */
  nameKey?: TranslationKey;
  /**
   * Never preselected, even when required and single-choice: the pick IS the
   * dish ("Beef or chicken"), so a default would be ordering for the customer.
   */
  noDefault?: boolean;
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
  /**
   * Offered on the staff POS only (the half tray, for now): the customer
   * sheet never lists it and POST /api/orders refuses it. Same contract as
   * MenuModifier.staffOnly. Drop the flag to put the size on the website.
   */
  staffOnly?: boolean;
}

/**
 * THE TRAY FAMILY. Every size id that is a party tray of some capacity: no
 * rice side, the longer prep window, the 餐盤 strip on the POS. One set, so a
 * new tray capacity is one id here instead of a condition to find in four
 * files.
 */
export const TRAY_SIZE_IDS: ReadonlySet<string> = new Set(["half-tray", "party-tray"]);

export function isTraySize(sizeId: string): boolean {
  return TRAY_SIZE_IDS.has(sizeId);
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
  /**
   * Lunch-special item: orderable ONLY between 11:00 AM and 3:00 PM
   * restaurant time. The server enforces this at submission; the client may
   * also hide it, but that is UX, not the gate. See lib/order/gates.ts.
   */
  lunchSpecial?: boolean;
  /**
   * Needs the longer prep window (party trays, family dinners). Drives the
   * 20–30 minute pickup estimate instead of the standard 15–20.
   */
  longPrep?: boolean;
}

export interface MenuCategory {
  id: string;
  nameEn: string;
  nameZh: string | null;
  sortOrder: number;
  /** Section footnote from the printed menu, e.g. the lunch "no soup" rule. */
  note: string | null;
  items: MenuItem[];
}

/**
 * Where the menu being served came from.
 *
 * Only one value today: the restaurant's own catalogue, compiled into the app.
 * The union is retained (rather than dropped) so that adding a remote source
 * later is a compile error at every site that needs to care, instead of a
 * silent behaviour change.
 */
export type MenuSource = "catalog";

export interface Menu {
  categories: MenuCategory[];
  source: MenuSource;
  /** Epoch ms the data was read from a remote source; 0 for the catalogue. */
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

/** The sizes the WEBSITE may show and accept: itemSizes() without staff-only tiers. */
export function customerSizes(item: MenuItem): MenuSize[] {
  return itemSizes(item).filter((s) => !s.staffOnly);
}

/** True unless the item is explicitly marked unavailable. */
export function isAvailable(item: MenuItem): boolean {
  return item.available !== false;
}
