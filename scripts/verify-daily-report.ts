/**
 * Prove the 日結 DAILY REPORT's numbers, from a real database.
 *
 *   npm run verify:daily-report
 *
 * In the shape of verify:staff-orders: a real embedded Postgres on its own
 * port, the real schema.sql, the real aggregate (lib/reports/daily.ts).
 *
 *   1. A HAND-WORKED DAY. Eleven rows written straight into `orders`, every
 *      number on the report worked out by hand in this file and asserted:
 *      add-ons fold into their channel's money but are never an order,
 *      cancelled and unprinted orders are listed apart and never counted,
 *      charges are lifted out of the stored subtotal (not added on top), tax
 *      and total are the stored values to the cent, a 9:15pm order (05:15 UTC
 *      the next day) stays on Saturday, a 12:10am order is the NEXT business
 *      day's, another tenant's day and the day before are invisible.
 *   2. SQL = MODEL. The four report:sample days (116, 12, 52 and 0 orders) are
 *      inserted and the SQL report must equal summarizeDay over the same rows,
 *      deep-equal, code included.
 *   3. INVARIANTS. reportProblems() is empty for every report read: Online +
 *      Store = All on every row, the channels sum to All, subtotal + charges +
 *      tax + tip = the stored total, the hours sum to All.
 *   3b. TOP 5 BY DISH. The printed 熱賣 TOP merges the Specials copy and the
 *      numbered copy of a dish (lib/menu/dishKey: same nameZh, same dish):
 *      a hand-worked day whose ranking only comes out right merged, every
 *      catalogue pair sharing a nameZh shares a key, no two Top lines on any
 *      fixture day share a nameZh, and the paper prints each dish once, 中文
 *      only.
 *   4. THE DAY THE SHEET OPENS ON. Today, or yesterday before 4am; nothing in
 *      the future.
 *   5. THE ROUTES. /api/kitchen/reports/daily (JSON), /preview (PNG) and
 *      /print, called as the tablet calls them: staff session required, the
 *      JSON is the aggregate's numbers, the preview is a PNG of them, a print
 *      is idempotent on (tenant, date, #N), a future day is refused, and a
 *      printer out of paper refuses the print with its reason. A print carries
 *      no optional blocks (日結 v2) and stores '{}'; an old tablet that still
 *      sends `blocks` is not refused for it.
 *
 * ⚠️ WINDOWS: PostgreSQL refuses to start under an administrative token; run
 * from a NON-ELEVATED shell (see verify:print-recurrence for the runas note).
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import type { OrderLine } from "../src/lib/orders/types";
import type { DailyReport, ReportOrderRow } from "../src/lib/reports/dailyModel";

const PORT = 55449;
const DB_NAME = "nmc_daily_report_test";
const TENANT = "report-test";
const OTHER_TENANT = "someone-else";
const TIMEZONE = "America/Los_Angeles";

/* ------------------------------------------------------------- results -- */

let failures = 0;
let passes = 0;
function check(name: string, passed: boolean, detail = ""): void {
  if (passed) passes++;
  else failures++;
  console.log(`   ${passed ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
}
function eq(name: string, actual: unknown, expected: unknown): void {
  const ok = isDeepStrictEqual(actual, expected);
  check(name, ok, ok ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

/* ------------------------------------------------------------- harness -- */

interface Mods {
  pool: typeof import("../src/lib/db/postgres");
  daily: typeof import("../src/lib/reports/daily");
  model: typeof import("../src/lib/reports/dailyModel");
  biz: typeof import("../src/lib/orders/businessDate");
  session: typeof import("../src/lib/auth/kitchenSession");
  sheet: { GET: (r: Request) => Promise<Response> };
  preview: { GET: (r: Request) => Promise<Response> };
  render: typeof import("../src/lib/ticket/report");
  dish: typeof import("../src/lib/menu/dishKey");
  catalog: typeof import("../src/lib/menu/catalog");
  print: { POST: (r: Request) => Promise<Response> };
}

let seq = 0;

async function insertRow(
  m: Mods,
  tenant: string,
  businessDate: string,
  row: ReportOrderRow,
): Promise<void> {
  seq++;
  await m.pool.ordersPool().query(
    `insert into orders
       (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
        customer, phone_verified_at, pickup_at, channel, print_station, is_addon, created_at)
     values ($1, $2, $3::date, $4, $5, $6::jsonb, $7::jsonb,
             '{"name":"Report Test","phone":"+16195550100"}'::jsonb, $8, $8, $9, $10, $11, $8)`,
    [
      tenant,
      `R-${String(seq).padStart(4, "0")}`,
      businessDate,
      row.status,
      `report-${seq}`,
      JSON.stringify(row.items),
      JSON.stringify(row.totals),
      row.createdAt,
      row.channel,
      row.channel === "web" ? "online" : "store",
      row.isAddon === true,
    ],
  );
}

function line(
  itemId: string,
  quantity: number,
  unitCents: number,
  extra: Partial<OrderLine> = {},
): OrderLine {
  return {
    itemId,
    nameEn: itemId.replace(/-/g, " "),
    nameZh: null,
    sizeId: "regular",
    sizeLabel: "Regular",
    sizeLabelZh: null,
    modifiers: [],
    quantity,
    unitCents,
    lineCents: unitCents * quantity,
    ...extra,
  };
}

/** Local wall clock on a date in TIMEZONE, as an ISO instant. */
function at(m: Mods, date: string, hhmm: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return m.biz.zonedWallClockToUtc(TIMEZONE, y, mo, d, h, mi).toISOString();
}

const totals = (sub: number, tax: number) => ({
  subtotalCents: sub,
  taxCents: tax,
  tipCents: 0,
  totalCents: sub + tax,
});

/* ---------------------------------------------------- 1. hand-worked day -- */

const SAT = "2026-11-21";
const SUN = "2026-11-22";
const FRI = "2026-11-20";

async function s1_handWorkedDay(m: Mods): Promise<void> {
  console.log("\n1. a hand-worked Saturday");
  const family = [...m.model.familyDinnerItemIds()][0];
  check("there is a family dinner item to count", typeof family === "string");
  const surcharge = { id: "surcharge", nameEn: "Extra shrimp", nameZh: "加蝦", priceCents: 300 };
  const custom: OrderLine = {
    ...line("custom", 1, 200),
    nameEn: "Extra rice",
    nameZh: "加飯",
    custom: true,
  };

  const day: Array<[string, ReportOrderRow]> = [
    // #1 web, 11:05, two shrimp.
    [SAT, { channel: "web", status: "PRINTED", createdAt: at(m, SAT, "11:05"),
      items: [line("honey-walnut-shrimp", 2, 1700)], totals: totals(3400, 298) }],
    // #2 phone, 12:30, a party tray plus a 加飯 custom charge.
    [SAT, { channel: "phone", status: "ACCEPTED", createdAt: at(m, SAT, "12:30"),
      items: [line("chow-mein", 1, 6500, { sizeId: "party-tray" }), custom], totals: totals(6700, 586) }],
    // #3 walk-in, 12:45, shrimp with a $3 surcharge inside its unit price, and two half trays.
    [SAT, { channel: "walk_in", status: "COMPLETED", createdAt: at(m, SAT, "12:45"),
      items: [
        line("honey-walnut-shrimp", 1, 2000, { modifiers: [surcharge] }),
        line("fried-rice", 2, 3500, { sizeId: "half-tray" }),
      ], totals: totals(9000, 788) }],
    // #4 dine-in (retired, still counted, folds into Store), 1:10pm, a family dinner.
    [SAT, { channel: "dine_in", status: "COMPLETED", createdAt: at(m, SAT, "13:10"),
      items: [line(family, 1, 4000)], totals: totals(4000, 350) }],
    // #5 its 加菜 add-on round, 1:40pm: money yes, order no.
    [SAT, { channel: "dine_in", status: "COMPLETED", isAddon: true, createdAt: at(m, SAT, "13:40"),
      items: [line("honey-walnut-shrimp", 1, 1700)], totals: totals(1700, 149) }],
    // #6 web, cancelled.
    [SAT, { channel: "web", status: "CANCELLED", createdAt: at(m, SAT, "14:00"),
      items: [line("egg-roll", 4, 250)], totals: totals(1000, 88) }],
    // #7 phone, still QUEUED at print time.
    [SAT, { channel: "phone", status: "QUEUED", createdAt: at(m, SAT, "20:55"),
      items: [line("egg-roll", 2, 250)], totals: totals(500, 44) }],
    // #8 web, 9:15pm Saturday = 05:15 UTC Sunday. Still Saturday.
    [SAT, { channel: "web", status: "PRINTED", createdAt: at(m, SAT, "21:15"),
      items: [line("orange-chicken", 3, 1000)], totals: totals(3000, 263) }],
    // #9 12:10am Sunday: Sunday's first order, not Saturday's.
    [SUN, { channel: "phone", status: "PRINTED", createdAt: at(m, SUN, "00:10"),
      items: [line("egg-roll", 1, 250)], totals: totals(250, 22) }],
    // #10 Friday 11:50pm.
    [FRI, { channel: "web", status: "PRINTED", createdAt: at(m, FRI, "23:50"),
      items: [line("egg-roll", 1, 250)], totals: totals(250, 22) }],
  ];
  for (const [date, row] of day) await insertRow(m, TENANT, date, row);
  // #11 another restaurant's Saturday.
  await insertRow(m, OTHER_TENANT, SAT, {
    channel: "web", status: "PRINTED", createdAt: at(m, SAT, "12:00"),
    items: [line("egg-roll", 9, 250)], totals: totals(2250, 197),
  });

  const r = await m.daily.readDailyReport({ tenantId: TENANT, businessDate: SAT, timezone: TIMEZONE });
  const b = (count: number, sub: number, charges: number, tax: number, total: number) => ({
    count, subtotalCents: sub, chargesCents: charges, taxCents: tax, tipCents: 0, totalCents: total,
  });

  eq("ORDERS Online = web #1 + #8", r.channels.web, b(2, 6400, 0, 561, 6961));
  eq("ORDERS Phone = #2, its 加飯 lifted into Charges", r.channels.phone, b(1, 6500, 200, 586, 7286));
  eq("ORDERS Walk-in = #3, its $3 surcharge lifted into Charges", r.channels.walk_in, b(1, 8700, 300, 788, 9788));
  eq("ORDERS Dine-in = #4 plus its add-on's money, ONE order", r.channels.dine_in, b(1, 5700, 0, 499, 6199));
  eq("TOTALS Online", r.columns.online, b(2, 6400, 0, 561, 6961));
  eq("TOTALS Store = phone + walk-in + dine-in", r.columns.store, b(3, 20900, 500, 1873, 23273));
  eq("TOTALS All", r.columns.all, b(5, 27300, 500, 2434, 30234));
  check(
    "charges and tax match the stored totals to the cent",
    r.columns.all.subtotalCents + r.columns.all.chargesCents === 3400 + 6700 + 9000 + 4000 + 1700 + 3000 &&
      r.columns.all.taxCents === 298 + 586 + 788 + 350 + 149 + 263,
  );
  eq("NOT INCLUDED Cancelled", r.cancelled, b(1, 1000, 0, 88, 1088));
  eq("NOT INCLUDED Unprinted", r.unprinted, b(1, 500, 0, 44, 544));
  eq("TRAYS: quantities, not lines", r.trays, { halfTray: 2, partyTray: 1, familyDinners: 1 });
  eq(
    "TOP: by quantity then sales; sizes merged; surcharges and custom lines out",
    r.top.map((t) => [t.itemId, t.quantity, t.salesCents]),
    [
      ["honey-walnut-shrimp", 4, 3400 + 1700 + 1700],
      ["orange-chicken", 3, 3000],
      ["fried-rice", 2, 7000],
      ["chow-mein", 1, 6500],
      [family, 1, 4000],
    ],
  );
  eq(
    "BY HOUR: local hours, the add-on adds money to 1p but no order",
    r.hours,
    [
      { hour: 11, count: 1, totalCents: 3698 },
      { hour: 12, count: 2, totalCents: 7286 + 9788 },
      { hour: 13, count: 1, totalCents: 4350 + 1849 },
      { hour: 21, count: 1, totalCents: 3263 },
    ],
  );
  eq("window: first order 11:05a", r.firstOrderAt, at(m, SAT, "11:05"));
  eq("window: last order 9:15p (05:15 UTC Sunday) is still Saturday's", r.lastOrderAt, at(m, SAT, "21:15"));
  eq("invariants hold", m.model.reportProblems(r), []);

  const sun = await m.daily.readDailyReport({ tenantId: TENANT, businessDate: SUN, timezone: TIMEZONE });
  eq("the 12:10am order is Sunday's, its only order", [sun.columns.all.count, sun.columns.all.totalCents], [1, 272]);
  eq("Sunday's hour is 12a", sun.hours.map((h) => h.hour), [0]);

  const other = await m.daily.readDailyReport({ tenantId: OTHER_TENANT, businessDate: SAT, timezone: TIMEZONE });
  eq("another tenant sees only its own order", other.columns.all.count, 1);

  const model = m.model.summarizeDay(
    await m.daily.readReportRows({ tenantId: TENANT, businessDate: SAT, timezone: TIMEZONE }),
    { tenantId: TENANT, businessDate: SAT, timezone: TIMEZONE, familyItemIds: m.model.familyDinnerItemIds() },
  );
  eq("SQL = reference model, the whole report", r, model);
}

/* ------------------------------------------------------- 2. SQL = model -- */

async function s2_fixtureDays(m: Mods): Promise<void> {
  console.log("\n2. the report:sample days: SQL = model");
  const { reportFixtureDays } = await import("./fixtures/orders");
  const family = m.model.familyDinnerItemIds();
  const tenant = "fixture-days";
  for (const day of await reportFixtureDays()) {
    for (const row of day.rows) await insertRow(m, tenant, day.businessDate, row);
    const scope = { tenantId: tenant, businessDate: day.businessDate, timezone: TIMEZONE };
    const sql: DailyReport = await m.daily.readDailyReport(scope);
    const model = m.model.summarizeDay(day.rows, { ...scope, familyItemIds: family });
    const same = isDeepStrictEqual(sql, model);
    check(
      `${day.slug}: ${sql.columns.all.count} orders, ${m.model.formatMoney(sql.columns.all.totalCents)}, code ${sql.code}`,
      same,
      same ? "" : firstDifference(sql, model),
    );
    eq(`${day.slug}: invariants hold`, m.model.reportProblems(sql), []);
    const names = m.model.topDishes(sql).map((d) => d.name);
    check(`${day.slug}: no two Top lines share a nameZh`, new Set(names).size === names.length, names.join(", "));
  }
}

/* ------------------------------------------------------- 3b. top by dish -- */

const MON = "2026-11-23";

async function s3b_topByDish(m: Mods): Promise<void> {
  console.log("\n3b. 熱賣 TOP 5, merged by dish");

  // The helper, on the real catalogue: every item sharing a nameZh shares a
  // key, the named Specials pairs among them, and different names never do.
  const items = m.catalog.staffCatalogMenu().categories.flatMap((c) => c.items);
  const byZh = new Map<string, Set<string>>();
  for (const i of items) {
    if (!i.nameZh) continue;
    const keys = byZh.get(i.nameZh) ?? new Set<string>();
    keys.add(m.dish.dishKey({ itemId: i.id, nameZh: i.nameZh }));
    byZh.set(i.nameZh, keys);
  }
  check("every nameZh maps to exactly one dish key", [...byZh.values()].every((k) => k.size === 1));
  const allKeys = [...byZh.values()].map((k) => [...k][0]);
  check("different nameZh, different dish key", new Set(allKeys).size === allKeys.length);
  const key = (id: string) => {
    const i = items.find((x) => x.id === id);
    return i ? m.dish.dishKey({ itemId: i.id, nameZh: i.nameZh }) : `missing ${id}`;
  };
  for (const [a, b] of [
    ["salted-pepper-chicken-wings-special", "salted-pepper-chicken-wings"],
    ["mongolian-beef-special", "mongolian-beef"],
    ["orange-flavored-chicken-special", "orange-flavored-chicken"],
    ["salted-pepper-squid-special", "salted-pepper-squid"],
  ]) {
    check(`${a} and ${b} are one dish`, key(a) === key(b) && !key(a).startsWith("missing"), `${key(a)} vs ${key(b)}`);
  }
  check("no 中文 name: the item is its own dish", m.dish.dishKey({ itemId: "x", nameZh: null }) === "id:x");

  // A hand-worked Monday. By catalogue id the top line would be 陳皮雞 4;
  // by dish it is 蒙古牛肉 3 + 2 = 5, and 椒鹽雞翼 1 + 2 = 3 passes 宮保雞丁 2.
  // Six dishes, so the cut to five drops 春卷 (1 at $3.50 loses the sales
  // tie-break to 酸辣湯 1 at $9.00).
  const zh = (nameZh: string) => ({ nameZh });
  const rows: ReportOrderRow[] = [
    { channel: "web", status: "COMPLETED", createdAt: at(m, MON, "11:30"),
      items: [line("mongolian-beef", 3, 1695, zh("蒙古牛肉")), line("salted-pepper-chicken-wings", 1, 1395, zh("椒鹽雞翼"))],
      totals: totals(3 * 1695 + 1395, 590) },
    { channel: "phone", status: "COMPLETED", createdAt: at(m, MON, "12:00"),
      items: [line("mongolian-beef-special", 2, 1895, zh("蒙古牛肉")), line("salted-pepper-chicken-wings-special", 2, 1595, zh("椒鹽雞翼"))],
      totals: totals(2 * 1895 + 2 * 1595, 611) },
    { channel: "walk_in", status: "COMPLETED", createdAt: at(m, MON, "12:30"),
      items: [line("orange-flavored-chicken", 4, 1595, zh("陳皮雞")), line("kung-pao-chicken", 2, 1495, zh("宮保雞丁"))],
      totals: totals(4 * 1595 + 2 * 1495, 820) },
    { channel: "web", status: "COMPLETED", createdAt: at(m, MON, "13:00"),
      items: [line("hot-sour-soup", 1, 900, zh("酸辣湯")), line("egg-rolls", 1, 350, zh("春卷"))],
      totals: totals(1250, 109) },
  ];
  for (const row of rows) await insertRow(m, TENANT, MON, row);
  const r = await m.daily.readDailyReport({ tenantId: TENANT, businessDate: MON, timezone: TIMEZONE });
  eq(
    "TOP 5: merged by dish, by quantity then sales",
    m.model.topDishes(r).map((d) => [d.name, d.quantity]),
    [["蒙古牛肉", 5], ["陳皮雞", 4], ["椒鹽雞翼", 3], ["宮保雞丁", 2], ["酸辣湯", 1]],
  );
  check("the stored report still lists catalogue items (8 of them)", r.top.length === 8, String(r.top.length));

  // And the paper: each dish once, 中文 only, no English half and no sales column.
  const { lines } = await m.render.composeReportSvg(r, {
    printedAt: at(m, MON, "21:30"), station: "store", sequence: 1, timezone: TIMEZONE,
  });
  const text = lines.map((l) => l.text);
  for (const name of ["蒙古牛肉", "陳皮雞", "椒鹽雞翼", "宮保雞丁", "酸辣湯"]) {
    check(`the paper prints ${name} once`, text.filter((t) => t === name).length === 1);
  }
  check("春卷 (sixth) is not printed", !text.includes("春卷"));
  check("no English dish names on the paper", !text.some((t) => /mongolian|chicken|soup/i.test(t)));
  check("no em dash anywhere on the paper", !text.some((t) => t.includes("\u2014")));
  check(
    "gone: NOT INCLUDED, BY HOUR, Family dinners, the payments sentence",
    !text.some((t) => /NOT INCLUDED|BY HOUR|Family|not payments|未計入|時段|家庭餐/.test(t)),
  );
  check("the TOTAL figure is on the paper with its $", text.includes(m.model.formatMoney(r.columns.all.totalCents)));
  const total = lines.find((l) => l.text === m.model.formatMoney(r.columns.all.totalCents))!;
  check("the TOTAL is the largest type on the paper, at least 2x body", total.size >= 84 && lines.every((l) => l.size <= total.size));
  check("nothing on the paper under the kitchen ticket's 中文 dish name (38)", lines.every((l) => l.size >= 38),
    lines.filter((l) => l.size < 38).map((l) => `${l.text}@${l.size}`).join(", "));
}

function firstDifference(a: unknown, b: unknown, path = "report"): string {
  if (isDeepStrictEqual(a, b)) return "";
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
      );
      if (d) return d;
    }
  }
  return `${path}: sql ${JSON.stringify(a)} vs model ${JSON.stringify(b)}`;
}

/* --------------------------------------------- 4. the day the sheet opens -- */

function s4_sheetDay(m: Mods): void {
  console.log("\n4. the day the print sheet opens on");
  const local = (date: string, hhmm: string) => new Date(at(m, date, hhmm));
  eq("12:10am Sunday opens on Saturday", m.model.defaultReportDate(TIMEZONE, local(SUN, "00:10")), SAT);
  eq("3:59am Sunday still opens on Saturday", m.model.defaultReportDate(TIMEZONE, local(SUN, "03:59")), SAT);
  eq("4:00am Sunday opens on Sunday", m.model.defaultReportDate(TIMEZONE, local(SUN, "04:00")), SUN);
  eq("9:02pm Saturday opens on Saturday", m.model.defaultReportDate(TIMEZONE, local(SAT, "21:02")), SAT);
  eq("today at 12:10am is still Sunday (the cap for ▶)", m.model.todayFor(TIMEZONE, local(SUN, "00:10")), SUN);
  eq("shiftDate crosses a month", m.model.shiftDate("2026-12-01", -1), "2026-11-30");
  check("isReportDate refuses 2026-02-30", !m.model.isReportDate("2026-02-30"));
  check("isReportDate takes 2026-11-21", m.model.isReportDate(SAT));
}

/* ------------------------------------------------------------ 5. routes -- */

const PASSWORD = "verify-daily-report-password";
const MAC_STORE = "00:11:62:00:00:42";

async function s5_routes(m: Mods): Promise<void> {
  console.log("\n5. the sheet's routes");
  const cookie = `nmc_kitchen=${m.session.login(PASSWORD)}`;
  const req = (path: string, init: RequestInit = {}, auth = true) => {
    const headers = new Headers(init.headers);
    if (auth) headers.set("cookie", cookie);
    if (init.body) headers.set("content-type", "application/json");
    return new Request(`http://localhost${path}`, { ...init, headers });
  };

  check("GET without a staff session is 401", (await m.sheet.GET(req(`/api/kitchen/reports/daily?date=${SAT}`, {}, false))).status === 401);
  check("print without a staff session is 401",
    (await m.print.POST(req("/api/kitchen/reports/daily/print", { method: "POST", body: "{}" }, false))).status === 401);

  const res = await m.sheet.GET(req(`/api/kitchen/reports/daily?date=${SAT}`));
  const body = (await res.json()) as {
    ok: boolean; date: string; report: DailyReport; nextSequence: number; printable: boolean;
    printers: Array<{ station: string; health: string }>;
  };
  check("GET answers the day", res.status === 200 && body.ok && body.date === SAT);
  eq("GET's numbers are the aggregate's", body.report.columns.all, {
    count: 5, subtotalCents: 27300, chargesCents: 500, taxCents: 2434, tipCents: 0, totalCents: 30234,
  });
  check("GET says #1 is next and printing is set up", body.nextSequence === 1 && body.printable);
  check("GET refuses a future day", (await m.sheet.GET(req("/api/kitchen/reports/daily?date=2099-01-01"))).status === 400);
  check("GET refuses a malformed day", (await m.sheet.GET(req("/api/kitchen/reports/daily?date=2026-02-30"))).status === 400);

  const png = await m.preview.GET(req(`/api/kitchen/reports/daily/preview?date=${SAT}&station=store&sequence=1`));
  const bytes = new Uint8Array(await png.arrayBuffer());
  check(
    "the preview is a PNG, and carries the report's code",
    png.status === 200 && png.headers.get("content-type") === "image/png" &&
      bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      png.headers.get("x-report-code") === body.report.code,
    `status=${png.status} code=${png.headers.get("x-report-code")}`,
  );

  const press = (sequence: number, requestKey: string, extra: Record<string, unknown> = {}) =>
    m.print.POST(req("/api/kitchen/reports/daily/print", {
      method: "POST",
      body: JSON.stringify({
        date: SAT, station: "store", sequence, requestKey, ...extra,
      }),
    }));
  const first = await press(1, "sheet-press-0001");
  const firstBody = (await first.json()) as { ok: boolean; replay: boolean; print: { sequence: number; code: string } };
  check("print queues #1 with the day's code", first.status === 200 && firstBody.ok && !firstBody.replay &&
    firstBody.print.sequence === 1 && firstBody.print.code === body.report.code, JSON.stringify(firstBody));
  const again = (await (await press(1, "sheet-press-0001")).json()) as { ok: boolean; replay: boolean };
  check("the same press again is a replay, not a second print", again.ok && again.replay);
  const clash = await press(1, "other-tablet-0001");
  const clashBody = (await clash.json()) as { nextSequence: number };
  check("another tablet's #1 is a 409 naming #2", clash.status === 409 && clashBody.nextSequence === 2);
  check("a future day cannot be printed", (await press(1, "future-press-01", { date: "2099-01-01" })).status === 400);
  const { rows } = await m.pool.ordersPool().query(
    `select count(*)::int as n, min(status) as status from report_prints where tenant_id = $1 and business_date = $2::date`,
    [TENANT, SAT],
  );
  check("one row in report_prints, QUEUED for the printer", rows[0].n === 1 && rows[0].status === "QUEUED", JSON.stringify(rows[0]));
  const stored = await m.pool.ordersPool().query(
    `select blocks from report_prints where tenant_id = $1 and business_date = $2::date and sequence = 1`,
    [TENANT, SAT],
  );
  eq("a print stores no optional blocks ('{}')", stored.rows[0]?.blocks, {});
  const stale = await press(2, "old-tablet-blocks-01", { blocks: { trays: true, top: true, hours: true } });
  check("an old tablet still sending `blocks` is not refused for it", stale.status === 200, String(stale.status));
  const after = (await (await m.sheet.GET(req(`/api/kitchen/reports/daily?date=${SAT}`))).json()) as {
    nextSequence: number; prints: Array<{ sequence: number }>;
  };
  check("the sheet now offers #3 and lists #2, #1", after.nextSequence === 3 && after.prints[0]?.sequence === 2 && after.prints[1]?.sequence === 1);

  // The store printer reports paper out.
  await m.pool.ordersPool().query(
    `insert into printer_station_status (tenant_id, station, last_seen_at, online, paper_out, printer_mac)
     values ($1, 'store', now(), true, true, $2)`,
    [TENANT, MAC_STORE.replace(/:/g, "").toLowerCase()],
  );
  const out = await press(3, "paper-out-press1");
  const outBody = (await out.json()) as { error: string; reason: string };
  check("a printer out of paper refuses the print, saying why", out.status === 409 && outBody.reason === "paper-out",
    JSON.stringify(outBody));
}

/* ----------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-daily-report-test-"));
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
  });
  console.log("starting embedded postgres…");
  await pg.initialise();
  await pg.start();
  const admin = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  // en_US collation on purpose: production is not "C", and the top-10
  // tie-break must not depend on it.
  await admin.query(`create database ${DB_NAME} with encoding 'UTF8' template template0`);
  await admin.end();

  process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`;
  process.env.TENANT_ID = TENANT;
  process.env.RESTAURANT_TIMEZONE = TIMEZONE;
  process.env.ADMIN_DASH_PASSWORD = PASSWORD;
  process.env.CLOUDPRNT_PRINTER_MAC_STORE = MAC_STORE;

  const pool = await import("../src/lib/db/postgres");
  await pool.ordersPool().query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));

  const m: Mods = {
    pool,
    daily: await import("../src/lib/reports/daily"),
    model: await import("../src/lib/reports/dailyModel"),
    biz: await import("../src/lib/orders/businessDate"),
    session: await import("../src/lib/auth/kitchenSession"),
    sheet: (await import("../src/app/api/kitchen/reports/daily/route")) as unknown as Mods["sheet"],
    preview: (await import("../src/app/api/kitchen/reports/daily/preview/route")) as unknown as Mods["preview"],
    print: (await import("../src/app/api/kitchen/reports/daily/print/route")) as unknown as Mods["print"],
    render: await import("../src/lib/ticket/report"),
    dish: await import("../src/lib/menu/dishKey"),
    catalog: await import("../src/lib/menu/catalog"),
  };

  try {
    await s1_handWorkedDay(m);
    await s2_fixtureDays(m);
    await s3b_topByDish(m);
    s4_sheetDay(m);
    await s5_routes(m);
  } finally {
    await pool.closeOrdersPool();
    console.log("\nstopping postgres…");
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(`\ndaily report: ${passes}/${passes + failures} checks passed`);
  if (failures > 0) {
    console.log(`\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log("\nthe printed numbers are the database's numbers ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
