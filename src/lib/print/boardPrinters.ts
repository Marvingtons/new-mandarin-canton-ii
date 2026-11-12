import "server-only";

import { OTHER_STATION, STATIONS, failoverStations, printFailoverAfterSeconds } from "@/config/stations";
import { countQueuedOrders } from "@/lib/orders/repository";
import { readAllPrinterStatus } from "@/lib/print/healthStore";
import { configuredStations, stationCoverage } from "@/lib/print/printerIdentity";
import {
  OFFLINE_AFTER_SECONDS,
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

  const silent = (s: (typeof STATIONS)[number]): number | undefined => {
    const row = rows[s];
    return row ? Math.max(0, (Date.now() - Date.parse(row.lastSeenAt)) / 1000) : undefined;
  };
  const windowSeconds = printFailoverAfterSeconds();

  return STATIONS.map((station, i) => {
    const printedBy = coverage[station];
    // The same rule the poll uses, seen from the other printer, which must
    // itself be alive to be taking anything.
    const other = OTHER_STATION[station];
    const otherSilent = silent(other);
    const thisSilent = silent(station);
    const failoverTo =
      otherSilent !== undefined &&
      otherSilent <= OFFLINE_AFTER_SECONDS &&
      failoverStations({
        printer: other,
        configured: [...configured],
        silentSeconds: thisSilent === undefined ? {} : { [station]: thisSilent },
        windowSeconds,
      }).includes(station)
        ? other
        : null;
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
        failoverTo: null,
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
      failoverTo,
    };
  });
}
