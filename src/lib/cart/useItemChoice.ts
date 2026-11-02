import { useMemo, useState } from "react";
import type { MenuItem, MenuModifierGroup } from "@/lib/menu/types";
import { itemSizes } from "@/lib/menu/types";
import { groupsForSize } from "@/lib/menu/rice";
import { resolveLinePrice } from "@/lib/cart/pricing";

/**
 * The item sheet's choice logic: size, modifier groups with Clover-style
 * min/max, quantity, special instructions, and the live line price.
 *
 * Shared by the customer sheet (components/order/ItemSheet) and the staff POS
 * sheet (components/kitchen/StaffItemSheet), which look nothing alike and must
 * never decide differently: what is required, what is defaulted, which rice a
 * party tray drops, and what the line costs. The price is resolveLinePrice,
 * the same pure function the server recomputes with.
 *
 * Mount it under a component keyed by item id, so a new item starts clean.
 */
export function useItemChoice(item: MenuItem) {
  const sizes = itemSizes(item);
  const [sizeId, setSizeId] = useState<string>(sizes[0]?.id ?? "");

  /**
   * Single-choice REQUIRED groups open on their first option.
   *
   * Sizes have always defaulted to the first tier; modifier groups never
   * did, which was invisible while the only required group was the lunch
   * entrée choice, a genuine decision, where a default would be the
   * kitchen picking your lunch. Rice is not that. It is on most of the
   * menu, steamed is what the counter gives you if you say nothing, and
   * an undefaulted required group means every dish opens with a dead Add
   * button and no visible reason.
   *
   * Only `maxAllowed === 1` groups: defaulting one option of a
   * multi-select would be choosing on the customer's behalf, not saving
   * them a tap. A lazy initializer, so it costs one evaluation at mount
   * and needs no effect.
   */
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const g of item.modifierGroups) {
      if (g.minRequired >= 1 && g.maxAllowed === 1 && g.modifiers[0]) {
        initial[g.id] = [g.modifiers[0].id];
      }
    }
    return initial;
  });
  const [quantity, setQuantity] = useState(1);
  const [instructions, setInstructions] = useState("");

  /**
   * The groups this SIZE offers. A party tray has no rice group: rice
   * comes with an individual portion, and a tray is the dish alone.
   */
  const groups = useMemo(() => groupsForSize(item, sizeId), [item, sizeId]);

  /**
   * The pending line's modifiers, filtered to what the current size
   * actually offers.
   *
   * The filter is what implements "Individual → Tray drops the rice".
   * `selected` is deliberately NOT cleared when the size changes; it
   * keeps remembering, so Tray → Individual brings the selector back with
   * the choice still on it. A reset would punish toggling a size for a
   * look at the price, and the thing that actually matters (that no rice
   * can reach the line on a tray) is this filter, not the state.
   */
  const modifierIds = useMemo(() => {
    const offered = new Set(groups.flatMap((g) => g.modifiers.map((m) => m.id)));
    return Object.values(selected)
      .flat()
      .filter((id) => offered.has(id));
  }, [selected, groups]);

  const priceCents = useMemo(() => {
    if (!sizeId) return 0;
    try {
      return resolveLinePrice(item, sizeId, modifierIds, quantity).lineCents;
    } catch {
      return 0;
    }
  }, [item, sizeId, modifierIds, quantity]);

  /** Groups that are not yet satisfied, so the footer can name them. */
  const unmetGroups: MenuModifierGroup[] = useMemo(
    () =>
      groups.filter((g) => {
        const count = (selected[g.id] ?? []).length;
        const maxOk = g.maxAllowed == null || count <= g.maxAllowed;
        return !(count >= g.minRequired && maxOk);
      }),
    [groups, selected],
  );

  function toggleModifier(groupId: string, modId: string, maxAllowed: number | null) {
    setSelected((prev) => {
      const current = prev[groupId] ?? [];
      const has = current.includes(modId);
      if (has) return { ...prev, [groupId]: current.filter((id) => id !== modId) };
      // Single-select group: replace. Multi-select: append up to max.
      if (maxAllowed === 1) return { ...prev, [groupId]: [modId] };
      if (maxAllowed != null && current.length >= maxAllowed) return prev;
      return { ...prev, [groupId]: [...current, modId] };
    });
  }

  function isSelected(groupId: string, modId: string): boolean {
    return (selected[groupId] ?? []).includes(modId);
  }

  return {
    sizes,
    sizeId,
    setSizeId,
    groups,
    modifierIds,
    toggleModifier,
    isSelected,
    quantity,
    setQuantity,
    instructions,
    setInstructions,
    priceCents,
    unmetGroups,
    /** Every group's min/max is satisfied: the Add button may be enabled. */
    groupsValid: unmetGroups.length === 0,
  };
}
