/**
 * The order fixtures every ticket script renders.
 *
 * Extracted from scripts/ticket-sample.ts so the layout assertions
 * (ticket:sample) and the paper-length report (ticket:heights) measure the
 * SAME orders. Two scripts with two sets of fixtures is how a height delta
 * ends up describing a ticket nobody asserted on.
 *
 * Lines are built through the real `resolveOrderLine` against the real
 * catalogue wherever possible, so these exercise the same override lookup and
 * integer-cent arithmetic production uses — a missing translation shows up
 * here first.
 */

import { resolveOrderLine } from "../../src/lib/orders/lines";
import type { MenuItem } from "../../src/lib/menu/types";
import type { Order, OrderLine } from "../../src/lib/orders/types";

/** Minimal MenuItem builder — mirrors the seed menu's shape. */
export function fixtureItem(
  over: Partial<MenuItem> & Pick<MenuItem, "id" | "nameEn">,
): MenuItem {
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
  // Matches "Kung Pao Chicken" in the catalogue -> 宮保雞丁
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
        // No override exists for this one — it prints English alone.
        { id: "mod-wok-hei", nameEn: "Extra Wok Hei Char", nameZh: null, priceCents: 0 },
      ],
    },
  ],
});

/** An invented dish, so the no-中文 path stays exercised after the import. */
const offMenuSpecial = fixtureItem({
  id: "off-menu-special",
  nameEn: "Off-Menu Chef Special",
  priceCents: 1995,
});

const mongolianBeef = fixtureItem({
  id: "mongolian-beef",
  // Matches "Mongolian Beef" -> 蒙古牛肉
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
    resolveOrderLine(offMenuSpecial, "regular", [], 1),
    resolveOrderLine(mongolianBeef, "regular", [], 3),
  ];
}

/** Sum the lines and apply the tenant's 7.75% so totals are always coherent. */
function totalsFor(lines: OrderLine[]) {
  const subtotalCents = lines.reduce((n, l) => n + l.lineCents, 0);
  const taxCents = Math.round((subtotalCents * 775) / 10000);
  return {
    subtotalCents,
    taxCents,
    tipCents: 0,
    totalCents: subtotalCents + taxCents,
  };
}

/**
 * The baseline ticket — the shape of the order that printed as A-001 with
 * three cut copies. Every paper-length delta is measured against this one.
 */
export function fixtureOrder(): Order {
  const lines = buildLines();

  return {
    id: 1,
    tenantId: "fixture",
    orderNumber: "A-017",
    businessDate: "2026-07-27",
    status: "QUEUED",
    idempotencyKey: "fixture-key",
    items: lines,
    totals: totalsFor(lines),
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

/** Every orderable item, flattened out of the real catalogue. */
async function catalogueItems(): Promise<MenuItem[]> {
  const { catalogMenu } = await import("../../src/lib/menu/catalog");
  return catalogMenu().categories.flatMap((c) => c.items);
}

/**
 * A twelve-line party-tray order, built from the REAL catalogue.
 *
 * This is the fixture that catches layout problems the small one hides: a tall
 * ticket, a mix of dishes, and every party tray the catalogue knows about.
 */
export async function longOrder(): Promise<Order> {
  const all = await catalogueItems();

  // Prefer real tray items so the size chip is exercised, then top up to 12.
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

  return {
    ...fixtureOrder(),
    orderNumber: "A-042",
    items: lines,
    totals: totalsFor(lines),
    customer: { name: "Party Of Twelve", phone: "+16195550188" },
  };
}

/**
 * THE EVERYDAY TICKET: four dishes, each at the size the cart defaults to.
 *
 * That default is "Individual" for any item the printed menu also prices as a
 * tray — which is most of the menu — so this is the order shape the old layout
 * was worst at: it printed a dedicated "單點 / Individual" row under every
 * single line, saying nothing the kitchen did not already assume. Nothing else
 * in this file exercises that, because the older fixtures reach for trays and
 * for items with no size choice at all.
 */
export async function typicalOrder(): Promise<Order> {
  const all = await catalogueItems();
  const byId = new Map(all.map((i) => [i.id, i]));

  const wanted: [string, number, string[]][] = [
    ["kung-pao-chicken", 1, []],
    ["beef-broccoli", 2, []],
    ["house-special-fried-rice", 1, []],
    ["chicken-vegetable-soup", 1, ["add-noodle"]],
  ];

  const lines = wanted.map(([id, qty, mods]) => {
    const item = byId.get(id);
    if (!item) throw new Error(`typical fixture: catalogue has no item "${id}"`);
    // Whatever the cart would pre-select: the first tier.
    const sizeId = item.sizes?.[0]?.id ?? "regular";
    return resolveOrderLine(item, sizeId, mods, qty);
  });

  return {
    ...fixtureOrder(),
    orderNumber: "A-001",
    items: lines,
    totals: totalsFor(lines),
    customer: { name: "Weeknight Pickup", phone: "+16195550101" },
  };
}

/**
 * One line per SIZE TIER the catalogue can produce.
 *
 * The size indicator is exception-based (individual prints nothing, everything
 * else prints a chip), so the only way to prove the exception list is to order
 * one of each: an implicit-regular item, an explicit individual, a party tray,
 * a cup, both duck weights, and a per-head family dinner.
 */
export async function mixedSizeOrder(): Promise<Order> {
  const all = await catalogueItems();
  const byId = new Map(all.map((i) => [i.id, i]));

  const wanted: [string, string][] = [
    ["egg-rolls", "regular"], // implicit single tier — prints no chip
    ["kung-pao-chicken", "individual"], // the default — prints no chip
    ["kung-pao-chicken", "party-tray"], // 【餐盤 TRAY】
    ["egg-drop-soup", "cup"], // 【杯裝 CUP】
    ["roasted-duck", "half"], // 【半隻 HALF】
    ["roasted-duck", "whole"], // 【全隻 WHOLE】
    ["combo-family-dinner-1", "people-4"], // 【四人 4 PEOPLE】
  ];

  const lines: OrderLine[] = [];
  for (const [id, sizeId] of wanted) {
    const item = byId.get(id);
    if (!item) throw new Error(`mixed-size fixture: catalogue has no item "${id}"`);
    lines.push(resolveOrderLine(item, sizeId, [], 1));
  }

  return {
    ...fixtureOrder(),
    orderNumber: "A-055",
    items: lines,
    totals: totalsFor(lines),
    customer: { name: "Every Size", phone: "+16195550155" },
  };
}

/**
 * One dish from EVERY category, including the combo sections.
 *
 * This is the fixture that proves the 中文 import end to end: if a category's
 * names were missed, or the glyph collector never saw a section, this order is
 * where the gap prints. Deliberately the widest ticket in the set.
 */
export async function breadthOrder(): Promise<Order> {
  const { catalogMenu } = await import("../../src/lib/menu/catalog");
  const categories = catalogMenu().categories;

  const lines = categories.map((category, index) => {
    // Rotate through each category so the pick is not always the first item.
    const item = category.items[index % category.items.length];
    const sizes = item.sizes ?? [];
    const sizeId = sizes.length > 0 ? sizes[index % sizes.length].id : "regular";
    // A required modifier group (the lunch entrée) must be satisfied.
    const required = item.modifierGroups
      .filter((g) => g.minRequired > 0)
      .map((g) => g.modifiers[index % g.modifiers.length].id);
    return resolveOrderLine(item, sizeId, required, 1);
  });

  return {
    ...fixtureOrder(),
    orderNumber: "A-100",
    items: lines,
    totals: totalsFor(lines),
    customer: { name: "Whole Menu", phone: "+16195550100" },
  };
}

/**
 * The wrapping torture fixture. Every string here is chosen to break a
 * hand-rolled wrapper in a different way:
 *   - a 52-character English item name, far past one line at 40px
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
    sizes: [
      { id: "individual", label: "Individual", priceCents: 2495 },
      { id: "party-tray", label: "Party Tray", priceCents: 9800 },
    ],
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

export function tortureOrder(): Order {
  const lines = [
    resolveOrderLine(
      tortureItems.longName,
      // A tray as well as a long name: the chip has to survive a wrapped name.
      "party-tray",
      ["mod-unbroken", "mod-mixed"],
      1,
      "Antidisestablishmentarianism — 請不要放味精 and absolutely no " +
        "Worcestershiresauceonanything at all, thank you very much indeed.",
    ),
    resolveOrderLine(tortureItems.unbroken, "regular", [], 2),
  ];
  return {
    ...fixtureOrder(),
    orderNumber: "A-999",
    items: lines,
    totals: totalsFor(lines),
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
export function sqlShapedOrder(): Order {
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
 *
 * ⚠️ Its stored totals are EMPTY on purpose, so its printed line totals do NOT
 * sum to its printed subtotal. That is the one fixture the totals-integrity
 * assertion cannot cover; see assertTotalsAddUp in ticket-sample.ts.
 */
export function malformedOrder(): Order {
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

export interface NamedOrder {
  name: string;
  order: Order;
  /** False when the stored totals are deliberately incoherent. */
  totalsCoherent: boolean;
}

/** Every fixture, in one list, for the scripts that walk all of them. */
export async function fixtureOrders(): Promise<NamedOrder[]> {
  return [
    { name: "typical (A-001 shape)", order: await typicalOrder(), totalsCoherent: true },
    { name: "baseline sample", order: fixtureOrder(), totalsCoherent: true },
    { name: "12-line party tray", order: await longOrder(), totalsCoherent: true },
    { name: "mixed sizes", order: await mixedSizeOrder(), totalsCoherent: true },
    { name: "full-menu breadth", order: await breadthOrder(), totalsCoherent: true },
    { name: "wrapping torture", order: tortureOrder(), totalsCoherent: true },
    { name: "sql-shaped", order: sqlShapedOrder(), totalsCoherent: true },
    { name: "malformed", order: malformedOrder(), totalsCoherent: false },
  ];
}
