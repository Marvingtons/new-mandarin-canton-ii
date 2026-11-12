import "server-only";

import { STATIONS } from "@/config/stations";
import { countQueuedOrders } from "@/lib/orders/repository";
import { readAllPrinterStatus } from "@/lib/print/healthStore";
import { stationCoverage } from "@/lib/print/printerIdentity";
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
 */
export async function stationPrinterHealth(
  tenantId: string,
): Promise<StationPrinterHealth[]> {
  const coverage = stationCoverage();
  const [rows, ...queued] = await Promise.all([
    readAllPrinterStatus(tenantId),
    ...STATIONS.map((s) => countQueuedOrders(tenantId, [s])),
  ]);

  return STATIONS.map((station, i) => {
    const printedBy = coverage[station];
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
