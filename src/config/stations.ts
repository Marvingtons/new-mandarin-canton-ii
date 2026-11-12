import type { OrderChannel } from "@/lib/orders/types";

/**
 * PRINT STATIONS: which printer an order's ticket comes out of.
 *
 * This file is the ONLY place the channel -> station rule lives. The order
 * write path, the CloudPRNT claim, the board, reprint and the owner texts all
 * read it from here. (Migration 011 repeats it once, to backfill rows written
 * before it existed; that copy never runs again.)
 *
 *   online  printer A, by the pass: orders customers place on the website.
 *   store   printer B, by the counter: everything staff enter on the POS
 *           (phone, walk-in, dine-in and dine-in add-ons).
 *
 * Both are the same Star TSP143IVUE on the same CloudPRNT firmware and print
 * the same ticket. A printer is told apart from the other by the MAC it sends
 * on every poll; which MAC is which station is deployment config
 * (CLOUDPRNT_PRINTER_MAC_ONLINE / CLOUDPRNT_PRINTER_MAC_STORE), read in
 * lib/print/printerIdentity.ts.
 *
 * Pure and client-safe: the staff UI imports the labels and the order of the
 * filter chips from here too.
 */

export const STATIONS = ["online", "store"] as const;

export type Station = (typeof STATIONS)[number];

export function isStation(value: unknown): value is Station {
  return typeof value === "string" && (STATIONS as readonly string[]).includes(value);
}

/** Where each order channel prints. Exhaustive: a new channel will not compile until it is placed. */
export const CHANNEL_STATION = {
  web: "online",
  phone: "store",
  walk_in: "store",
  dine_in: "store",
} as const satisfies Record<OrderChannel, Station>;

export function stationForChannel(channel: OrderChannel): Station {
  return CHANNEL_STATION[channel];
}

/**
 * The station in plain English, for the owner's text message. Staff screens
 * name stations through the kitchen dictionary (station.online /
 * station.store) in either language.
 */
export const STATION_LABEL: Record<Station, string> = {
  online: "Online",
  store: "Store",
};

/** The printer itself, named for the owner text and the strip's screen-reader label. */
export const STATION_PRINTER_NAME: Record<Station, string> = {
  online: "Online printer",
  store: "Store printer",
};

/** The other printer. Two stations, so each has exactly one. */
export const OTHER_STATION: Record<Station, Station> = {
  online: "store",
  store: "online",
};

/**
 * TIMED FAILOVER, behind PRINT_FAILOVER_AFTER_SECONDS.
 *
 * When a station's printer HAS a MAC configured but has not polled for this
 * many seconds, the other printer takes that station's new tickets: it claims
 * them as if they were its own, the order and the hand-over record the printer
 * that actually printed, and the ticket carries one extra header line,
 * REROUTED FROM ONLINE / REROUTED FROM STORE, with the Chinese beside it (see
 * TICKET_LABELS.reroutedFrom in lib/ticket/glyphs.ts). The owner
 * gets one text when it starts and one when the printer is back, never one
 * per ticket. Nothing about delivery changes: the same claim, R2 body,
 * starprnt bytes, confirm window and copies, on the other printer.
 *
 * Default 90: past the 60s at which the board calls a printer offline (a
 * dropped packet or a Wi-Fi roam never reroutes), short enough that a phone
 * order comes out within two minutes of the store printer losing power.
 * 0 disables failover: tickets wait for their own printer, as before.
 *
 * A station with no MAC configured is not failover: its tickets always print
 * on the other printer (lib/print/printerIdentity stationCoverage), and it is
 * "not set up", never offline.
 */
export const PRINT_FAILOVER_AFTER_SECONDS_DEFAULT = 90;

/** The configured window in seconds; 0 = failover off. Server-side only. */
export function printFailoverAfterSeconds(
  raw: string | undefined = process.env.PRINT_FAILOVER_AFTER_SECONDS,
): number {
  if (raw === undefined || raw.trim() === "") return PRINT_FAILOVER_AFTER_SECONDS_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(
      `[cloudprnt] PRINT_FAILOVER_AFTER_SECONDS=${JSON.stringify(raw)} is not a number of seconds; ` +
        `using ${PRINT_FAILOVER_AFTER_SECONDS_DEFAULT}.`,
    );
    return PRINT_FAILOVER_AFTER_SECONDS_DEFAULT;
  }
  return Math.floor(n);
}

/**
 * Which stations a live printer should cover right now, given how long each
 * other station's printer has been silent. Pure: the poll route and the board
 * strip both decide from this one rule.
 *
 *   - failover off (window 0): none;
 *   - only stations with a MAC configured (an unset station is coverage, not
 *     failover);
 *   - only a printer that HAS polled before and then went silent past the
 *     window: one that has never polled (just deployed, never plugged in) is
 *     "not connected", not failed over.
 */
export function failoverStations(input: {
  printer: Station;
  configured: readonly Station[];
  /** Seconds since each other station's printer last polled; absent = never. */
  silentSeconds: Partial<Record<Station, number>>;
  windowSeconds: number;
}): Station[] {
  if (input.windowSeconds <= 0) return [];
  if (!input.configured.includes(input.printer)) return [];
  return STATIONS.filter((s) => {
    if (s === input.printer || !input.configured.includes(s)) return false;
    const silent = input.silentSeconds[s];
    return silent !== undefined && silent > input.windowSeconds;
  });
}
