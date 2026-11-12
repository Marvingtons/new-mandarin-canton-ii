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

/**
 * One spelling for a MAC, so the env var and the poll compare equal however
 * either was typed.
 *
 * WHAT THE PRINTER SENDS. The TSP143IVUE (CloudPRNT on the TSP100IV
 * firmware) names itself in two places: `printerMAC` in the JSON poll body,
 * and `mac=` in the query string of the job GET and the confirming DELETE.
 * Both carry the same colon-separated, lowercase hex, e.g. `00:11:62:55:24:d4`
 * (that is this restaurant's printer A, from its own polls; see
 * docs/PRINTER_FINAL_AUDIT.md). In the query string the colons arrive
 * percent-encoded (`00%3A11%3A62...`); URLSearchParams decodes them, but a
 * value can reach here still encoded, so it is decoded once more, safely.
 *
 * The rule: decode, strip colons, dashes, dots and whitespace, lowercase.
 * "00:11:62:AA:BB:CC", "00-11-62-aa-bb-cc", "001162AABBCC" and
 * " 00:11:62:aa:bb:cc " are one printer. Nothing else is stripped, so a value
 * that is not a MAC stays not-a-MAC and matches nothing (looksLikeMac).
 */
export function normalizeMac(mac: string | null | undefined): string | null {
  if (!mac) return null;
  let text = mac;
  if (text.includes("%")) {
    try {
      text = decodeURIComponent(text);
    } catch {
      /* not valid percent-encoding: compare it as typed */
    }
  }
  const out = text.replace(/[\s:.-]/g, "").toLowerCase();
  return out.length > 0 ? out : null;
}

/** Twelve hex digits once normalized: the shape of every Star MAC. */
export function looksLikeMac(mac: string | null | undefined): boolean {
  const n = normalizeMac(mac);
  return n !== null && /^[0-9a-f]{12}$/.test(n);
}

/**
 * The configuration problems worth a line in the log, as text. Pure, so the
 * verifier can read them; `warnPrinterMacConfigOnce` prints them.
 */
export function printerMacConfigWarnings(configured: Partial<Record<Station, string>>): string[] {
  const out: string[] = [];
  for (const station of STATIONS) {
    const value = configured[station];
    if (value === undefined || value.trim() === "") continue;
    if (!looksLikeMac(value)) {
      out.push(
        `CLOUDPRNT_PRINTER_MAC_${station.toUpperCase()} is ${JSON.stringify(value)}, which does not ` +
          "look like a MAC (12 hex digits, e.g. 00:11:62:55:24:d4). No printer will match it, so " +
          `the ${station} printer's polls will be ignored. Copy the MAC from the printer's self-test print.`,
      );
    }
  }
  if (STATIONS.every((s) => !configured[s] || configured[s]!.trim() === "")) {
    out.push(
      "no printer MAC is configured (CLOUDPRNT_PRINTER_MAC_ONLINE / _STORE): any printer is accepted " +
        "and prints both stations, both stations read \"Not set up\" on the board, and no printer " +
        "offline / paper / cover text is ever sent.",
    );
  }
  return out;
}

let macConfigChecked = false;

/**
 * Once per isolate, on the first printer lookup: Workers has no startup hook
 * that can see env, so "at startup" is the first request that needs it.
 */
function warnPrinterMacConfigOnce(configured: Partial<Record<Station, string>>): void {
  if (macConfigChecked) return;
  macConfigChecked = true;
  for (const line of printerMacConfigWarnings(configured)) console.warn(`[cloudprnt] ${line}`);
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

/**
 * The stations that have a printer MAC configured. Only these can be offline,
 * out of paper or alerted about; any other station is "not set up" and its
 * tickets print on the station that covers it (stationCoverage).
 */
export function configuredStations(
  configured: Partial<Record<Station, string>> = cloudPrntPrinterMacs(),
): Station[] {
  warnPrinterMacConfigOnce(configured);
  return STATIONS.filter((s) => normalizeMac(configured[s]) !== null);
}

/** The request's printer, against this deployment's configuration. */
export function printerIdentity(rawMac: string | null | undefined): PrinterIdentity | null {
  const configured = cloudPrntPrinterMacs();
  warnPrinterMacConfigOnce(configured);
  return resolvePrinterIdentity(rawMac, configured);
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
