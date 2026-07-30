import { isInk } from "@/lib/ticket/png";

/**
 * StarPRNT command data for a 1-bit ticket raster.
 *
 * WHY THIS EXISTS. The TSP143IV answered every PNG we sent with 511, and Star
 * documents exactly what that means: "Data size limitation for print jobs"
 * (CloudPRNT Protocol Guide 2.5.2) states that for image/png and
 * image/vnd.star.png "the printer performs a conversion process on the
 * received data", and "depending on the printer's memory usage, the data
 * conversion process may fail. In this case, the printer returns 511."
 *
 * The file size was never the problem. 576 x 2161 truecolour is ~3.7MB once
 * decompressed, and a receipt printer does not have 3.7MB to spend on it. So
 * this stops asking the printer to decode anything: the ticket goes over as
 * StarPRNT commands with the bitmap already packed at 1 bit per dot, which is
 * ~152KB for the same ticket and needs no conversion step at all.
 *
 * ---------------------------------------------------------------------------
 * EVERY BYTE BELOW IS FROM A CITED SECTION. Nothing here is inferred.
 *
 * Source: "Line Thermal Printer StarPRNT Command Specifications" Rev. 4.01
 * (starasia.com/Download/Manual/starprnt_cm_en.pdf). This document covers the
 * TSP100IV series explicitly, which matters — the older "STAR Graphic Mode
 * Command Specifications" Rev. 2.32 describes a raster mode (ESC * r A, and
 * the `b n1 n2` line command) that reads like the obvious fit and IS NOT
 * SUPPORTED HERE. Rev. 4.01's raster compatibility table marks every ESC * r
 * command "-" for TSP100IV and "OK" only for StarLine emulation. Using them
 * would have failed on hardware for the third time.
 *
 *   ESC @                       1B 40                  Command initialization
 *   ESC GS S m xL xH yL yH n d  1B 1D 53 ...           Print raster graphics data
 *   ESC d n                     1B 64 n                Auto-cutter
 *
 * TSP100IV support was read from Rev. 4.01's per-model tables:
 *   - "Bit image Graphics": ESC K / ESC L / ESC k / ESC X / ESC GS S / ESC GS X
 *     -> TSP100IV = OK OK OK Spec.1 OK No. So ESC GS S is supported and the
 *     COMPRESSED variant ESC GS X is not; this file uses the uncompressed one.
 *   - "Cutter control": ESC d -> TSP100IV = OK.
 *
 * ⚠️ THE BUZZER CANNOT RIDE THIS PATH. Rev. 4.01's "External device drive"
 * table lists ESC BEL, BEL, FS, SUB, EM, ESC GS BEL, ESC GS EM DC1 and
 * ESC GS EM DC2, and TSP100IV is "No" for every one of them. There is no
 * command this printer accepts that pulses the DK port, so nothing is emitted
 * for it — a guessed byte sequence is exactly what this file exists to stop.
 * The CloudPRNT peripheral HEADERS do not cover it either: Star's media-type
 * appendix routes cut/drawer/buzzer through headers only for image/png,
 * image/vnd.star.png and text/plain, and through print data for the vnd.star
 * command formats. So choosing starprnt costs the buzzer on this model. See
 * peripheralHeaders() in lib/print/cloudprnt.ts, which still applies on the
 * PNG paths, and the note in the route where the choice is made.
 * ---------------------------------------------------------------------------
 */

/** ESC @ — command initialization (Rev. 4.01, "Command initialization"). */
const ESC_INIT = [0x1b, 0x40];

/**
 * ESC GS S — print raster graphics data (Rev. 4.01 §2.3.12, p.62).
 *
 *   m  = 1  one block, monochrome 2 tones, 1 bit per dot
 *   n  = 0  print colour black
 *   xL + xH*256 = horizontal data BYTES, and the spec caps this at 128
 *   yL + yH*256 = vertical dots, 1..65535
 *   k  = xbytes * ydots
 *
 * The spec's own example diagram labels the bits "Bit7 Bit6 ... Bit0" and
 * defines the two tones as "0 /1 (OFF/ON)". So: MSB first, and a set bit is a
 * dot that fires — ink. That is the OPPOSITE sense to our 1-bit PNG, where
 * colour type 0 makes 0 black and 1 white; packMono below takes the sense as
 * an argument rather than leaving two subtly different loops to drift apart.
 */
const ESC_GS_S = [0x1b, 0x1d, 0x53];

/** Largest horizontal byte count ESC GS S accepts (spec: <= 128). */
const MAX_ROW_BYTES = 128;

/**
 * Rows per ESC GS S block.
 *
 * Not a spec limit — the command takes up to 65535 rows and our tallest ticket
 * is 4401, so one block would be legal. It is banded because the bug being
 * fixed here is the printer running out of memory: each block is a complete
 * printable unit, so the firmware can rasterize and feed it and move on rather
 * than holding the whole ticket. 256 rows is 32mm of paper at 8 dots/mm and
 * 18KB of data at our width.
 */
const DEFAULT_BAND_ROWS = 256;

/** ESC d n — auto-cutter (Rev. 4.01, "Auto-cutter"). */
const ESC_CUT = [0x1b, 0x64];
/**
 * n = 2: "Paper is fed to cutting position, then a full cut."
 *
 * The spec's defined area accepts both the raw value and its ASCII digit
 * (0<=n<=3 and 48<=n<=51); the ASCII form is used because Star writes its own
 * examples that way and a printable byte is easier to see in a hex dump.
 */
const CUT_FEED_THEN_FULL = 0x32; // '2'

/**
 * Star's GET download ceiling for this printer class.
 *
 * "Data size limitation for print jobs": 512KB for printers other than
 * mC-Label3 and IFBD-HI01X/HI02X, which get 2MB. Exceed it and the printer
 * answers 521. Unlike the PNG height ceilings this is not something the
 * printer declares per-job — it is a documented property of the model, so it
 * is a constant here rather than something we wait to be told.
 */
export const MAX_JOB_BYTES = 512 * 1024;

/** Bytes of command framing around the raster, given a row count. */
function framingBytes(rows: number, bandRows: number): number {
  const bands = Math.ceil(rows / bandRows);
  // ESC @ (2) + ESC d n (3) + 9 per ESC GS S header.
  return 2 + 3 + bands * 9;
}

/**
 * The tallest raster that still fits in a single job at this width.
 *
 * Command data is not compressed, so unlike the PNG path the size is exactly
 * predictable: rows x ceil(width/8), plus framing. Feeding this to the same
 * splitter the PNG path uses turns the 512KB cap into a height ceiling, which
 * is the shape the rest of the pipeline already understands — and means a tall
 * ticket becomes two jobs rather than one 521.
 */
export function maxStarPrntRows(
  width: number,
  budgetBytes: number = MAX_JOB_BYTES,
  bandRows: number = DEFAULT_BAND_ROWS,
): number {
  const rowBytes = (width + 7) >> 3;
  // Framing depends on the answer, so solve once with an upper-bound estimate
  // and once more with the framing that estimate implies.
  let rows = Math.floor((budgetBytes - framingBytes(1, bandRows)) / rowBytes);
  rows = Math.floor((budgetBytes - framingBytes(rows, bandRows)) / rowBytes);
  return Math.max(1, rows);
}

/**
 * The ESC GS S blocks for one raster — no init, no cut.
 *
 * Split out so a multi-copy body and a single-copy body build their pixels
 * through exactly the same code, and only their framing differs.
 */
function rasterBlocks(
  rgba: Uint8Array,
  width: number,
  height: number,
  bandRowsOption?: number,
): Uint8Array {
  const expected = width * height * 4;
  if (rgba.length < expected) {
    throw new Error(
      `pixel buffer is ${rgba.length} bytes, expected ${expected} for ${width}x${height} RGBA`,
    );
  }
  const rowBytes = (width + 7) >> 3;
  if (rowBytes > MAX_ROW_BYTES) {
    throw new Error(
      `${width}px is ${rowBytes} bytes per row; ESC GS S accepts at most ` +
        `${MAX_ROW_BYTES} (${MAX_ROW_BYTES * 8} dots)`,
    );
  }
  const bandRows = Math.max(1, bandRowsOption ?? DEFAULT_BAND_ROWS);

  const blocks: Uint8Array[] = [];
  for (let top = 0; top < height; top += bandRows) {
    const rows = Math.min(bandRows, height - top);
    const block = new Uint8Array(ESC_GS_S.length + 6 + rowBytes * rows);
    let at = 0;
    block.set(ESC_GS_S, at);
    at += ESC_GS_S.length;
    block[at++] = 0x01; // m = 1 block, monochrome
    block[at++] = rowBytes & 0xff; // xL
    block[at++] = (rowBytes >> 8) & 0xff; // xH
    block[at++] = rows & 0xff; // yL
    block[at++] = (rows >> 8) & 0xff; // yH
    block[at++] = 0x00; // n = black
    for (let r = 0; r < rows; r++) {
      packRow(rgba, width, top + r, block, at, true);
      at += rowBytes;
    }
    blocks.push(block);
  }

  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

/* ------------------------------------------------ multi-copy composition -- */

/** ESC @ — start of job. */
export function starPrntInit(): Uint8Array {
  return Uint8Array.from(ESC_INIT);
}

/**
 * ESC d 2 — feed to the cutting position, then a full cut.
 *
 * This is the whole between-copies mechanism, and it needs no separate feed.
 * Rev. 4.01's Auto-cutter table for n=2: "Paper is fed to cutting position,
 * then a full cut" — the printer advances the paper far enough for the last
 * printed line to clear the cutter before firing, so there is no
 * minimum-feed constant to get wrong. The same entry adds "If there is print
 * data remaining in the line buffer, printing of line buffer is executed
 * prior to the operation described above", which is what guarantees a copy is
 * fully on paper before its cut rather than half-buffered into the next one.
 *
 * FULL, not partial: n=1 and n=3 are the partial variants, and a partial cut
 * leaves the copies joined by a spine. Three separable tickets is the point.
 */
export function starPrntCut(): Uint8Array {
  return Uint8Array.from([...ESC_CUT, CUT_FEED_THEN_FULL]);
}

/**
 * Compose several rasters into ONE job body, each followed by a full cut.
 *
 *   [ESC @] copy1 [ESC d 2] copy2 [ESC d 2] copy3 [ESC d 2]
 *
 * One body, not N jobs. The claim, the confirmation and the state machine all
 * stay per-ORDER; how many pieces of paper that produces is a property of the
 * bytes, which is the only place it belongs — N queue entries would mean N
 * chances to half-print an order.
 *
 * Cut after the LAST copy too, so the final ticket is separated from the roll
 * and staff take three loose tickets rather than two and a tail.
 */
export function encodeStarPrntCopies(
  rasters: { pixels: Uint8Array; width: number; height: number }[],
  options: { bandRows?: number } = {},
): Uint8Array {
  if (rasters.length === 0) throw new Error("no copies to encode");
  const parts: Uint8Array[] = [starPrntInit()];
  for (const r of rasters) {
    parts.push(rasterBlocks(r.pixels, r.width, r.height, options.bandRows));
    parts.push(starPrntCut());
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface StarPrntRasterOptions {
  /** Feed to the cutting position and full-cut at the end of the job. */
  cut?: boolean;
  /** Override the band height. Mainly so tests can force many blocks. */
  bandRows?: number;
}

/**
 * Pack one row of RGBA into 1 bit per pixel, MSB first.
 *
 * `setBitMeansInk` picks the convention: true for StarPRNT (a set bit fires a
 * dot), false for PNG colour type 0 (a set bit is white paper). Both callers
 * share this and `isInk`, so the two encodings cannot disagree about which
 * pixels are black — which is what makes the round-trip test meaningful.
 */
function packRow(
  rgba: Uint8Array,
  width: number,
  row: number,
  out: Uint8Array,
  at: number,
  setBitMeansInk: boolean,
): void {
  let src = row * width * 4;
  for (let x = 0; x < width; x++) {
    const ink = isInk(rgba[src], rgba[src + 1], rgba[src + 2], rgba[src + 3]);
    if (ink === setBitMeansInk) out[at + (x >> 3)] |= 0x80 >> (x & 7);
    src += 4;
  }
}

/**
 * Encode an RGBA raster as StarPRNT command data.
 *
 * The pixel pipeline upstream is untouched: this takes exactly the buffer
 * resvg produces and replaces only the final "wrap it in a container" stage.
 */
export function encodeStarPrntRaster(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: StarPrntRasterOptions = {},
): Uint8Array {
  const expected = width * height * 4;
  if (rgba.length < expected) {
    throw new Error(
      `pixel buffer is ${rgba.length} bytes, expected ${expected} for ${width}x${height} RGBA`,
    );
  }

  const rowBytes = (width + 7) >> 3;
  if (rowBytes > MAX_ROW_BYTES) {
    throw new Error(
      `${width}px is ${rowBytes} bytes per row; ESC GS S accepts at most ` +
        `${MAX_ROW_BYTES} (${MAX_ROW_BYTES * 8} dots)`,
    );
  }
  const bandRows = Math.max(1, options.bandRows ?? DEFAULT_BAND_ROWS);

  const parts: number[][] = [[...ESC_INIT]];
  const blocks: Uint8Array[] = [];

  for (let top = 0; top < height; top += bandRows) {
    const rows = Math.min(bandRows, height - top);
    const block = new Uint8Array(ESC_GS_S.length + 6 + rowBytes * rows);
    let at = 0;
    block.set(ESC_GS_S, at);
    at += ESC_GS_S.length;
    block[at++] = 0x01; // m = 1 block, monochrome
    block[at++] = rowBytes & 0xff; // xL
    block[at++] = (rowBytes >> 8) & 0xff; // xH
    block[at++] = rows & 0xff; // yL
    block[at++] = (rows >> 8) & 0xff; // yH
    block[at++] = 0x00; // n = black
    for (let r = 0; r < rows; r++) {
      packRow(rgba, width, top + r, block, at, true);
      at += rowBytes;
    }
    blocks.push(block);
  }

  if (options.cut !== false) parts.push([...ESC_CUT, CUT_FEED_THEN_FULL]);

  const head = Uint8Array.from(parts[0]);
  const tail = parts.length > 1 ? Uint8Array.from(parts[1]) : new Uint8Array(0);
  const total =
    head.length + blocks.reduce((n, b) => n + b.length, 0) + tail.length;

  const out = new Uint8Array(total);
  let at = 0;
  out.set(head, at);
  at += head.length;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  out.set(tail, at);
  return out;
}

/* --------------------------------------------------------------- decode -- */

export interface StarPrntRaster {
  width: number;
  height: number;
  /** One byte per pixel: 1 = ink. Row-major, width * height long. */
  pixels: Uint8Array;
  blocks: number;
  cut: boolean;
  /**
   * The payload split at its cut commands — one entry per physical ticket.
   *
   * This is what proves the copies are separated rather than stacked: a job
   * that produced one long strip decodes to a single entry however many copies
   * it drew, and three cut tickets decode to three.
   */
  copies: { height: number; pixels: Uint8Array }[];
}

/**
 * Walk a StarPRNT payload back to pixels.
 *
 * This is the inverse of the encoder and exists to be diffed against the
 * thresholded source — a packing bug that inverted a bit or transposed a row
 * would still produce a plausible-looking byte stream, and the printer is not
 * a fast way to find that out. Deliberately strict: anything it does not
 * recognise throws rather than being skipped, so a stray byte cannot pass.
 */
export function decodeStarPrntRaster(data: Uint8Array, width: number): StarPrntRaster {
  const rowBytes = (width + 7) >> 3;
  const rows: Uint8Array[] = [];
  const copies: { height: number; pixels: Uint8Array }[] = [];
  let copyStart = 0;
  let blocks = 0;
  let cut = false;
  let at = 0;

  const toPixels = (from: number, to: number) => {
    const h = to - from;
    const out = new Uint8Array(width * h);
    for (let y = 0; y < h; y++) {
      const row = rows[from + y];
      for (let x = 0; x < width; x++) {
        out[y * width + x] = (row[x >> 3] >> (7 - (x & 7))) & 1;
      }
    }
    return out;
  };

  const matches = (seq: number[], pos: number) =>
    seq.every((b, i) => data[pos + i] === b);

  while (at < data.length) {
    if (matches(ESC_INIT, at)) {
      at += ESC_INIT.length;
      continue;
    }
    if (matches(ESC_CUT, at)) {
      cut = true;
      // Everything drawn since the previous cut is one physical ticket.
      if (rows.length > copyStart) {
        copies.push({
          height: rows.length - copyStart,
          pixels: toPixels(copyStart, rows.length),
        });
        copyStart = rows.length;
      }
      at += ESC_CUT.length + 1; // command plus its n
      continue;
    }
    if (!matches(ESC_GS_S, at)) {
      throw new Error(`unrecognised byte 0x${data[at].toString(16)} at offset ${at}`);
    }
    at += ESC_GS_S.length;
    const m = data[at++];
    if (m !== 0x01) throw new Error(`ESC GS S m=${m}, expected 1`);
    const xBytes = data[at] | (data[at + 1] << 8);
    at += 2;
    const yDots = data[at] | (data[at + 1] << 8);
    at += 2;
    const n = data[at++];
    if (n !== 0x00) throw new Error(`ESC GS S n=${n}, expected 0`);
    if (xBytes !== rowBytes) {
      throw new Error(`block declares ${xBytes} bytes/row, expected ${rowBytes}`);
    }
    for (let r = 0; r < yDots; r++) {
      rows.push(data.subarray(at, at + xBytes));
      at += xBytes;
    }
    blocks++;
  }

  // A trailing copy with no cut after it — a strip, not a ticket.
  if (rows.length > copyStart) {
    copies.push({ height: rows.length - copyStart, pixels: toPixels(copyStart, rows.length) });
  }

  const height = rows.length;
  return { width, height, pixels: toPixels(0, height), blocks, cut, copies };
}

/** The source of truth the decode is diffed against: ink per pixel. */
export function thresholdToInk(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, src = 0; i < out.length; i++, src += 4) {
    out[i] = isInk(rgba[src], rgba[src + 1], rgba[src + 2], rgba[src + 3]) ? 1 : 0;
  }
  return out;
}
