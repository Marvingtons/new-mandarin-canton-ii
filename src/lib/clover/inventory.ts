import "server-only";

import { cloverFetch } from "@/lib/clover/client";
import { restBase } from "@/lib/clover/env";
import { requireInventoryToken, requireMerchantId } from "@/config/tenant.server";
import type {
  CloverCategory,
  CloverCollection,
  CloverItem,
  CloverModifierGroup,
} from "@/lib/clover/rawTypes";

/**
 * Reads the merchant's live menu out of Clover v3 Inventory.
 *
 * Three separate passes, deliberately:
 *   1. categories   — grouping + display order
 *   2. items        — full detail incl. price, flags, category + group links
 *   3. modifier_groups (TOP LEVEL, not nested)
 *
 * Pass 3 is top-level on purpose. Clover caps NESTED expanded collections at
 * 100 elements and offers no way to paginate them, so relying on
 * `items?expand=modifierGroups` to carry the modifiers themselves silently
 * truncates a large menu. Querying /modifier_groups directly is paginated
 * properly, so nothing is lost.
 *
 * Uses CLOVER_INVENTORY_TOKEN (Dashboard token with INVENTORY_R) — NOT the
 * ecommerce sk_ key, which cannot read inventory at all.
 */

/** Clover's hard maximum page size. */
const PAGE_LIMIT = 1000;

/**
 * Walk an offset/limit paginated collection until a short page arrives.
 * Sequential by design: Clover allows only ~5 concurrent requests per token,
 * and a menu is a handful of pages.
 */
async function paginate<T>(
  path: string,
  query: Record<string, string | number | undefined>,
): Promise<T[]> {
  const token = requireInventoryToken();
  const base = restBase();
  const out: T[] = [];
  let offset = 0;

  // Bounded to keep a pathological response from looping forever.
  for (let page = 0; page < 50; page++) {
    const chunk = await cloverFetch<CloverCollection<T>>({
      baseUrl: base,
      path,
      token,
      query: { ...query, limit: PAGE_LIMIT, offset },
    });
    const elements = chunk.elements ?? [];
    out.push(...elements);
    if (elements.length < PAGE_LIMIT) break;
    offset += elements.length;
  }

  return out;
}

export interface RawInventory {
  categories: CloverCategory[];
  items: CloverItem[];
  modifierGroups: CloverModifierGroup[];
}

/**
 * Fetch everything needed to build a menu. Throws CloverApiError on failure —
 * callers (getMenu) are responsible for falling back to a cached snapshot.
 */
export async function fetchInventory(): Promise<RawInventory> {
  const mId = requireMerchantId();

  const categories = await paginate<CloverCategory>(
    `/v3/merchants/${mId}/categories`,
    { expand: "items" },
  );

  const items = await paginate<CloverItem>(`/v3/merchants/${mId}/items`, {
    expand: "categories,modifierGroups,itemStock",
    // Ask Clover to omit hidden items; normalize.ts still re-checks, since
    // filter support varies and we never want a hidden item orderable.
    filter: "hidden=false",
  });

  const modifierGroups = await paginate<CloverModifierGroup>(
    `/v3/merchants/${mId}/modifier_groups`,
    { expand: "modifiers" },
  );

  return { categories, items, modifierGroups };
}
