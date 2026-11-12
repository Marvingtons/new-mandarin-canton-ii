import "server-only";

import { STATIONS } from "@/config/stations";
import { countQueuedOrders } from "@/lib/orders/repository";
import { readAllPrinterStatus } from "@/lib/print/healthStore";
import { configuredStations, stationCoverage } from "@/lib/print/printerIdentity";
import {
  derivePrinterHealth,
  type StationPrinterHealth,
} from "@/lib/print/printerStatus";

/**
 * Both printers, as the staff header strip shows them, derived fresh on every
 * board poll.
 *
 * Derived rather than stored, because "offline" is not something a printer
 * ever tells us: it is the absence of it telling us anything, and that can only
 * be computed against the clock at read time.
 *
 * Always one entry per station, in STATIONS order, so the strip never changes
 * shape: a printer that has never polled reads "unknown", not missing.
 *
 * A station with no MAC configured reads "not-set-up", whatever any printer is
 * doing: it has no printer of its own, so it cannot be offline, out of paper
 * or blocked, and it never counts as a failure. Its tickets print on the
 * covering printer, whose own chip carries that printer's health.
 */
export async function stationPrinterHealth(
  tenantId: string,
): Promise<StationPrinterHealth[]> {
  const coverage = stationCoverage();
  const configured = new Set(configuredStations());
  const [rows, ...queued] = await Promise.all([
    readAllPrinterStatus(tenantId),
    ...STATIONS.map((s) => countQueuedOrders(tenantId, [s])),
  ]);

  return STATIONS.map((station, i) => {
    const printedBy = coverage[station];
    if (!configured.has(station)) {
      return {
        station,
        configured: false,
        printedBy,
        health: "not-set-up",
        paperLow: false,
        secondsSinceSeen: null,
        statusCode: null,
        blocked: false,
        queued: queued[i],
      };
    }
    const row = rows[printedBy];
    const secondsSinceSeen = row
      ? Math.max(0, Math.round((Date.now() - Date.parse(row.lastSeenAt)) / 1000))
      : null;
    const health = derivePrinterHealth({
      secondsSinceSeen,
      paperOut: row?.paperOut ?? false,
      coverOpen: row?.coverOpen ?? false,
    });
    return {
      station,
      configured: true,
      printedBy,
      health,
      paperLow: health === "ok" && row?.paperLow === true,
      secondsSinceSeen,
      statusCode: row?.statusCode ?? null,
      blocked: health === "paper-out" || health === "cover-open" || health === "offline",
      queued: queued[i],
    };
  });
}
