/**
 * Prove PRINT_COMPACT_BLANK_ROWS is a byte change and never a paper change.
 *
 *   npm run verify:starprnt-compact
 *
 * For every fixture order, at the production copy count and at 3 copies, every
 * piece is rendered twice (full width, and blank rows as 1-byte blocks) and
 * both are decoded back to pixels with the strict decoder. They must agree
 * pixel for pixel, piece for piece and cut for cut, the plan must split at
 * the same places, and the compact job must be smaller. Synthetic rasters
 * cover the edges: no blank rows, all blank, and a blank run longer than a band.
 */

import { renderTicketJob } from "../src/lib/ticket/render";
import {
  decodeStarPrntRaster,
  encodeStarPrntCopies,
} from "../src/lib/ticket/starprnt";
import { TICKET_WIDTH_PX } from "../src/lib/ticket/render";
import { maxStarPrntRows } from "../src/lib/ticket/starprnt";
import { fixtureOrders } from "./fixtures/orders";

const TZ = "America/Los_Angeles";
const results: boolean[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push(ok);
  console.log(`   ${ok ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** RGBA where `ink(y)` rows have a dot at the left and right edge, others white. */
function raster(width: number, height: number, ink: (y: number) => boolean): Uint8Array {
  const px = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    if (!ink(y)) continue;
    for (const x of [0, width - 1]) {
      const i = (y * width + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }
  return px;
}

async function main(): Promise<void> {
  const maxHeight = maxStarPrntRows(TICKET_WIDTH_PX);
  let full = 0;
  let compact = 0;

  for (const copies of [2, 3]) {
    console.log(`\nfixtures at ${copies} copies`);
    for (const { name, order } of await fixtureOrders()) {
      const opts = { timezone: TZ, copies };
      const first = await renderTicketJob(order, opts, { format: "starprnt", maxHeight, segment: 0 });
      let same = true;
      let smaller = true;
      let segmentsAgree = true;
      let f = 0;
      let c = 0;
      for (let segment = 0; segment < first.segments; segment++) {
        const a = await renderTicketJob(order, opts, { format: "starprnt", maxHeight, segment });
        const b = await renderTicketJob(order, opts, { format: "starprnt", maxHeight, segment, compactBlankRows: true });
        const da = decodeStarPrntRaster(a.body, TICKET_WIDTH_PX);
        const db = decodeStarPrntRaster(b.body, TICKET_WIDTH_PX);
        segmentsAgree &&= a.segments === b.segments && a.height === b.height;
        same &&=
          da.height === db.height &&
          da.cut === db.cut &&
          da.copies.length === db.copies.length &&
          da.copies.every((cp, i) => cp.height === db.copies[i].height) &&
          equalBytes(da.pixels, db.pixels);
        smaller &&= b.body.length < a.body.length;
        f += a.body.length;
        c += b.body.length;
      }
      full += f;
      compact += c;
      check(`${name}: same pixels, pieces and cuts`, same && segmentsAgree, `${first.segments} piece(s)`);
      check(`${name}: fewer bytes`, smaller, `${f} -> ${c}, ${(100 - (100 * c) / f).toFixed(0)}% less`);
    }
  }

  console.log("\nsynthetic rasters");
  const W = TICKET_WIDTH_PX;
  const cases: [string, number, (y: number) => boolean][] = [
    ["no blank rows", 300, () => true],
    ["all blank", 300, () => false],
    ["a 700-row blank run (longer than a band)", 1000, (y) => y < 100 || y >= 800],
    ["alternating single rows", 513, (y) => y % 2 === 0],
  ];
  for (const [name, h, ink] of cases) {
    const px = raster(W, h, ink);
    const a = decodeStarPrntRaster(encodeStarPrntCopies([{ pixels: px, width: W, height: h }]), W);
    const bBody = encodeStarPrntCopies([{ pixels: px, width: W, height: h }], { compactBlankRows: true });
    const b = decodeStarPrntRaster(bBody, W);
    const fullLen = encodeStarPrntCopies([{ pixels: px, width: W, height: h }]).length;
    check(`${name}: identical pixels`, a.height === b.height && equalBytes(a.pixels, b.pixels), `${fullLen} -> ${bBody.length} bytes`);
    check(`${name}: never larger`, bBody.length <= fullLen);
  }

  // The decoder refuses ink in a narrow block: ESC GS S m=1 x=1 y=1 n=0, data 0x80.
  let refused = false;
  try {
    decodeStarPrntRaster(Uint8Array.from([0x1b, 0x40, 0x1b, 0x1d, 0x53, 1, 1, 0, 1, 0, 0, 0x80]), W);
  } catch {
    refused = true;
  }
  check("a 1-byte block carrying ink is refused by the decoder", refused);

  console.log(`\nall fixtures: ${full} -> ${compact} bytes, ${(100 - (100 * compact) / full).toFixed(1)}% less`);
  const failed = results.filter((r) => !r).length;
  console.log(`starprnt compact: ${results.length - failed}/${results.length} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
