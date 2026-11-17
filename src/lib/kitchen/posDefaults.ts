import type { MenuItem } from "@/lib/menu/types";
import { itemSizes } from "@/lib/menu/types";
import {
  groupsForSize,
  RICE_BOTH_ID,
  RICE_FRIED_ID,
  RICE_GROUP_ID,
  RICE_NONE_ID,
  RICE_STEAMED_ID,
} from "@/lib/menu/rice";
import { resolveLinePrice } from "@/lib/cart/pricing";

/**
 * WHAT ONE TAP ON A DISH CARD DOES. No sticky defaults above the dishes any
 * more: the size is the dish's regular one (單點 when it is also sold as a
 * tray; the card's 餐盤 pill asks for the tray), and the rice is asked on the
 * card itself, in a small popover, only for a dish that comes with rice.
 *
 *   add    nothing to decide: the line goes on the ticket
 *   rice   the only decision is the rice: the card shows the picker; a
 *          second tap on the card takes 白飯
 *   ask    a choice the card cannot make (an entrée, beef or chicken, a
 *          family dinner's head count): the full sheet, on that choice
 *
 * A required choice is never made for the caller. Pure, so the card, the
 * popover and the tests read one rule.
 */

export type RiceChoice = "steamed" | "fried" | "half" | "none";

/** The picker's order: 白飯 first, the default. */
export const RICE_CHOICES: readonly RiceChoice[] = ["steamed", "fried", "half", "none"];

export const RICE_CHOICE_MODIFIER: Record<RiceChoice, string> = {
  steamed: RICE_STEAMED_ID,
  fried: RICE_FRIED_ID,
  half: RICE_BOTH_ID,
  none: RICE_NONE_ID,
};

const INDIVIDUAL = "individual";
const TRAY = "party-tray";

/** Does this dish sell both 單點 and 餐盤, so the card carries a 餐盤 pill? */
export function hasBothSizes(item: MenuItem): boolean {
  const ids = new Set(itemSizes(item).map((s) => s.id));
  return ids.has(INDIVIDUAL) && ids.has(TRAY);
}

export const TRAY_SIZE_ID = TRAY;

/**
 * The size a plain tap uses, or null when the size is itself the decision.
 *
 *   one size             that one
 *   單點 and 餐盤          單點
 *   any other two        the first, the menu's regular one (cup before bowl)
 *   more than two        null: a family dinner's head count is asked
 */
export function defaultSizeId(item: MenuItem): string | null {
  const sizes = itemSizes(item);
  if (sizes.length === 1) return sizes[0].id;
  if (sizes.length === 2) return hasBothSizes(item) ? INDIVIDUAL : sizes[0].id;
  return null;
}

export interface QuickLine {
  itemId: string;
  sizeId: string;
  modifierIds: string[];
  quantity: number;
}

export type TapPlan =
  | { kind: "add"; line: QuickLine }
  | { kind: "rice"; sizeId: string; options: RiceChoice[] }
  | { kind: "ask"; sizeId?: string; modifierIds: string[]; focus: string };

/** The rice choices this dish offers at this size, in picker order; [] when it has no rice. */
export function riceOptions(item: MenuItem, sizeId: string): RiceChoice[] {
  const group = groupsForSize(item, sizeId).find((g) => g.id === RICE_GROUP_ID);
  if (!group) return [];
  const offered = new Set(group.modifiers.map((m) => m.id));
  return RICE_CHOICES.filter((r) => offered.has(RICE_CHOICE_MODIFIER[r]));
}

/**
 * What a tap does. `sizeId` forces a size (the 餐盤 pill); otherwise the
 * default size.
 */
export function tapPlan(item: MenuItem, sizeId: string | null = defaultSizeId(item)): TapPlan {
  if (!sizeId) return { kind: "ask", modifierIds: [], focus: "size" };

  let focus: string | null = null;
  let hasRice = false;
  for (const g of groupsForSize(item, sizeId)) {
    if (g.id === RICE_GROUP_ID) {
      hasRice = true;
      continue;
    }
    if (g.minRequired >= 1 && focus === null) focus = g.id;
  }
  // Another choice to make: the sheet asks it, with the rice at 白飯 (the
  // default) when the dish offers it.
  if (focus !== null) {
    const steamed = hasRice && riceOptions(item, sizeId).includes("steamed") ? [RICE_STEAMED_ID] : [];
    return { kind: "ask", sizeId, modifierIds: steamed, focus };
  }
  if (hasRice) {
    const options = riceOptions(item, sizeId);
    if (options.length > 0) return { kind: "rice", sizeId, options };
  }

  try {
    resolveLinePrice(item, sizeId, [], 1);
  } catch {
    return { kind: "ask", sizeId, modifierIds: [], focus: "size" };
  }
  return { kind: "add", line: { itemId: item.id, sizeId, modifierIds: [], quantity: 1 } };
}

/** The line a rice pick makes. */
export function riceLine(item: MenuItem, sizeId: string, rice: RiceChoice): QuickLine {
  return { itemId: item.id, sizeId, modifierIds: [RICE_CHOICE_MODIFIER[rice]], quantity: 1 };
}
