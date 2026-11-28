/**
 * The 飲品 DRINKS block on a real kitchen ticket, for the PR and docs:
 *   npx tsx --conditions=react-server scripts/beverages-sample.ts
 * Writes docs/beverages/ticket-kitchen.png and ticket-register.png.
 */
import { writeFile } from "node:fs/promises";
import { fixtureOrder } from "./fixtures/orders";
import { catalogMenu } from "../src/lib/menu/catalog";
import { composeOrder } from "../src/lib/orders/compose";
import { renderTicket } from "../src/lib/ticket/render";

const composed = composeOrder(
  catalogMenu(),
  [
    {
      itemId: "kung-pao-chicken",
      sizeId: "individual",
      modifierIds: ["rice-steamed"],
      quantity: 1,
    },
    {
      itemId: "american-beer",
      sizeId: "regular",
      modifierIds: [],
      quantity: 2,
    },
    {
      itemId: "mongolian-beef",
      sizeId: "individual",
      modifierIds: ["rice-fried"],
      quantity: 1,
    },
    {
      itemId: "hot-or-iced-tea",
      sizeId: "regular",
      modifierIds: ["tea-iced"],
      quantity: 1,
    },
    { itemId: "wonton-chips", sizeId: "regular", modifierIds: [], quantity: 1 },
    {
      itemId: "house-wine-glass",
      sizeId: "regular",
      modifierIds: ["wine-chardonnay"],
      quantity: 1,
    },
  ],
  { taxRateBps: 875, lunchAllowed: true, allowStaffOnly: true },
);
if (!composed.ok) throw new Error(composed.error);
const order = {
  ...fixtureOrder(),
  channel: "phone" as const,
  items: composed.lines,
  totals: composed.totals,
};
async function main(): Promise<void> {
  for (const [copy, name] of [
    [0, "kitchen"],
    [1, "register"],
  ] as const) {
    const png = await renderTicket(order, {
      timezone: "America/Los_Angeles",
      copies: 2,
      copyIndex: copy,
    } as never);
    await writeFile(`docs/beverages/ticket-${name}.png`, png);
    console.log(
      `docs/beverages/ticket-${name}.png ${(png.length / 1024).toFixed(1)} KB`,
    );
  }
}

void main();
