import { indexItems, isAvailable, itemSizes, type Menu } from "@/lib/menu/types";
import { taxCents } from "@/lib/money";
import { isLunchService, lunchClosedMessage } from "@/lib/order/gates";
import type { PickupOptions } from "@/lib/order/pickup";
import { resolveOrderLine } from "@/lib/orders/lines";
import { checkModifierGroups } from "@/lib/orders/modifierRules";
import { stripRice } from "@/lib/menu/rice";
import { applyPreparationDefault } from "@/lib/menu/preparation";
import type { OrderLine, OrderTotals } from "@/lib/orders/types";
import type { OrderRequest } from "@/lib/orders/requestSchema";

/**
 * Turn a submitted cart into priced, stored lines. THE recompute.
 *
 * This is the body of the web checkout's step 6, lifted out unchanged so the
 * staff POS cannot have a pricing path of its own. Both POST /api/orders and
 * POST /api/kitchen/orders call this, against the same `getMenu()`, with the
 * same tax rate, so an identical cart costs the same to the cent whichever
 * screen it came from. Every money figure here is computed; none is read off
 * the request, whose schema has nowhere to put one.
 *
 * The one knob is `lunchAllowed`: whether a lunch special may be ordered right
 * now. The web passes "it is lunchtime, or the test-mode bypass is on"; the POS
 * passes the same, OR'd with the staff override toggle.
 */

export type ComposeRejection = "item_unavailable";

export type ComposeResult =
  | {
      ok: true;
      lines: OrderLine[];
      totals: OrderTotals;
      /** A tray, family dinner or similar: the longer ready window applies. */
      hasLongPrep: boolean;
    }
  | { ok: false; error: string; reason?: ComposeRejection };

export interface ComposeOptions {
  /** Tenant tax rate in basis points. The caller checks it is configured. */
  taxRateBps: number;
  /** May a lunch special be on this order right now? See the header. */
  lunchAllowed: boolean;
}

/**
 * May a STAFF order carry a lunch special right now?
 *
 * The same 11:00 to 15:00 window as the web, unless staff flip the
 * 午餐時段外 override on the POS (which shows a warning while it is on), or the
 * request carries the test-mode bypass. Named rather than inlined so the rule
 * is testable against a fixed clock.
 *
 * Owner confirmed: staff may override the lunch window; the POS keeps its
 * visible warning while the override is on.
 */
export function staffLunchAllowed(input: {
  now: Date;
  opts: PickupOptions;
  override: boolean;
  bypass: boolean;
}): boolean {
  return input.bypass || input.override || isLunchService(input.now, input.opts);
}

export function composeOrder(
  menu: Menu,
  requestLines: OrderRequest["lines"],
  options: ComposeOptions,
): ComposeResult {
  const index = indexItems(menu);

  const lines: OrderLine[] = [];
  let subtotalCents = 0;
  for (const line of requestLines) {
    const item = index.get(line.itemId);
    // A hidden item (86'd, or removed like Roasted Duck 2026-08) is filtered
    // out of the catalogue before it is indexed, so a stale cart holding its
    // id lands HERE; the item is simply absent. The isAvailable() line below
    // is the belt-and-braces case for an id that is indexed yet unavailable.
    // Both carry the item_unavailable reason so the checkout can localize.
    if (!item)
      return {
        ok: false,
        error:
          "An item in your cart is no longer available. Please rebuild your cart. · 購物車中有項目已下架，請重新下單。",
        reason: "item_unavailable",
      };
    if (!isAvailable(item))
      return {
        ok: false,
        error: `"${item.nameEn}" is currently unavailable. · 該項目暫時售罄。`,
        reason: "item_unavailable",
      };
    // Lunch specials are an 11–3 product. The client hides them outside that
    // window, but the client's clock is display-only; this is the gate.
    if (item.lunchSpecial && !options.lunchAllowed) {
      return { ok: false, error: lunchClosedMessage() };
    }
    const size = itemSizes(item).find((s) => s.id === line.sizeId);
    if (!size) return { ok: false, error: `A size is no longer available for "${item.nameEn}".` };

    /* RICE IS NOT ALWAYS OFFERED. A party tray is the dish alone, and a
       noodle or rice dish is the starch itself; neither includes a rice
       side. A line arriving with a rice modifier for such an item/size is
       stripped here rather than refused: it is not tampering, it is a cart
       built before the rule shipped. Stripped BEFORE the group check, which
       reads the same size-filtered groups, so the two cannot disagree. */
    const { modifierIds: withoutStaleRice, removed } = stripRice(
      item,
      line.sizeId,
      line.modifierIds,
    );
    if (removed.length > 0) {
      console.warn(
        `[orders] stripped rice from a "${size.label}" line of "${item.nameEn}": ` +
          `${removed.join(", ")}: this item does not include rice at that size (stale cart)`,
      );
    }

    /* A MISSING PREPARATION IS DEFAULTED, NOT REFUSED (#116 steamed/fried).
       See lib/menu/preparation.ts. Done BEFORE the group check so the
       defaulted line satisfies the required group. */
    const { modifierIds, defaulted } = applyPreparationDefault(item, withoutStaleRice);
    if (defaulted) {
      console.warn(
        `[orders] a "${size.label}" line of "${item.nameEn}" arrived with no ` +
          `preparation choice; defaulted to Steamed (stale cart)`,
      );
    }

    /* REQUIRED CHOICES ARE ENFORCED HERE: minRequired / maxAllowed are a
       server gate, not just the item sheet's disabled button. */
    const groupError = checkModifierGroups(item, line.sizeId, modifierIds);
    if (groupError) return { ok: false, error: groupError };

    let resolved: OrderLine;
    try {
      resolved = resolveOrderLine(
        item,
        line.sizeId,
        modifierIds,
        line.quantity,
        line.specialInstructions,
      );
    } catch {
      return { ok: false, error: `An option is no longer available for "${item.nameEn}".` };
    }

    subtotalCents += resolved.lineCents;
    lines.push(resolved);
  }

  // Prep time: a party tray, family dinner, or big family dinner in the cart
  // moves the whole order to the longer window. One slow item sets the pace.
  const hasLongPrep = requestLines.some((line) => {
    const item = index.get(line.itemId);
    return (
      item?.longPrep === true ||
      (line.sizeId === "party-tray" &&
        itemSizes(item!).some((s) => s.id === "party-tray"))
    );
  });

  const tax = taxCents(subtotalCents, options.taxRateBps);
  const totalCents = subtotalCents + tax;
  if (totalCents <= 0) return { ok: false, error: "Your cart is empty. · 購物車是空的。" };

  return {
    ok: true,
    lines,
    totals: {
      subtotalCents,
      taxCents: tax,
      // Payment happens at the counter, so tipping is the register's job.
      tipCents: 0,
      totalCents,
    },
    hasLongPrep,
  };
}
