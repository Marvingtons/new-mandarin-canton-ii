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

import { composeTicketSvg } from "../src/lib/ticket/render";
import { fixtureOrders } from "./fixtures/orders";

const TIMEZONE = "America/Los_Angeles";

/** 203 dpi. */
const PX_PER_MM = 8;

async function main(): Promise<void> {
  const fixtures = await fixtureOrders();
  const copies = 3;

  console.log(`per-copy composed height, ${copies}-copy job (203 dpi: ${PX_PER_MM}px ≈ 1mm)\n`);
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
    console.log(
      `  ${name.padEnd(26)} ` +
        heights.map((h) => `${String(h).padStart(5)}px`).join("  ") +
        `   total ${String(total).padStart(5)}px  (${(total / PX_PER_MM / 10).toFixed(1)} cm)`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
