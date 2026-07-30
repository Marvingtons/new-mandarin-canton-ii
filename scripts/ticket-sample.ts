/**
 * Render sample kitchen tickets to /tmp so the layout can be eyeballed with no
 * database, no Twilio account, and no printer.
 *
 *   npm run ticket:sample
 *
 * The fixtures deliberately cover the cases that break ticket layouts:
 *   - an item WITH 中文 (the happy path)
 *   - an item with NO 中文, which must print English plus a loud ⚠ EN marker
 *   - an item with four modifiers, one of which has no 中文
 *   - a three-line special instruction
 *   - a TWELVE-LINE party-tray order, the long-ticket case
 *   - a reprint header
 *   - a WRAPPING TORTURE order: a 40-char English name, a 20-char unbroken
 *     token, and a mixed CJK/Latin modifier — the cases a hand-rolled wrapper
 *     gets wrong. Every laid-out line is asserted against its column, so an
 *     overflow fails the script instead of being noticed on paper.
 *
 * Lines are built through the real `resolveOrderLine` against the real
 * catalogue, so this exercises the same override lookup and integer-cent
 * arithmetic production uses — a missing translation shows up here first.
 */

import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveOrderLine } from "../src/lib/orders/lines";
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
import type { MenuItem } from "../src/lib/menu/types";
import type { Order, OrderLine } from "../src/lib/orders/types";

const TIMEZONE = "America/Los_Angeles";

/** Minimal MenuItem builder — mirrors the seed menu's shape. */
function fixtureItem(over: Partial<MenuItem> & Pick<MenuItem, "id" | "nameEn">): MenuItem {
  return {
    nameZh: null,
    description: null,
    priceCents: 1995,
    categoryId: "fixtures",
    modifierGroups: [],
    spicy: false,
    vegetarian: false,
    chefSpecial: false,
    available: true,
    ...over,
  };
}

/** An item carrying a long, realistic modifier group. */
const kungPao = fixtureItem({
  id: "kung-pao-chicken",
  // Matches "Kung Pao Chicken" in menu-overrides -> 宮保雞丁
  nameEn: "Kung Pao Chicken",
  priceCents: 2250,
  sizes: [
    { id: "individual", label: "Individual", priceCents: 2250 },
    { id: "party-tray", label: "Party Tray", priceCents: 9000 },
  ],
  modifierGroups: [
    {
      id: "heat",
      nameEn: "Heat Level",
      nameZh: null,
      minRequired: 1,
      maxAllowed: 1,
      modifiers: [
        { id: "mod-extra-spicy", nameEn: "Extra Spicy", nameZh: null, priceCents: 0 },
        { id: "mod-mild", nameEn: "Mild Spicy", nameZh: null, priceCents: 0 },
      ],
    },
    {
      id: "adds",
      nameEn: "Add-ons",
      nameZh: null,
      minRequired: 0,
      maxAllowed: null,
      modifiers: [
        { id: "mod-no-peanuts", nameEn: "No Peanuts", nameZh: null, priceCents: 0 },
        { id: "mod-no-msg", nameEn: "No MSG", nameZh: null, priceCents: 0 },
        { id: "mod-sauce-side", nameEn: "Sauce on the Side", nameZh: null, priceCents: 0 },
        { id: "mod-add-shrimp", nameEn: "Add Shrimp", nameZh: null, priceCents: 450 },
        // No override exists for this one — it must print with the marker.
        { id: "mod-wok-hei", nameEn: "Extra Wok Hei Char", nameZh: null, priceCents: 0 },
      ],
    },
  ],
});

/** No override exists for this name — the missing-中文 case. */
const orangeChicken = fixtureItem({
  id: "orange-chicken",
  nameEn: "Orange Flavored Chicken",
  priceCents: 1995,
});

const mongolianBeef = fixtureItem({
  id: "mongolian-beef",
  // Matches "Mongolian Beef" -> 蒙古牛
  nameEn: "Mongolian Beef",
  priceCents: 2150,
});

function buildLines(): OrderLine[] {
  return [
    resolveOrderLine(
      kungPao,
      "party-tray",
      [
        "mod-extra-spicy",
        "mod-no-peanuts",
        "mod-no-msg",
        "mod-sauce-side",
        "mod-add-shrimp",
        "mod-wok-hei",
      ],
      2,
      // Three lines of instruction, the length that usually breaks a layout.
      "Customer is severely allergic to peanuts — please use a clean wok and " +
        "fresh oil. Pack the sauce separately in a lidded container. " +
        "Ring the phone number on arrival, do not knock.",
    ),
    resolveOrderLine(orangeChicken, "regular", [], 1),
    resolveOrderLine(mongolianBeef, "regular", [], 3),
  ];
}

function fixtureOrder(): Order {
  const lines = buildLines();
  const subtotalCents = lines.reduce((n, l) => n + l.lineCents, 0);
  const taxCents = Math.round((subtotalCents * 775) / 10000);

  return {
    id: 1,
    tenantId: "fixture",
    orderNumber: "A-017",
    businessDate: "2026-07-27",
    status: "QUEUED",
    idempotencyKey: "fixture-key",
    items: lines,
    totals: { subtotalCents, taxCents, tipCents: 0, totalCents: subtotalCents + taxCents },
    customer: { name: "Marvin W.", phone: "+16195550148" },
    phoneVerifiedAt: new Date("2026-07-27T01:00:00.000Z").toISOString(),
    pickupAt: new Date("2026-07-27T01:45:00.000Z").toISOString(),
    readyFrom: new Date("2026-07-27T01:45:00.000Z").toISOString(),
    readyTo: new Date("2026-07-27T01:50:00.000Z").toISOString(),
    printAttempts: 0,
    printedAt: null,
    lastPrintError: null,
    alertedAt: null,
    createdAt: new Date("2026-07-27T01:05:00.000Z").toISOString(),
    updatedAt: new Date("2026-07-27T01:05:00.000Z").toISOString(),
  };
}

/**
 * A twelve-line party-tray order, built from the REAL catalogue.
 *
 * This is the fixture that catches layout problems the small one hides: a tall
 * ticket, a mix of translated and untranslated dishes, and every party tray
 * the tray map actually knows about.
 */
async function longOrder(): Promise<Order> {
  const { catalogMenu } = await import("../src/lib/menu/catalog");
  const menu = catalogMenu();
  const all = menu.categories.flatMap((c) => c.items);

  // Prefer real tray items so the size line is exercised, then top up to 12.
  const trays = all.filter((i) => (i.sizes?.length ?? 0) > 1).slice(0, 8);
  const singles = all.filter((i) => (i.sizes?.length ?? 0) <= 1).slice(0, 12 - trays.length);
  const chosen = [...trays, ...singles].slice(0, 12);

  const lines = chosen.map((item, index) =>
    resolveOrderLine(
      item,
      (item.sizes?.length ?? 0) > 1 ? "party-tray" : "regular",
      [],
      (index % 3) + 1,
    ),
  );

  const subtotalCents = lines.reduce((n, l) => n + l.lineCents, 0);
  const taxCents = Math.round((subtotalCents * 775) / 10000);

  return {
    ...fixtureOrder(),
    orderNumber: "A-042",
    items: lines,
    totals: { subtotalCents, taxCents, tipCents: 0, totalCents: subtotalCents + taxCents },
    customer: { name: "Party Of Twelve", phone: "+16195550188" },
  };
}

/**
 * The wrapping torture fixture. Every string here is chosen to break a
 * hand-rolled wrapper in a different way:
 *   - a 40-character English item name, far past one line at 40px
 *   - a 20-character unbroken token, which cannot be split on a space and has
 *     to be shattered per character
 *   - a modifier that switches between CJK and Latin mid-string, where the
 *     break rule changes from per-character to per-word and back
 */
const tortureItems = {
  longName: fixtureItem({
    id: "torture-long-name",
    nameEn: "Twice Cooked Pork Belly With Preserved Mustard Greens",
    priceCents: 2495,
    modifierGroups: [
      {
        id: "torture-mods",
        nameEn: "Preparation",
        nameZh: null,
        minRequired: 0,
        maxAllowed: null,
        modifiers: [
          { id: "mod-unbroken", nameEn: "Supercalifragilistic", nameZh: null, priceCents: 0 },
          { id: "mod-mixed", nameEn: "加辣 extra spicy 走花生 no peanuts 汁另上", nameZh: null, priceCents: 0 },
        ],
      },
    ],
  }),
  unbroken: fixtureItem({
    id: "torture-unbroken",
    nameEn: "Pneumonoultramicroscopicsilicovolcanoconiosis",
    priceCents: 995,
  }),
};

function tortureOrder(): Order {
  const lines = [
    resolveOrderLine(
      tortureItems.longName,
      "regular",
      ["mod-unbroken", "mod-mixed"],
      1,
      "Antidisestablishmentarianism — 請不要放味精 and absolutely no " +
        "Worcestershiresauceonanything at all, thank you very much indeed.",
    ),
    resolveOrderLine(tortureItems.unbroken, "regular", [], 2),
  ];
  const subtotalCents = lines.reduce((n, l) => n + l.lineCents, 0);
  const taxCents = Math.round((subtotalCents * 775) / 10000);
  return {
    ...fixtureOrder(),
    orderNumber: "A-999",
    items: lines,
    totals: {
      subtotalCents,
      taxCents,
      tipCents: 0,
      totalCents: subtotalCents + taxCents,
    },
    customer: { name: "Bartholomew Featherstonehaugh", phone: "+16195550199" },
  };
}

/**
 * A row as a hand-written INSERT leaves it: every NOT NULL column present,
 * every OPTIONAL field of the jsonb payloads absent.
 *
 * This is the shape that took production down. `mapOrder` casts the jsonb
 * columns straight through, so an operator writing `items` by hand during an
 * incident produces exactly this: name, qty, price, and none of the fields the
 * layout iterates. An item without `nameEn` put undefined into the measurer and
 * threw "text is not iterable" — "A11 is not iterable" once minified.
 *
 * Deliberately built with `as unknown as Order` rather than a typed literal:
 * the type system is what is ABSENT on this path, so a fixture that satisfies
 * it would test nothing.
 */
function sqlShapedOrder(): Order {
  return {
    id: 996,
    tenantId: "fixture",
    orderNumber: "T-996",
    businessDate: "2026-07-30",
    status: "QUEUED",
    idempotencyKey: "manual-t996",
    // Only what a human types. No nameZh, no sizeLabelZh, no modifiers,
    // no specialInstructions.
    items: [
      {
        itemId: "kung-pao",
        nameEn: "Kung Pao Chicken",
        quantity: 2,
        sizeId: "regular",
        sizeLabel: "Regular",
        unitCents: 1495,
        lineCents: 2990,
      },
      // The worst case: an item with nothing but a price.
      { itemId: "mystery", lineCents: 500 },
    ],
    totals: { subtotalCents: 3490, taxCents: 270, tipCents: 0, totalCents: 3760 },
    customer: { name: "Walk In", phone: "+16195550100" },
    phoneVerifiedAt: new Date("2026-07-30T01:00:00.000Z").toISOString(),
    pickupAt: new Date("2026-07-30T01:45:00.000Z").toISOString(),
    readyFrom: null,
    readyTo: null,
    printAttempts: 0,
    printedAt: null,
    lastPrintError: null,
    alertedAt: null,
    createdAt: new Date("2026-07-30T01:05:00.000Z").toISOString(),
    updatedAt: new Date("2026-07-30T01:05:00.000Z").toISOString(),
  } as unknown as Order;
}

/**
 * The same idea taken further: the jsonb columns hold the WRONG TYPE, not just
 * missing keys. A jsonb column can hold an object where an array belongs, and a
 * TEXT column holding JSON comes back as a string — which is iterable, so it
 * would render one ticket line per character rather than failing loudly.
 */
function malformedOrder(): Order {
  const base = sqlShapedOrder() as unknown as Record<string, unknown>;
  return {
    ...base,
    orderNumber: "T-997",
    // object where an array belongs
    items: { 0: { itemId: "x", nameEn: "Object Not Array", quantity: 1, lineCents: 100 } },
    customer: {},
    totals: {},
  } as unknown as Order;
}

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

async function main(): Promise<void> {
  const order = fixtureOrder();
  const long = await longOrder();
  const torture = tortureOrder();

  const sqlShaped = sqlShapedOrder();
  const malformed = malformedOrder();

  await render("ticket-sample.png", order);
  await render("ticket-sample-reprint.png", order, true);
  await render("ticket-sample-long.png", long);
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
  await assertNoOverflow("ticket-sample-reprint", order, true);
  await assertNoOverflow("ticket-sample-long", long);
  await assertNoOverflow("ticket-sample-torture", torture);
  await assertNoOverflow("ticket-sample-sql-shaped", sqlShaped);
  await assertNoOverflow("ticket-sample-malformed", malformed);
  console.log("  all lines within their columns and inside 576px ✓");

  // Both job formats for every fixture, with the StarPRNT payload walked back
  // to pixels and diffed against the threshold that produced it.
  console.log("\njob formats (starprnt is what the printer gets):");
  await assertFormats("short ticket", order);
  await assertFormats("reprint", order);
  await assertFormats("12-line party tray", long);
  await assertFormats("wrapping torture", torture);
  await assertFormats("party tray, 2 copies", long, 2);
  await assertFormats("sql-shaped", sqlShaped);
  await assertFormats("malformed", malformed);
  console.log(`  all payloads inside Star's ${512}KB GET cap ✓`);

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

  // Report what the override lookup actually resolved, so a missing 中文 is
  // visible in the build log too and not only on the paper.
  console.log("\nresolved names (short ticket):");
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

  // How much of the real catalogue can print in 中文 today? This is the
  // translation backlog, stated as a number rather than left to be discovered
  // one ticket at a time.
  const { catalogMenu } = await import("../src/lib/menu/catalog");
  const items = catalogMenu().categories.flatMap((c) => c.items);
  const withZh = items.filter((i) => i.nameZh).length;
  console.log(
    `\ncatalogue coverage: ${withZh}/${items.length} items have 中文 ` +
      `(${Math.round((withZh / items.length) * 100)}%). The rest print English with ⚠ EN.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
