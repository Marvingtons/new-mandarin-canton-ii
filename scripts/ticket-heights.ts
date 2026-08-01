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

  /* THE CEILING NO LONGER FAILS ANYTHING. A StarPRNT job is capped at
     512 KB, which at this width is maxStarPrntRows() rows — but that is a
     cap per JOB, and renderCutCopies() now sends a copy set too tall to
     travel at once as consecutive jobs instead of refusing it. There is no
     order this printer cannot be sent; verify:print-split asserts that,
     including a synthetic 40-line order at copies=3.

     So the number here has changed meaning. It is no longer "will this
     print" — it is "how much paper, and how many jobs". Over the ceiling
     is a plan with more than one segment, which is a cost worth seeing and
     not a failure. The warning threshold stays because crossing it is
     still the moment a single job becomes two. */
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
    const flag = pct > 1 ? "  → splits into multiple jobs" : pct >= WARN_AT ? "  ⚠ near one-job ceiling" : "";
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
    console.log(
      `\n${over.length} fixture(s) exceed what one ${ceiling}px job can carry and are sent ` +
        `as consecutive jobs:\n` +
        over.map((o) => `    ${o}`).join("\n") +
        `\n\n  This is normal. Run \`npm run verify:print-split\` for the segment plans.\n` +
        `  Dropping TICKET_COPIES (currently ${copies}) would reduce the job count,\n` +
        `  but is a paper decision now rather than a printing one.\n`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
