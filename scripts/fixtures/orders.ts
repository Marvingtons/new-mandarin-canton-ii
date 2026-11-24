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

import { taxCents } from "../../src/lib/money";
import { resolveOrderLine } from "../../src/lib/orders/lines";
import { RICE_FRIED_ID } from "../../src/lib/menu/rice";
import { PREP_STEAMED_ID } from "../../src/lib/menu/preparation";
import type { MenuItem } from "../../src/lib/menu/types";
import type { Order, OrderChannel, OrderLine, OrderStatus } from "../../src/lib/orders/types";
import type { ReportBlocks, ReportOrderRow } from "../../src/lib/reports/dailyModel";
import type { Station } from "../../src/config/stations";
import { zonedWallClockToUtc } from "../../src/lib/orders/businessDate";
import { customOrderLine, surchargeModifier } from "../../src/lib/kitchen/customCharge";

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

/**
 * The tenant's rate, as a fixture reads it.
 *
 * These scripts render tickets without a tenant environment, so the rate is
 * stated here rather than resolved — but it is stated ONCE, and it goes
 * through the same taxCents() production uses, so a fixture can never disagree
 * with the app about how a rate becomes money. Keep in step with
 * TENANT_TAX_RATE_BPS in wrangler.jsonc.
 */
export const FIXTURE_TAX_RATE_BPS = 875;

/** Sum the lines and apply the tenant's 8.75% so totals are always coherent. */
function totalsFor(lines: OrderLine[]) {
  const subtotalCents = lines.reduce((n, l) => n + l.lineCents, 0);
  const tax = taxCents(subtotalCents, FIXTURE_TAX_RATE_BPS);
  return {
    subtotalCents,
    taxCents: tax,
    tipCents: 0,
    totalCents: subtotalCents + tax,
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
    offeredAt: null,
    printDeliveryId: null,
    printDeliveryExpiresAt: null,
    printedAt: null,
    lastPrintError: null,
    alertedAt: null,
    channel: "web",
    station: "online",
    reprintPending: false,
    reroutedFrom: null,
    paymentNote: null,
    staffNote: null,
    createdAt: new Date("2026-07-27T01:05:00.000Z").toISOString(),
    updatedAt: new Date("2026-07-27T01:05:00.000Z").toISOString(),
    revision: 0,
    editedAt: null,
    ticketRevision: null,
    changePending: false,
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

  // The Half/Whole size chip used to be proven by Roasted Duck, the
  // catalogue's only 半隻/全隻 item — removed from online ordering at owner
  // request (2026-08), so it no longer resolves from the catalogue. The
  // coverage that mattered was of the SIZE PAIR, not of that one dish, so a
  // synthetic two-weight item stands in and outlives any single menu change.
  // Its size labels still route through the real resolveSizeZh (半隻/全隻).
  const twoWeightRoast = fixtureItem({
    id: "fixture-two-weight-roast",
    nameEn: "Two-Weight Roast",
    priceCents: 2000,
    sizes: [
      { id: "half", label: "Half", priceCents: 2000 },
      { id: "whole", label: "Whole", priceCents: 3800 },
    ],
  });
  byId.set(twoWeightRoast.id, twoWeightRoast);

  const wanted: [string, string][] = [
    ["egg-rolls", "regular"], // implicit single tier — prints no chip
    ["kung-pao-chicken", "individual"], // the default — prints no chip
    ["kung-pao-chicken", "party-tray"], // 【餐盤 TRAY】
    ["egg-drop-soup", "cup"], // 【杯裝 CUP】
    ["fixture-two-weight-roast", "half"], // 【半隻 HALF】
    ["fixture-two-weight-roast", "whole"], // 【全隻 WHOLE】
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
 * The two rices, side by side, so the ticket has to keep them distinct.
 *
 * This is the fixture #116 exists for: a $3 STEAMED RICE SIDE and an ENTRÉE
 * whose included rice is FRIED. They must print differently and unmistakably —
 * the side's steamed choice IS the dish and rides the item line ("白飯 Steamed
 * Rice"), while the entrée's fried rice is a ● side beneath it ("● 炒飯 / Fried
 * Rice"). If the two ever collapsed into the same shape, a cook could bag the
 * wrong rice for either. verify:preparation renders this and asserts exactly
 * that separation; here it also lands in the shared fixture set so ticket:sample
 * and verify:orders exercise it too.
 */
export async function preparationOrder(): Promise<Order> {
  const all = await catalogueItems();
  const byId = new Map(all.map((i) => [i.id, i]));

  const side = byId.get("fried-steamed-rice");
  const entree = byId.get("mongolian-beef-special");
  if (!side || !entree) {
    throw new Error(
      "preparation fixture: catalogue is missing fried-steamed-rice or " +
        "mongolian-beef-special",
    );
  }

  const lines = [
    // $3 steamed rice side — the preparation IS the dish, prints on the item line.
    resolveOrderLine(side, "individual", [PREP_STEAMED_ID], 1),
    // An entrée whose included rice side is fried — prints as a ● bullet beneath.
    resolveOrderLine(entree, "individual", [RICE_FRIED_ID], 2),
  ];

  return {
    ...fixtureOrder(),
    orderNumber: "A-116",
    items: lines,
    totals: totalsFor(lines),
    customer: { name: "Two Rices", phone: "+16195550116" },
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
    // 3490 @ 875 bps = 305.375c -> 305c half-up.
    totals: { subtotalCents: 3490, taxCents: 305, tipCents: 0, totalCents: 3795 },
    customer: { name: "Walk In", phone: "+16195550100" },
    phoneVerifiedAt: new Date("2026-07-30T01:00:00.000Z").toISOString(),
    pickupAt: new Date("2026-07-30T01:45:00.000Z").toISOString(),
    readyFrom: null,
    readyTo: null,
    printAttempts: 0,
    printedAt: null,
    lastPrintError: null,
    alertedAt: null,
    channel: "web",
    paymentNote: null,
    staffNote: null,
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
    { name: "two rices (side + entrée)", order: await preparationOrder(), totalsCoherent: true },
    { name: "wrapping torture", order: tortureOrder(), totalsCoherent: true },
    { name: "sql-shaped", order: sqlShapedOrder(), totalsCoherent: true },
    { name: "malformed", order: malformedOrder(), totalsCoherent: false },
  ];
}

/**
 * A HISTORICAL dine-in row. Dine-in is retired, but rows from before remain
 * on the retired `dine_in` channel with the customer the POS gave a table
 * ("Table 4", no phone). Nothing creates one now; it must still render, as a
 * plain store ticket: the number, no table header, no 客人 line, no time.
 */
export function legacyDineInOrder(): Order {
  const base = fixtureOrder();
  return {
    ...base,
    id: 2,
    orderNumber: "B-021",
    channel: "dine_in",
    station: "store",
    customer: { name: "Table 4", phone: "" },
    items: base.items.slice(0, 3),
    totals: totalsFor(base.items.slice(0, 3)),
  };
}

/** A staff phone order: the number, the 電話訂單 tag, the customer up top. */
export function phoneTakeoutOrder(): Order {
  const base = fixtureOrder();
  return {
    ...base,
    id: 4,
    orderNumber: "B-022",
    channel: "phone",
    customer: { name: "Mrs. Chan", phone: "+16195550177" },
    items: base.items.slice(0, 3),
    totals: totalsFor(base.items.slice(0, 3)),
  };
}


/**
 * The owner's ticket: a two-line phone order with a note on both lines, the
 * order the 2026-11-20 type change was judged on. 陳皮雞 with fried rice and
 * 加辣, and two Beef with Broccoli with 一辣.
 */
export async function notesOrder(): Promise<Order> {
  const all = await catalogueItems();
  const byId = new Map(all.map((i) => [i.id, i]));
  const line = (id: string, qty: number, mods: string[], note: string) => {
    const item = byId.get(id);
    if (!item) throw new Error(`notes fixture: catalogue has no item "${id}"`);
    return resolveOrderLine(item, item.sizes?.[0]?.id ?? "regular", mods, qty, note);
  };
  const lines = [
    line("orange-flavored-chicken-special", 1, [RICE_FRIED_ID], "加辣"),
    line("beef-broccoli", 2, [], "一辣"),
  ];
  return {
    ...fixtureOrder(),
    orderNumber: "B-001",
    channel: "phone",
    station: "store",
    items: lines,
    totals: totalsFor(lines),
    customer: { name: "", phone: "+16195550101" },
  };
}

/* ===================================================== 日結 DAILY REPORT === */

/**
 * Whole business days of orders for `npm run report:sample`.
 *
 * Built the same way as the ticket fixtures: every dish line through the real
 * `resolveOrderLine` against the real catalogue, every total through the real
 * `taxCents`, custom charges through the POS's own customOrderLine and
 * surcharge builders. A seeded PRNG keeps each day identical run to run, so
 * the PNGs only change when the layout does.
 */

const REPORT_TZ = "America/Los_Angeles";

/** mulberry32: small, seeded, good enough to shuffle a fixture. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Best sellers lead the pick, so a TOP 10 looks like a real day's. */
const POPULAR: readonly [string, number][] = [
  ["honey-walnut-shrimp", 9],
  ["orange-flavored-chicken", 8],
  ["mongolian-beef", 7],
  ["kung-pao-chicken", 6],
  ["house-special-fried-rice", 6],
  ["beef-broccoli", 5],
  ["egg-rolls", 5],
  ["sweet-sour-pork", 4],
  ["house-soft-noodle", 4],
  ["salted-pepper-pork-chop", 3],
  ["mandarin-special", 3],
  ["hot-sour-soup", 3],
  ["fried-steamed-rice", 3],
  ["combo-lunch-15-75", 3],
];

export interface ReportFixtureDay {
  /** File name stem for the PNG. */
  slug: string;
  title: string;
  businessDate: string;
  rows: ReportOrderRow[];
  print: { printedAt: string; station: Station; sequence: number; blocks: ReportBlocks };
}

interface DaySpec {
  slug: string;
  title: string;
  businessDate: string;
  seed: number;
  orders: number;
  /** Probability a counted order is web / phone (the rest walk-in). */
  web: number;
  phone: number;
  trays: boolean;
  /** How many orders end CANCELLED, and how many are still QUEUED / PRINT_FAILED at print time. */
  cancelled: number;
  queued: number;
  failed: number;
  /** Local wall clock of the first and last order, "HH:MM". */
  open: string;
  close: string;
  /** Local wall clock of the print, on `printDate` (defaults to the business date). */
  printAt: string;
  printDate?: string;
  station: Station;
  sequence: number;
}

function at(date: string, hhmm: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return zonedWallClockToUtc(REPORT_TZ, y, m, d, h, min);
}

async function buildDay(spec: DaySpec): Promise<ReportFixtureDay> {
  const rand = seeded(spec.seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const all = await catalogueItems();
  const byId = new Map(all.map((i) => [i.id, i]));
  const family = all.filter((i) => i.id.startsWith("combo-family-") || i.id.startsWith("combo-big-family-"));
  const weighted = POPULAR.flatMap(([id, w]) => Array.from({ length: w }, () => id));

  const line = (itemId: string, sizeId: string, qty: number): OrderLine => {
    const item = byId.get(itemId);
    if (!item) throw new Error(`report fixture: catalogue has no item "${itemId}"`);
    const required = item.modifierGroups
      .filter((g) => g.minRequired > 0)
      .map((g) => g.modifiers[0].id);
    try {
      return resolveOrderLine(item, sizeId, required, qty);
    } catch {
      // A tray takes no rice: the size refuses the rice group.
      return resolveOrderLine(item, sizeId, [], qty);
    }
  };

  // Spread the orders over the day with a lunch and a dinner rush.
  const open = at(spec.businessDate, spec.open).getTime();
  const close = at(spec.businessDate, spec.close).getTime();
  const times: number[] = [];
  for (let i = 0; i < spec.orders; i++) {
    const r = rand();
    const peak = r < 0.35 ? 0.15 : r < 0.85 ? 0.68 : rand();
    const jitter = r < 0.85 ? (rand() - 0.5) * 0.22 : 0;
    const f = Math.min(1, Math.max(0, peak + jitter));
    times.push(open + f * (close - open));
  }
  times.sort((a, b) => a - b);
  if (times.length > 0) {
    times[0] = open;
    times[times.length - 1] = close;
  }

  // Which orders end cancelled / still unprinted: spread through the day for
  // cancellations, the very last ones for anything still unprinted.
  const status = (i: number): OrderStatus => {
    const n = spec.orders;
    if (i >= n - spec.queued) return "QUEUED";
    if (i >= n - spec.queued - spec.failed) return "PRINT_FAILED";
    const step = Math.floor(n / (spec.cancelled + 1));
    for (let k = 1; k <= spec.cancelled; k++) if (i === k * step) return "CANCELLED";
    return rand() < 0.7 ? "COMPLETED" : rand() < 0.5 ? "ACCEPTED" : "PRINTED";
  };

  const rows: ReportOrderRow[] = times.map((t, i) => {
    const r = rand();
    const channel: OrderChannel = r < spec.web ? "web" : r < spec.web + spec.phone ? "phone" : "walk_in";
    const lines: OrderLine[] = [];
    const count = 1 + Math.floor(rand() * rand() * 4);
    for (let k = 0; k < count; k++) {
      const roll = rand();
      if (spec.trays && roll < 0.05 && family.length > 0) {
        const item = pick(family);
        lines.push(line(item.id, item.sizes?.[Math.floor(rand() * 3)]?.id ?? "regular", 1));
        continue;
      }
      const itemId = rand() < 0.75 ? pick(weighted) : pick(all.filter((x) => !x.id.startsWith("combo-"))).id;
      const item = byId.get(itemId)!;
      const sizes = (item.sizes ?? []).map((s) => s.id);
      let sizeId = sizes[0] ?? "regular";
      if (spec.trays && sizes.includes("party-tray") && rand() < 0.07) sizeId = "party-tray";
      else if (spec.trays && sizes.includes("half-tray") && rand() < 0.06) sizeId = "half-tray";
      const qty = rand() < 0.75 ? 1 : rand() < 0.8 ? 2 : 3;
      lines.push(line(itemId, sizeId, qty));
    }
    // The POS's own money: a surcharge on a dish line, now and then a custom line.
    if (channel !== "web" && rand() < 0.1) {
      const target = lines[0];
      const mod = surchargeModifier({ amountCents: 300, label: "加蝦 Extra shrimp" });
      target.modifiers = [...target.modifiers, mod];
      target.unitCents += mod.priceCents;
      target.lineCents = target.unitCents * target.quantity;
    }
    if (channel !== "web" && rand() < 0.06) {
      lines.push(customOrderLine({ name: "加飯 Extra rice", amountCents: 200, quantity: 1 }));
    }
    return {
      channel,
      status: status(i),
      isAddon: false,
      items: lines,
      totals: totalsFor(lines),
      createdAt: new Date(Math.round(t / 60_000) * 60_000).toISOString(),
    };
  });

  return {
    slug: spec.slug,
    title: spec.title,
    businessDate: spec.businessDate,
    rows,
    print: {
      printedAt: at(spec.printDate ?? spec.businessDate, spec.printAt).toISOString(),
      station: spec.station,
      sequence: spec.sequence,
      blocks: { trays: true, top: true, hours: true },
    },
  };
}

/** The four days the design is reviewed on. */
export async function reportFixtureDays(): Promise<ReportFixtureDay[]> {
  return Promise.all([
    buildDay({
      slug: "1-saturday",
      title: "Normal Saturday, ~110 orders",
      businessDate: "2026-11-21",
      seed: 2126,
      orders: 116,
      web: 0.36,
      phone: 0.5,
      trays: true,
      cancelled: 0,
      queued: 1,
      failed: 0,
      open: "11:00",
      close: "21:01",
      printAt: "21:02",
      station: "store",
      sequence: 3,
    }),
    buildDay({
      slug: "2-slow-monday",
      title: "Slow Monday, 12 orders, no trays",
      businessDate: "2026-11-16",
      seed: 1116,
      orders: 12,
      web: 0.4,
      phone: 0.45,
      trays: false,
      cancelled: 0,
      queued: 0,
      failed: 0,
      open: "11:24",
      close: "20:24",
      printAt: "20:41",
      station: "store",
      sequence: 1,
    }),
    buildDay({
      slug: "3-cancellations",
      title: "Thursday with 3 cancellations, printed next morning",
      businessDate: "2026-11-19",
      seed: 1119,
      orders: 52,
      web: 0.35,
      phone: 0.5,
      trays: true,
      cancelled: 3,
      queued: 0,
      failed: 1,
      open: "11:03",
      close: "20:52",
      printAt: "10:15",
      printDate: "2026-11-20",
      station: "online",
      sequence: 2,
    }),
    buildDay({
      slug: "4-empty-day",
      title: "Empty day, looked up the following week",
      businessDate: "2026-11-11",
      seed: 1126,
      orders: 0,
      web: 0,
      phone: 0,
      trays: false,
      cancelled: 0,
      queued: 0,
      failed: 0,
      open: "11:00",
      close: "11:00",
      printAt: "09:30",
      printDate: "2026-11-23",
      station: "store",
      sequence: 1,
    }),
  ]);
}
