/**
 * Render sample kitchen tickets to /tmp so the layout can be eyeballed with no
 * database, no Twilio account, and no printer.
 *
 *   npm run ticket:sample
 *
 * The fixtures live in scripts/fixtures/orders.ts, shared with
 * `npm run ticket:heights`, and deliberately cover the cases that break ticket
 * layouts:
 *   - the baseline order: 中文 under every dish, a size chip, six modifiers,
 *     and a three-line special instruction
 *   - an off-menu item with NO 中文, which prints English alone and no marker
 *   - a TWELVE-LINE party-tray order, the long-ticket case
 *   - a MIXED-SIZE order — one line per size tier the catalogue can produce,
 *     which is the only way to prove an exception-based size chip
 *   - a FULL-MENU-BREADTH order, one dish from every category including the
 *     combos, which is where a missed 中文 import would print
 *   - a reprint header
 *   - a WRAPPING TORTURE order: a 52-char English name, a 20-char unbroken
 *     token, and a mixed CJK/Latin modifier — the cases a hand-rolled wrapper
 *     gets wrong. Every laid-out line is asserted against its column, so an
 *     overflow fails the script instead of being noticed on paper.
 *
 * Lines are built through the real `resolveOrderLine` against the real
 * catalogue, so this exercises the same lookup and integer-cent arithmetic
 * production uses — a missing translation shows up here first.
 */

import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  composeTicketSvg,
  rasterizeTicket,
  renderTicket,
  renderTicketJob,
  TICKET_WIDTH_PX,
} from "../src/lib/ticket/render";
import {
  decodeStarPrntRaster,
  encodeStarPrntRaster,
  maxStarPrntRows,
  thresholdToInk,
  MAX_JOB_BYTES,
} from "../src/lib/ticket/starprnt";
import { formatCents } from "../src/lib/money";
import type { Order } from "../src/lib/orders/types";
import {
  breadthOrder,
  fixtureOrder,
  longOrder,
  malformedOrder,
  mixedSizeOrder,
  sqlShapedOrder,
  tortureOrder,
  typicalOrder,
} from "./fixtures/orders";

const TIMEZONE = "America/Los_Angeles";

/** Ticket padding, so the assertion can work in page coordinates. */
const PAD = 20;

/**
 * Assert no laid-out line overflows.
 *
 * Two checks, because they can fail independently: a line wider than the
 * column it was wrapped into means the wrapper is broken, and a line whose
 * right edge passes the paper width means a column was positioned wrong.
 * Both would print as text running off the roll.
 */
async function assertNoOverflow(
  name: string,
  order: Order,
  reprint = false,
): Promise<number> {
  const { lines, height } = await composeTicketSvg(order, {
    timezone: TIMEZONE,
    reprint,
  });
  // Sub-pixel slack: widths are float sums of per-glyph advances.
  const EPS = 0.5;
  const bad: string[] = [];
  for (const line of lines) {
    if (line.width > line.column + EPS) {
      bad.push(
        `  column overflow: "${line.text}" is ${line.width.toFixed(1)}px in a ${line.column}px column`,
      );
    }
    const right = PAD + line.x + line.width;
    if (right > TICKET_WIDTH_PX + EPS) {
      bad.push(
        `  paper overflow: "${line.text}" ends at x=${right.toFixed(1)} (> ${TICKET_WIDTH_PX})`,
      );
    }
  }
  if (bad.length > 0) {
    throw new Error(`${name}: ${bad.length} overflowing line(s)\n${bad.join("\n")}`);
  }
  const widest = lines.reduce((m, l) => Math.max(m, PAD + l.x + l.width), 0);
  console.log(
    `  ${name.padEnd(34)} ${String(lines.length).padStart(3)} lines  ` +
      `widest right edge ${widest.toFixed(1)}px / ${TICKET_WIDTH_PX}  height ${height}px`,
  );
  return widest;
}

async function render(
  name: string,
  order: Order,
  reprint = false,
  copies = 1,
): Promise<void> {
  const png = await renderTicket(order, { timezone: TIMEZONE, reprint, copies });
  const out = join(tmpdir(), name);
  await writeFile(out, png);

  // Walked, not assumed: every chunk length and CRC is checked against an
  // independent CRC-32 here, so a bug in the encoder's own table cannot
  // validate itself.
  const info = walkPng(png);
  console.log(
    // `items` is deliberately not an array in some fixtures — that is the
    // point of them — so this log must not assume one either.
    `${out.padEnd(46)} ${(png.length / 1024).toFixed(1).padStart(7)} KB  ` +
      `${info.width}x${info.height}px  depth ${info.bitDepth} type ${info.colorType}  ` +
      `${Array.isArray(order.items) ? order.items.length : "non-array"} lines`,
  );
  if (png.length === 0) throw new Error(`${out} is empty`);
  assertStarPng(out, info);
  await assertDecodable(out, info);
}

/* ------------------------------------------------------------ PNG checks -- */

interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compression: number;
  filter: number;
  interlace: number;
  chunks: { type: string; length: number }[];
  bytes: number;
}

/** CRC-32, written out again here on purpose — see walkPng. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Walk the file chunk by chunk rather than trusting a summary.
 *
 * This is the check that catches a hand-rolled encoder writing a plausible
 * header over a malformed body: lengths must chain exactly from the signature
 * to IEND with no trailing bytes, and every CRC must match.
 */
function walkPng(png: Buffer): PngInfo {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (png[i] !== SIGNATURE[i]) throw new Error(`bad PNG signature at byte ${i}`);
  }

  const chunks: { type: string; length: number }[] = [];
  let at = 8;
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const end = at + 12 + length;
    if (end > png.length) throw new Error(`chunk ${type} runs past end of file`);
    const declared = png.readUInt32BE(at + 8 + length);
    const actual = crc32(png.subarray(at + 4, at + 8 + length));
    if (declared !== actual) {
      throw new Error(
        `chunk ${type} CRC is ${declared.toString(16)}, computed ${actual.toString(16)}`,
      );
    }
    chunks.push({ type, length });
    at = end;
    if (type === "IEND") break;
  }
  if (at !== png.length) throw new Error(`${png.length - at} trailing byte(s) after IEND`);

  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    bitDepth: png[24],
    colorType: png[25],
    compression: png[26],
    filter: png[27],
    interlace: png[28],
    chunks,
    bytes: png.length,
  };
}

/**
 * The properties the printer cares about.
 *
 * 1 bit per pixel, greyscale, non-interlaced, 576 wide — Star's first-named
 * image format on an 80mm roll. Three chunks and nothing else, so an embedded
 * decoder has fewer places to disagree with us.
 */
function assertStarPng(out: string, info: PngInfo): void {
  const fail = (why: string) => {
    throw new Error(`${out}: ${why}`);
  };
  if (info.width !== 576) fail(`is ${info.width}px wide, expected 576`);
  if (info.bitDepth !== 1) fail(`bit depth is ${info.bitDepth}, expected 1`);
  if (info.colorType !== 0) fail(`colour type is ${info.colorType}, expected 0 (greyscale)`);
  if (info.interlace !== 0) fail(`interlace is ${info.interlace}, expected 0`);
  if (info.compression !== 0) fail(`compression method is ${info.compression}, expected 0`);
  if (info.filter !== 0) fail(`filter method is ${info.filter}, expected 0`);
  const shape = info.chunks.map((c) => c.type).join(",");
  if (shape !== "IHDR,IDAT,IEND") fail(`chunks are ${shape}, expected IHDR,IDAT,IEND`);
}

/**
 * Split the tallest realistic job against a pretend ceiling and check the
 * pieces add up.
 *
 * The ceiling is invented HERE and only here — production takes it from the
 * printer's own mono_len and splits nothing without one. What this proves is
 * the arithmetic and the cut rule: every piece fits, the pieces tile the whole
 * ticket exactly with no row dropped or repeated, every cut lands on a row
 * with no ink in it, and each piece is independently a valid 1-bit PNG.
 */
async function assertSplitsCleanly(order: Order, ceiling: number): Promise<void> {
  const whole = await renderTicketJob(order, { timezone: TIMEZONE, copies: 2 }, { format: "png" });
  if (whole.segments !== 1) {
    throw new Error(`no ceiling should mean one piece, got ${whole.segments}`);
  }

  const pieces: { height: number; bytes: number }[] = [];
  let total = 0;
  for (let i = 0; ; i++) {
    const piece = await renderTicketJob(
      order,
      { timezone: TIMEZONE, copies: 2 },
      { format: "png", maxHeight: ceiling, segment: i },
    );
    if (piece.height > ceiling) {
      throw new Error(`piece ${i + 1} is ${piece.height}px, over the ${ceiling}px ceiling`);
    }
    const info = walkPng(piece.body);
    if (info.bitDepth !== 1 || info.colorType !== 0 || info.width !== 576) {
      throw new Error(`piece ${i + 1} is not a 576px 1-bit greyscale PNG`);
    }
    if (info.height !== piece.height) {
      throw new Error(`piece ${i + 1} header says ${info.height}px, expected ${piece.height}`);
    }
    // TICKET_DUMP_SPLITS=1 writes the pieces out so the cut edges can be
    // looked at. The arithmetic below proves they tile; only an eyeball
    // proves the tear falls in whitespace rather than through a descender.
    if (process.env.TICKET_DUMP_SPLITS) {
      await writeFile(
        join(tmpdir(), `ticket-split-${ceiling}-${i + 1}of${piece.segments}.png`),
        piece.body,
      );
    }
    pieces.push({ height: piece.height, bytes: piece.body.length });
    total += piece.height;
    if (i + 1 >= piece.segments) {
      if (total !== piece.totalHeight) {
        throw new Error(
          `pieces total ${total}px but the ticket is ${piece.totalHeight}px — ` +
            "rows were dropped or duplicated",
        );
      }
      break;
    }
  }

  console.log(
    `  ${whole.totalHeight}px ticket under a ${ceiling}px ceiling -> ` +
      `${pieces.length} pieces: ${pieces.map((p) => `${p.height}px`).join(" + ")} ✓`,
  );
}


/**
 * Encode a fixture both ways and prove the StarPRNT payload round-trips.
 *
 * The size table is the point of the exercise — 511 is a memory failure during
 * the printer's PNG conversion, so what matters is that the command path never
 * asks it to convert anything and stays inside the 512KB GET cap.
 *
 * The round trip is the correctness half: a packing bug that inverted a bit or
 * dropped a row would still produce a byte stream the printer accepts, and
 * paper is a slow way to discover that. So the payload is walked back to
 * pixels and diffed against the same threshold the encoder used.
 */
async function assertFormats(name: string, order: Order, copies = 1): Promise<void> {
  const opts = { timezone: TIMEZONE, copies };
  const star = await renderTicketJob(order, opts, { format: "starprnt" });
  const png = await renderTicketJob(order, opts, { format: "png" });

  const raster = decodeStarPrntRaster(star.body, TICKET_WIDTH_PX);
  if (raster.height !== star.height) {
    throw new Error(
      `${name}: payload decodes to ${raster.height} rows, expected ${star.height}`,
    );
  }
  if (!raster.cut) throw new Error(`${name}: payload carries no cut command`);

  // The same raster the encoder saw, thresholded the same way.
  const source = await rasterizeTicket(order, opts);
  let expected: Uint8Array;
  try {
    expected = thresholdToInk(source.pixels, source.width, source.height);
  } finally {
    source.free();
  }
  if (expected.length !== raster.pixels.length) {
    throw new Error(
      `${name}: ${raster.pixels.length} decoded pixels vs ${expected.length} source`,
    );
  }
  let mismatches = 0;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== raster.pixels[i]) mismatches++;
  }
  if (mismatches !== 0) {
    throw new Error(`${name}: ${mismatches} pixel(s) differ after round trip`);
  }

  const over = [star, png].filter((j) => j.body.length > MAX_JOB_BYTES);
  if (over.length > 0) {
    throw new Error(`${name}: ${over[0].format} payload exceeds the 512KB GET cap`);
  }

  // TICKET_DUMP_STARPRNT=1 writes each payload out with its sha256, which is
  // what an R2 upload needs: the object key ends in that hash, and the same
  // hash is what a download is checked against. See scripts/verify-job-wire.sh.
  if (process.env.TICKET_DUMP_STARPRNT) {
    const sha = createHash("sha256").update(star.body).digest("hex");
    const slug = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const out = join(tmpdir(), `starprnt-${slug}-${sha}.bin`);
    await writeFile(out, star.body);
    console.log(`    dumped ${out}`);
  }

  const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;
  console.log(
    `  ${name.padEnd(24)} ${String(star.height).padStart(5)}px  ` +
      `starprnt ${kb(star.body.length).padStart(8)} (${raster.blocks} blocks)  ` +
      `png ${kb(png.body.length).padStart(8)}  ` +
      `round-trip ${expected.length} px, 0 mismatches ✓`,
  );
}

const run = promisify(execFile);

/**
 * Second opinion from a decoder that is not ours.
 *
 * The chunk walk proves the file is self-consistent; it cannot prove the
 * pixels decode. ffprobe is an independent implementation, and `monob` is what
 * it calls a 1-bit greyscale raster — if it reports anything else, the packing
 * is wrong however well-formed the container is.
 */
async function assertDecodable(out: string, info: PngInfo): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await run("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,pix_fmt",
      "-of", "default=noprint_wrappers=1:nokey=1",
      out,
    ]));
  } catch (err) {
    // No ffprobe on this machine is a gap in the check, not a broken ticket.
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT/.test(message)) {
      console.warn("  ⚠ ffprobe not found — skipping the independent decode check");
      return;
    }
    throw new Error(`${out}: ffprobe could not decode it — ${message}`);
  }
  const [w, h, pixFmt] = stdout.trim().split(/\s+/);
  if (Number(w) !== info.width || Number(h) !== info.height) {
    throw new Error(
      `${out}: ffprobe reads ${w}x${h}, the header says ${info.width}x${info.height}`,
    );
  }
  if (pixFmt !== "monob") {
    throw new Error(`${out}: ffprobe decodes it as ${pixFmt}, expected monob (1-bit mono)`);
  }
}

/**
 * The ticket's arithmetic, checked against what it actually PRINTED.
 *
 * composeTicketSvg reports the money it drew, per copy — not the money the
 * order carries — so this catches a renderer that shows one number and sums a
 * different one. Two invariants, both of which a customer would notice:
 *
 *   1. the printed line totals sum EXACTLY to the printed subtotal
 *   2. printed subtotal + tax + tip is EXACTLY the printed total
 *
 * Integer cents throughout, so "exactly" means ===. A ticket whose column does
 * not add up is a dispute at the counter with the paper on the customer's side.
 *
 * The kitchen copy prints no money at all; it is checked for that instead.
 */
async function assertTotalsAddUp(
  name: string,
  order: Order,
  copies: number,
): Promise<void> {
  const { money } = await composeTicketSvg(order, { timezone: TIMEZONE, copies });
  if (money.length !== copies) {
    throw new Error(`${name}: composed ${money.length} copies, expected ${copies}`);
  }

  const shown: string[] = [];
  for (const copy of money) {
    if (copy.totals === null) {
      if (copy.lineCents.length > 0) {
        throw new Error(
          `${name} (${copy.role}): no totals block but ${copy.lineCents.length} line price(s) — ` +
            "a copy that shows prices must show what they add up to",
        );
      }
      shown.push(`${copy.role}: no money`);
      continue;
    }
    const { subtotal, tax, tip, total } = copy.totals;
    const sum = copy.lineCents.reduce((n, c) => n + c, 0);
    if (sum !== subtotal) {
      throw new Error(
        `${name} (${copy.role}): line totals sum to ${sum}c but the printed subtotal is ` +
          `${subtotal}c — the columns do not add up`,
      );
    }
    if (subtotal + tax + tip !== total) {
      throw new Error(
        `${name} (${copy.role}): ${subtotal} + ${tax} + ${tip} != ${total} — ` +
          "the printed total is not the sum of the printed parts",
      );
    }
    shown.push(`${copy.role}: ${copy.lineCents.length} lines = ${formatCents(subtotal)} → ${formatCents(total)}`);
  }
  console.log(`  ${name.padEnd(24)} ${shown.join("   ")} ✓`);
}

/**
 * Stored line totals really are qty × unit, in integer cents.
 *
 * The ticket prints `lineCents` — the number that was summed into the subtotal
 * — and this is what proves that number is the multiplication the layout spec
 * asks for rather than something that drifted. Catalogue-built orders only: a
 * hand-written incident row carries whatever an operator typed, which is the
 * whole point of those fixtures.
 */
function assertLinesAreQtyTimesUnit(name: string, order: Order): void {
  for (const line of order.items) {
    if (line.lineCents !== line.quantity * line.unitCents) {
      throw new Error(
        `${name}: "${line.nameEn}" stores ${line.lineCents}c but ` +
          `${line.quantity} × ${line.unitCents}c is ${line.quantity * line.unitCents}c`,
      );
    }
  }
}

async function main(): Promise<void> {
  const order = fixtureOrder();
  const typical = await typicalOrder();
  const long = await longOrder();
  const mixed = await mixedSizeOrder();
  const breadth = await breadthOrder();
  const torture = tortureOrder();

  const sqlShaped = sqlShapedOrder();
  const malformed = malformedOrder();

  await render("ticket-sample.png", order);
  await render("ticket-sample-typical.png", typical);
  await render("ticket-sample-reprint.png", order, true);
  await render("ticket-sample-long.png", long);
  await render("ticket-sample-mixed-sizes.png", mixed);
  await render("ticket-sample-breadth.png", breadth);
  await render("ticket-sample-torture.png", torture);
  // Worst case in production: the 12-line tray at the tenant default of two
  // copies, stacked into one job body with a tear line between them.
  const t0 = Date.now();
  await render("ticket-sample-long-2up.png", long, false, 2);
  console.log(`  (2-copy render took ${Date.now() - t0} ms)`);
  await render("ticket-sample-sql-shaped.png", sqlShaped);
  await render("ticket-sample-malformed.png", malformed);

  // Geometry is asserted, not eyeballed: nothing may exceed its column or run
  // off the 576px roll. This is the check that a hand-rolled wrapper needs and
  // a layout engine used to provide.
  console.log("\nwrapping assertions:");
  await assertNoOverflow("ticket-sample", order);
  await assertNoOverflow("ticket-sample-typical", typical);
  await assertNoOverflow("ticket-sample-reprint", order, true);
  await assertNoOverflow("ticket-sample-long", long);
  await assertNoOverflow("ticket-sample-mixed-sizes", mixed);
  await assertNoOverflow("ticket-sample-breadth", breadth);
  await assertNoOverflow("ticket-sample-torture", torture);
  await assertNoOverflow("ticket-sample-sql-shaped", sqlShaped);
  await assertNoOverflow("ticket-sample-malformed", malformed);
  console.log("  all lines within their columns and inside 576px ✓");

  // THE COLUMNS ADD UP. Asserted against what the renderer printed, on every
  // copy profile, for every fixture whose stored totals are coherent.
  console.log("\ntotals integrity (3 copies: kitchen / bag / register):");
  for (const [name, o] of [
    ["baseline", order],
    ["typical", typical],
    ["12-line party tray", long],
    ["mixed sizes", mixed],
    ["full-menu breadth", breadth],
    ["wrapping torture", torture],
    ["sql-shaped", sqlShaped],
  ] as [string, Order][]) {
    await assertTotalsAddUp(name, o, 3);
  }
  for (const [name, o] of [
    ["baseline", order],
    ["typical", typical],
    ["12-line party tray", long],
    ["mixed sizes", mixed],
    ["full-menu breadth", breadth],
    ["wrapping torture", torture],
  ] as [string, Order][]) {
    assertLinesAreQtyTimesUnit(name, o);
  }
  console.log("  every printed line total is qty × unit, and every column sums ✓");
  // The malformed fixture stores `totals: {}` on purpose, so its printed
  // subtotal is 0 while its one line prints $1.00. That is faithful rendering
  // of an incoherent row, not a renderer bug — the assertion above would
  // (correctly) fail on it, so it is excluded and said so out loud.
  console.log(
    "  (malformed fixture excluded: its stored totals are empty by design, " +
      "so no renderer could make its column add up)",
  );

  // The three copy profiles, side by side, from ONE order. This is the picture
  // the layout change is about: the kitchen copy is the short one.
  console.log("\ncopy profiles (same order, one job):");
  for (let copy = 0; copy < 3; copy++) {
    const { height, money } = await composeTicketSvg(order, {
      timezone: TIMEZONE,
      copies: 3,
      copyIndex: copy,
    });
    const png = await renderTicket(order, {
      timezone: TIMEZONE,
      copies: 3,
      copyIndex: copy,
    });
    const out = join(tmpdir(), `ticket-sample-copy-${copy + 1}-${money[0].role}.png`);
    await writeFile(out, png);
    console.log(
      `  ${money[0].role.padEnd(9)} ${String(height).padStart(5)}px  ` +
        `${money[0].lineCents.length ? "line prices" : "no line prices"}, ` +
        `${money[0].totals ? "totals block" : "no totals block"}  ->  ${out}`,
    );
  }

  // Both job formats for every fixture, with the StarPRNT payload walked back
  // to pixels and diffed against the threshold that produced it.
  console.log("\njob formats (starprnt is what the printer gets):");
  await assertFormats("short ticket", order);
  await assertFormats("reprint", order);
  await assertFormats("12-line party tray", long);
  await assertFormats("mixed sizes", mixed);
  await assertFormats("full-menu breadth", breadth);
  await assertFormats("wrapping torture", torture);
  // Multi-copy is not checked here: a copies>1 starprnt job is now several
  // rasters with cuts between them, not one tall one, so it decodes to N
  // tickets and the single-raster diff below does not describe it. The
  // "three copies" section that follows is where that case is proven.
  await assertFormats("sql-shaped", sqlShaped);
  await assertFormats("malformed", malformed);
  console.log(`  all payloads inside Star's ${512}KB GET cap ✓`);

  // THREE INDIVIDUALLY CUT COPIES — the requirement is three loose tickets,
  // not one strip. Proven by decoding: the payload is split at its ESC d 2
  // commands, and a strip would decode to ONE entry however many copies it
  // drew. Each entry is then diffed against its own re-render, so a cut in the
  // wrong place shows up as a pixel mismatch rather than as a shrug.
  console.log("\nthree copies, each individually cut:");
  for (const [name, order] of [
    ["short ticket", await Promise.resolve(fixtureOrder())],
    ["12-line party tray", long],
  ] as [string, Order][]) {
    const job = await renderTicketJob(order, { timezone: TIMEZONE, copies: 3 }, {
      format: "starprnt",
    });
    const raster = decodeStarPrntRaster(job.body, TICKET_WIDTH_PX);
    if (raster.copies.length !== 3) {
      throw new Error(`${name}: decoded ${raster.copies.length} tickets, expected 3`);
    }
    if (!raster.cut) throw new Error(`${name}: no cut commands at all`);

    for (let i = 0; i < 3; i++) {
      const src = await rasterizeTicket(order, {
        timezone: TIMEZONE,
        copies: 3,
        copyIndex: i,
      });
      let expected: Uint8Array;
      try {
        expected = thresholdToInk(src.pixels, src.width, src.height);
      } finally {
        src.free();
      }
      const got = raster.copies[i];
      if (got.pixels.length !== expected.length) {
        throw new Error(
          `${name} copy ${i + 1}: ${got.pixels.length} px decoded vs ${expected.length}`,
        );
      }
      let bad = 0;
      for (let p = 0; p < expected.length; p++) if (expected[p] !== got.pixels[p]) bad++;
      if (bad !== 0) throw new Error(`${name} copy ${i + 1}: ${bad} pixel(s) differ`);
    }

    const heights = raster.copies.map((c) => c.height);
    if (job.body.length > MAX_JOB_BYTES) {
      throw new Error(`${name}: 3 copies is ${job.body.length}B, over the 512KB cap`);
    }
    console.log(
      `  ${name.padEnd(22)} 3 tickets ${heights.join(" + ")}px  ` +
        `${(job.body.length / 1024).toFixed(1)}KB total  ` +
        `${((job.body.length / MAX_JOB_BYTES) * 100).toFixed(0)}% of cap  ` +
        `all three match source ✓`,
    );
  }

  // The cap converted to a row count, and a job encoded right at it — this is
  // what stops a tall ticket becoming a 521 instead of a print.
  const capRows = maxStarPrntRows(TICKET_WIDTH_PX);
  const atCap = encodeStarPrntRaster(
    new Uint8Array(TICKET_WIDTH_PX * capRows * 4),
    TICKET_WIDTH_PX,
    capRows,
  );
  if (atCap.length > MAX_JOB_BYTES) {
    throw new Error(`${capRows} rows encodes to ${atCap.length}B, over the cap`);
  }
  const overCap = encodeStarPrntRaster(
    new Uint8Array(TICKET_WIDTH_PX * (capRows + 1) * 4),
    TICKET_WIDTH_PX,
    capRows + 1,
  );
  if (overCap.length <= MAX_JOB_BYTES) {
    throw new Error(`${capRows} is not the tightest row count under the cap`);
  }
  console.log(
    `  512KB cap = ${capRows} rows at 576px: ${capRows} rows -> ${atCap.length}B, ` +
      `${capRows + 1} -> ${overCap.length}B ✓`,
  );

  // The split path, which only runs in production when a printer declares a
  // ceiling this ticket exceeds. Three ceilings: one that lands between the
  // two copies, one well inside a single copy, and one tight enough to force
  // several cuts through the body of the ticket.
  console.log("\nheight-ceiling splits (2-copy worst case):");
  for (const ceiling of [2400, 1500, 900]) {
    await assertSplitsCleanly(long, ceiling);
  }

  // Report what the catalogue actually resolved, so a missing 中文 is visible
  // in the build log too and not only on the paper.
  console.log("\nresolved names (baseline ticket):");
  for (const line of order.items) {
    console.log(
      `  ${line.nameZh ?? "(no 中文)"} <- ${line.nameEn}` +
        (line.modifiers.length > 0
          ? `\n      mods: ${line.modifiers
              .map((m) => `${m.nameZh ?? "(no 中文)"}/${m.nameEn}`)
              .join(", ")}`
          : ""),
    );
  }

  // How much of the real catalogue can print in 中文? Anything short of 100%
  // is now a gap in the import rather than a translation backlog.
  const { catalogMenu } = await import("../src/lib/menu/catalog");
  const items = catalogMenu().categories.flatMap((c) => c.items);
  const withoutZh = items.filter((i) => !i.nameZh);
  console.log(
    `\ncatalogue coverage: ${items.length - withoutZh.length}/${items.length} items have 中文 ` +
      `(${Math.round(((items.length - withoutZh.length) / items.length) * 100)}%).`,
  );
  if (withoutZh.length > 0) {
    console.log(
      `  missing: ${withoutZh.map((i) => i.id).join(", ")} — these print English alone.`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
