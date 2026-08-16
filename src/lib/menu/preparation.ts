import type { MenuItem, MenuModifierGroup } from "@/lib/menu/types";

/**
 * An item's OWN preparation choice — steamed vs fried rice on #116
 * "Fried/Steamed Rice".
 *
 * THIS IS NOT THE RICE SIDE. The entrée included-rice group (lib/menu/rice.ts,
 * id "rice") answers "which rice comes WITH this dish"; it prints as a ● side
 * line beneath the entrée. This group answers "how is THIS dish made" — the
 * dish IS the rice, and the menu name "Fried/Steamed Rice" is an either/or the
 * customer resolves at order time. So the two are deliberately separate ids and
 * separate code paths, and the chosen preparation prints ON the item line
 * rather than as a side (see drawLine in lib/ticket/render.ts). Modelling it as
 * the rice side would put "● Steamed Rice" under an item that already is rice.
 *
 * ⚠️ Client-safe, exactly like rice.ts: imported by catalog.ts (server-only),
 * reached from the item sheet through the built modifierGroups, read by the
 * orders route (default injection), and walked by the ticket-font glyph
 * collector at build time. No server-only imports, no data fetching — just the
 * shapes.
 */

/**
 * One group id, distinct from RICE_GROUP_ID. Modifier ids are resolved against
 * the ITEM's own groups (see cart/pricing.ts), never globally, so this could
 * not collide with "rice" even on the same item — but they never share an item
 * anyway (a Sides rice is not an entrée), and a distinct id keeps the ticket's
 * "is this the preparation?" test (isPreparationModifierId) unambiguous.
 */
export const PREP_GROUP_ID = "prep";

export const PREP_STEAMED_ID = "prep-steamed";
export const PREP_FRIED_ID = "prep-fried";

const PREP_MODIFIER_IDS: ReadonlySet<string> = new Set([
  PREP_STEAMED_ID,
  PREP_FRIED_ID,
]);

/**
 * Is this stored modifier id one of the preparation choices? The ticket reads
 * this to lift the preparation onto the item line instead of printing it as a
 * ● side. An OrderLineModifier carries no group id, so identity is by the fixed
 * option ids — the same approach rice takes with its three constants.
 */
export function isPreparationModifierId(id: string): boolean {
  return PREP_MODIFIER_IDS.has(id);
}

/**
 * The preparation group: a REQUIRED single choice, Steamed first.
 *
 * Steamed is listed first and is what the item sheet preselects (see
 * ItemSheet's required-single-select default), so the required choice costs a
 * customer who does not care exactly nothing — and it is the Steamed default
 * the server falls back to for a stale cart (see applyPreparationDefault).
 *
 * PER-OPTION PRICING IS SUPPORTED, and that is deliberate: each option carries
 * its own `priceCents`, and resolveLinePrice already sums it into the unit
 * price, so making Fried cost more later is a one-value edit here.
 *
 * TODO(confirm): does Fried Rice at the $3.00 size cost more? Owner to confirm —
 * steamed $3.00 vs fried likely higher. The printed menu prints one price for
 * this line ($3.00 individual / $38.00 tray), but a standalone fried rice
 * elsewhere on the menu is $17.50–$19.50, so $3.00 is almost certainly the
 * steamed rice bowl only. Both options are $0 delta until the owner answers; if
 * the answer is "fried costs more", raise PREP_FRIED_ID's priceCents and
 * nothing else changes.
 */
export function preparationGroup(): MenuModifierGroup {
  return {
    id: PREP_GROUP_ID,
    nameEn: "Preparation",
    // Browser-only label (the group question never reaches a ticket — only the
    // chosen option does), so its glyphs are the page font's problem, not the
    // subset's. Excluded from preparationGlyphStrings() for that reason.
    nameZh: "煮法",
    minRequired: 1,
    maxAllowed: 1,
    modifiers: [
      { id: PREP_STEAMED_ID, nameEn: "Steamed Rice", nameZh: "白飯", priceCents: 0 },
      { id: PREP_FRIED_ID, nameEn: "Fried Rice", nameZh: "炒飯", priceCents: 0 },
    ],
  };
}

/**
 * Default a missing preparation to Steamed rather than refusing the line.
 *
 * A missing rice side is REFUSED (the customer must say which rice) — but the
 * preparation is different: the item sheet always preselects Steamed, so the
 * only way a line arrives without one is a STALE CART built before this
 * selector shipped, sitting in a sessionStorage tab. Refusing it would turn a
 * $3 order into a lost one over a choice the sheet would have made anyway.
 *
 * Returns the ids unchanged (with `defaulted: false`) for any item that has no
 * preparation group, so the orders route can call it unconditionally. When it
 * does inject, the caller warn-logs, the same way stripRice's removals are
 * logged, so the frequency of stale carts stays visible.
 */
export function applyPreparationDefault(
  item: MenuItem,
  modifierIds: readonly string[],
): { modifierIds: string[]; defaulted: boolean } {
  const hasGroup = item.modifierGroups.some((g) => g.id === PREP_GROUP_ID);
  if (!hasGroup) return { modifierIds: [...modifierIds], defaulted: false };
  if (modifierIds.some(isPreparationModifierId)) {
    return { modifierIds: [...modifierIds], defaulted: false };
  }
  return { modifierIds: [...modifierIds, PREP_STEAMED_ID], defaulted: true };
}

/**
 * Every string the preparation group can put ON A TICKET, for the font subset.
 *
 * Only the chosen OPTION reaches paper (as the item line — see render.ts), so
 * only option strings are collected. The group's own `nameZh` ("煮法") is
 * excluded on purpose: it renders only in the browser item sheet, never on a
 * ticket, so dragging 煮/法 into a subset shipped as two .ttf files would be a
 * rule with no subject — the same discipline rice.ts applies to its `note`.
 *
 * These four strings are already covered by riceGlyphStrings() (白飯/炒飯/
 * Steamed Rice/Fried Rice are identical), so this adds no glyph today; it exists
 * so the coverage does not silently depend on the rice group continuing to name
 * its options the same way.
 */
export function preparationGlyphStrings(): string[] {
  const group = preparationGroup();
  const out: string[] = [];
  for (const mod of group.modifiers) {
    out.push(mod.nameEn);
    if (mod.nameZh) out.push(mod.nameZh);
  }
  return out;
}
