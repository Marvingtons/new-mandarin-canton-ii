import "server-only";

import { cloudPrntPrinterMacs } from "@/config/tenant.server";
import { STATIONS, type Station } from "@/config/stations";

/**
 * WHO IS POLLING. Every CloudPRNT request names its printer by MAC (the poll
 * body's `printerMAC`, the `mac` query parameter on GET and DELETE); this turns
 * that into the station the printer IS and the stations it PRINTS FOR.
 *
 * Usually those are the same one station. They differ only while a station has
 * no printer configured: its tickets go to the other printer rather than
 * nowhere. That is what makes the two-printer code safe to deploy before
 * printer B is on the counter, and what keeps the store's tickets printing if
 * its MAC is ever unset to swap a unit.
 *
 *   both MACs set       online prints online, store prints store
 *   online only         online prints both (today's behaviour)
 *   store only          store prints both
 *   neither             any printer is accepted as online and prints both,
 *                       which is exactly what an unpinned printer always did
 *
 * Deliberately NOT failover. A configured printer that goes offline keeps its
 * tickets: they wait on the board, and the owner is texted with the station's
 * name. Moving a ticket to the other printer is a person's call, made with the
 * station picker on 重印.
 */

export interface PrinterIdentity {
  /** The printer this request came from; keys its printer_station_status row. */
  station: Station;
  /** Whose tickets it claims. Always includes `station`. */
  serves: Station[];
  /** Normalized MAC, or null when the request did not carry one. */
  mac: string | null;
}

/** Lowercase hex, separators stripped: "00:11:62:AA:BB:CC" and "001162aabbcc" are one printer. */
export function normalizeMac(mac: string | null | undefined): string | null {
  if (!mac) return null;
  const hex = mac.replace(/[^0-9a-f]/gi, "").toLowerCase();
  return hex.length > 0 ? hex : null;
}

/**
 * The pure rule, configuration passed in, so the verifier drives it without
 * touching env. Null = not one of ours: answer NO_JOB and record nothing.
 */
export function resolvePrinterIdentity(
  rawMac: string | null | undefined,
  configured: Partial<Record<Station, string>>,
): PrinterIdentity | null {
  const mac = normalizeMac(rawMac);
  const pinned = STATIONS.filter((s) => normalizeMac(configured[s]) !== null);

  if (pinned.length === 0) {
    return { station: "online", serves: [...STATIONS], mac };
  }

  if (mac === null) return null;
  const station = pinned.find((s) => normalizeMac(configured[s]) === mac);
  if (!station) return null;

  // Its own station first, then every station nobody else is configured for.
  const serves = [station, ...STATIONS.filter((s) => s !== station && !pinned.includes(s))];
  return { station, serves, mac };
}

/** The request's printer, against this deployment's configuration. */
export function printerIdentity(rawMac: string | null | undefined): PrinterIdentity | null {
  return resolvePrinterIdentity(rawMac, cloudPrntPrinterMacs());
}

/**
 * For each station, the station whose printer is printing its tickets: itself
 * when it has a printer configured, otherwise the one covering it. The board
 * uses this to say "printing on the Online printer" instead of "offline" for a
 * station that has no printer of its own yet.
 */
export function stationCoverage(
  configured: Partial<Record<Station, string>> = cloudPrntPrinterMacs(),
): Record<Station, Station> {
  const pinned = STATIONS.filter((s) => normalizeMac(configured[s]) !== null);
  const out = {} as Record<Station, Station>;
  for (const s of STATIONS) {
    if (pinned.length === 0) out[s] = "online";
    else out[s] = pinned.includes(s) ? s : pinned[0];
  }
  return out;
}
