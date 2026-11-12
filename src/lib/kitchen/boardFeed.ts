import "server-only";

import {
  OTHER_STATION,
  STATIONS,
  failoverStations,
  printFailoverAfterSeconds,
} from "@/config/stations";
import {
  listActiveOrders,
  readBoardPrinterInputs,
  readBoardVersion,
  type BoardPrinterInput,
} from "@/lib/orders/repository";
import type { Order } from "@/lib/orders/types";
import { configuredStations, stationCoverage } from "@/lib/print/printerIdentity";
import {
  OFFLINE_AFTER_SECONDS,
  derivePrinterHealth,
  type StationPrinterHealth,
} from "@/lib/print/printerStatus";
import { cloudPrntConfigured } from "@/lib/print/status";

/**
 * THE STAFF BOARD'S FEED, read-only from end to end.
 *
 * A tablet polls GET /api/kitchen/orders/version every 4 seconds: one
 * statement, and a 304 with no body when nothing has changed. Only when the
 * version moves does it fetch the full list, GET /api/kitchen/orders, which
 * answers 304 to the same ETag. Neither takes a lock or opens a transaction.
 *
 * The version is an ETag over everything the board response is built from:
 * today's open orders (count, newest updated_at, and the sum of every
 * updated_at, see readBoardVersion), both printers' visible state with the
 * two clock thresholds the strip changes at, and the printer configuration.
 * The full list reads the version FIRST and the data after it, so the data a
 * tablet holds is never older than the ETag it was handed with.
 */

/** Bump when the board response changes shape, so a 304 never pins an old one. */
const FEED_SHAPE = "b1";

export interface BoardVersion {
  /** The ETag, quoted: "b1-<hex>". */
  etag: string;
  openCount: number;
  maxUpdatedAt: string | null;
  /** The database clock at the read, ISO. Sent as X-Server-Time. */
  serverTime: string;
}

export async function boardVersion(tenantId: string, businessDate: string): Promise<BoardVersion> {
  const v = await readBoardVersion(tenantId, businessDate, {
    offlineAfterSeconds: OFFLINE_AFTER_SECONDS,
    failoverAfterSeconds: printFailoverAfterSeconds(),
  });
  const key = [
    FEED_SHAPE,
    businessDate,
    v.openCount,
    v.maxUpdatedAt ?? "-",
    v.updatedSum,
    v.printers ?? "-",
    cloudPrntConfigured() ? "prnt" : "no-prnt",
    configuredStations().join("+"),
  ].join("|");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  let hex = "";
  for (const b of digest.subarray(0, 12)) hex += b.toString(16).padStart(2, "0");
  return {
    etag: `"${FEED_SHAPE}-${hex}"`,
    openCount: v.openCount,
    maxUpdatedAt: v.maxUpdatedAt,
    serverTime: v.dbNow,
  };
}

export interface BoardData {
  orders: Order[];
  printers: StationPrinterHealth[];
  printersConfigured: boolean;
}

/** Today's open orders and both printers. Call AFTER boardVersion. */
export async function readBoardData(tenantId: string, businessDate: string): Promise<BoardData> {
  const [orders, inputs] = await Promise.all([
    listActiveOrders(tenantId, businessDate),
    readBoardPrinterInputs(tenantId),
  ]);
  return {
    orders,
    printers: printerStrip(inputs, Date.now()),
    // false = no CloudPRNT at all; the strip then says "no printer" rather
    // than "offline", because nothing is broken.
    printersConfigured: cloudPrntConfigured(),
  };
}

/**
 * Both printers as the header strip shows them. The same rules, in the same
 * order, as lib/print/boardPrinters.ts's stationPrinterHealth, from a
 * lock-free read; verify:board-poll checks the two agree on every state.
 *
 * Always one entry per station, in STATIONS order. A station with no MAC
 * configured reads "not-set-up" and follows the printer covering it.
 */
export function printerStrip(inputs: readonly BoardPrinterInput[], nowMs: number): StationPrinterHealth[] {
  const coverage = stationCoverage();
  const configured = new Set(configuredStations());
  const byStation = new Map(inputs.map((i) => [i.station, i]));
  const lastSeen = (s: (typeof STATIONS)[number]): string | null => byStation.get(s)?.lastSeenAt ?? null;

  const silent = (s: (typeof STATIONS)[number]): number | undefined => {
    const seen = lastSeen(s);
    return seen ? Math.max(0, (nowMs - Date.parse(seen)) / 1000) : undefined;
  };
  const windowSeconds = printFailoverAfterSeconds();

  return STATIONS.map((station) => {
    const queued = byStation.get(station)?.queued ?? 0;
    const printedBy = coverage[station];
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
        queued,
        failoverTo: null,
      };
    }
    const row = byStation.get(printedBy);
    const seen = row?.lastSeenAt ?? null;
    const secondsSinceSeen = seen ? Math.max(0, Math.round((nowMs - Date.parse(seen)) / 1000)) : null;
    const health = derivePrinterHealth({
      secondsSinceSeen,
      paperOut: seen ? row!.paperOut : false,
      coverOpen: seen ? row!.coverOpen : false,
    });
    return {
      station,
      configured: true,
      printedBy,
      health,
      paperLow: health === "ok" && seen !== null && row!.paperLow,
      secondsSinceSeen,
      statusCode: seen ? row!.statusCode : null,
      blocked: health === "paper-out" || health === "cover-open" || health === "offline",
      queued,
      failoverTo,
    };
  });
}

/* ---------------------------------------------------------------- HTTP -- */

/** The headers on every board answer: never cached, the version, the clock. */
export function boardHeaders(v: BoardVersion): Record<string, string> {
  return { "cache-control": "no-store", etag: v.etag, "x-server-time": v.serverTime };
}

/**
 * Does If-None-Match name this version? Weak comparison (RFC 9110 13.1.2):
 * Cloudflare turns a strong ETag weak when it compresses a body, so a tablet
 * may send back W/"b1-…".
 */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, "");
  const want = bare(etag);
  return ifNoneMatch.split(",").some((tag) => {
    const t = tag.trim();
    return t === "*" || bare(t) === want;
  });
}
