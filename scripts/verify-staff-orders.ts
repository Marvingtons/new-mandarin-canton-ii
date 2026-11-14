/**
 * Prove the staff POS is the SAME pipeline as the web checkout, and that order
 * history reports what is actually in the table.
 *
 *   npm run verify:staff-orders
 *
 * Real things, not mocks, in the shape of verify:print-deliveries:
 *
 *   - a real embedded Postgres on its own port, with the real schema.sql
 *   - the real repository
 *   - the REAL route handlers: POST /api/orders (web), POST /api/kitchen/orders
 *     (POS), the CloudPRNT poll/fetch/confirm, the board's order actions, the
 *     repeat-customer lookup, and both history routes (JSON and CSV)
 *
 * Clocks: the routes run against the real clock, so hours are skipped the way
 * a tester skips them in production, with the ORDER_GATE_BYPASS header. The
 * lunch window, which the bypass also skips, is proved against FIXED clocks
 * through staffLunchAllowed() and composeOrder(), the two functions the route
 * calls to make that decision.
 *
 * ⚠️ WINDOWS: PostgreSQL refuses to start under an administrative token; run
 * from a NON-ELEVATED shell (see verify:print-recurrence for the runas note).
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const PORT = 55436;
const DB_NAME = "nmc_staff_test";
const TENANT = "staff-test";
const OTHER_TENANT = "someone-else";
const PASSWORD = "verify-staff-orders-password";
const BYPASS = "verify-staff-orders-bypass";
const PRINT_SECRET = "verify-staff-orders-print";
const MAC = "00:11:62:00:00:09";
const TIMEZONE = "America/Los_Angeles";

/* ------------------------------------------------------------- results -- */

let failures = 0;
let passes = 0;
function check(name: string, passed: boolean, detail = ""): void {
  if (passed) passes++;
  else failures++;
  console.log(`   ${passed ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
}

/* ------------------------------------------------------------- harness -- */

type Handler = (r: Request, ctx?: unknown) => Promise<Response>;

interface Mods {
  repo: typeof import("../src/lib/orders/repository");
  pool: typeof import("../src/lib/db/postgres");
  catalog: typeof import("../src/lib/menu/catalog");
  compose: typeof import("../src/lib/orders/compose");
  types: typeof import("../src/lib/menu/types");
  render: typeof import("../src/lib/ticket/render");
  otp: typeof import("../src/lib/otp/session");
  session: typeof import("../src/lib/auth/kitchenSession");
  rate: typeof import("../src/lib/http/rateLimit");
  pickup: typeof import("../src/lib/order/pickup");
  gates: typeof import("../src/lib/order/gates");
  biz: typeof import("../src/lib/orders/businessDate");
  webOrders: { POST: Handler };
  kitchenOrders: { POST: Handler; GET: Handler };
  orderAction: { POST: (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };
  customers: { GET: Handler };
  history: { GET: Handler };
  historyCsv: { GET: Handler };
  print: {
    POST: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
    GET: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
    DELETE: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
  };
}

let kitchenCookie = "";

function kitchenRequest(path: string, init: RequestInit = {}, opts: { bypass?: boolean } = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", kitchenCookie);
  if (init.body) headers.set("content-type", "application/json");
  if (opts.bypass !== false) headers.set("x-gate-bypass", BYPASS);
  // localhost: the kitchen write routes refuse any other host (lib/http/deployHost).
  return new Request(`http://localhost${path}`, { ...init, headers });
}

let keySeq = 0;
const nextKey = () => `verify-${Date.now()}-${++keySeq}`;

interface CartLine {
  itemId: string;
  sizeId: string;
  modifierIds: string[];
  quantity: number;
  specialInstructions?: string;
}

async function staffPost(m: Mods, body: Record<string, unknown>, opts: { bypass?: boolean } = {}) {
  const res = await m.kitchenOrders.POST(
    kitchenRequest("/api/kitchen/orders", { method: "POST", body: JSON.stringify(body) }, opts),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function staffBody(lines: CartLine[], extra: Record<string, unknown> = {}) {
  return {
    lines,
    channel: "phone",
    customer: { name: "Staff Test", phone: "(619) 555-0177" },
    pickup: { time: "asap" },
    idempotencyKey: nextKey(),
    ...extra,
  };
}

let ipSeq = 0;
async function webPost(m: Mods, lines: CartLine[], phone: string) {
  const e164 = `+1${phone.replace(/\D/g, "")}`;
  const res = await m.webOrders.POST(
    // localhost: POST /api/orders refuses any other host (lib/http/deployHost).
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `nmc_phone=${m.otp.mintToken(e164)}`,
        "x-gate-bypass": BYPASS,
        "x-forwarded-for": `10.0.0.${++ipSeq % 250}`,
      },
      body: JSON.stringify({
        lines,
        pickup: { name: "Web Test", phone, time: "asap" },
        idempotencyKey: nextKey(),
      }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** A line the item sheet would build: first option of every required group. */
function defaultLine(m: Mods, itemId: string, sizeId?: string, quantity = 1): CartLine {
  const item = m.types.indexItems(m.catalog.catalogMenu()).get(itemId);
  if (!item) throw new Error(`no such item ${itemId}`);
  const size = sizeId ?? m.types.itemSizes(item)[0].id;
  const { groupsForSize } = riceMod!;
  const modifierIds = groupsForSize(item, size)
    .filter((g) => g.minRequired > 0)
    .map((g) => g.modifiers[0].id);
  return { itemId, sizeId: size, modifierIds, quantity };
}
let riceMod: typeof import("../src/lib/menu/rice") | null = null;

async function resetTenant(m: Mods, tenant = TENANT): Promise<void> {
  await m.pool.ordersPool().query("delete from orders where tenant_id = $1", [tenant]);
  await m.pool.ordersPool().query("delete from order_counters where tenant_id = $1", [tenant]);
  m.rate.resetRateLimits();
}

const printParams = Promise.resolve({ secret: PRINT_SECRET });
const PRINT_BASE = `https://example.test/api/print/${PRINT_SECRET}`;

async function pollPrinter(m: Mods): Promise<{ jobReady: boolean; token: string | null }> {
  const res = await m.print.POST(
    new Request(PRINT_BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusCode: "200 OK", printerMAC: MAC }),
    }),
    { params: printParams },
  );
  const body = (await res.json()) as { jobReady?: boolean; jobToken?: string };
  return { jobReady: body.jobReady === true, token: body.jobToken ?? null };
}

/* --------------------------------------------------------- scenarios -- */

async function s1_pricing(m: Mods): Promise<void> {
  console.log("\n1. server recompute: tampered prices refused; staff and web agree to the cent");
  await resetTenant(m);

  const cart: CartLine[] = [
    defaultLine(m, "kung-pao-chicken", undefined, 2),
    defaultLine(m, "kung-pao-chicken", "party-tray"),
    { ...defaultLine(m, "chicken-vegetable-soup"), modifierIds: ["chicken-vegetable-soup-noodle"] },
    defaultLine(m, "egg-rolls", undefined, 3),
  ];
  // The modifier id for "Add Noodle" is read from the catalogue, not guessed.
  const soup = m.types.indexItems(m.catalog.catalogMenu()).get("chicken-vegetable-soup")!;
  const noodle = soup.modifierGroups.flatMap((g) => g.modifiers)[0];
  cart[2] = { ...cart[2], modifierIds: noodle ? [noodle.id] : [] };

  const tamperedLine = await staffPost(m, staffBody([{ ...cart[0], unitCents: 1 } as CartLine]));
  check("a line carrying a price is a hard 400", tamperedLine.status === 400, `status=${tamperedLine.status}`);

  const tamperedTotal = await staffPost(m, { ...staffBody(cart), totalCents: 100 });
  check("a body carrying a total is a hard 400", tamperedTotal.status === 400, `status=${tamperedTotal.status}`);

  const tamperedTax = await staffPost(m, { ...staffBody(cart), taxCents: 0 });
  check("a body carrying tax is a hard 400", tamperedTax.status === 400, `status=${tamperedTax.status}`);

  const staff = await staffPost(m, staffBody(cart));
  const web = await webPost(m, cart, "6195550101");
  check("staff order accepted", staff.status === 200 && staff.body.ok === true, JSON.stringify(staff.body).slice(0, 160));
  check("web order accepted", web.status === 200 && web.body.ok === true, JSON.stringify(web.body).slice(0, 160));

  const staffOrder = await m.repo.getOrderById(TENANT, Number((staff.body.order as { id: number }).id));
  const webOrder = await m.repo.getOrderByNumber(
    TENANT,
    m.biz.businessDateFor(TIMEZONE),
    String(web.body.orderNumber),
  );
  check(
    "identical cart, identical totals (subtotal, tax, total)",
    !!staffOrder &&
      !!webOrder &&
      JSON.stringify(staffOrder.totals) === JSON.stringify(webOrder.totals),
    `staff=${JSON.stringify(staffOrder?.totals)} web=${JSON.stringify(webOrder?.totals)}`,
  );
  check(
    "identical cart, identical stored lines",
    JSON.stringify(staffOrder?.items) === JSON.stringify(webOrder?.items),
  );

  // Independently: catalogue prices, summed by hand, at 8.75%.
  const index = m.types.indexItems(m.catalog.catalogMenu());
  let expected = 0;
  for (const line of cart) {
    const item = index.get(line.itemId)!;
    const size = m.types.itemSizes(item).find((s) => s.id === line.sizeId)!;
    const mods = item.modifierGroups.flatMap((g) => g.modifiers).filter((x) => line.modifierIds.includes(x.id));
    expected += (size.priceCents + mods.reduce((n, x) => n + x.priceCents, 0)) * line.quantity;
  }
  const expectedTax = Math.round((expected * 875) / 10_000);
  check(
    "subtotal and tax match the catalogue by hand",
    staffOrder?.totals.subtotalCents === expected && staffOrder?.totals.taxCents === expectedTax,
    `subtotal ${staffOrder?.totals.subtotalCents} vs ${expected}, tax ${staffOrder?.totals.taxCents} vs ${expectedTax}`,
  );
  check("staff order is channel=phone, status QUEUED", staffOrder?.channel === "phone" && staffOrder?.status === "QUEUED");
  check("web order is channel=web", webOrder?.channel === "web");
  check("the 86'd item is refused for staff too", (await staffPost(m, staffBody([{ itemId: "roasted-duck", sizeId: "half", modifierIds: [], quantity: 1 }]))).body.code === "item_unavailable");
}

async function s2_phoneOrderPrints(m: Mods): Promise<void> {
  console.log("\n2. a phone order prints through the same CloudPRNT path, exactly once");
  await resetTenant(m);

  const created = await staffPost(
    m,
    staffBody([defaultLine(m, "chicken-broccoli")], {
      paymentNote: "paid by phone, card ending 4417",
      staffNote: "regular, always extra spicy",
    }),
  );
  const id = Number((created.body.order as { id: number }).id);

  const p1 = await pollPrinter(m);
  check("the printer is offered the phone order", p1.jobReady && !!p1.token);
  const get = await m.print.GET(
    new Request(`${PRINT_BASE}?token=${encodeURIComponent(p1.token!)}&mac=${encodeURIComponent(MAC)}&type=application/vnd.star.starprnt`),
    { params: printParams },
  );
  check("the job body downloads", get.status === 200, `status=${get.status}`);
  await get.arrayBuffer();
  const del = await m.print.DELETE(
    new Request(`${PRINT_BASE}?mac=${encodeURIComponent(MAC)}&code=OK&token=${encodeURIComponent(p1.token!)}`, { method: "DELETE" }),
    { params: printParams },
  );
  check("the confirmation is accepted", del.status === 200, `status=${del.status}`);
  const p2 = await pollPrinter(m);
  check("no second offer after confirmation", p2.jobReady === false);

  const { rows } = await m.pool.ordersPool().query(
    "select reason, confirmed_at from print_deliveries where tenant_id = $1 and order_id = $2",
    [TENANT, id],
  );
  check("exactly one delivery", rows.length === 1, `${rows.length} deliveries`);
  check("exactly one confirm", rows.filter((r) => r.confirmed_at !== null).length === 1);
  const order = await m.repo.getOrderById(TENANT, id);
  check("order is PRINTED", order?.status === "PRINTED", order?.status);
  check(
    "payment and staff notes persisted",
    order?.paymentNote === "paid by phone, card ending 4417" && order?.staffNote === "regular, always extra spicy",
  );

  const texts = async (o: NonNullable<typeof order>) =>
    (await m.render.composeTicketSvg(o, { timezone: TIMEZONE })).lines.map((l) => l.text);
  const phoneTicket = await texts(order!);
  check(
    "the rendered ticket says 電話訂單 PHONE ORDER",
    phoneTicket.includes("電話訂單 PHONE ORDER"),
    phoneTicket.find((t) => t.includes("PHONE ORDER")) ?? "no PHONE ORDER line",
  );
  check("the staff note is NOT printed", !phoneTicket.some((t) => t.includes("extra spicy")));
  check("the phone ticket prints the number as (619) 555-0177", phoneTicket.includes("(619) 555-0177"));
  check("the phone ticket prints no 客人 name line", !phoneTicket.some((t) => t.startsWith("客人")));
  const walkIn = await texts({ ...order!, channel: "walk_in" });
  check("a walk-in ticket says 到店 WALK-IN", walkIn.includes("到店 WALK-IN"));
  const web = await texts({ ...order!, channel: "web" });
  check("a web ticket carries no channel line", !web.some((t) => /PHONE ORDER|WALK-IN/.test(t)));
  check("a web ticket keeps its 客人 name line", web.includes("客人 Staff Test"));
  check("a walk-in ticket prints no 客人 name line", !walkIn.some((t) => t.startsWith("客人")));
}

async function s3_numbering(m: Mods): Promise<void> {
  console.log("\n3. web orders number A-, store orders B-, each its own gapless daily sequence under concurrency");
  await resetTenant(m);
  const line = defaultLine(m, "egg-rolls");

  // 20 at once, interleaved: 7 web, 13 store (phone and walk-in), so the two
  // sequences end at different lengths and a shared counter cannot pass.
  const jobs: Promise<{ status: number; body: Record<string, unknown> }>[] = [];
  for (let i = 0; i < 20; i++) {
    jobs.push(
      i % 3 !== 0
        ? staffPost(m, staffBody([line], { channel: i % 2 === 0 ? "phone" : "walk_in" }))
        : webPost(m, [line], `61955502${String(i).padStart(2, "0")}`),
    );
  }
  const results = await Promise.all(jobs);
  const numbers = results.map((r) =>
    r.body.order ? String((r.body.order as { orderNumber: string }).orderNumber) : String(r.body.orderNumber),
  );
  check("all 20 accepted", results.every((r) => r.status === 200 && r.body.ok === true), results.filter((r) => r.status !== 200).map((r) => JSON.stringify(r.body)).join(" | ").slice(0, 200));
  check("20 distinct numbers", new Set(numbers).size === 20, numbers.join(","));

  const run = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(3, "0")}`);
  const a = numbers.filter((n) => n.startsWith("A-")).sort();
  const b = numbers.filter((n) => n.startsWith("B-")).sort();
  check(`web: exactly A-001..A-${String(a.length).padStart(3, "0")}, no gaps or duplicates`, a.length === 7 && a.join() === run("A", 7).join(), a.join(","));
  check(`store: exactly B-001..B-${String(b.length).padStart(3, "0")}, no gaps or duplicates`, b.length === 13 && b.join() === run("B", 13).join(), b.join(","));

  const { rows } = await m.pool.ordersPool().query(
    `select channel, print_station, array_agg(distinct left(order_number, 2)) as prefixes
       from orders where tenant_id = $1 group by channel, print_station order by channel`,
    [TENANT],
  );
  check(
    "every web order is A- on online, every phone/walk-in is B- on store",
    rows.length === 3 &&
      rows.every((r) => (r.channel === "web" ? r.print_station === "online" && r.prefixes.join() === "A-" : r.print_station === "store" && r.prefixes.join() === "B-")),
    JSON.stringify(rows),
  );
  const counters = await m.pool.ordersPool().query(
    "select station, seq from order_counters where tenant_id = $1 order by station",
    [TENANT],
  );
  check("one counter row per station, at 7 and 13", JSON.stringify(counters.rows) === JSON.stringify([{ station: "online", seq: 7 }, { station: "store", seq: 13 }]), JSON.stringify(counters.rows));

  // The order the board, reprint, Recently done and Undo act on is found by
  // id; the ticket preview and search find it by number. Both prefixes.
  for (const n of [a[0], b[0]]) {
    const today = m.biz.businessDateFor(TIMEZONE);
    const found = await m.repo.getOrderByNumber(TENANT, today, n);
    check(`getOrderByNumber finds ${n}`, found?.orderNumber === n, found?.orderNumber ?? "null");
  }
}

async function s4_history(m: Mods): Promise<void> {
  console.log("\n4. history: filters, pagination, summary and CSV agree");
  await resetTenant(m);

  const items = [
    {
      itemId: "egg-rolls",
      nameEn: "Egg Rolls (2)",
      nameZh: "春卷",
      sizeId: "regular",
      sizeLabel: "Regular",
      sizeLabelZh: null,
      modifiers: [],
      quantity: 1,
      unitCents: 350,
      lineCents: 350,
    },
  ];
  const channels = ["web", "phone", "walk_in"] as const;
  const created: { number: string; date: string; channel: string; total: number; cancelled: boolean }[] = [];
  // 70 orders over three days, so one range needs two pages.
  for (let i = 0; i < 70; i++) {
    const date = i < 30 ? "2026-09-01" : i < 60 ? "2026-09-02" : "2026-09-03";
    const channel = channels[i % 3];
    const total = 1000 + i;
    const { order } = await m.repo.createOrder({
      tenantId: TENANT,
      businessDate: date,
      orderNumberPrefix: "A",
      idempotencyKey: `hist-${i}`,
      items,
      totals: { subtotalCents: total - 80, taxCents: 80, tipCents: 0, totalCents: total },
      customer: { name: i === 7 ? "Mrs. Wong" : `Customer ${i}`, phone: i === 7 ? "+16195558877" : `+1619555${String(1000 + i)}` },
      phoneVerifiedAt: new Date(),
      pickupAt: new Date(),
      channel,
    });
    const cancelled = i % 10 === 9;
    if (cancelled) await m.repo.cancelOrder(TENANT, order.id, "test cancel");
    created.push({ number: order.orderNumber, date, channel, total, cancelled });
  }
  // And one in another tenant, in range, that must never appear.
  await m.repo.createOrder({
    tenantId: OTHER_TENANT,
    businessDate: "2026-09-02",
    orderNumberPrefix: "A",
    idempotencyKey: "hist-other",
    items,
    totals: { subtotalCents: 920, taxCents: 80, tipCents: 0, totalCents: 99_999 },
    customer: { name: "Mrs. Wong", phone: "+16195558877" },
    phoneVerifiedAt: new Date(),
    pickupAt: new Date(),
  });

  const history = async (qs: string) => {
    const res = await m.history.GET(kitchenRequest(`/api/kitchen/history?${qs}`));
    return (await res.json()) as {
      ok: boolean;
      orders: { orderNumber: string; businessDate: string; totals: { totalCents: number }; channel: string; status: string }[];
      total: number;
      summary: { orderCount: number; salesCents: number; cancelledCount: number; averageCents: number; byChannel: Record<string, { orderCount: number; salesCents: number }> };
    };
  };
  const csv = async (qs: string) => {
    const res = await m.historyCsv.GET(kitchenRequest(`/api/kitchen/history/csv?${qs}`));
    const text = await res.text();
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    return { status: res.status, type: res.headers.get("content-type"), header: lines[0], rows: lines.slice(1) };
  };

  const range = "from=2026-09-01&to=2026-09-02";
  const p1 = await history(range);
  const p2 = await history(`${range}&page=2`);
  const inRange = created.filter((c) => c.date <= "2026-09-02");
  check("total counts every row in range (this tenant only)", p1.total === inRange.length, `${p1.total} vs ${inRange.length}`);
  check("page 1 holds 50", p1.orders.length === 50);
  check("page 2 holds the rest", p2.orders.length === inRange.length - 50, `${p2.orders.length}`);
  const listed = [...p1.orders, ...p2.orders];
  check(
    "newest first",
    listed.every((o, i) => i === 0 || o.businessDate <= listed[i - 1].businessDate),
  );
  const live = inRange.filter((c) => !c.cancelled);
  check(
    "summary excludes CANCELLED from count and sales",
    p1.summary.orderCount === live.length &&
      p1.summary.salesCents === live.reduce((n, c) => n + c.total, 0) &&
      p1.summary.cancelledCount === inRange.length - live.length,
    JSON.stringify(p1.summary).slice(0, 200),
  );
  check(
    "channel split adds up",
    Object.values(p1.summary.byChannel).reduce((n, c) => n + c.salesCents, 0) === p1.summary.salesCents &&
      p1.summary.byChannel.phone.orderCount === live.filter((c) => c.channel === "phone").length,
  );

  const all = await csv(range);
  check("CSV is text/csv", all.status === 200 && (all.type ?? "").startsWith("text/csv"), `${all.status} ${all.type}`);
  check("CSV header", all.header === "order_number,business_date,created_at,customer,phone,channel,items,subtotal,tax,total,status,table,guests,addon,station");
  const csvNumbers = all.rows.map((r) => `${r.split(",")[1]}/${r.split(",")[0]}`);
  const listNumbers = listed.map((o) => `${o.businessDate}/${o.orderNumber}`);
  check("CSV rows are the listed rows, in the same order", JSON.stringify(csvNumbers) === JSON.stringify(listNumbers), `${csvNumbers.length} vs ${listNumbers.length}`);
  const csvTotal = all.rows.reduce((n, r) => {
    const cols = r.split(",");
    // From the end: status, total sit before the three dine-in columns and station.
    return cols[cols.length - 5] === "CANCELLED" ? n : n + Math.round(Number(cols[cols.length - 6]) * 100);
  }, 0);
  check("CSV totals (excluding cancelled) equal the summary", csvTotal === p1.summary.salesCents, `${csvTotal} vs ${p1.summary.salesCents}`);

  const filtered = "from=2026-09-01&to=2026-09-03&channel=phone,walk_in&status=QUEUED";
  const f = await history(filtered);
  const fc = await csv(filtered);
  const fExpected = created.filter((c) => c.channel !== "web" && !c.cancelled);
  check("channel + status filter", f.total === fExpected.length && f.orders.every((o) => o.channel !== "web" && o.status === "QUEUED"), `${f.total} vs ${fExpected.length}`);
  check("filtered CSV has the same rows", fc.rows.length === f.total);
  check(
    "filtered CSV total equals filtered summary",
    fc.rows.reduce((n, r) => n + Math.round(Number(r.split(",").at(-6)) * 100), 0) === f.summary.salesCents,
  );

  const byPhone = await history("from=2026-09-01&to=2026-09-03&q=555-8877");
  check("search: partial phone", byPhone.total === 1 && byPhone.orders[0].orderNumber === created[7].number);
  const byName = await history("from=2026-09-01&to=2026-09-03&q=wong");
  check("search: name, case-insensitive", byName.total === 1);
  const byNumber = await history("from=2026-09-03&to=2026-09-03&q=A-003");
  check("search: order number", byNumber.total === 1 && byNumber.orders[0].orderNumber === "A-003");
  const byStoreNumber = await history("from=2026-09-03&to=2026-09-03&q=B-005");
  check("search: a store B- number", byStoreNumber.total === 1 && byStoreNumber.orders[0].orderNumber === "B-005", byStoreNumber.orders.map((o) => o.orderNumber).join(","));
  const bad = await m.history.GET(kitchenRequest("/api/kitchen/history?from=2026-09-03&to=2026-09-01"));
  check("a reversed range is a 400", bad.status === 400);
  const anon = await m.history.GET(new Request("https://example.test/api/kitchen/history?from=2026-09-01&to=2026-09-01"));
  check("history without a session is a 401", anon.status === 401);
}

async function s5_repeatCustomer(m: Mods): Promise<void> {
  console.log("\n5. repeat-customer lookup: this tenant, this phone, newest three");
  await resetTenant(m);
  await resetTenant(m, OTHER_TENANT);
  const base = {
    orderNumberPrefix: "A",
    items: [],
    totals: { subtotalCents: 100, taxCents: 9, tipCents: 0, totalCents: 109 },
    phoneVerifiedAt: new Date(),
    pickupAt: new Date(),
  };
  const mine: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { order } = await m.repo.createOrder({
      ...base,
      tenantId: TENANT,
      businessDate: `2026-09-1${i}`,
      idempotencyKey: `rc-${i}`,
      customer: { name: i === 3 ? "Mr. Lee (latest)" : "Mr. Lee", phone: "+16195554242" },
      channel: "phone",
    });
    mine.push(order.id);
  }
  await m.repo.createOrder({ ...base, tenantId: TENANT, businessDate: "2026-09-15", idempotencyKey: "rc-other-phone", customer: { name: "Other", phone: "+16195554243" } });
  await m.repo.createOrder({ ...base, tenantId: OTHER_TENANT, businessDate: "2026-09-16", idempotencyKey: "rc-other-tenant", customer: { name: "Other tenant", phone: "+16195554242" } });

  const res = await m.customers.GET(kitchenRequest("/api/kitchen/customers?phone=(619)%20555-4242"));
  const body = (await res.json()) as { ok: boolean; name: string | null; orders: { id: number }[] };
  check("lookup succeeds", res.status === 200 && body.ok);
  check("returns three orders", body.orders.length === 3, `${body.orders.length}`);
  check("only this tenant's orders for this phone", body.orders.every((o) => mine.includes(o.id)));
  check("newest first", JSON.stringify(body.orders.map((o) => o.id)) === JSON.stringify([...mine].reverse().slice(0, 3)));
  check("name from the latest order", body.name === "Mr. Lee (latest)", String(body.name));
  const none = await m.customers.GET(kitchenRequest("/api/kitchen/customers?phone=6195550000"));
  check("an unknown phone returns nothing", ((await none.json()) as { orders: unknown[] }).orders.length === 0);
}

async function s6_lunchAndSoup(m: Mods): Promise<void> {
  console.log("\n6. lunch-special gating (on, off, override) and the no-soup rule");
  const opts = { timezone: TIMEZONE, leadMinutes: 20, intervalMinutes: 15 };
  const noonPT = new Date("2026-10-13T19:00:00Z"); // Tue 12:00 PDT
  const fourPT = new Date("2026-10-13T23:00:00Z"); // Tue 16:00 PDT
  const allowed = (now: Date, override: boolean) =>
    m.compose.staffLunchAllowed({ now, opts, override, bypass: false });
  check("12:00: lunch allowed", allowed(noonPT, false) === true);
  check("16:00: lunch refused", allowed(fourPT, false) === false);
  check("16:00 with the override: allowed", allowed(fourPT, true) === true);

  const menu = m.catalog.catalogMenu();
  const lunch = menu.categories.flatMap((c) => c.items).find((i) => i.lunchSpecial);
  check("there is a lunch special to test with", !!lunch);
  if (!lunch) return;
  const line = defaultLine(m, lunch.id);
  const off = m.compose.composeOrder(menu, [line], { taxRateBps: 875, lunchAllowed: allowed(fourPT, false) });
  check("composeOrder refuses it at 16:00", off.ok === false);
  const on = m.compose.composeOrder(menu, [line], { taxRateBps: 875, lunchAllowed: allowed(fourPT, true) });
  check("composeOrder accepts it at 16:00 with the override", on.ok === true);

  // The route itself, with the override and no bypass, when the store is open.
  const now = new Date();
  const slots = m.pickup.staffPickupSlots(now, opts);
  if (slots.length > 0) {
    m.rate.resetRateLimits();
    const withOverride = await staffPost(m, staffBody([line], { pickup: { time: slots[0].value }, lunchOverride: true }), { bypass: false });
    check("route: lunch special + override accepted", withOverride.status === 200, JSON.stringify(withOverride.body).slice(0, 160));
    const without = await staffPost(m, staffBody([line], { pickup: { time: slots[0].value } }), { bypass: false });
    const lunchNow = m.gates.isLunchService(now, opts);
    check(`route: without override ${lunchNow ? "accepted (it is lunch)" : "refused (not lunch)"}`, (without.status === 200) === lunchNow, `status=${without.status}`);
  } else {
    console.log("   · store closed right now; route-level lunch check covered by the fixed-clock checks above");
  }

  const staff = m.catalog.staffCatalogMenu();
  const lunchStaff = staff.categories.flatMap((c) => c.items).filter((i) => i.lunchSpecial);
  check(
    "no-soup rule: no staff lunch special lists soup as included",
    lunchStaff.length > 0 &&
      lunchStaff.every((i) => (i.description ?? "").replace("Soup is not included on to-go orders.", "").search(/soup/i) === -1),
  );
  check(
    "no-soup rule: every staff lunch special says so",
    lunchStaff.every((i) => (i.description ?? "").includes("Soup is not included on to-go orders.")),
  );
  const duck = staff.categories.flatMap((c) => c.items).find((i) => i.id === "roasted-duck");
  check("staff menu shows the 86'd item, marked unavailable", duck?.available === false);
  check("the web menu does not", !menu.categories.flatMap((c) => c.items).some((i) => i.id === "roasted-duck"));
}

async function s7_cancelAndValidation(m: Mods): Promise<void> {
  console.log("\n7. cancel never re-offers; phone rules; auth");
  await resetTenant(m);
  const created = await staffPost(m, staffBody([defaultLine(m, "egg-rolls")]));
  const id = Number((created.body.order as { id: number }).id);
  const act = (action: string, extra: Record<string, unknown> = {}) =>
    m.orderAction.POST(
      kitchenRequest(`/api/kitchen/orders/${id}`, { method: "POST", body: JSON.stringify({ action, ...extra }) }),
      { params: Promise.resolve({ id: String(id) }) },
    );
  const cancel = await act("cancel", { note: "customer called back to cancel" });
  const after = await m.repo.getOrderById(TENANT, id);
  check("cancel answers ok", cancel.status === 200);
  check("status CANCELLED with the note", after?.status === "CANCELLED" && (after?.staffNote ?? "").includes("customer called back"));
  check("the printer is not offered a cancelled order", (await pollPrinter(m)).jobReady === false);
  const reprint = await act("reprint");
  check("reprint of a cancelled order is refused (409)", reprint.status === 409, `status=${reprint.status}`);
  check("and it stays CANCELLED", (await m.repo.getOrderById(TENANT, id))?.status === "CANCELLED");
  check("still not offered", (await pollPrinter(m)).jobReady === false);

  const noPhone = await staffPost(m, staffBody([defaultLine(m, "egg-rolls")], { customer: { name: "No Phone" } }));
  check("phone order without a phone is refused", noPhone.body.code === "phone_required");
  const walkIn = await staffPost(m, staffBody([defaultLine(m, "egg-rolls")], { channel: "walk_in", customer: { name: "Walk In" } }));
  check("walk-in without a phone is accepted", walkIn.status === 200, JSON.stringify(walkIn.body).slice(0, 120));
  const badPhone = await staffPost(m, staffBody([defaultLine(m, "egg-rolls")], { customer: { name: "X", phone: "123" } }));
  check("a malformed phone is refused", badPhone.body.code === "phone_invalid");
  const noName = await staffPost(m, staffBody([defaultLine(m, "egg-rolls")], { customer: { name: "  ", phone: "6195550111" } }));
  check("a blank name is refused", noName.status === 400);

  const saved = kitchenCookie;
  kitchenCookie = "";
  const anon = await staffPost(m, staffBody([defaultLine(m, "egg-rolls")]));
  kitchenCookie = saved;
  check("no session, no order (401)", anon.status === 401);

  const key = nextKey();
  const a = await staffPost(m, staffBody([defaultLine(m, "egg-rolls")], { idempotencyKey: key }));
  const b = await staffPost(m, staffBody([defaultLine(m, "egg-rolls")], { idempotencyKey: key }));
  check(
    "a double-tap is one order",
    (a.body.order as { id: number }).id === (b.body.order as { id: number }).id && b.body.duplicate === true,
  );
}

async function s8_perPhoneCap(m: Mods): Promise<void> {
  console.log("\n8. the per-phone daily cap is web-only: staff orders neither hit it nor count toward it");
  await resetTenant(m);
  const prev = process.env.MAX_ORDERS_PER_PHONE_PER_DAY;
  process.env.MAX_ORDERS_PER_PHONE_PER_DAY = "5";
  try {
    const line = defaultLine(m, "egg-rolls");
    const today = m.biz.businessDateFor(TIMEZONE);

    // A regular who has already hit the web cap today.
    const capped = "6195550188";
    const cappedE164 = `+1${capped}`;
    const webs = [];
    for (let i = 0; i < 5; i++) webs.push(await webPost(m, [line], capped));
    check("5 web orders accepted", webs.every((r) => r.status === 200), webs.map((r) => r.status).join(","));

    const staff = await staffPost(m, staffBody([line], { customer: { name: "Regular", phone: capped } }));
    check("a staff phone order is still taken at 5 web orders", staff.status === 200 && staff.body.ok === true, `status=${staff.status} ${JSON.stringify(staff.body).slice(0, 120)}`);
    const walkIn = await staffPost(m, staffBody([line], { channel: "walk_in", customer: { name: "Regular", phone: capped } }));
    check("a staff walk-in order is still taken at 5 web orders", walkIn.status === 200 && walkIn.body.ok === true, `status=${walkIn.status}`);

    const count = await m.repo.countOrdersForPhone(TENANT, today, cappedE164);
    check("staff orders do not increment the counter", count === 5, `count=${count}`);

    const sixth = await webPost(m, [line], capped);
    check("a 6th web order is still refused", sixth.status === 429, `status=${sixth.status}`);

    // The other direction: staff orders earlier in the day leave the web
    // allowance untouched.
    const regular = "6195550189";
    for (let i = 0; i < 3; i++) {
      await staffPost(m, staffBody([line], { customer: { name: "Regular", phone: regular } }));
    }
    const after = [];
    for (let i = 0; i < 5; i++) after.push(await webPost(m, [line], regular));
    check(
      "3 staff orders first, then all 5 web orders still accepted",
      after.every((r) => r.status === 200),
      after.map((r) => r.status).join(","),
    );
    check("…and the 6th web order is refused", (await webPost(m, [line], regular)).status === 429);
  } finally {
    process.env.MAX_ORDERS_PER_PHONE_PER_DAY = prev;
  }
}

/* ---------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-staff-test-"));
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
  await admin.query(`create database ${DB_NAME} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();

  process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`;
  process.env.TENANT_ID = TENANT;
  process.env.RESTAURANT_TIMEZONE = TIMEZONE;
  process.env.TENANT_TIMEZONE = TIMEZONE;
  process.env.TENANT_TAX_RATE_BPS = "875";
  process.env.ORDER_NUMBER_PREFIX = "A";
  process.env.ADMIN_DASH_PASSWORD = PASSWORD;
  process.env.ORDER_GATE_BYPASS = BYPASS;
  process.env.OTP_SIGNING_SECRET = "verify-staff-orders-otp-secret-0123456789abcdef";
  process.env.CLOUDPRNT_SECRET = PRINT_SECRET;
  process.env.CLOUDPRNT_PRINTER_MAC = MAC;
  process.env.TICKET_COPIES = "1";
  process.env.PRINT_CONFIRM_FLOOR_SECONDS = "25";
  process.env.PRINT_SECONDS_PER_COPY = "0";
  process.env.MAX_ORDERS_PER_PHONE_PER_DAY = "50";
  delete process.env.PRINT_OFFER_CAP;
  delete process.env.PRINT_CONFIRM_TEST_DELAY_MS;
  delete process.env.TWILIO_ACCOUNT_SID;

  const pool = await import("../src/lib/db/postgres");
  await pool.ordersPool().query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));

  riceMod = await import("../src/lib/menu/rice");
  const m: Mods = {
    repo: await import("../src/lib/orders/repository"),
    pool,
    catalog: await import("../src/lib/menu/catalog"),
    compose: await import("../src/lib/orders/compose"),
    types: await import("../src/lib/menu/types"),
    render: await import("../src/lib/ticket/render"),
    otp: await import("../src/lib/otp/session"),
    session: await import("../src/lib/auth/kitchenSession"),
    rate: await import("../src/lib/http/rateLimit"),
    pickup: await import("../src/lib/order/pickup"),
    gates: await import("../src/lib/order/gates"),
    biz: await import("../src/lib/orders/businessDate"),
    webOrders: (await import("../src/app/api/orders/route")) as unknown as Mods["webOrders"],
    kitchenOrders: (await import("../src/app/api/kitchen/orders/route")) as unknown as Mods["kitchenOrders"],
    orderAction: (await import("../src/app/api/kitchen/orders/[id]/route")) as unknown as Mods["orderAction"],
    customers: (await import("../src/app/api/kitchen/customers/route")) as unknown as Mods["customers"],
    history: (await import("../src/app/api/kitchen/history/route")) as unknown as Mods["history"],
    historyCsv: (await import("../src/app/api/kitchen/history/csv/route")) as unknown as Mods["historyCsv"],
    print: (await import("../src/app/api/print/[secret]/route")) as unknown as Mods["print"],
  };
  kitchenCookie = `nmc_kitchen=${m.session.login(PASSWORD)}`;

  try {
    await s1_pricing(m);
    await s2_phoneOrderPrints(m);
    await s3_numbering(m);
    await s4_history(m);
    await s5_repeatCustomer(m);
    await s6_lunchAndSoup(m);
    await s7_cancelAndValidation(m);
    await s8_perPhoneCap(m);
  } finally {
    await pool.closeOrdersPool();
    console.log("\nstopping postgres…");
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(`\nstaff orders: ${passes}/${passes + failures} checks passed`);
  if (failures > 0) {
    console.log(`\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log("\none pipeline: staff orders price, number, print and report like web orders ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
