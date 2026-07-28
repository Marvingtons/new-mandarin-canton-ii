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
import {
  resolveItemOverride,
  resolveModifierZh,
  resolveSizeZh,
} from "@/data/menu-overrides";
import { itemSizes, type MenuItem } from "@/lib/menu/types";
import type { OrderLine, OrderLineModifier } from "@/lib/orders/types";

/** 中文 for an item: the menu's own, else the override map, else null. */
export function resolveItemZh(item: MenuItem): string | null {
  if (item.nameZh) return item.nameZh;
  return resolveItemOverride(item.id, item.nameEn)?.nameZh ?? null;
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

  const modifiers: OrderLineModifier[] = [];
  for (const id of modifierIds) {
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
    nameEn: item.nameEn,
    nameZh: resolveItemZh(item),
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
