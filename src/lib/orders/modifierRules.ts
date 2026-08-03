import { groupsForSize } from "@/lib/menu/rice";
import type { MenuItem } from "@/lib/menu/types";

/**
 * Does this set of chosen modifier ids satisfy the item's own groups?
 *
 * `minRequired` and `maxAllowed` existed on the type from the start and
 * were read by exactly one file: the item sheet, which disables its Add
 * button. That is a UX affordance, not a gate — the sheet runs in the
 * customer's browser and the cart it fills is JSON in sessionStorage.
 * Nothing on the server ever looked at either field, so an order missing
 * a required choice was priced, stored and printed as though it were
 * complete.
 *
 * Returns a customer-facing bilingual message, or null when the line is
 * fine. Bilingual because it renders through the same setError path as
 * every other refusal on the checkout page.
 *
 * Deliberately NOT throwing: resolveLinePrice throws for tampering
 * (unknown ids), which is a different situation with a different answer.
 * A missing rice choice is an ordinary stale-cart mistake and the
 * customer needs to be told what to fix.
 *
 * ⚠️ TAKES THE SIZE, and must. Groups are size-conditional now — a party
 * tray has no rice group (see lib/menu/rice) — and the rice group is
 * `minRequired: 1`. Checked against the unfiltered item, a tray line that
 * correctly carries no rice would be refused with "please choose rice",
 * i.e. the honest client would be the one that could not order.
 */
export function checkModifierGroups(
  item: MenuItem,
  sizeId: string,
  modifierIds: readonly string[],
): string | null {
  const chosen = new Set(modifierIds);

  for (const group of groupsForSize(item, sizeId)) {
    const idsInGroup = group.modifiers.map((m) => m.id);
    const picked = idsInGroup.filter((id) => chosen.has(id)).length;

    if (picked < group.minRequired) {
      return (
        `Please choose ${group.nameEn.toLowerCase()} for "${item.nameEn}". ` +
        `Reopen the dish and pick one. · ` +
        `請為「${item.nameZh ?? item.nameEn}」選擇${group.nameZh ?? group.nameEn}。`
      );
    }

    if (group.maxAllowed !== null && picked > group.maxAllowed) {
      return (
        `Too many options chosen for "${item.nameEn}". ` +
        `Reopen the dish and pick ${group.maxAllowed}. · ` +
        `「${item.nameZh ?? item.nameEn}」的選項過多，請重新選擇。`
      );
    }
  }

  // A duplicate id prices twice and renders a duplicate React key on the
  // kitchen board. Cheap to refuse, and no honest client produces one.
  if (chosen.size !== modifierIds.length) {
    return (
      `A duplicate option was submitted for "${item.nameEn}". Please rebuild your cart. · ` +
      `選項重複，請重新下單。`
    );
  }

  return null;
}
