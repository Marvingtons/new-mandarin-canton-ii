/**
 * Raw Clover v3 API shapes, as returned by the wire.
 *
 * Only the fields this platform actually consumes are modelled — Clover
 * returns considerably more. All money is INTEGER CENTS ($12.00 -> 1200);
 * there is no decimal field anywhere in the v3 API.
 *
 * These are deliberately kept separate from our normalized menu types so a
 * Clover schema change surfaces as a compile error in one mapping file
 * (menu/normalize.ts) rather than rippling through the UI.
 */

/** Every Clover collection response is wrapped like this. */
export interface CloverCollection<T> {
  elements: T[];
  href?: string;
}

/** FIXED = normal menu item. VARIABLE/PER_UNIT have no usable fixed price. */
export type CloverPriceType = "FIXED" | "VARIABLE" | "PER_UNIT";

export interface CloverCategoryRef {
  id: string;
  name?: string;
  sortOrder?: number;
}

export interface CloverModifier {
  id: string;
  name: string;
  /** Integer cents. 0 = free add-on. */
  price?: number;
  available?: boolean;
  modifierGroup?: { id: string };
}

export interface CloverModifierGroup {
  id: string;
  name: string;
  /** Minimum selections the customer MUST make. >=1 means required. */
  minRequired?: number;
  /** Maximum selections permitted. 0/undefined = unlimited. */
  maxAllowed?: number;
  showByDefault?: boolean;
  sortOrder?: number;
  deleted?: boolean;
  modifiers?: CloverCollection<CloverModifier>;
}

export interface CloverItemStock {
  quantity?: number;
  stockCount?: number;
}

export interface CloverItem {
  id: string;
  name: string;
  /** Integer cents. */
  price?: number;
  priceType?: CloverPriceType;
  /** true = hidden from Register/menus. */
  hidden?: boolean;
  /** false = not currently sellable. */
  available?: boolean;
  sku?: string;
  code?: string;
  unitName?: string;
  modifiedTime?: number;
  categories?: CloverCollection<CloverCategoryRef>;
  modifierGroups?: CloverCollection<{ id: string; name?: string }>;
  itemStock?: CloverItemStock;
}

export interface CloverCategory {
  id: string;
  name: string;
  sortOrder?: number;
  items?: CloverCollection<{ id: string; name?: string; hidden?: boolean }>;
}

/** Response of POST /v3/access_tokens/{token} — what a token may do. */
export interface CloverAccessTokenInfo {
  /** Permission names granted to this token, e.g. "INVENTORY_R". */
  permissions?: string[];
  /** Some responses nest permissions under an object map. */
  [key: string]: unknown;
}
