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
 * THE POS'S STICKY DEFAULTS: the rice and the size a tile tap uses, set once
 * in the strip above the dishes and kept per tablet.
 *
 * A DEFAULT COVERS A CHOICE ONLY WHEN THE DISH OFFERS IT. 各一半 Half exists
 * only on the family sets, so with Half chosen a single entrée asks; 單點,
 * 半盤 and 餐盤 only mean something on a dish sold by the tray. A required choice no
 * default covers (beef or chicken, the lunch entrée, a family dinner's head
 * count) is never picked here: the tap opens the sheet on that choice.
 *
 * Pure, so the tile, its "this will ask" marker and Apply to all read one rule.
 */

export type RiceDefault = "steamed" | "fried" | "half" | "none";
export type SizeDefault = "individual" | "half" | "tray";

export const RICE_DEFAULTS: readonly RiceDefault[] = ["steamed", "fried", "half", "none"];
export const SIZE_DEFAULTS: readonly SizeDefault[] = ["individual", "half", "tray"];

export interface PosDefaults {
  rice: RiceDefault;
  size: SizeDefault;
}

export const INITIAL_DEFAULTS: PosDefaults = { rice: "steamed", size: "individual" };

/** Per tablet: the counter iPad and the office laptop may differ. */
export const POS_RICE_STORAGE_KEY = "nmc-pos-rice";
export const POS_SIZE_STORAGE_KEY = "nmc-pos-size";

export const RICE_DEFAULT_MODIFIER: Record<RiceDefault, string> = {
  steamed: RICE_STEAMED_ID,
  fried: RICE_FRIED_ID,
  half: RICE_BOTH_ID,
  none: RICE_NONE_ID,
};

const SIZE_DEFAULT_ID: Record<SizeDefault, string> = {
  individual: "individual",
  half: "half-tray",
  tray: "party-tray",
};

export function isRiceDefault(value: unknown): value is RiceDefault {
  return typeof value === "string" && (RICE_DEFAULTS as readonly string[]).includes(value);
}

export function isSizeDefault(value: unknown): value is SizeDefault {
  return typeof value === "string" && (SIZE_DEFAULTS as readonly string[]).includes(value);
}

/**
 * The size a tap uses, or null when the size is itself the decision.
 *
 *   one size                 that one
 *   a dish sold by the tray  the strip's size (單點 / 半盤 / 餐盤); null if
 *                            the dish lacks that tier, so the sheet asks
 *   any other two sizes      the first, the menu's regular one (cup before
 *                            bowl), as the tile has always done
 *   more than two            null: a family dinner's head count is asked
 */
export function defaultSizeId(item: MenuItem, size: SizeDefault): string | null {
  const sizes = itemSizes(item);
  if (sizes.length === 1) return sizes[0].id;
  if (sellsTrays(item)) {
    const wanted = SIZE_DEFAULT_ID[size];
    return sizes.some((s) => s.id === wanted) ? wanted : null;
  }
  if (sizes.length === 2) return sizes[0].id;
  return null;
}

/** Does this dish sell 單點 and a 餐盤, so the size default applies? */
export function sellsTrays(item: MenuItem): boolean {
  const ids = new Set(itemSizes(item).map((s) => s.id));
  return ids.has(SIZE_DEFAULT_ID.individual) && ids.has(SIZE_DEFAULT_ID.tray);
}

/** The strip's rice, when this dish offers it at any size; for prefilling a sheet. */
export function defaultRiceFor(item: MenuItem, rice: RiceDefault): string[] {
  const id = RICE_DEFAULT_MODIFIER[rice];
  const group = item.modifierGroups.find((g) => g.id === RICE_GROUP_ID);
  return group?.modifiers.some((m) => m.id === id) ? [id] : [];
}

export interface QuickLine {
  itemId: string;
  sizeId: string;
  modifierIds: string[];
  quantity: number;
}

/**
 * What one tap on a tile does with the current defaults.
 *
 *   add   every required choice is covered: this line goes on the ticket
 *   ask   open the sheet prefilled with what the defaults do cover, on the
 *         first choice they do not (`focus`: a group id, or "size")
 */
export type QuickResult =
  | { kind: "add"; line: QuickLine }
  | { kind: "ask"; sizeId?: string; modifierIds: string[]; focus: string };

export function quickAdd(item: MenuItem, defaults: PosDefaults): QuickResult {
  const sizeId = defaultSizeId(item, defaults.size);
  if (!sizeId) return { kind: "ask", modifierIds: defaultRiceFor(item, defaults.rice), focus: "size" };

  const riceId = RICE_DEFAULT_MODIFIER[defaults.rice];
  const modifierIds: string[] = [];
  let focus: string | null = null;
  for (const g of groupsForSize(item, sizeId)) {
    if (g.id === RICE_GROUP_ID && g.modifiers.some((m) => m.id === riceId)) {
      modifierIds.push(riceId);
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

/**
 * A line's modifiers with its rice switched to `rice`, or null when there is
 * nothing to change: the dish has no rice at this size, does not offer that
 * rice (Half on a single entrée), or already has it.
 */
export function withRice(item: MenuItem, sizeId: string, modifierIds: readonly string[], rice: RiceDefault): string[] | null {
  const group = groupsForSize(item, sizeId).find((g) => g.id === RICE_GROUP_ID);
  if (!group) return null;
  const target = RICE_DEFAULT_MODIFIER[rice];
  if (!group.modifiers.some((m) => m.id === target)) return null;
  const riceIds = new Set(group.modifiers.map((m) => m.id));
  const current = modifierIds.filter((id) => riceIds.has(id));
  if (current.length === 1 && current[0] === target) return null;
  return [...modifierIds.filter((id) => !riceIds.has(id)), target];
}
