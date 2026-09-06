import type { ItemChoiceMeta, MenuItem, MenuModifierGroup } from "@/lib/menu/types";

/**
 * A required PROTEIN or PREPARATION choice hidden in a dish's name.
 *
 * "Chicken or Beef Chow Fun (Dry)" (#124), the Specials "Black Pepper Beef or
 * Chicken", and "Steamed or Fried Dumplings (8)" (#6) each print an "or" the
 * counter used to resolve out loud and the site could not resolve at all — the
 * customer was left to type the protein into the special-instructions box, the
 * one thing the site explicitly discourages. This is the selector that makes
 * the "or" a real choice.
 *
 * SAME MECHANISM AS THE #116 PREPARATION SELECTOR (lib/menu/preparation.ts),
 * with two deliberate differences:
 *
 *  1. NO DEFAULT. #116's Steamed is a sensible default (it is what the counter
 *     gives you if you say nothing), so the sheet preselects it and a stale
 *     cart is DEFAULTED. Chicken-vs-Beef has no such default — picking one for
 *     the customer is the kitchen choosing their order — so the group carries
 *     `requireExplicitChoice` (the sheet leaves it blank, Add stays disabled)
 *     and a stale cart is REFUSED rather than defaulted. See the note on stale
 *     carts in the orders route.
 *  2. IT PRINTS AS "{chosen} · {base}", NOT AS A FULL NAME REPLACEMENT. #116's
 *     dish IS the rice, so the chosen option replaces the whole name. Here the
 *     dish survives the choice ("Chow Fun (Dry)" is still chow fun), so the
 *     chosen option LEADS the item line and the rest of the name follows it,
 *     with the redundant "or" gone — "Beef · Chow Fun (Dry)". That combining is
 *     done ONCE, at order time, in `resolveChoiceLine`, and frozen into the
 *     stored line's name; the ticket and the kitchen board then read the same
 *     resolved snapshot with no special-casing, exactly as they do for every
 *     other dish. The chosen option is FOLDED INTO THE NAME and dropped from the
 *     stored modifier list, so it is never also printed as a ● side.
 *
 * ⚠️ Client-safe, exactly like rice.ts / preparation.ts: imported by catalog.ts
 * (server-only), reached from the item sheet through the built modifierGroups,
 * and read by resolveOrderLine and the ticket-font glyph collector. No
 * server-only imports, no data fetching — just the shapes.
 */

/**
 * One group id for every choice item, distinct from RICE_GROUP_ID and
 * PREP_GROUP_ID. Modifier ids resolve against the ITEM's own groups (see
 * cart/pricing.ts), never globally, so the OPTION ids can be item-specific
 * ("chow-fun-beef", "dumplings-steamed") without colliding — and a stable group
 * id lets resolveChoiceLine and the sheet find the group without knowing the
 * options. An item that has a rice side AND a protein choice (the Specials
 * "Black Pepper Beef or Chicken") carries both groups; the two never share an
 * id, so neither test is ambiguous.
 */
export const CHOICE_GROUP_ID = "choice";

/**
 * The raw catalogue's declaration of a name-hidden choice, as `src/data/menu.ts`
 * writes it. `kind` only picks the group's browser label (Protein vs
 * Preparation); everything the kitchen sees comes from the options and the base
 * name. Options carry per-option `priceCents` (default 0) so a "Beef costs more"
 * answer is a one-value edit here, the same way preparation.ts is built —
 * price invariance is asserted in verify:choice until an owner says otherwise.
 */
export interface ItemChoiceSpec {
  kind: "protein" | "preparation";
  /** The dish name with the "or" clause removed — what follows the chosen
   *  option on the ticket. See ItemChoiceMeta. */
  ticketBaseEn: string;
  ticketBaseZh: string | null;
  /** The options, in printed-menu order. NO option is a default. */
  options: {
    id: string;
    nameEn: string;
    nameZh: string;
    priceCents?: number;
  }[];
}

/** The browser-only group label. Never reaches a ticket (only the chosen option
 *  does), so its glyphs are the page font's problem, not the subset's — the same
 *  reason preparation.ts excludes its group `nameZh` from the collector. */
function groupLabels(kind: ItemChoiceSpec["kind"]): {
  nameEn: string;
  nameZh: string;
} {
  return kind === "protein"
    ? { nameEn: "Protein", nameZh: "肉類" }
    : { nameEn: "Preparation", nameZh: "煮法" };
}

/**
 * Build the choice group: a REQUIRED single choice with NO preselected default.
 *
 * `requireExplicitChoice` is what tells the item sheet not to auto-pick the
 * first option, so Add-to-Cart stays disabled with a named reason until the
 * customer chooses — the whole point of the "must actively choose" rule.
 */
export function choiceGroup(spec: ItemChoiceSpec): MenuModifierGroup {
  const { nameEn, nameZh } = groupLabels(spec.kind);
  return {
    id: CHOICE_GROUP_ID,
    nameEn,
    nameZh,
    minRequired: 1,
    maxAllowed: 1,
    requireExplicitChoice: true,
    modifiers: spec.options.map((o) => ({
      id: o.id,
      nameEn: o.nameEn,
      nameZh: o.nameZh,
      priceCents: o.priceCents ?? 0,
    })),
  };
}

/** The ticket base name, lifted out of the spec for catalog.ts to store on the
 *  normalized item so resolveOrderLine can read it without the raw spec. */
export function choiceMeta(spec: ItemChoiceSpec): ItemChoiceMeta {
  return { ticketBaseEn: spec.ticketBaseEn, ticketBaseZh: spec.ticketBaseZh };
}

/**
 * The resolved item-line name for a chosen protein/preparation, or null when
 * the item has no choice group or none of the chosen ids belongs to it.
 *
 * Returns the chosen option's id alongside the name so `resolveOrderLine` can
 * DROP it from the stored modifier list — the option is captured in the name
 * ("Beef · Chow Fun (Dry)"), so printing it a second time as a ● side is the
 * duplication this whole model exists to avoid. Reads the item's own
 * `choice` meta for the base and the item's CHOICE_GROUP_ID group for the
 * chosen option's bilingual labels, so a rename or a translation fix flows
 * through one place.
 */
export function resolveChoiceLine(
  item: MenuItem,
  modifierIds: readonly string[],
): { nameEn: string; nameZh: string | null; choiceId: string } | null {
  const group = item.modifierGroups.find((g) => g.id === CHOICE_GROUP_ID);
  if (!group || !item.choice) return null;

  const chosenIds = new Set(modifierIds);
  const chosen = group.modifiers.find((m) => chosenIds.has(m.id));
  if (!chosen) return null;

  const { ticketBaseEn, ticketBaseZh } = item.choice;
  const nameEn = `${chosen.nameEn} · ${ticketBaseEn}`;
  // Both halves bilingual, or fall back to the English line — never a half-中文
  // name. A choice option always carries 中文 (asserted in verify:choice), so
  // the only way `nameZh` is null is a dish with no base 中文, which none of the
  // three have.
  const nameZh =
    chosen.nameZh && ticketBaseZh
      ? `${chosen.nameZh} · ${ticketBaseZh}`
      : null;

  return { nameEn, nameZh, choiceId: chosen.id };
}

/**
 * Is this stored modifier id one of an item's choice options? Used where a
 * caller has the item in hand (resolveOrderLine) to fold the option into the
 * name and keep it off the ● side list. There is no global predicate the way
 * preparation has one, because the option ids are per-item — identity is
 * membership in THIS item's choice group.
 */
export function isChoiceModifierId(item: MenuItem, id: string): boolean {
  const group = item.modifierGroups.find((g) => g.id === CHOICE_GROUP_ID);
  return !!group && group.modifiers.some((m) => m.id === id);
}
