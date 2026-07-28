/**
 * Render sample kitchen tickets to /tmp so the layout can be eyeballed without
 * a Clover credential, a database, or a printer.
 *
 *   npm run ticket:sample
 *
 * The fixtures deliberately cover the cases that break ticket layouts:
 *   - an item WITH 中文 (the happy path)
 *   - an item with NO 中文, which must print English plus a loud marker
 *   - a long modifier list
 *   - a three-line special instruction
 *   - a reprint header
 *
 * Lines are built through the real `resolveOrderLine`, so this exercises the
 * same override lookup and integer-cent arithmetic production uses.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveOrderLine } from "../src/lib/orders/lines";
import { renderTicket } from "../src/lib/ticket/render";
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
    status: "PAID",
    idempotencyKey: "fixture-key",
    chargeId: "fixture-charge",
    items: lines,
    totals: { subtotalCents, taxCents, tipCents: 0, totalCents: subtotalCents + taxCents },
    customer: { name: "Marvin W.", phone: "(619) 555-0148" },
    pickupAt: new Date("2026-07-27T01:45:00.000Z").toISOString(),
    printAttempts: 0,
    lastPrintError: null,
    createdAt: new Date("2026-07-27T01:05:00.000Z").toISOString(),
    updatedAt: new Date("2026-07-27T01:05:00.000Z").toISOString(),
  };
}

async function main(): Promise<void> {
  const order = fixtureOrder();

  const variants: { name: string; reprint: boolean }[] = [
    { name: "ticket-sample.png", reprint: false },
    { name: "ticket-sample-reprint.png", reprint: true },
  ];

  for (const variant of variants) {
    const png = await renderTicket(order, {
      timezone: TIMEZONE,
      reprint: variant.reprint,
    });
    const out = join(tmpdir(), variant.name);
    await writeFile(out, png);

    // PNG header: bytes 16..24 are width and height, big-endian.
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    console.log(
      `${out}  ${(png.length / 1024).toFixed(1)} KB  ${width}x${height}px`,
    );
    if (png.length === 0) throw new Error(`${out} is empty`);
    if (width !== 576) throw new Error(`${out} is ${width}px wide, expected 576`);
  }

  // Report what the override lookup actually resolved, so a missing 中文 is
  // visible in the build log too and not only on the paper.
  console.log("\nresolved names:");
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
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
