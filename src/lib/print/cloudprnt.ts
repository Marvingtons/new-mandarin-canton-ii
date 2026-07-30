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
 *  - THE GET NEVER IDENTIFIES THE JOB. It says only which PRINTER is calling
 *    (`mac=`), so the SERVER owns "which job is in flight" — that is why
 *    `currentPrintJob` exists.
 *  - THE DELETE IS DIFFERENT, and this file used to say otherwise. Star's
 *    job-confirmation spec sends `token=<job token>` "present if one was
 *    provided by the server in its POST response", and we always provide one
 *    (the order number). So a confirmation CAN be attributed exactly, and
 *    must be: without it, a DELETE arriving after the offer cap retired its
 *    job lands on whatever job is in flight NOW and marks the wrong order
 *    printed. Alongside `token` the DELETE carries `code`, and optionally
 *    `retry`, `skip` and `error` counts.
 *  - `code` IS "OK" ON SUCCESS. Star: on correct completion the client sends
 *    DELETE "with the code parameter set to OK"; a failure reports a printer
 *    status code, and a status not beginning with "2" means the print did not
 *    succeed. Both spellings therefore have to be accepted — see
 *    classifyResultCode, which an exact-match regex got wrong for "200 OK".
 *  - Only `statusCode` is guaranteed present in a poll body. Every other field
 *    may be absent OR null, and the two must behave identically.
 *  - `statusCode` is URL-ENCODED on the wire: the literal value is "200%20OK".
 *  - The printer picks the media type from the array we advertise and echoes
 *    its choice in the GET `type=` parameter. We advertise exactly one.
 */

/**
 * The media types we advertise, in preference order.
 *
 * PNG is printer-native — Star's own reference server streams the bytes
 * straight through and the firmware rasterizes. No conversion, and the 576px
 * ticket this repo already renders is exactly the right artifact.
 *
 * WHY BOTH, AND WHY vnd.star.png FIRST. The two carry identical bytes: Star's
 * extended type is a PNG, and its documentation describes the same 1-bit and
 * 24-bit variants. What differs is what the PRINTER tells US. Star ties the
 * `mono_len` / `24bpp_len` declarations to image/vnd.star.png, so a printer
 * offered only image/png has no reason to send them — which is exactly the
 * state this endpoint was in, and why the height gate below had never once
 * seen a number. Advertising the extended type first is what makes the printer
 * declare its limits; plain image/png stays as the fallback for firmware that
 * does not support the extended type, so nothing is lost if it declines.
 */
export const JOB_MEDIA_TYPE = "image/png";

/** Star's extended PNG type — the one that carries the height declarations. */
export const JOB_MEDIA_TYPE_STAR = "image/vnd.star.png";

/**
 * Printer-ready StarPRNT command data. THE PRIMARY PATH.
 *
 * Star's "Data size limitation for print jobs" is explicit that 511 comes from
 * the CONVERSION step both PNG types require, and that the conversion fails on
 * memory. This type skips it: the bitmap arrives already packed at 1 bit per
 * dot and the firmware prints it. Listed in the TSP100IV's supported media
 * types on Star's Content Media Types page.
 */
export const JOB_MEDIA_TYPE_STARPRNT = "application/vnd.star.starprnt";

/**
 * What we advertise, in our order of preference.
 *
 * starprnt first because it is the only one of the three that cannot hit the
 * 511 conversion failure. vnd.star.png second: still a conversion, but the
 * mono pathway, and it is the type that makes the printer declare mono_len.
 * Plain image/png last so the dev preview and any human-facing surface still
 * get something a browser can open.
 *
 * The printer picks; we serve what it names in the GET's `type` parameter.
 */
export const OFFERED_MEDIA_TYPES = [
  JOB_MEDIA_TYPE_STARPRNT,
  JOB_MEDIA_TYPE_STAR,
  JOB_MEDIA_TYPE,
];

/**
 * Which offered type is this GET asking for, if any?
 *
 * The printer echoes its choice in `type=`, and for the extended type that
 * value carries parameters — `image/vnd.star.png;mono_len=800;24bpp_len=200`.
 * Comparing the whole string against a bare media type would reject the very
 * request we asked for, so only the part before the first `;` is matched.
 *
 * Returns the canonical type to answer with, or null if we do not offer it.
 * An absent `type=` means the printer did not state a preference, which Star
 * permits — it gets our first choice.
 */
export function matchOfferedMediaType(requested: string | null | undefined): string | null {
  if (!requested) return JOB_MEDIA_TYPE_STAR;
  const base = requested.split(";")[0].trim().toLowerCase();
  return OFFERED_MEDIA_TYPES.find((t) => t === base) ?? null;
}

/*
 * The give-up thresholds moved to src/config/tenant.server.ts — printOfferCap()
 * and printRenderCap() — where their defaults are justified and an operator can
 * change them without a deploy. They were constants here when the only number
 * that mattered was "some". Then an order died at the ceiling with its own
 * confirmation already in flight, which made the ceiling a tuning decision.
 */

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
  /** Peripheral input echoes. Present only on models that have them. */
  barcodeReader?: unknown;
  keyboard?: unknown;
  display?: unknown;
  /** Anything this firmware sends that Star does not document. */
  [key: string]: unknown;
}

/** Everything Star's poll spec names. Used only to flag what it does NOT. */
const DOCUMENTED_POLL_FIELDS = new Set([
  "status",
  "printerMAC",
  "uniqueID",
  "statusCode",
  "jobToken",
  "printingInProgress",
  "clientAction",
  "barcodeReader",
  "keyboard",
  "display",
]);

/**
 * Print the whole poll body the first time a given SHAPE is seen.
 *
 * Keyed on the set of KEYS, not the values: `statusCode` and `jobToken` change
 * on every poll, so keying on content would put a line in the tail every few
 * seconds for the life of the deployment. Keying on shape means one line per
 * isolate boot, plus one the moment the printer starts sending a field it was
 * not sending before — which is the event actually worth seeing.
 *
 * WHY THIS EXISTS, given that the height limits are NOT here. Star's poll spec
 * documents ten fields and not one of them is a decoding capability; the
 * `mono_len` / `24bpp_len` declarations live on the job GET's query string
 * (see readPrinterLimits). This log is the empirical check on that reading: if
 * this firmware volunteers anything beyond the documented ten, the field name
 * and its value land in the tail rather than being silently dropped by a
 * parser that only looks for what it already expects.
 *
 * Nothing here is a secret. The credential is in the URL path, which is never
 * logged; the body carries printer identity and state only.
 */
let lastPollShape: string | null = null;

export function logPollBody(poll: CloudPrntPoll): void {
  const keys = Object.keys(poll).sort();
  const shape = keys.join(",");
  if (shape === lastPollShape) return;
  lastPollShape = shape;

  // Bounded: display/keyboard arrays are unbounded in principle and this is a
  // diagnostic, not an archive.
  let body: string;
  try {
    body = JSON.stringify(poll) ?? "null";
  } catch {
    body = "<unserializable>";
  }
  if (body.length > 2000) body = `${body.slice(0, 2000)}…<truncated>`;

  console.info(`[cloudprnt] poll body shape changed — ${body}`);

  const undocumented = keys.filter((k) => !DOCUMENTED_POLL_FIELDS.has(k));
  if (undocumented.length > 0) {
    console.info(
      `[cloudprnt] poll carries field(s) Star does not document: ${undocumented.join(", ")}. ` +
        "If any of these is a decoding capability, honour it in readPrinterLimits.",
    );
  }
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

/* ---------------------------------------------------- the job response -- */

/**
 * SHA-256 of a payload, lowercase hex.
 *
 * Logged at render so a download can be proved byte-identical from outside:
 * hash what curl pulled off the deployed route, compare it to this line. Any
 * transformation in between — compression, a re-encode, a truncated stream —
 * changes the hash, and nothing else in the system would have told us.
 */
export async function payloadHash(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body as unknown as BufferSource);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build a print-job response that reaches the printer byte for byte.
 *
 * The printer downloaded every PNG we ever sent and then failed on the
 * CONTENT (511/510). It answered the first StarPRNT job with 520 Download
 * failed — a different failure, before decoding, which points at the transfer
 * rather than the bytes. The two differ in exactly one respect that the
 * network can see: their media type. So this stops leaving anything about the
 * transfer to a default.
 *
 *  - The body is a freshly allocated, exactly sized Uint8Array. Never a
 *    string: a binary raster is not valid UTF-8, and any path that decodes
 *    and re-encodes it replaces every invalid sequence with U+FFFD and
 *    changes the length. The copy also guarantees the view is not a window
 *    into a larger pooled ArrayBuffer, which is how a Node Buffer can carry
 *    neighbouring bytes along with it.
 *  - `content-length` is the byteLength of exactly those bytes.
 *  - `cache-control: no-store, no-transform`. no-transform is the standard
 *    instruction that an intermediary must not alter the payload, and it is
 *    what Cloudflare documents for this: "If you do not want a particular
 *    response from your origin to be encoded with Brotli/Gzip when delivered
 *    to website visitors, you can disable this by including a
 *    `cache-control: no-transform` HTTP header in the response from your
 *    origin web server." A Compression Rule that matches will not modify a
 *    response carrying it either. The Worker IS the origin here, so this is
 *    the supported place to say it.
 *  - No `content-encoding` is ever set. It is not enough to avoid setting it;
 *    the assertion below fails loudly if a caller adds one through
 *    extraHeaders, because a header we cannot decode is precisely what a 520
 *    looks like from the printer's side.
 *
 * ⚠️ BUT COMPRESSION IS NOT WHAT BROKE THE STARPRNT DOWNLOAD. Measured against
 * a minimal worker under `wrangler dev`, asking with `Accept-Encoding: gzip,
 * br`, on a 60,000-byte body:
 *
 *   application/vnd.star.starprnt  -> no content-encoding, length intact
 *   image/png                      -> no content-encoding, length intact
 *   text/plain                     -> gzip, and content-length dropped
 *   text/plain + no-transform      -> STILL gzip
 *
 * So the runtime compresses by media type, ours is not one it compresses, and
 * no-transform does not govern that layer at all — it is Cloudflare's EDGE
 * that honours it, and Cloudflare's published compressible list does not
 * contain our type either. Two independent reasons the job body was never
 * being compressed.
 *
 * The headers here are therefore hardening, not the fix: they remove a class
 * of failure from consideration and cost nothing. The 520 has another cause,
 * and the sha256 logged beside every job is what will identify it — a hash
 * that matches end to end says the bytes were never the problem.
 */
export function jobResponse(
  body: Uint8Array,
  mediaType: string,
  extraHeaders: Record<string, string> = {},
): Response {
  for (const key of Object.keys(extraHeaders)) {
    if (key.toLowerCase() === "content-encoding") {
      throw new Error("a print job must never carry a content-encoding");
    }
  }
  // Exactly these bytes, in their own buffer.
  const exact = new Uint8Array(body);
  return new Response(exact, {
    headers: {
      ...extraHeaders,
      "content-type": mediaType,
      "content-length": String(exact.byteLength),
      "cache-control": "no-store, no-transform",
    },
  });
}

/* ------------------------------------------------- job confirmation ----- */

/** What a DELETE's `code` says about whether paper came out. */
export type ResultVerdict = "success" | "failure" | "absent";

/** Everything a DELETE tells us, parsed once so nothing is read twice. */
export interface PrintConfirmation {
  /** Exactly as it arrived, already percent-decoded by URLSearchParams. */
  code: string | null;
  verdict: ResultVerdict;
  /** Our own jobToken echoed back — the order number. */
  token: string | null;
  /** Diagnostics some models send; logged, never branched on. */
  retry: string | null;
  skip: string | null;
  errorCount: string | null;
}

/**
 * Read a result code the way Star actually writes it.
 *
 * The old test was `/^(200|0|ok)$/i` — an EXACT match, which is wrong for the
 * spelling Star uses everywhere else in this protocol. `statusCode` in the
 * poll body is the string "200 OK" (URL-encoded on the wire as "200%20OK"),
 * and firmware that reuses that formatting for the DELETE's `code` would have
 * been read as a FAILURE by the old test: a ticket that printed perfectly
 * would have been recorded as a print failure and the order left unprinted.
 *
 * The rule here is Star's own: "OK" means completed, and otherwise a status
 * beginning with "2" means the printer is fine. "0" is kept because the
 * previous implementation accepted it and some reference servers emit it.
 *
 * ABSENT is its own verdict rather than a silent success. Star documents the
 * code as set on completion, so its absence is unusual enough to say out loud,
 * even though we still treat it as a print (see confirmPrinted).
 */
export function classifyResultCode(code: string | null | undefined): ResultVerdict {
  if (code === null || code === undefined) return "absent";
  const value = code.trim();
  if (value === "") return "absent";
  if (/^ok$/i.test(value)) return "success";
  // "200", "200 OK", "201 Created" — the code, then a word boundary. "2000"
  // is not a status and must not pass.
  if (/^2\d{2}\b/.test(value)) return "success";
  if (value === "0") return "success";
  return "failure";
}

/** Parse a confirmation URL once. Every field is optional but `code`. */
export function readConfirmation(url: URL): PrintConfirmation {
  const code = url.searchParams.get("code");
  return {
    code,
    verdict: classifyResultCode(code),
    token: url.searchParams.get("token"),
    retry: url.searchParams.get("retry"),
    skip: url.searchParams.get("skip"),
    errorCount: url.searchParams.get("error"),
  };
}

/**
 * The confirmation as one log-safe string.
 *
 * The raw code is JSON-quoted so whitespace and emptiness are visible — the
 * whole reason this exists is that "200 OK" and "200" were indistinguishable
 * in the access log, which is where the A-003 mystery started.
 */
export function describeConfirmation(c: PrintConfirmation): string {
  const parts = [
    `code=${c.code === null ? "(absent)" : JSON.stringify(c.code)}`,
    `verdict=${c.verdict}`,
    `token=${c.token === null ? "(absent)" : JSON.stringify(c.token)}`,
  ];
  if (c.retry !== null) parts.push(`retry=${c.retry}`);
  if (c.skip !== null) parts.push(`skip=${c.skip}`);
  if (c.errorCount !== null) parts.push(`error=${c.errorCount}`);
  return parts.join(" ");
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
 * field — Star's poll spec names ten fields and none of them is one — so there
 * is nothing there for readPoll to capture. Parsing them here, on the GET, is
 * the only place they exist. logPollBody prints the real body anyway, so this
 * reading is checked against the hardware rather than merely asserted.
 *
 * THE OTHER HALF OF THE HANDSHAKE. Star ties these parameters to the
 * image/vnd.star.png media type, so a printer offered only plain image/png has
 * no reason to send them — and until we started advertising the extended type
 * (see OFFERED_MEDIA_TYPES) this parser could never have returned anything but
 * nulls. Advertising it is what makes the declaration arrive.
 *
 * They may still be absent: firmware that does not support the extended type
 * falls back to image/png and declares nothing. No declared limit means no
 * gate. We do not invent a constant.
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
      "[cloudprnt] printer declared no image height limit on this job GET. " +
        `We offer ${OFFERED_MEDIA_TYPES.join(" and ")}; the declaration only ` +
        `accompanies ${JOB_MEDIA_TYPE_STAR}, so this means the printer chose ` +
        `${JOB_MEDIA_TYPE} instead. No height gate is applied.`,
    );
  } else {
    console.info(`[cloudprnt] printer declares ${summary}`);
  }
}

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
/**
 * Say once, loudly, when the configured buzzer cannot fire on this job.
 *
 * Star routes peripheral control by media type: through these response headers
 * for image/png, image/vnd.star.png and text/plain, and through the PRINT DATA
 * for the vnd.star command formats. So on a starprnt job the headers below are
 * ignored — and the TSP100IV accepts no in-data command that would replace
 * them: StarPRNT Rev. 4.01's "External device drive" table marks ESC BEL, BEL,
 * FS, SUB, EM, ESC GS BEL, ESC GS EM DC1 and ESC GS EM DC2 all "No" for this
 * model.
 *
 * That is a real cost of the starprnt path and the operator should hear about
 * it rather than wonder why the kitchen went quiet. Module scope, so it is one
 * line per isolate rather than one per ticket.
 */
let buzzerWarned = false;

export function warnBuzzerUnavailable(mediaType: string): void {
  if (buzzerWarned) return;
  if (cloudPrntBuzzerMode() === "off") return;
  buzzerWarned = true;
  console.warn(
    `[cloudprnt] CLOUDPRNT_BUZZER is set, but this job is ${mediaType}: Star ` +
      "routes peripheral control through the print data for vnd.star formats, " +
      "and the TSP100IV supports no external-device-drive command to put there. " +
      "The buzzer will not sound on this path. It still works on the image/png " +
      "and image/vnd.star.png paths, where the control headers apply.",
  );
}

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
