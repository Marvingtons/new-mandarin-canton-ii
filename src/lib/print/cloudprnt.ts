import "server-only";

import { timingSafeEqual } from "node:crypto";
import {
  cloudPrntBuzzerMode,
  cloudPrntPrinterMac,
  requireCloudPrntSecret,
} from "@/config/tenant.server";

/**
 * Star CloudPRNT protocol helpers.
 *
 * The direction of travel is the whole point of choosing CloudPRNT: the
 * PRINTER polls US. Nothing needs to reach into the restaurant's network,
 * there is no always-on PC running client software, and a router reboot fixes
 * itself. The cost is that the server is now a job queue with three verbs.
 *
 *   POST   — "do you have work?"  We answer with a small JSON status.
 *   GET    — "give me the job."   We return the ticket PNG.
 *   DELETE — "I printed it."      Only THIS marks an order PRINTED.
 *
 * That last point is load-bearing. A GET we never hear back about means the
 * paper may not have come out — printer jam, power cut, network drop mid-job.
 * Treating a GET as success would silently lose exactly the orders the
 * unprinted-order alert exists to catch.
 *
 * PROTOCOL FACTS THAT SHAPED THIS FILE (Star Protocol Guide 2.5.2 + Star's own
 * reference servers), several of which are counter-intuitive:
 *
 *  - THE PRINTER NEVER SENDS A JOB ID. GET and DELETE identify the job only by
 *    the printer (`mac=`). The SERVER owns "which job is in flight" — that is
 *    the entire state machine, and it is why `currentPrintJob` exists.
 *  - Only `statusCode` is guaranteed present in a poll body. Every other field
 *    may be absent OR null, and the two must behave identically.
 *  - `statusCode` is URL-ENCODED on the wire: the literal value is "200%20OK".
 *  - The printer picks the media type from the array we advertise and echoes
 *    its choice in the GET `type=` parameter. We advertise exactly one.
 */

/**
 * The single media type we advertise.
 *
 * PNG is printer-native — Star's own reference server streams the bytes
 * straight through and the firmware rasterizes. No conversion, and the 576px
 * ticket this repo already renders is exactly the right artifact.
 */
export const JOB_MEDIA_TYPE = "image/png";

/**
 * Re-offers of an unconfirmed job before we give up and mark it PRINT_FAILED.
 *
 * This counts POLLS, not paper. The printer polls every few seconds while it
 * has work outstanding, so ~10 unconfirmed offers is roughly a minute of a
 * printer that is reachable but not printing — jammed, out of paper, or
 * cover-open. At that point the kitchen board is the answer, not more retries.
 */
export const MAX_PRINT_ATTEMPTS = 10;

/**
 * Attempts at which a RENDER failure stops being treated as transient.
 *
 * A render failure is usually our bug, which is why this ceiling is low — the
 * point is only to survive a cold-start OOM or a resource blip, not to grind
 * against a template that cannot render. Shares the `print_attempts` counter
 * with the offer ceiling above (see recordRenderFailure), so in practice this
 * is about two render attempts before the order is condemned.
 */
export const MAX_RENDER_ATTEMPTS = 3;

/** Constant-time compare that does not leak length via early return. */
export function secretMatches(provided: string): boolean {
  let expected: string;
  try {
    expected = requireCloudPrntSecret();
  } catch {
    // Unconfigured means closed, not open.
    return false;
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * The JSON a Star printer POSTs when it polls.
 *
 * Every field is optional except `statusCode`, and Star states explicitly that
 * a field may be absent OR null. Modelled loosely on purpose: a missing field
 * must never be the reason a ticket does not print.
 */
export interface CloudPrntPoll {
  /** The only guaranteed field. URL-encoded, e.g. "200%20OK". */
  statusCode?: string | null;
  /** Star ASB hex string. Not decoded — statusCode is enough for v1. */
  status?: string | null;
  /** Stable identity: reported even over Wi-Fi when Ethernet exists. */
  printerMAC?: string | null;
  uniqueID?: string | null;
  jobToken?: string | null;
  printingInProgress?: boolean | null;
  clientAction?: unknown;
}

/**
 * The response shape the printer expects from a POST.
 *
 * `jobReady: false` is the overwhelmingly common answer — the printer polls
 * continuously and is idle almost all of the time.
 */
export interface CloudPrntStatusResponse {
  jobReady: boolean;
  /** Required whenever jobReady is true. */
  mediaTypes?: string[];
  jobToken?: string;
  deleteMethod?: "DELETE" | "GET";
}

/** The idle answer, as a constant so it is impossible to get subtly wrong. */
export const NO_JOB: CloudPrntStatusResponse = { jobReady: false };

/**
 * Does the printer report itself healthy?
 *
 * Star: a statusCode beginning "2" means online. The value arrives
 * URL-encoded, and some firmware pads it with a leading space, so it is
 * decoded and trimmed before the first character is read. Advisory only —
 * nothing is withheld from an unhealthy printer, because a printer that says
 * it has a problem is exactly the one we want to keep offering the job to.
 */
export function printerReportsHealthy(poll: CloudPrntPoll): boolean {
  if (!poll.statusCode) return true; // absent = assume fine
  let value = poll.statusCode;
  try {
    value = decodeURIComponent(value);
  } catch {
    /* not encoded, or malformed — use as-is */
  }
  return value.trimStart().startsWith("2");
}

/**
 * Is this the printer we expect?
 *
 * When CLOUDPRNT_PRINTER_MAC is unset we accept any caller that knows the
 * secret — the realistic setup before the hardware is in hand. Once the MAC is
 * pinned, a leaked URL alone is no longer enough to drain the job queue.
 *
 * Compared case- and separator-insensitively: MACs are reported variously as
 * `00:11:62:AA:BB:CC`, `00-11-62-aa-bb-cc`, or bare hex.
 */
export function printerMacAllowed(mac: string | null | undefined): boolean {
  const expected = cloudPrntPrinterMac();
  if (!expected) return true;
  if (!mac) return false;
  const normalize = (value: string) => value.replace(/[^0-9a-f]/gi, "").toLowerCase();
  return normalize(mac) === normalize(expected);
}

/**
 * Parse a poll body defensively.
 *
 * Star does not document the Content-Type the printer sends, and an empty body
 * is normal on some models. Refusing to parse is never worth a lost ticket, so
 * anything unreadable becomes an empty poll rather than a 400 — a 400 would
 * just make the printer retry forever.
 */
export async function readPoll(request: Request): Promise<CloudPrntPoll> {
  try {
    const text = await request.text();
    if (!text.trim()) return {};
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as CloudPrntPoll) : {};
  } catch {
    return {};
  }
}

/* ------------------------------------------- printer-declared limits ---- */

/**
 * The maximum image heights the printer says it can decode, in pixels.
 *
 * WHERE THESE ACTUALLY COME FROM — and it is not the poll body.
 *
 * Star's protocol guide puts them on the JOB GET's query string, not the POST
 * the printer polls with: "When a client provides the response when it makes a
 * GET request for a print job using the image/vnd.star.png media type, then it
 * should also supply the following query parameters", e.g.
 *
 *   ?type=image/vnd.star.png;mono_len=<length>;24bpp_len=<length>
 *
 * Nothing in the documented POST poll body carries a capability or limit
 * field, so there is nothing for readPoll to capture. Parsing them here, on
 * the GET, is the only place they exist.
 *
 * ⚠️ AND THEY WILL USUALLY BE ABSENT. Star ties these parameters to the
 * image/vnd.star.png media type; we advertise plain image/png
 * (JOB_MEDIA_TYPE), so a printer following the documentation has no reason to
 * send them. This parser is here so that the moment a real printer DOES
 * declare a limit we see it and can honour it — never so that a limit can be
 * assumed. No declared limit means no gate; we do not invent a constant.
 */
export interface PrinterLimits {
  /** Max height for 1-bit monochrome, in pixels. */
  monoLen: number | null;
  /** Max height for 24-bit colour, in pixels. */
  colorLen: number | null;
}

export const NO_LIMITS: PrinterLimits = { monoLen: null, colorLen: null };

function positiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Read the declared limits off a job-GET URL.
 *
 * Accepts them either as their own query parameters (`?mono_len=800`) or
 * embedded in the `type` parameter's media-type string
 * (`?type=image/vnd.star.png;mono_len=800`), because Star's example shows the
 * latter and firmware is not always literal about which form it uses.
 */
export function readPrinterLimits(url: URL): PrinterLimits {
  const direct = {
    monoLen: positiveInt(url.searchParams.get("mono_len")),
    colorLen: positiveInt(url.searchParams.get("24bpp_len")),
  };
  if (direct.monoLen !== null || direct.colorLen !== null) return direct;

  const type = url.searchParams.get("type");
  if (!type) return NO_LIMITS;
  const params = new Map<string, string>();
  for (const part of type.split(";").slice(1)) {
    const [k, v] = part.split("=");
    if (k && v) params.set(k.trim(), v.trim());
  }
  return {
    monoLen: positiveInt(params.get("mono_len")),
    colorLen: positiveInt(params.get("24bpp_len")),
  };
}

/**
 * Log a change in what the printer declares, not every poll.
 *
 * Module scope, so this is once per isolate boot and then only when the value
 * actually moves — a line every ten seconds for the life of the deployment
 * would bury everything else in the tail.
 */
let lastDeclared: string | null = null;

export function logPrinterLimits(limits: PrinterLimits): void {
  const summary = `mono_len=${limits.monoLen ?? "-"} 24bpp_len=${limits.colorLen ?? "-"}`;
  if (summary === lastDeclared) return;
  lastDeclared = summary;
  if (limits.monoLen === null && limits.colorLen === null) {
    console.info(
      "[cloudprnt] printer declares no image height limit " +
        `(expected: those parameters are documented for ${JOB_MEDIA_TYPE_STAR}, ` +
        `and we advertise ${JOB_MEDIA_TYPE}). No height gate is applied.`,
    );
  } else {
    console.info(`[cloudprnt] printer declares ${summary}`);
  }
}

/** Star's extended PNG media type — named only in the log above. */
const JOB_MEDIA_TYPE_STAR = "image/vnd.star.png";

/**
 * Peripheral-control headers for the job GET.
 *
 * THIS IS HOW THE BUZZER WORKS, and it is the part that was genuinely
 * uncertain going in. Star's Developer Guide is explicit: "When a print job
 * uses the Media type which is text/plain, image/png, image/jpeg, then the
 * server can set extra control options in the response header." The peripheral
 * command travels in the HTTP HEADERS, not the job body — which is precisely
 * why it works for PNG, a format that cannot carry device commands.
 *
 * So: no media-type change, no Star Document Markup, no raw StarPRNT. The PNG
 * we already render is the supported path.
 *
 * WHICH HEADER depends on how the buzzer is physically wired, and that is why
 * the env var is a MODE rather than a boolean:
 *
 *   drawer — X-Star-CashDrawer. The right one for a buzzer wired into the
 *            cash-drawer (DK) port, which is this restaurant's setup. Do NOT
 *            use it on a printer with an actual cash drawer attached, or the
 *            till pops on every ticket.
 *   buzzer — X-Star-Buzzerendpattern. For a printer with a built-in or
 *            dedicated-terminal buzzer.
 *   both   — send both. Useful for bench testing when the wiring is unknown.
 *
 * ⚠️ TODO(confirm): Star documents these headers and the underlying StarPRNT
 * commands separately, and never states which byte sequence the buzzer headers
 * actually emit. A DK-port buzzer responds to the drawer pulse, not the
 * dedicated buzzer terminal — which is why `drawer` is the documented default
 * for this wiring. BENCH TEST on the real unit before service, and check the
 * firmware from a self-test print: the headers need TSP100IV 1.0+,
 * mC-Print2/3 1.2+, or IFBD-HI01X/HI02X (Star's two guides disagree on the
 * exact IFBD minimum, 1.1.0 vs 1.3).
 *
 * Model support is firmware-gated, and an unsupported printer IGNORES an
 * unknown header rather than failing the job — so enabling this can waste a
 * buzz, never a ticket.
 */
export function peripheralHeaders(): Record<string, string> {
  const mode = cloudPrntBuzzerMode();
  const headers: Record<string, string> = {};

  if (mode === "buzzer" || mode === "both") {
    // 1–3; the value is the number of buzzes. "end" pattern = after printing,
    // so the sound means "a ticket is waiting", not "one is coming".
    headers["X-Star-Buzzerendpattern"] = "1";
  }
  if (mode === "drawer" || mode === "both") {
    headers["X-Star-CashDrawer"] = "end";
  }
  return headers;
}
