import type { MenuItem } from "@/lib/menu/types";
import { itemSizes } from "@/lib/menu/types";

/**
 * Pure line-price resolution, shared by the client (display) and the server
 * (authority). The SERVER's result is the only one that can charge a card;
 * the client uses this purely to show a live price. Because both run the same
 * pure function against the same menu, they agree — but the server never
 * trusts a client-supplied amount (see /api/checkout).
 *
 * All money is integer cents. Unknown size/modifier ids throw, so the server
 * rejects a tampered cart instead of silently mispricing it.
 */

export interface ResolvedLine {
  unitCents: number; // size + modifiers, before quantity
  lineCents: number; // unitCents * quantity
}

export function resolveLinePrice(
  item: MenuItem,
  sizeId: string,
  modifierIds: string[],
  quantity: number,
): ResolvedLine {
  const sizes = itemSizes(item);
  const size = sizes.find((s) => s.id === sizeId);
  if (!size) {
    throw new Error(`Unknown size "${sizeId}" for item "${item.id}"`);
  }

  let unit = size.priceCents;
  const validModifierIds = new Set(
    item.modifierGroups.flatMap((g) => g.modifiers.map((m) => m.id)),
  );
  for (const modId of modifierIds) {
    if (!validModifierIds.has(modId)) {
      throw new Error(`Unknown modifier "${modId}" for item "${item.id}"`);
    }
    const mod = item.modifierGroups
      .flatMap((g) => g.modifiers)
      .find((m) => m.id === modId);
    if (mod) unit += mod.priceCents;
  }

  const qty = Math.max(1, Math.floor(quantity));
  return { unitCents: unit, lineCents: unit * qty };
}
