/**
 * Turn a validated cart line into the stored, bilingual OrderLine the ticket
 * and the kitchen board read.
 *
 * PRICING IS NOT DONE HERE. This calls the same `resolveLinePrice` the cart
 * and the checkout route already share — the money is untouched, and all this
 * layer adds is the 中文 the ticket cannot be printed without.
 *
 * Why the name resolution is repeated here rather than trusted from the menu:
 * an order is stored as a SNAPSHOT. Renaming a dish or fixing a translation
 * next week must not silently rewrite what a kitchen was told to cook last
 * week, so the bilingual names are resolved once, at order time, and frozen
 * into the row.
 */

import { resolveLinePrice } from "@/lib/cart/pricing";
import { resolveModifierZh, resolveSizeZh } from "@/data/menu-overrides";
import { dishZh } from "@/data/menu";
import { resolveChoiceLine } from "@/lib/menu/choice";
import { itemSizes, type MenuItem } from "@/lib/menu/types";
import type { OrderLine, OrderLineModifier } from "@/lib/orders/types";

/**
 * 中文 for an item: the resolved menu item's own, else a catalogue lookup by
 * name, else null.
 *
 * The name lookup is the safety net for items that did not come through
 * `catalogMenu()` — a fixture, a combo assembled elsewhere — and it reads the
 * SAME table the catalogue does, so it can never disagree with it.
 */
export function resolveItemZh(item: MenuItem): string | null {
  if (item.nameZh) return item.nameZh;
  return dishZh(item.nameEn);
}

/**
 * Build the stored line. Throws (via resolveLinePrice) on an unknown size or
 * modifier, so a tampered cart is rejected rather than mispriced — the same
 * guarantee the checkout route already relies on.
 */
export function resolveOrderLine(
  item: MenuItem,
  sizeId: string,
  modifierIds: string[],
  quantity: number,
  specialInstructions?: string,
): OrderLine {
  const priced = resolveLinePrice(item, sizeId, modifierIds, quantity);

  const size = itemSizes(item).find((s) => s.id === sizeId);
  if (!size) throw new Error(`Unknown size "${sizeId}" for item "${item.id}"`);

  const byId = new Map(
    item.modifierGroups.flatMap((g) => g.modifiers).map((m) => [m.id, m]),
  );

  // A name-hidden protein/preparation choice ("Chicken or Beef Chow Fun") is
  // resolved INTO the line's name here, once — "Beef · Chow Fun (Dry)" — and the
  // chosen option is then dropped from the stored modifiers, so the kitchen
  // reads it on the item line and never also as a ● side. The $0 choice was
  // already summed by resolveLinePrice above, so dropping it here does not touch
  // the price. Null for every dish without a choice group. See lib/menu/choice.
  const choice = resolveChoiceLine(item, modifierIds);

  const modifiers: OrderLineModifier[] = [];
  for (const id of modifierIds) {
    // Folded into the name, not printed as a side.
    if (choice && id === choice.choiceId) continue;
    const mod = byId.get(id);
    // resolveLinePrice already rejected unknown ids; this is belt and braces.
    if (!mod) continue;
    modifiers.push({
      id: mod.id,
      nameEn: mod.nameEn,
      nameZh: mod.nameZh ?? resolveModifierZh(mod.nameEn),
      priceCents: mod.priceCents,
    });
  }

  return {
    itemId: item.id,
    // The chosen option leads the name for a choice item; the canonical
    // "Chicken or Beef …" is what the website shows, but the ticket and board
    // read this resolved snapshot.
    nameEn: choice ? choice.nameEn : item.nameEn,
    nameZh: choice ? choice.nameZh : resolveItemZh(item),
    sizeId: size.id,
    sizeLabel: size.label,
    sizeLabelZh: resolveSizeZh(size.label),
    modifiers,
    quantity,
    unitCents: priced.unitCents,
    lineCents: priced.lineCents,
    specialInstructions,
  };
}
