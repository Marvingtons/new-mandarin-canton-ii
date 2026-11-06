import "server-only";

import { listPrinters, listRoutes, type PrinterView } from "@/lib/print/printers";
import { cloudPrntConfigured } from "@/lib/print/status";
import {
  worstHealth,
  type BoardPrinter,
  type BoardPrintersPayload,
} from "@/lib/print/printerPayload";
import type { OrderChannel, PrinterRole } from "@/lib/orders/types";

/** How recently an unassigned printer must have polled to be flagged. */
const UNASSIGNED_RECENT_SECONDS = 600;

/**
 * Health for the board, derived fresh on every board poll from locking reads.
 *
 * Derived rather than stored, because "offline" is not something a printer
 * ever tells us — it is the absence of it telling us anything, and that can
 * only be computed against the clock at read time.
 */
export async function boardPrinters(tenantId: string): Promise<BoardPrintersPayload> {
  const configured = cloudPrntConfigured();
  const [all, routes] = await Promise.all([listPrinters(tenantId), listRoutes(tenantId)]);
  return buildBoardPayload(all, routes, configured);
}

export function buildBoardPayload(
  all: PrinterView[],
  routes: Array<{ channel: OrderChannel; role: PrinterRole }>,
  configured: boolean,
): BoardPrintersPayload {
  const active = all.filter((p) => p.active && p.role !== null);
  const up = active.filter((p) => !p.down);

  const printers: BoardPrinter[] = active
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "takeout" ? -1 : 1))
    .map((p) => ({
      id: p.id,
      label: p.label,
      role: p.role as PrinterRole,
      health: p.health,
      secondsSinceSeen: p.secondsSinceSeen,
      statusCode: p.statusCode,
      down: p.down,
      coveredBy: p.down ? (up.find((o) => o.id !== p.id)?.label ?? null) : null,
    }));

  const health = active.length === 0 ? "unknown" : worstHealth(printers.map((p) => p.health));
  const lead = printers.find((p) => p.health === health) ?? printers[0];

  return {
    printer: {
      health,
      secondsSinceSeen: lead?.secondsSinceSeen ?? null,
      statusCode: lead?.statusCode ?? null,
      // Exactly the states in which nothing is printing for SOME channel. With
      // one printer this is the pre-011 value, unchanged.
      blocked: health === "paper-out" || health === "cover-open" || health === "offline",
      configured,
    },
    printers,
    routes: Object.fromEntries(routes.map((r) => [r.channel, r.role])),
    unassignedRecent: all.filter(
      (p) =>
        p.role === null &&
        p.secondsSinceSeen !== null &&
        p.secondsSinceSeen <= UNASSIGNED_RECENT_SECONDS,
    ).length,
  };
}
