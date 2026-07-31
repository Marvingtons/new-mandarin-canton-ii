import "server-only";

import { menu as catalog } from "@/data/menu";
import type { MenuItem as CatalogItem } from "@/data/menu";
import { comboCategories } from "@/data/combo-items";
import { PARTY_TRAY_SERVES } from "@/data/party-trays";
import {
  categoryZhByName,
  overrideKey,
  resolveItemOverride,
  resolveModifierZh,
} from "@/data/menu-overrides";
import type {
  Menu,
  MenuCategory,
  MenuItem,
  MenuModifierGroup,
  MenuSize,
} from "@/lib/menu/types";

/**
 * Builds the orderable menu from the restaurant's own transcribed catalogue.
 *
 * This replaces the Clover inventory sync AND the 16-item seed file. Both are
 * gone: there is no remote menu source any more, so `src/data/menu.ts` — 137
 * items reconciled against the printed menu (rev. 9/25) — is simply the truth.
 *
 * No price conversion happens here any more. `menu.ts` stores INTEGER CENTS,
 * so cents flow unchanged from the catalogue through the cart and the totals
 * to the printed ticket, and there is no rounding boundary to get wrong.
 *
 * 中文 comes straight from the catalogue now: every item in `menu.ts` carries
 * its own `chineseName`, transcribed from the printed-menu document beside its
 * price. menu-overrides.ts is left with what is NOT a dish name — the
 * vegetarian / chef's-special markers, and the category, size and modifier
 * vocabulary. `spicy` is layered from neither: the printed menu's 🌶 set lives
 * in menu.ts and nowhere else.
 */

/**
 * Price tiers for an item.
 *
 * Three shapes, all read from the item itself:
 *  - no explicit sizes, no tray -> undefined, i.e. a single implicit tier
 *    (itemSizes() supplies "Regular"). Appetizers and soups land here, which
 *    is why no tray option renders for them.
 *  - explicit sizes (Roasted Duck half/whole, Egg Drop Soup cup/bowl) -> those
 *    tiers, in printed order.
 *  - a tray price -> the individual tier plus a "Party Tray" tier.
 */
function sizesFor(item: CatalogItem): MenuSize[] | undefined {
  const base: MenuSize[] =
    item.sizes?.map((s) => ({
      id: s.id,
      label: s.label,
      priceCents: s.priceCents,
    })) ?? [{ id: "individual", label: "Individual", priceCents: item.priceCents }];

  if (item.trayCents === undefined) return item.sizes ? base : undefined;

  return [
    ...base,
    {
      id: "party-tray",
      label: "Party Tray",
      priceCents: item.trayCents,
      // One constant, never an inline string — the capacity is an
      // owner-provided claim the printed menu does not make, so it has to be
      // correctable in a single edit. See PARTY_TRAY_SERVES.
      servesNote: PARTY_TRAY_SERVES.short,
    },
  ];
}

/**
 * The printed menu's per-item add-ons ("Add Noodle $3.00 Extra") as an
 * optional multi-select group. Priced from the catalogue, so the +$3.00 the
 * customer sees and the +300 the server charges are the same number.
 */
function modifierGroupsFor(item: CatalogItem): MenuModifierGroup[] {
  if (!item.modifiers?.length) return [];
  return [
    {
      id: `${item.id}-extras`,
      nameEn: "Extras",
      nameZh: null,
      minRequired: 0,
      maxAllowed: null,
      modifiers: item.modifiers.map((m) => ({
        id: m.id,
        nameEn: m.name,
        nameZh: resolveModifierZh(m.name),
        priceCents: m.priceCents,
      })),
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
      const override = resolveItemOverride(item.id);

      return {
        id: item.id,
        nameEn: override?.nameEn ?? item.name,
        // The catalogue's own name, and the only source of dish 中文.
        nameZh: item.chineseName ?? null,
        description: item.description ?? override?.description ?? null,
        priceCents: item.priceCents,
        sizes: sizesFor(item),
        categoryId: category.id,
        modifierGroups: modifierGroupsFor(item),
        // The printed menu's 🌶 set, straight from the catalogue. No override
        // fallback: a second source for this flag is how it drifts.
        spicy: item.spicy === true,
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
