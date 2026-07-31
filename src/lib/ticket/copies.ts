import { TICKET_LABELS as L } from "@/lib/ticket/glyphs";

/**
 * WHICH COPIES A JOB PRINTS, AND WHAT EACH ONE SHOWS.
 *
 * A print job drops several loose tickets (see renderCutCopies in render.ts)
 * and they are not interchangeable: one goes to the line, one goes to the
 * register, one goes on the bag. They carry different information, and the
 * difference is declared here rather than discovered in the renderer.
 *
 * ONE LAYOUT ENGINE, FLAGS ON TOP. There is no second renderer for the kitchen
 * copy — the same composer draws every copy and reads these booleans. That is
 * deliberate: two renderers is how a price fix lands on the bag copy and not
 * the register's, and how the two drift until nobody can say which is right.
 *
 * Pure data + pure functions. No env, no `server-only`: the fixture scripts and
 * the print route resolve copies through exactly the same table.
 */

export type TicketCopyRole = "kitchen" | "register" | "bag" | "all";

export interface TicketCopyProfile {
  role: TicketCopyRole;
  /** Copy bar text. Empty English means "this ticket carries no copy bar". */
  labelZh: string;
  labelEn: string;
  /** Print the money column beside each item. */
  linePrices: boolean;
  /** Print the subtotal / tax / total block and the COLLECT PAYMENT bar. */
  priceBlock: boolean;
}

/**
 * The profiles themselves.
 *
 * THE KITCHEN COPY CARRIES NO MONEY AT ALL — no line prices, no totals, no
 * COLLECT PAYMENT bar. A cook does not ring the order and does not need to
 * parse it; every number on that copy is a line of paper spent on something
 * nobody reads, and something to mis-read under pressure. The register rings
 * from the register copy and the customer reads the bag copy, so both of those
 * keep the full pricing.
 */
export const TICKET_COPY_PROFILES: Record<TicketCopyRole, TicketCopyProfile> = {
  kitchen: {
    role: "kitchen",
    labelZh: L.copyKitchen,
    labelEn: "KITCHEN",
    linePrices: false,
    priceBlock: false,
  },
  register: {
    role: "register",
    labelZh: L.copyRegister,
    labelEn: "REGISTER",
    linePrices: true,
    priceBlock: true,
  },
  bag: {
    role: "bag",
    labelZh: L.copyBag,
    labelEn: "BAG",
    linePrices: true,
    priceBlock: true,
  },
  /**
   * A job of exactly one ticket. There is nothing to tell it apart FROM, so it
   * carries no copy bar and everything else — it has to serve as all three.
   * This is what the /kitchen browser view and the dev preview render.
   */
  all: {
    role: "all",
    labelZh: "",
    labelEn: "",
    linePrices: true,
    priceBlock: true,
  },
};

/**
 * Which roles a job of `total` copies prints, in order.
 *
 * N=3 is the configured case and its order is fixed by the kitchen: 廚房 / 袋 /
 * 收銀. Everything else degrades around it — kitchen always first, bag always
 * last, register filling the middle — so a change to TICKET_COPIES never
 * produces an unlabelled or misordered stack.
 */
export function defaultCopyRoles(total: number): TicketCopyRole[] {
  if (total <= 1) return ["all"];
  if (total === 2) return ["kitchen", "bag"];
  if (total === 3) return ["kitchen", "bag", "register"];
  return Array.from({ length: total }, (_, i) =>
    i === 0 ? "kitchen" : i === total - 1 ? "bag" : "register",
  );
}

/** Parse a configured role list, e.g. "kitchen,bag,register". Null if unusable. */
export function parseCopyRoles(value: string | null | undefined): TicketCopyRole[] | null {
  if (!value) return null;
  const roles = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (roles.length === 0) return null;
  // "all" is what a one-copy job resolves to on its own; naming it explicitly
  // in a multi-copy list would print two tickets nothing tells apart.
  const valid = roles.every(
    (r): r is TicketCopyRole => r === "kitchen" || r === "register" || r === "bag",
  );
  return valid ? (roles as TicketCopyRole[]) : null;
}

/** The profile for copy `index` of `total`, honouring a configured role list. */
export function copyProfile(
  index: number,
  total: number,
  roles?: TicketCopyRole[] | null,
): TicketCopyProfile {
  const plan = roles && roles.length === total ? roles : defaultCopyRoles(total);
  return TICKET_COPY_PROFILES[plan[index] ?? "all"];
}
