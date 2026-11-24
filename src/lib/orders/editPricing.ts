/**
 * 改單 EDIT ORDER: price an edited ticket on the SERVER.
 *
 * The POS sends the whole edited ticket as the same StaffLine[] a new order
 * sends: no prices, ever. Each line that came from the order carries the
 * lineId the POS gave it on load, `orig:<index>`.
 *
 * THE RULE (owner's decision, docs/edit-order.md open question 2): a line the
 * edit did not touch keeps the price and names it was ordered at. "Not
 * touched" = it names an original line and still has the same dish, size,
 * options and surcharge; its quantity and note may change, neither of which
 * moves the unit price. So adding egg rolls never reprices, renames or
 * refuses the dishes the kitchen is already cooking because the menu moved
 * since (a price change, a dish 86'd at 7pm).
 *
 * Every other line (new, or with a changed size / options) goes through
 * composeOrder, exactly as a new order: same menu, same gates, same tax.
 * Lunch eligibility comes from the ORIGINAL order's time (`lunchAllowed` is
 * computed by the caller from order.createdAt), so a lunch order edited at
 * 3pm can still carry lunch specials.
 *
 * Pure: menu, tax rate and the original lines in, priced lines out.
 */

import { taxCents } from "@/lib/money";
import type { Menu } from "@/lib/menu/types";
import { composeOrder, type ComposeRejection } from "@/lib/orders/compose";
import type { StaffLine } from "@/lib/orders/requestSchema";
import type { OrderLine, OrderTotals } from "@/lib/orders/types";
import { customOrderLine, SURCHARGE_MODIFIER_ID } from "@/lib/kitchen/customCharge";

export type EditPricingResult =
  | { ok: true; lines: OrderLine[]; totals: OrderTotals }
  | { ok: false; error: string; reason?: ComposeRejection };

function originalIndex(lineId: string | undefined, count: number): number | null {
  const match = /^orig:(\d+)$/.exec(lineId ?? "");
  if (!match) return null;
  const index = Number(match[1]);
  return index < count ? index : null;
}

function sortedIds(ids: readonly string[]): string {
  return [...ids].sort().join(",");
}

/** True when `line` is the stored `original` with only quantity / note changed. */
function sameDish(line: StaffLine, original: OrderLine): boolean {
  if ("custom" in line) {
    if (!original.custom) return false;
    const rebuilt = customOrderLine({ name: line.name, amountCents: line.amountCents, quantity: 1 });
    return (
      rebuilt.nameEn === original.nameEn &&
      rebuilt.nameZh === original.nameZh &&
      rebuilt.unitCents === original.unitCents
    );
  }
  if (original.custom) return false;
  if (line.itemId !== original.itemId || line.sizeId !== original.sizeId) return false;
  const storedSurcharge = original.modifiers.find((m) => m.id === SURCHARGE_MODIFIER_ID) ?? null;
  const storedIds = original.modifiers.filter((m) => m.id !== SURCHARGE_MODIFIER_ID).map((m) => m.id);
  if (sortedIds(storedIds) !== sortedIds(line.modifierIds)) return false;
  const surcharge = "surcharge" in line ? line.surcharge : undefined;
  if (!surcharge) return storedSurcharge === null;
  return storedSurcharge !== null && storedSurcharge.priceCents === surcharge.amountCents;
}

function note(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function priceEdit(
  menu: Menu,
  original: readonly OrderLine[],
  request: readonly StaffLine[],
  options: { taxRateBps: number; lunchAllowed: boolean },
): EditPricingResult {
  const out: (OrderLine | null)[] = new Array(request.length).fill(null);
  const toCompose: { at: number; line: StaffLine }[] = [];

  request.forEach((line, at) => {
    const index = originalIndex(line.lineId, original.length);
    if (index !== null && sameDish(line, original[index])) {
      const kept = original[index];
      out[at] = {
        ...kept,
        quantity: line.quantity,
        lineCents: kept.unitCents * line.quantity,
        specialInstructions: note(line.specialInstructions),
      };
      if (out[at]!.specialInstructions === undefined) delete out[at]!.specialInstructions;
    } else if ("custom" in line) {
      // composeOrder builds a custom line the same way, with no menu.
      out[at] = customOrderLine({
        name: line.name,
        amountCents: line.amountCents,
        quantity: line.quantity,
        specialInstructions: line.specialInstructions,
      });
    } else {
      toCompose.push({ at, line });
    }
  });

  if (toCompose.length > 0) {
    const composed = composeOrder(
      menu,
      toCompose.map((c) => c.line),
      { taxRateBps: options.taxRateBps, lunchAllowed: options.lunchAllowed, allowStaffOnly: true },
    );
    if (!composed.ok) return { ok: false, error: composed.error, reason: composed.reason };
    composed.lines.forEach((line, i) => {
      out[toCompose[i].at] = line;
    });
  }

  const lines = out as OrderLine[];
  const subtotalCents = lines.reduce((n, l) => n + l.lineCents, 0);
  const tax = taxCents(subtotalCents, options.taxRateBps);
  return {
    ok: true,
    lines,
    totals: { subtotalCents, taxCents: tax, tipCents: 0, totalCents: subtotalCents + tax },
  };
}
