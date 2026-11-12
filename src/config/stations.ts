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
