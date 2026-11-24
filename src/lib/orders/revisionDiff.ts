/**
 * 改單 EDIT ORDER: what changed between two versions of an order's lines.
 *
 * This is the whole content of a CHANGE TICKET. The kitchen may already be
 * cooking the first ticket, so an edit never prints a second full ticket (that
 * reads as a new order and the wok makes two). It prints only the difference,
 * under the original number. See docs/edit-order.md.
 *
 * PURE AND DETERMINISTIC. No clock, no ids, no menu lookup: the same two line
 * lists always give the same diff in the same order, because the diff is
 * stored with the print request and a 重印 of a change ticket must be
 * byte-identical to the first one. Client-safe (no `server-only`): the POS
 * confirm sheet previews the same function the server stores, but the server's
 * copy is the one that prints.
 *
 * HOW LINES ARE MATCHED. A line's identity is (itemId, sizeId, sorted
 * modifierIds, note). Lines with the same identity are one dish however the
 * POS split them, so quantities are summed per identity before comparing:
 *
 *   same identity, same total quantity      -> unchanged
 *   same identity, different quantity       -> CHANGED  "2 → 3"
 *   left over on both sides, same item and
 *   same quantity, one or more of size /
 *   options / note differing                -> CHANGED  "餐盤 → 半盤", note old → new
 *   left over, old side only                -> REMOVED
 *   left over, new side only                -> ADDED
 *
 * A quantity change AND a size change on the same dish (2 餐盤 → 3 半盤) is a
 * remove plus an add: two clear lines beat one line the wok has to parse.
 *
 * A custom charge (自訂) has itemId "custom"; its identity is its name and
 * unit price instead of a size.
 */

import type { OrderLine } from "@/lib/orders/types";

/** Which attributes of a paired line moved. */
export type ChangedField = "quantity" | "size" | "modifiers" | "note";

export interface ChangedLine {
  before: OrderLine;
  after: OrderLine;
  /** In display order: quantity, size, modifiers, note. Never empty. */
  fields: ChangedField[];
}

export interface OrderLinesDiff {
  /** Lines (or the added part of a line) that are new. quantity = how many were added. */
  added: OrderLine[];
  /** Lines that are gone. quantity = how many were removed. */
  removed: OrderLine[];
  changed: ChangedLine[];
  /** Dishes untouched by the edit, counted by quantity, as the board counts items. */
  unchangedCount: number;
}

/**
 * What a change ticket prints, as stored on its print request. Everything the
 * renderer needs, frozen at save time, so a reprint does not recompute.
 */
export interface OrderChangeTicket {
  /** The revision this ticket brings the kitchen up to (orders.revision after the save). */
  revision: number;
  /** The revision the kitchen's paper was at before (usually revision - 1; more after a merge). */
  fromRevision: number;
  /** When the edit was saved, ISO-8601. Printed in the header. */
  savedAt: string;
  diff: OrderLinesDiff;
  oldTotalCents: number;
  newTotalCents: number;
}

function noteOf(line: OrderLine): string {
  return (line.specialInstructions ?? "").trim();
}

function modifierKey(line: OrderLine): string {
  return line.modifiers
    .map((m) => m.id)
    .slice()
    .sort()
    .join(",");
}

/** What the dish is, without how many: the pairing key for a CHANGED line. */
function dishKey(line: OrderLine): string {
  return line.custom ? `custom:${line.nameEn.trim()}` : `item:${line.itemId}`;
}

/** The full identity. Two lines with equal keys are the same dish. */
export function lineKey(line: OrderLine): string {
  const size = line.custom ? `@${line.unitCents}` : line.sizeId;
  return [dishKey(line), size, modifierKey(line), noteOf(line)].join("|");
}

interface Bucket {
  key: string;
  line: OrderLine;
  quantity: number;
  /** First index on its side, so output order follows the ticket's order. */
  order: number;
}

function bucket(lines: readonly OrderLine[]): Map<string, Bucket> {
  const out = new Map<string, Bucket>();
  lines.forEach((line, index) => {
    const key = lineKey(line);
    const seen = out.get(key);
    if (seen) seen.quantity += line.quantity;
    else out.set(key, { key, line, quantity: line.quantity, order: index });
  });
  return out;
}

function withQuantity(line: OrderLine, quantity: number): OrderLine {
  return { ...line, quantity, lineCents: line.unitCents * quantity };
}

function fieldsBetween(before: OrderLine, after: OrderLine): ChangedField[] {
  const fields: ChangedField[] = [];
  if (before.quantity !== after.quantity) fields.push("quantity");
  if (before.custom ? before.unitCents !== after.unitCents : before.sizeId !== after.sizeId) {
    fields.push("size");
  }
  if (modifierKey(before) !== modifierKey(after)) fields.push("modifiers");
  if (noteOf(before) !== noteOf(after)) fields.push("note");
  return fields;
}

export function diffOrderLines(
  previous: readonly OrderLine[],
  next: readonly OrderLine[],
): OrderLinesDiff {
  const before = bucket(previous);
  const after = bucket(next);

  const changed: ChangedLine[] = [];
  const changedOrder: number[] = [];
  let unchangedCount = 0;
  const removedPool: Bucket[] = [];
  const addedPool: Bucket[] = [];

  for (const b of before.values()) {
    const a = after.get(b.key);
    if (!a) {
      removedPool.push(b);
    } else if (a.quantity === b.quantity) {
      unchangedCount += a.quantity;
    } else {
      changed.push({
        before: withQuantity(b.line, b.quantity),
        after: withQuantity(a.line, a.quantity),
        fields: ["quantity"],
      });
      changedOrder.push(a.order);
    }
  }
  for (const a of after.values()) {
    if (!before.has(a.key)) addedPool.push(a);
  }

  // Pair the leftovers: same dish, same quantity, something else moved.
  const removed: Bucket[] = [];
  const usedAdded = new Set<string>();
  for (const b of removedPool) {
    const match = addedPool.find(
      (a) =>
        !usedAdded.has(a.key) &&
        dishKey(a.line) === dishKey(b.line) &&
        a.quantity === b.quantity,
    );
    if (!match) {
      removed.push(b);
      continue;
    }
    usedAdded.add(match.key);
    const beforeLine = withQuantity(b.line, b.quantity);
    const afterLine = withQuantity(match.line, match.quantity);
    changed.push({ before: beforeLine, after: afterLine, fields: fieldsBetween(beforeLine, afterLine) });
    changedOrder.push(match.order);
  }
  const added = addedPool.filter((a) => !usedAdded.has(a.key));

  // Ticket order: each block follows the order the lines sit on the ticket.
  const changedSorted = changed
    .map((c, i) => ({ c, o: changedOrder[i] }))
    .sort((x, y) => x.o - y.o)
    .map((x) => x.c);

  return {
    added: added.sort((x, y) => x.order - y.order).map((a) => withQuantity(a.line, a.quantity)),
    removed: removed.sort((x, y) => x.order - y.order).map((b) => withQuantity(b.line, b.quantity)),
    changed: changedSorted,
    unchangedCount,
  };
}

/** True when an edit would print nothing: Save stays disabled ("no changes"). */
export function isEmptyDiff(diff: OrderLinesDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}
