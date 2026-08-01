/**
 * Paper length, per copy, in pixels.
 *
 *   npm run ticket:heights
 *
 * The layout engine reports its own composed height (see Canvas.toSvg), so a
 * change to the ticket can be measured in millimetres of roll rather than
 * argued about. 203 dpi vertical: 8 px ≈ 1 mm.
 *
 * Kept as its own script rather than folded into ticket:sample because it is
 * the ONLY number that answers "did this layout change cost or save paper",
 * and that question is asked once per layout revision, not on every run.
 */

import { composeTicketSvg, TICKET_WIDTH_PX } from "../src/lib/ticket/render";
import { maxStarPrntRows } from "../src/lib/ticket/starprnt";
import { fixtureOrders } from "./fixtures/orders";

const TIMEZONE = "America/Los_Angeles";

/** 203 dpi. */
const PX_PER_MM = 8;

async function main(): Promise<void> {
  const fixtures = await fixtureOrders();
  const copies = 3;

  /* THE CEILING IS REAL AND IT THROWS. A StarPRNT job is capped at 512 KB,
     which at this width is maxStarPrntRows() rows for ALL copies together.
     renderCutCopies() refuses an over-ceiling job outright ("reduce
     TICKET_COPIES") — unlike the single-copy path, which splits cleanly —
     so an order over the line does not print at all. It stays QUEUED and
     surfaces through the unprinted-order alert.

     This script used to only console.log, which meant the one number that
     answers "will this still print" was measured and then not checked.
     Anything at or above WARN_AT is reported; anything over the ceiling
     fails the run. */
  const ceiling = maxStarPrntRows(TICKET_WIDTH_PX);
  const WARN_AT = 0.85;

  console.log(`per-copy composed height, ${copies}-copy job (203 dpi: ${PX_PER_MM}px ≈ 1mm)`);
  console.log(`StarPRNT ceiling for ${copies} copies at ${TICKET_WIDTH_PX}px: ${ceiling}px\n`);

  const over: string[] = [];
  const near: string[] = [];

  for (const { name, order } of fixtures) {
    const heights: number[] = [];
    for (let copy = 0; copy < copies; copy++) {
      const { height } = await composeTicketSvg(order, {
        timezone: TIMEZONE,
        copies,
        copyIndex: copy,
      });
      heights.push(height);
    }
    const total = heights.reduce((a, b) => a + b, 0);
    const pct = total / ceiling;
    const flag = pct > 1 ? "  ✗ OVER CEILING" : pct >= WARN_AT ? "  ⚠ near ceiling" : "";
    if (pct > 1) over.push(`${name} (${total}px, ${Math.round(pct * 100)}%)`);
    else if (pct >= WARN_AT) near.push(`${name} (${Math.round(pct * 100)}%)`);
    console.log(
      `  ${name.padEnd(26)} ` +
        heights.map((h) => `${String(h).padStart(5)}px`).join("  ") +
        `   total ${String(total).padStart(5)}px  (${(total / PX_PER_MM / 10).toFixed(1)} cm)` +
        flag,
    );
  }

  if (near.length > 0) {
    console.log(`\n⚠ within ${Math.round((1 - WARN_AT) * 100)}% of the ceiling: ${near.join(", ")}`);
  }
  if (over.length > 0) {
    console.error(
      `\n✗ ${over.length} fixture(s) exceed the ${ceiling}px StarPRNT ceiling and would NOT print:\n` +
        over.map((o) => `    ${o}`).join("\n") +
        `\n\n  Levers, in order of cheapness:\n` +
        `    1. TICKET_COPIES is ${copies} (wrangler.jsonc). Dropping to 2 buys ~33%.\n` +
        `    2. Make renderCutCopies() split like the single-copy path already does.\n`,
    );
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
