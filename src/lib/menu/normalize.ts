import "server-only";

import {
  categoryZhByName,
  overrideKey,
  resolveItemOverride,
} from "@/data/menu-overrides";
import type { RawInventory } from "@/lib/clover/inventory";
import type {
  CloverModifierGroup,
  CloverItem,
} from "@/lib/clover/rawTypes";
import type {
  Menu,
  MenuCategory,
  MenuItem,
  MenuModifierGroup,
} from "@/lib/menu/types";

/**
 * Maps raw Clover inventory into our normalized, bilingual menu.
 *
 * SECURITY-RELEVANT RULE — only FIXED-price items become orderable.
 * Clover's VARIABLE and PER_UNIT items carry no usable fixed price (the
 * cashier keys the amount at the register). If such an item reached the cart,
 * the server-side price recompute would have nothing to recompute FROM and
 * would authorize a $0.00 charge. So they are dropped here, at the source,
 * rather than merely hidden in the UI — a hidden item is still orderable by a
 * crafted request; a dropped one does not exist to the checkout validator.
 *
 * Also dropped: hidden items, unavailable items, and deleted modifier groups.
 */

function normalizeModifierGroups(
  item: CloverItem,
  groupsById: Map<string, CloverModifierGroup>,
): MenuModifierGroup[] {
  const linked = item.modifierGroups?.elements ?? [];
  const out: MenuModifierGroup[] = [];

  for (const link of linked) {
    const group = groupsById.get(link.id);
    if (!group || group.deleted) continue;

    const modifiers = (group.modifiers?.elements ?? [])
      .filter((m) => m.available !== false)
      .map((m) => ({
        id: m.id,
        nameEn: m.name,
        nameZh: null,
        priceCents: m.price ?? 0,
      }));

    // A group with nothing selectable is noise in the UI and a trap for the
    // min/max validator — drop it.
    if (modifiers.length === 0) continue;

    const maxAllowed =
      group.maxAllowed && group.maxAllowed > 0 ? group.maxAllowed : null;

    out.push({
      id: group.id,
      nameEn: group.name,
      nameZh: null,
      minRequired: group.minRequired ?? 0,
      maxAllowed,
      modifiers,
    });
  }

  return out.sort((a, b) => a.nameEn.localeCompare(b.nameEn));
}

/** True when the item is safe to sell online at a server-verifiable price. */
function isOrderable(item: CloverItem): boolean {
  if (item.hidden === true) return false;
  if (item.available === false) return false;
  // Anything that is not explicitly FIXED has no trustworthy price.
  const priceType = item.priceType ?? "FIXED";
  if (priceType !== "FIXED") return false;
  if (typeof item.price !== "number" || item.price <= 0) return false;
  return true;
}

export interface NormalizeReport {
  /** Items dropped, with the reason — surfaced in dev so nothing vanishes silently. */
  dropped: { id: string; name: string; reason: string }[];
  /** Orderable items with no 中文 name yet — the override backlog. */
  missingZh: { id: string; name: string }[];
}

export function normalizeInventory(
  raw: RawInventory,
  fetchedAt: number,
): { menu: Menu; report: NormalizeReport } {
  const report: NormalizeReport = { dropped: [], missingZh: [] };

  const groupsById = new Map(raw.modifierGroups.map((g) => [g.id, g]));

  // Clover items link to categories; build the reverse index.
  const itemsByCategory = new Map<string, MenuItem[]>();

  for (const item of raw.items) {
    if (!isOrderable(item)) {
      const priceType = item.priceType ?? "FIXED";
      report.dropped.push({
        id: item.id,
        name: item.name,
        reason:
          item.hidden === true
            ? "hidden in Clover"
            : item.available === false
              ? "unavailable in Clover"
              : priceType !== "FIXED"
                ? `priceType ${priceType} has no fixed price — cannot be sold online safely`
                : "missing or zero price",
      });
      continue;
    }

    const override = resolveItemOverride(item.id, item.name);
    if (!override?.nameZh) {
      report.missingZh.push({ id: item.id, name: item.name });
    }
    if (override?.hidden) {
      report.dropped.push({
        id: item.id,
        name: item.name,
        reason: "force-hidden via menu-overrides.ts",
      });
      continue;
    }

    const categoryIds = (item.categories?.elements ?? []).map((c) => c.id);
    // An item with no category still needs a home, or it silently disappears.
    const targetCategories = categoryIds.length > 0 ? categoryIds : ["uncategorized"];

    const normalized: MenuItem = {
      id: item.id,
      nameEn: override?.nameEn ?? item.name,
      nameZh: override?.nameZh ?? null,
      description: override?.description ?? null,
      priceCents: item.price as number,
      categoryId: targetCategories[0],
      modifierGroups: normalizeModifierGroups(item, groupsById),
      spicy: override?.spicy ?? false,
      vegetarian: override?.vegetarian ?? false,
      chefSpecial: override?.chefSpecial ?? false,
    };

    for (const categoryId of targetCategories) {
      const bucket = itemsByCategory.get(categoryId);
      if (bucket) bucket.push({ ...normalized, categoryId });
      else itemsByCategory.set(categoryId, [{ ...normalized, categoryId }]);
    }
  }

  const categories: MenuCategory[] = raw.categories
    .map((c) => ({
      id: c.id,
      nameEn: c.name,
      nameZh: categoryZhByName[overrideKey(c.name)] ?? null,
      sortOrder: c.sortOrder ?? 0,
      items: itemsByCategory.get(c.id) ?? [],
    }))
    .filter((c) => c.items.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.nameEn.localeCompare(b.nameEn));

  const orphans = itemsByCategory.get("uncategorized") ?? [];
  if (orphans.length > 0) {
    categories.push({
      id: "uncategorized",
      nameEn: "More",
      nameZh: "其他",
      sortOrder: Number.MAX_SAFE_INTEGER,
      items: orphans,
    });
  }

  return { menu: { categories, source: "clover", fetchedAt }, report };
}

/**
 * Dev-only visibility into what the merge did. Never runs in production, and
 * never prints anything credential-adjacent.
 */
export function logNormalizeReport(report: NormalizeReport): void {
  if (process.env.NODE_ENV === "production") return;
  if (report.dropped.length > 0) {
    console.warn(
      `[menu] ${report.dropped.length} Clover item(s) excluded from online ordering:`,
    );
    console.table(report.dropped);
  }
  if (report.missingZh.length > 0) {
    console.warn(
      `[menu] ${report.missingZh.length} item(s) have no 中文 name — add them to src/data/menu-overrides.ts (ID-keyed):`,
    );
    console.table(report.missingZh);
  }
}
