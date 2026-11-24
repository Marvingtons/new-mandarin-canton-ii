import type { MenuItem, MenuSize } from "@/lib/menu/types";
import { itemSizes } from "@/lib/menu/types";
import { groupsForSize, RICE_GROUP_ID, RICE_STEAMED_ID } from "@/lib/menu/rice";
import { PREP_GROUP_ID, PREP_STEAMED_ID } from "@/lib/menu/prepIds";
import { resolveLinePrice } from "@/lib/cart/pricing";

/**
 * WHAT ONE TAP ON A POS TILE DOES. No sticky defaults: the size that changes
 * the price is always a deliberate tap, and nothing on screen decides it for
 * the caller (docs/kitchen-design.md, Revision 3).
 *
 *   one size                 add it at once
 *   several sizes            the portion sheet: one tap picks the size and adds
 *   (a family dinner's head count is more than a portion: the full sheet)
 *
 * The only choices a tap ever makes are the ones the menu itself defaults and
 * the counter gives when nobody says otherwise: the included rice is 白飯
 * Steamed, and #116's own preparation is 白飯 Steamed. Any other required
 * choice (beef or chicken, the lunch entrée) opens the full sheet on it.
 *
 * Pure, so the tile, its "this will ask" dot and the tests read one rule.
 */

export interface QuickLine {
  itemId: string;
  sizeId: string;
  modifierIds: string[];
  quantity: number;
}

export type TapResult =
  | { kind: "add"; line: QuickLine }
  | { kind: "portion"; sizes: MenuSize[] }
  | { kind: "ask"; sizeId?: string; modifierIds: string[]; focus: string };

/** The real menu item an extra rice is: #116 炒飯／白飯 Fried/Steamed Rice. */
export const RICE_SIDE_ITEM_ID = "fried-steamed-rice";
/** The size an extra rice is sold at: 單點, $3.00. */
export const RICE_SIDE_SIZE_ID = "individual";

/** Sizes counted as a portion choice: anything up to three tiers. A head count is more. */
const MAX_PORTIONS = 3;

/**
 * The line a dish makes at one size: the menu's default rice and preparation
 * filled in, or the first other required choice it still needs.
 */
export function lineAt(item: MenuItem, sizeId: string): TapResult {
  const modifierIds: string[] = [];
  let focus: string | null = null;
  for (const g of groupsForSize(item, sizeId)) {
    if (g.id === RICE_GROUP_ID && g.modifiers.some((m) => m.id === RICE_STEAMED_ID)) {
      modifierIds.push(RICE_STEAMED_ID);
      continue;
    }
    if (g.id === PREP_GROUP_ID && g.modifiers.some((m) => m.id === PREP_STEAMED_ID)) {
      modifierIds.push(PREP_STEAMED_ID);
      continue;
    }
    if (g.minRequired >= 1 && focus === null) focus = g.id;
  }
  if (focus !== null) return { kind: "ask", sizeId, modifierIds, focus };
  try {
    resolveLinePrice(item, sizeId, modifierIds, 1);
  } catch {
    return { kind: "ask", sizeId, modifierIds, focus: "size" };
  }
  return { kind: "add", line: { itemId: item.id, sizeId, modifierIds, quantity: 1 } };
}

export function tapRule(item: MenuItem): TapResult {
  const sizes = itemSizes(item);
  if (sizes.length === 1) return lineAt(item, sizes[0].id);
  if (sizes.length > MAX_PORTIONS) return { kind: "ask", modifierIds: [], focus: "size" };
  return { kind: "portion", sizes };
}

/** Does this size come without rice, so the 改 sheet offers 加飯 as its own line? */
export function sizeHasNoRice(item: MenuItem, sizeId: string): boolean {
  if (item.id === RICE_SIDE_ITEM_ID) return false;
  return !groupsForSize(item, sizeId).some((g) => g.id === RICE_GROUP_ID);
}

/** Does this dish sell 單點 and a 餐盤 (and so a 半盤)? */
export function sellsTrays(item: MenuItem): boolean {
  const ids = new Set(itemSizes(item).map((s) => s.id));
  return ids.has("individual") && ids.has("party-tray");
}

/**
 * The tile's dot: will this tap end on the full sheet for a required choice?
 * True for a one-size dish that asks, and for a dish sold in portions whose
 * every portion still needs one (黑椒牛肉或雞肉: the portion, then the pick).
 */
export function tapAsks(item: MenuItem): boolean {
  const tap = tapRule(item);
  if (tap.kind === "ask") return true;
  if (tap.kind === "portion") return tap.sizes.some((s) => lineAt(item, s.id).kind === "ask");
  return false;
}
