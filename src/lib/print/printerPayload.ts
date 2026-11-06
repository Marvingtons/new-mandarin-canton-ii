/**
 * Printer health as the kitchen screens receive it (migration 011: one entry
 * per printer). TYPES AND PURE HELPERS ONLY: the client board imports this.
 */

import type { OrderChannel, PrinterRole } from "@/lib/orders/types";
import type { PrinterHealth } from "@/lib/print/printerStatus";

/** One active printer, as the board strip and banner draw it. */
export interface BoardPrinter {
  id: string;
  /** "外賣機 Takeout printer", or "Printer …24D4" when unnamed. */
  label: string;
  role: PrinterRole;
  health: PrinterHealth;
  secondsSinceSeen: number | null;
  statusCode: string | null;
  /**
   * DOWN by the routing rule (silent 60s and not printing, or paper-out /
   * cover-open for 60s): its new tickets go to another printer.
   */
  down: boolean;
  /** The printer carrying its tickets while it is down, or null if none is up. */
  coveredBy: string | null;
}

/** The single-printer summary the board has always received. */
export interface PrinterHealthPayload {
  health: PrinterHealth;
  /** Whole seconds since the last poll, or null if it has never polled. */
  secondsSinceSeen: number | null;
  /** The printer's own words, for the operator who wants the detail. */
  statusCode: string | null;
  /** True while jobs are being withheld — the board says "waiting", not "stuck". */
  blocked: boolean;
  /** False when no printer is configured at all; the strip then stays quiet. */
  configured: boolean;
}

export interface BoardPrintersPayload {
  /** The worst active printer, in the pre-011 shape. Kept for old clients. */
  printer: PrinterHealthPayload;
  /** Every ACTIVE printer, takeout first. */
  printers: BoardPrinter[];
  /** Which role each channel prints on. */
  routes: Partial<Record<OrderChannel, PrinterRole>>;
  /** Unassigned printers that polled in the last 10 minutes. */
  unassignedRecent: number;
}

/** Worst first: what the summary chip should say. */
const SEVERITY: Record<PrinterHealth, number> = {
  offline: 4,
  "paper-out": 3,
  "cover-open": 2,
  unknown: 1,
  ok: 0,
};

export function worstHealth(list: readonly PrinterHealth[]): PrinterHealth {
  return list.reduce<PrinterHealth>((w, h) => (SEVERITY[h] > SEVERITY[w] ? h : w), "ok");
}

/**
 * Is an order of this channel WAITING on a printer that cannot print it right
 * now, with nobody covering? That is when the card says "waiting, not lost".
 * With failover, a home printer that is down but covered is not waiting.
 */
export function channelWaiting(
  payload: Pick<BoardPrintersPayload, "printers" | "routes"> | null,
  channel: OrderChannel,
): boolean {
  if (!payload) return false;
  const role = payload.routes[channel];
  const home = payload.printers.find((p) => p.role === role);
  if (!home) return payload.printers.every((p) => p.health !== "ok");
  return home.health !== "ok" && home.coveredBy === null;
}
