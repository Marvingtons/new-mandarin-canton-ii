import "server-only";

import { menu as catalog } from "@/data/menu";
import { comboCategories } from "@/data/combo-items";
import { partyTrayFor } from "@/data/party-trays";
import {
  categoryZhByName,
  overrideKey,
  resolveItemOverride,
} from "@/data/menu-overrides";
import type {
  Menu,
  MenuCategory,
  MenuItem,
  MenuSize,
} from "@/lib/menu/types";

/**
 * Builds the orderable menu from the restaurant's own transcribed catalogue.
 *
 * This replaces the Clover inventory sync AND the 16-item seed file. Both are
 * gone: there is no remote menu source any more, so `src/data/menu.ts` — 138
 * items transcribed from the printed menu (rev. 9/25) — is simply the truth.
 *
 * Two conversions happen here and nowhere else:
 *
 *  1. DOLLARS -> INTEGER CENTS. `menu.ts` stores display dollars as floats
 *     (`price: 24.95`) because it was written for a marketing page. Every
 *     downstream consumer — cart, ticket, totals — is integer cents. Rounding
 *     at this single boundary is what keeps a float out of the orders path.
 *
 *  2. ENGLISH -> BILINGUAL. `menu.ts` carries no 中文 (its `chineseName` field
 *     is declared but populated on zero items). The 中文 comes from
 *     menu-overrides.ts, which is also where spicy / vegetarian / chef's
 *     special markers are layered on.
 */

/** 24.95 -> 2495. Rounds at the cent, so float dust cannot survive. */
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Price tiers for an item: always an individual price, plus a party tray when
 * one is configured. An item with no tray entry is single-size, which is the
 * safe default — see the provenance warning in data/party-trays.ts.
 */
function sizesFor(itemId: string, individualCents: number): MenuSize[] | undefined {
  const tray = partyTrayFor(itemId);
  if (!tray) return undefined;
  return [
    { id: "individual", label: "Individual", priceCents: individualCents },
    {
      id: "party-tray",
      label: "Party Tray",
      priceCents: tray.priceCents,
      servesNote: tray.servesNote,
    },
  ];
}

let cached: Menu | null = null;

/**
 * The full orderable menu. Pure and synchronous — the catalogue is a module in
 * this repo, so there is nothing to await, nothing to cache-bust, and no
 * outage to degrade from. Memoized only to avoid re-mapping 138 items on
 * every request.
 */
export function catalogMenu(): Menu {
  if (cached) return cached;

  const categories: MenuCategory[] = catalog.map((category, index) => {
    const items: MenuItem[] = category.items.map((item) => {
      const override = resolveItemOverride(item.id, item.name);
      const priceCents = toCents(item.price);

      return {
        id: item.id,
        nameEn: override?.nameEn ?? item.name,
        // menu.ts's own chineseName wins if it is ever populated; today the
        // override map is the only source of 中文.
        nameZh: item.chineseName ?? override?.nameZh ?? null,
        description: item.description ?? override?.description ?? null,
        priceCents,
        sizes: sizesFor(item.id, priceCents),
        categoryId: category.id,
        // No modifier groups in the printed catalogue. Special instructions
        // carry the customer's requests instead.
        modifierGroups: [],
        spicy: item.spicy ?? override?.spicy ?? false,
        vegetarian: override?.vegetarian ?? false,
        chefSpecial: override?.chefSpecial ?? false,
        available: override?.hidden ? false : true,
      };
    });

    return {
      id: category.id,
      nameEn: category.name,
      nameZh: categoryZhByName[overrideKey(category.name)] ?? null,
      sortOrder: index,
      note: category.note ?? null,
      items: items.filter((item) => item.available !== false),
    };
  });

  // The printed menu's combo panels — lunch specials, family dinners, big
  // family specials — are orderable too. They were display-only until now,
  // which left a whole column of the physical menu un-orderable for takeout.
  const comboSections: MenuCategory[] = comboCategories().map((section, i) => ({
    id: section.id,
    nameEn: section.nameEn,
    nameZh: section.nameZh,
    sortOrder: categories.length + i,
    note: section.note,
    items: section.items,
  }));

  cached = {
    categories: [...categories, ...comboSections].filter(
      (c) => c.items.length > 0,
    ),
    source: "catalog",
    fetchedAt: 0,
  };
  return cached;
}
