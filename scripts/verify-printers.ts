/**
 * Two printers: routing, failover, recovery, unknown printers, owner PIN,
 * owner texts.
 *
 *   npm run verify:printers
 *
 * The same real-things harness as verify:print-stale-reads: embedded Postgres
 * with the real schema.sql (which carries migration 011), the real repository,
 * the real CloudPRNT, kitchen, printers and cron route handlers, and the
 * Hyperdrive cache emulator in front of EVERY query for EVERY case, so a
 * routing decision taken from a cached row would show up here.
 *
 * Two simulated printers, each a MAC that POSTs polls, GETs by token and
 * DELETEs to confirm:
 *   MAC_A  'takeout': web
 *   MAC_B  'pos':     phone, walk_in, dine_in (and add-ons)
 *
 * Time passes the way the other print verifiers simulate it: back-date
 * last_seen_at / blocked_since / expires_at / alert stamps in the database,
 * and clear the cache when more than 60s would have gone by. SMS goes through
 * the real sendSms with fetch stubbed at api.twilio.com, so texts are counted
 * exactly as they would leave.
 *
 * Production numbers: 3 copies x 30s over a 60s floor = a 90s window, cap 4.
 *
 * Case ids match docs/SECOND_PRINTER_DESIGN.md §3. L2 (every existing check)
 * is the rest of the verify suite, run alongside this one.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import {
  installHyperdriveCacheEmulator,
  type CacheEmulator,
} from "./lib/hyperdrive-cache-emulator";

const PORT = 55447;
const DB_NAME = "nmc_printers_test";
const SECRET = "verify-printers-secret";
const TENANT = "printers-test";
const PASSWORD = "verify-printers-kitchen";
const OWNER_PIN = "2468";
const CRON = "verify-printers-cron";
const BASE = `https://example.test/api/print/${SECRET}`;
const MAC_A = "00:11:62:aa:00:01";
const MAC_B = "00:11:62:bb:00:02";
const MAC_C = "00:11:62:cc:00:03";
const BUSINESS_DATE = "2026-11-05";

type Handler = (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
interface PrintRoute {
  POST: Handler;
  GET: Handler;
  DELETE: Handler;
}
interface PlainRoute {
  GET: (r: Request) => Promise<Response>;
  POST?: (r: Request) => Promise<Response>;
}
const params = Promise.resolve({ secret: SECRET });

interface Deps {
  repo: typeof import("../src/lib/orders/repository");
  printers: typeof import("../src/lib/print/printers");
  render: typeof import("../src/lib/ticket/render");
  starprnt: typeof import("../src/lib/ticket/starprnt");
  config: typeof import("../src/config/tenant.server");
  floor: typeof import("../src/lib/kitchen/floor-plan");
  rateLimit: typeof import("../src/lib/http/rateLimit");
  ordersPool: typeof import("../src/lib/db/postgres").ordersPool;
  cache: CacheEmulator;
  print: PrintRoute;
  kitchen: PlainRoute;
  printersApi: Required<PlainRoute>;
  cron: PlainRoute;
  cookie: string;
}

/* ------------------------------------------------------------- results -- */

const results: { id: string; name: string; passed: boolean; detail: string }[] = [];
let currentCase = "";
function check(name: string, passed: boolean, detail = ""): void {
  results.push({ id: currentCase, name, passed, detail });
  console.log(`   ${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function begin(id: string, title: string): void {
  currentCase = id;
  console.log(`\n${id}. ${title}`);
}

/* ------------------------------------------------------------ captures -- */

const warnings: string[] = [];
const realWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(" "));
  if (process.env.VERBOSE) realWarn(...args);
};
const realInfo = console.info.bind(console);
console.info = (...args: unknown[]) => {
  if (process.env.VERBOSE) realInfo(...args);
};

const sms: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("api.twilio.com")) {
    const body = new URLSearchParams(String(init?.body ?? ""));
    sms.push(body.get("Body") ?? "");
    return new Response(JSON.stringify({ sid: "SM-test" }), { status: 201 });
  }
  return realFetch(input, init);
}) as typeof fetch;

/* ------------------------------------------------------------- printer -- */

interface PollAnswer {
  jobReady: boolean;
  token: string | null;
}

async function poll(d: Deps, mac: string, statusCode = "200 OK"): Promise<PollAnswer> {
  const res = await d.print.POST(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusCode, printerMAC: mac }),
    }),
    { params },
  );
  const body = (await res.json()) as { jobReady?: boolean; jobToken?: string };
  return { jobReady: body.jobReady === true, token: body.jobToken ?? null };
}

async function fetchJob(d: Deps, mac: string, token: string): Promise<{ status: number; bytes: Uint8Array }> {
  const url = `${BASE}?token=${encodeURIComponent(token)}&mac=${encodeURIComponent(mac)}&type=application/vnd.star.starprnt`;
  const res = await d.print.GET(new Request(url), { params });
  const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array();
  return { status: res.status, bytes };
}

async function confirm(d: Deps, mac: string, token: string): Promise<number> {
  const url = `${BASE}?mac=${encodeURIComponent(mac)}&code=OK&token=${encodeURIComponent(token)}`;
  const res = await d.print.DELETE(new Request(url, { method: "DELETE" }), { params });
  return res.status;
}

/** One full print cycle: poll, fetch, confirm. Returns the order it printed. */
async function printNext(d: Deps, mac: string): Promise<number | null> {
  const p = await poll(d, mac);
  if (!p.token) return null;
  await fetchJob(d, mac, p.token);
  const del = await delivery(d, p.token);
  await confirm(d, mac, p.token);
  return del.order_id;
}

/* ---------------------------------------------------------- db helpers -- */

interface DeliveryRow {
  id: string;
  order_id: number;
  reason: string;
  printer_id: string | null;
  rerouted_from_printer_id: string | null;
  rerouted_from_role: string | null;
  copy_roles: string[] | null;
  offered_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
}

async function delivery(d: Deps, id: string): Promise<DeliveryRow> {
  const { rows } = await d.ordersPool().query(
    `select id, order_id::int, reason, printer_id, rerouted_from_printer_id, rerouted_from_role,
            copy_roles, offered_at, expires_at, confirmed_at
       from print_deliveries where id = $1 for update`,
    [id],
  );
  return rows[0] as DeliveryRow;
}

async function deliveriesFor(d: Deps, orderId: number): Promise<DeliveryRow[]> {
  const { rows } = await d.ordersPool().query(
    `select id, order_id::int, reason, printer_id, rerouted_from_printer_id, rerouted_from_role,
            copy_roles, offered_at, expires_at, confirmed_at
       from print_deliveries
      where tenant_id = $1 and order_id = $2 and reason <> 'manual_reprint'
      order by offered_at, created_at for update`,
    [TENANT, orderId],
  );
  return rows as DeliveryRow[];
}

interface OrderRow {
  status: string;
  print_attempts: number;
  print_printer_id: string | null;
  print_segment: number;
  print_segments: number;
  print_job_key: string | null;
  channel: string;
}

async function orderRow(d: Deps, id: number): Promise<OrderRow> {
  const { rows } = await d.ordersPool().query(
    `select status, print_attempts, print_printer_id, print_segment, print_segments,
            print_job_key, channel
       from orders where tenant_id = $1 and id = $2 for update`,
    [TENANT, id],
  );
  return rows[0] as OrderRow;
}

async function printerId(d: Deps, mac: string): Promise<string> {
  const norm = mac.replace(/[^0-9a-f]/gi, "").toLowerCase();
  const { rows } = await d.ordersPool().query(
    `select id from printers where tenant_id = $1 and mac = $2 for update`,
    [TENANT, norm],
  );
  return String(rows[0]?.id ?? "");
}

/** The printer has not polled for `seconds`. */
async function silence(d: Deps, mac: string, seconds: number): Promise<void> {
  await d.ordersPool().query(
    `update printer_health h set last_seen_at = now() - make_interval(secs => $3)
       from printers p
      where p.id = h.printer_id and p.tenant_id = $1 and p.mac = $2`,
    [TENANT, mac.replace(/[^0-9a-f]/gi, "").toLowerCase(), seconds],
  );
  d.cache.clear();
}

/** The printer's blocked spell began `seconds` ago (it must already be blocked). */
async function blockedFor(d: Deps, mac: string, seconds: number): Promise<void> {
  await d.ordersPool().query(
    `update printer_health h set blocked_since = now() - make_interval(secs => $3)
       from printers p
      where p.id = h.printer_id and p.tenant_id = $1 and p.mac = $2 and h.blocked_since is not null`,
    [TENANT, mac.replace(/[^0-9a-f]/gi, "").toLowerCase(), seconds],
  );
  d.cache.clear();
}

/** The in-flight delivery's window has passed. */
async function expireInFlight(d: Deps, orderId: number): Promise<void> {
  const pool = d.ordersPool();
  await pool.query(
    `update print_deliveries
        set offered_at = offered_at - interval '95 seconds', expires_at = expires_at - interval '95 seconds'
      where tenant_id = $1 and id = (select print_delivery_id from orders where tenant_id = $1 and id = $2)`,
    [TENANT, orderId],
  );
  await pool.query(
    `update orders
        set print_delivery_expires_at = print_delivery_expires_at - interval '95 seconds',
            print_offered_at = print_offered_at - interval '95 seconds'
      where tenant_id = $1 and id = $2`,
    [TENANT, orderId],
  );
  d.cache.clear();
}

let seq = 0;
const cacheTotals = { hits: 0, misses: 0 };
async function seed(
  d: Deps,
  channel: "web" | "phone" | "walk_in" | "dine_in",
  dine?: { table: string; addon?: boolean },
): Promise<number> {
  seq++;
  const { order } = await d.repo.createOrder({
    tenantId: TENANT,
    businessDate: BUSINESS_DATE,
    orderNumberPrefix: "A",
    idempotencyKey: `printers-${seq}-${Date.now()}`,
    items: [
      {
        itemId: "kung-pao-chicken",
        nameEn: "Kung Pao Chicken",
        nameZh: "宮保雞丁",
        sizeId: "individual",
        sizeLabel: "Individual",
        sizeLabelZh: "單點",
        modifiers: [],
        quantity: 1,
        unitCents: 2250,
        lineCents: 2250,
      },
    ],
    totals: { subtotalCents: 2250, taxCents: 197, tipCents: 0, totalCents: 2447 },
    customer: { name: `Printer Test ${seq}`, phone: "+16195550000" },
    phoneVerifiedAt: new Date(),
    pickupAt: new Date(Date.now() + 25 * 60_000),
    channel,
    dineIn:
      channel === "dine_in" && dine
        ? {
            tableLabel: dine.table,
            tableIds: d.floor.tablesForLabel(dine.table) ?? [dine.table],
            guestCount: 2,
            isAddon: dine.addon === true,
          }
        : null,
  });
  // Distinct created_at, oldest first, so "oldest" is unambiguous. Kept well
  // inside the per-order alert's 120s, so that sweep stays quiet and every
  // text counted here is a printer text.
  await d.ordersPool().query(
    `update orders set created_at = now() - make_interval(secs => $2) where id = $1`,
    [order.id, 30 - seq / 1000],
  );
  return order.id;
}

async function wipe(d: Deps): Promise<void> {
  const pool = d.ordersPool();
  await pool.query("delete from orders where tenant_id = $1", [TENANT]);
  await pool.query("delete from printers where tenant_id = $1", [TENANT]);
  await pool.query("delete from print_routes where tenant_id = $1", [TENANT]);
  await pool.query("delete from print_alert_state where tenant_id = $1", [TENANT]);
  await pool.query("delete from printer_config_audit where tenant_id = $1", [TENANT]);
  d.cache.clear();
  cacheTotals.hits += d.cache.hits;
  cacheTotals.misses += d.cache.misses;
  d.cache.resetStats();
  d.rateLimit.resetRateLimits();
  warnings.length = 0;
  sms.length = 0;
}

/**
 * A and B, as they will be after the live setup: A bootstrapped as takeout,
 * B assigned 'pos', and phone / walk_in / dine_in routed to pos.
 */
async function twoPrinters(d: Deps): Promise<{ a: string; b: string }> {
  await wipe(d);
  await poll(d, MAC_A); // bootstraps A: active takeout, every channel -> takeout
  await poll(d, MAC_B); // unknown: stored unassigned
  const a = await printerId(d, MAC_A);
  const b = await printerId(d, MAC_B);
  await d.printers.assignPrinter(TENANT, b, { role: "pos", name: "POS機 POS printer" }, "test");
  for (const ch of ["phone", "walk_in", "dine_in"] as const) {
    await d.printers.setRoute(TENANT, ch, "pos", "test");
  }
  d.cache.clear();
  warnings.length = 0;
  return { a, b };
}

/** What the route should have served for this order and delivery shape. */
async function expectedBytes(
  d: Deps,
  orderId: number,
  copyRoles: string[],
  rerouted: "takeout" | "pos" | null,
): Promise<Uint8Array> {
  const order = await d.repo.getOrderById(TENANT, orderId);
  if (!order) throw new Error("order vanished");
  const job = await d.render.renderTicketJob(
    order,
    {
      timezone: d.config.publicTenant().timezone,
      copies: copyRoles.length,
      copyRoles: copyRoles as never,
      rerouted: rerouted ? { fromRole: rerouted } : null,
    },
    { format: "starprnt", maxHeight: d.starprnt.maxStarPrntRows(d.render.TICKET_WIDTH_PX), segment: 0 },
  );
  return job.body;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function kitchenGet(d: Deps, path: string, route: PlainRoute) {
  const res = await route.GET(
    new Request(`https://example.test${path}`, { headers: { cookie: `nmc_kitchen=${d.cookie}` } }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function ownerChange(d: Deps, pin: string, change: unknown, withSession = true) {
  const res = await d.printersApi.POST(
    new Request("https://localhost/api/kitchen/printers", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        ...(withSession ? { cookie: `nmc_kitchen=${d.cookie}` } : {}),
      },
      body: JSON.stringify({ pin, change }),
    }),
  );
  return { status: res.status, body: (await res.json()) as { ok: boolean; code?: string } };
}

async function sweep(d: Deps): Promise<void> {
  await d.cron.GET(
    new Request("https://example.test/api/cron/unprinted-alert", {
      headers: { authorization: `Bearer ${CRON}` },
    }),
  );
}

const ENV_ROLES = ["kitchen", "bag", "register"];

/* ------------------------------------------------------------- routing -- */

async function r1(d: Deps): Promise<void> {
  begin("R1", "each channel prints on its home printer, and only there");
  const { a, b } = await twoPrinters(d);
  const web = await seed(d, "web");
  const phone = await seed(d, "phone");
  const walk = await seed(d, "walk_in");
  const dine = await seed(d, "dine_in", { table: "1" });
  const addon = await seed(d, "dine_in", { table: "1", addon: true });

  const byB: number[] = [];
  for (let i = 0; i < 5; i++) {
    const id = await printNext(d, MAC_B);
    if (id !== null) byB.push(id);
  }
  const byA: number[] = [];
  for (let i = 0; i < 3; i++) {
    const id = await printNext(d, MAC_A);
    if (id !== null) byA.push(id);
  }
  const all = [web, phone, walk, dine, addon];
  const ds = (await Promise.all(all.map((id) => deliveriesFor(d, id)))).flat();
  check("web printed on A, and A printed nothing else", byA.join() === String(web), `A printed ${byA.join(",")}`);
  check(
    "phone, walk_in, dine_in and the add-on printed on B, oldest first",
    byB.join() === [phone, walk, dine, addon].join(),
    `B printed ${byB.join(",")}`,
  );
  check("B never received the web order", !byB.includes(web));
  check(
    "every delivery names the printer it went to",
    ds.every((x) => x.printer_id === (x.order_id === web ? a : b)),
  );
  check("nothing rerouted", ds.every((x) => x.rerouted_from_role === null));
  check(
    "all five PRINTED",
    (await Promise.all(all.map((id) => orderRow(d, id)))).every((o) => o.status === "PRINTED"),
  );
}

async function r2(d: Deps): Promise<void> {
  begin("R2", "A and B each hold a live delivery at the same time");
  await twoPrinters(d);
  const web = await seed(d, "web");
  const phone = await seed(d, "phone");
  const pa = await poll(d, MAC_A);
  const pb = await poll(d, MAC_B);
  const both = (await orderRow(d, web)).print_attempts === 1 && (await orderRow(d, phone)).print_attempts === 1;
  check("both printers were handed a job concurrently", pa.jobReady && pb.jobReady && pa.token !== pb.token && both);
  await fetchJob(d, MAC_A, pa.token!);
  await fetchJob(d, MAC_B, pb.token!);
  await confirm(d, MAC_A, pa.token!);
  const midPhone = await orderRow(d, phone);
  await confirm(d, MAC_B, pb.token!);
  check("confirming A's delivery left B's order untouched", midPhone.status === "QUEUED", `phone=${midPhone.status}`);
  check(
    "both orders PRINTED, each by its own confirmation",
    (await orderRow(d, web)).status === "PRINTED" &&
      (await orderRow(d, phone)).status === "PRINTED" &&
      (await delivery(d, pa.token!)).confirmed_at !== null &&
      (await delivery(d, pb.token!)).confirmed_at !== null,
  );
}

async function r3(d: Deps): Promise<void> {
  begin("R3", "race: 40 orders, both printers polling concurrently until drained");
  const { a, b } = await twoPrinters(d);
  const ids: number[] = [];
  for (let i = 0; i < 40; i++) ids.push(await seed(d, i % 2 === 0 ? "web" : i % 4 === 1 ? "phone" : "walk_in"));
  const drain = async (mac: string) => {
    let idle = 0;
    while (idle < 3) {
      const id = await printNext(d, mac);
      idle = id === null ? idle + 1 : 0;
    }
  };
  await Promise.all([drain(MAC_A), drain(MAC_B)]);
  const rows = await Promise.all(ids.map((id) => orderRow(d, id)));
  const ds = await Promise.all(ids.map((id) => deliveriesFor(d, id)));
  check("all 40 PRINTED", rows.every((o) => o.status === "PRINTED"), `${rows.filter((o) => o.status === "PRINTED").length}/40`);
  check("exactly one delivery per order (no duplicates)", ds.every((x) => x.length === 1), `max ${Math.max(...ds.map((x) => x.length))}`);
  check(
    "every order printed on its home printer",
    ds.every((x, i) => x[0]?.printer_id === (rows[i].channel === "web" ? a : b)),
  );
}

async function r4(d: Deps): Promise<void> {
  begin("R4", "route change mid-queue: unclaimed orders follow it, in-flight stays");
  const { a, b } = await twoPrinters(d);
  const p1 = await seed(d, "phone");
  const p2 = await seed(d, "phone");
  const p3 = await seed(d, "phone");
  const held = await poll(d, MAC_B); // p1 in flight on B
  await d.printers.setRoute(TENANT, "phone", "takeout", "test");
  d.cache.clear();
  const aFirst = await printNext(d, MAC_A);
  const bAgain = await poll(d, MAC_B);
  await fetchJob(d, MAC_B, held.token!);
  await confirm(d, MAC_B, held.token!);
  const aSecond = await printNext(d, MAC_A);
  check("A picked up the next unclaimed phone order", aFirst === p2 && aSecond === p3, `A printed ${aFirst},${aSecond}`);
  check("B held its in-flight order (no second hand-over)", !bAgain.jobReady);
  check(
    "p1 finished on B; p2, p3 on A; none rerouted",
    (await orderRow(d, p1)).print_printer_id === b &&
      (await orderRow(d, p2)).print_printer_id === a &&
      (await orderRow(d, p3)).print_printer_id === a &&
      (await Promise.all([p1, p2, p3].map((id) => deliveriesFor(d, id)))).flat().every((x) => x.rerouted_from_role === null),
  );
}

async function c1(d: Deps): Promise<void> {
  begin("C1", "copies per channel: today's by default, editable without a restart");
  await twoPrinters(d);
  const dine = await seed(d, "dine_in", { table: "2" });
  const p = await poll(d, MAC_B);
  const served = await fetchJob(d, MAC_B, p.token!);
  const del = await delivery(d, p.token!);
  const expected = await expectedBytes(d, dine, ENV_ROLES, null);
  await confirm(d, MAC_B, p.token!);
  check("seeded dine_in delivery carries today's env copy set", (del.copy_roles ?? []).join() === ENV_ROLES.join(), `${del.copy_roles}`);
  check(
    "dine-in ticket is byte-identical to the env-copies render",
    sameBytes(served.bytes, expected),
    `${served.bytes.length} vs ${expected.length} bytes`,
  );
  check(
    "window is the 3-copy 90s",
    Math.round((+del.expires_at - +del.offered_at) / 1000) === 90,
  );

  await d.printers.setCopies(TENANT, "dine_in", ["kitchen"], "test");
  d.cache.clear();
  const addon = await seed(d, "dine_in", { table: "2", addon: true });
  const p2 = await poll(d, MAC_B);
  const served2 = await fetchJob(d, MAC_B, p2.token!);
  const del2 = await delivery(d, p2.token!);
  const expected2 = await expectedBytes(d, addon, ["kitchen"], null);
  await confirm(d, MAC_B, p2.token!);
  check("after the edit, the add-on prints ONE kitchen copy", (del2.copy_roles ?? []).join() === "kitchen" && sameBytes(served2.bytes, expected2));
  check("its window is the 1-copy floor, 60s", Math.round((+del2.expires_at - +del2.offered_at) / 1000) === 60);

  const web = await seed(d, "web");
  const p3 = await poll(d, MAC_A);
  const del3 = await delivery(d, p3.token!);
  await fetchJob(d, MAC_A, p3.token!);
  await confirm(d, MAC_A, p3.token!);
  check("web still prints today's copies", del3.order_id === web && (del3.copy_roles ?? []).join() === ENV_ROLES.join());
}

/* ------------------------------------------------------------ failover -- */

async function f1(d: Deps): Promise<void> {
  begin("F1", "A silent 61s, nothing in flight: a web order goes to B, REROUTED");
  const { a } = await twoPrinters(d);
  await silence(d, MAC_A, 61);
  const web = await seed(d, "web");
  const p = await poll(d, MAC_B);
  const del = p.token ? await delivery(d, p.token) : null;
  const served = p.token ? await fetchJob(d, MAC_B, p.token) : null;
  check("B was handed the web order", del?.order_id === web);
  check("the delivery is marked rerouted from A (takeout)", del?.rerouted_from_printer_id === a && del?.rerouted_from_role === "takeout");
  const withHeader = await expectedBytes(d, web, ENV_ROLES, "takeout");
  const plain = await expectedBytes(d, web, ENV_ROLES, null);
  check(
    "the served ticket carries the 轉印 REROUTED header",
    !!served && sameBytes(served.bytes, withHeader) && !sameBytes(served.bytes, plain),
    `${served?.bytes.length} bytes; with header ${withHeader.length}, plain ${plain.length}`,
  );
}

async function f2(d: Deps): Promise<void> {
  begin("F2", "A dies holding a live delivery: B waits for expiry, then takes it over");
  const { b } = await twoPrinters(d);
  const web = await seed(d, "web");
  const pa = await poll(d, MAC_A);
  await fetchJob(d, MAC_A, pa.token!);
  await silence(d, MAC_A, 61);
  const early: PollAnswer[] = [];
  for (let i = 0; i < 3; i++) early.push(await poll(d, MAC_B));
  check("B gets nothing while A's delivery is live (busy, not dead)", early.every((x) => !x.jobReady));
  await expireInFlight(d, web);
  const pb = await poll(d, MAC_B);
  const del = pb.token ? await delivery(d, pb.token) : null;
  const row = await orderRow(d, web);
  check("after expiry B takes it over as a retry, REROUTED", del?.order_id === web && del.reason === "retry" && del.printer_id === b && del.rerouted_from_role === "takeout");
  check("from piece 1 with a fresh budget", row.print_attempts === 1 && row.print_segment === 0 && row.print_job_key === null, JSON.stringify(row));
  await confirm(d, MAC_A, pa.token!); // A's late confirmation of the superseded delivery
  const afterLate = await orderRow(d, web);
  const oldDel = await delivery(d, pa.token!);
  check("A's late confirm is a stale-confirm: nothing recorded", afterLate.status === "QUEUED" && oldDel.confirmed_at === null);
  await fetchJob(d, MAC_B, pb.token!);
  await confirm(d, MAC_B, pb.token!);
  check("B's confirm prints it", (await orderRow(d, web)).status === "PRINTED");
}

async function f3(d: Deps): Promise<void> {
  begin("F3", "split ticket: A dies after piece 1 of 2, B prints the whole ticket");
  await twoPrinters(d);
  const web = await seed(d, "web");
  const pa = await poll(d, MAC_A);
  await fetchJob(d, MAC_A, pa.token!);
  // Make it a 2-piece ticket, then confirm piece 1.
  await d.ordersPool().query(`update orders set print_segments = 2 where id = $1`, [web]);
  d.cache.clear();
  await confirm(d, MAC_A, pa.token!);
  const mid = await orderRow(d, web);
  check("piece 1 confirmed; cursor on piece 2", mid.status === "QUEUED" && mid.print_segment === 1, JSON.stringify(mid));
  await silence(d, MAC_A, 61);
  const pb = await poll(d, MAC_B);
  const row = await orderRow(d, web);
  const del = pb.token ? await delivery(d, pb.token) : null;
  check("B took it over from piece 1, REROUTED", del?.order_id === web && row.print_segment === 0 && del.rerouted_from_role === "takeout", JSON.stringify(row));
  await fetchJob(d, MAC_B, pb.token!);
  await confirm(d, MAC_B, pb.token!);
  check("B's whole ticket completes the order", (await orderRow(d, web)).status === "PRINTED");
}

async function f4(d: Deps): Promise<void> {
  begin("F4", "paper-out and cover-open: wait under 60s, fail over at 60s");
  for (const [label, status] of [["paper-out", "Paper Empty"], ["cover-open", "Cover Open"]] as const) {
    await twoPrinters(d);
    await poll(d, MAC_A, status);
    const web = await seed(d, "web");
    const bEarly = await poll(d, MAC_B);
    const aEarly = await poll(d, MAC_A, status);
    const early = await orderRow(d, web);
    check(`${label} 30s: no one is handed the web order, no budget spent`, !bEarly.jobReady && !aEarly.jobReady && early.print_attempts === 0);
    await blockedFor(d, MAC_A, 61);
    const b = await poll(d, MAC_B);
    const del = b.token ? await delivery(d, b.token) : null;
    check(`${label} 61s: B prints it, REROUTED`, del?.order_id === web && del.rerouted_from_role === "takeout");
  }
}

async function f5(d: Deps): Promise<void> {
  begin("F5", "both printers down: nothing moves, the board says both");
  await twoPrinters(d);
  const web = await seed(d, "web");
  const phone = await seed(d, "phone");
  await silence(d, MAC_A, 61);
  await silence(d, MAC_B, 61);
  await sweep(d);
  const board = await kitchenGet(d, "/api/kitchen/orders?completed=0", d.kitchen);
  const printers = (board.body.printers ?? []) as Array<{ label: string; health: string; down: boolean; coveredBy: string | null }>;
  check("both shown offline with no one covering", printers.length === 2 && printers.every((p) => p.health === "offline" && p.down && p.coveredBy === null), JSON.stringify(printers.map((p) => [p.health, p.coveredBy])));
  const rows = [await orderRow(d, web), await orderRow(d, phone)];
  check("orders wait QUEUED, untouched", rows.every((o) => o.status === "QUEUED" && o.print_attempts === 0));
  check("no text before 2 minutes", sms.length === 0);
}

async function f6(d: Deps): Promise<void> {
  begin("F6", "the DOWN edge is logged once per outage, not once per poll");
  await twoPrinters(d);
  await silence(d, MAC_A, 61);
  for (let i = 0; i < 20; i++) await poll(d, MAC_B);
  const lines = warnings.filter((w) => w.includes("外賣機 Takeout printer] DOWN"));
  check("one DOWN line across 20 polls from B", lines.length === 1, `${lines.length} lines`);
}

async function f7(d: Deps): Promise<void> {
  begin("F7", "paper back on A revives only A's condemned orders");
  await twoPrinters(d);
  const web = await seed(d, "web");
  const phone = await seed(d, "phone");
  await poll(d, MAC_A);
  await poll(d, MAC_B);
  await d.repo.recordPrintAttempt(TENANT, web, { ok: false, error: "test condemn" });
  await d.repo.recordPrintAttempt(TENANT, phone, { ok: false, error: "test condemn" });
  d.cache.clear();
  await poll(d, MAC_A, "Paper Empty");
  await poll(d, MAC_A); // paper back: the restore edge
  check("A's condemned web order is back in the queue", (await orderRow(d, web)).status !== "PRINT_FAILED");
  check("B's condemned phone order stays PRINT_FAILED", (await orderRow(d, phone)).status === "PRINT_FAILED");
}

/* ------------------------------------------------------------ recovery -- */

async function rec1(d: Deps): Promise<void> {
  begin("Rec1", "A comes back: new web orders go home, the rerouted one stays on B");
  const { a, b } = await twoPrinters(d);
  await silence(d, MAC_A, 61);
  const web1 = await seed(d, "web");
  const pb = await poll(d, MAC_B); // web1 -> B, rerouted; also stamps A down
  await poll(d, MAC_A); // A is back
  const web2 = await seed(d, "web");
  const aGot = await poll(d, MAC_A);
  const del2 = aGot.token ? await delivery(d, aGot.token) : null;
  check("A gets the new web order with no header", del2?.order_id === web2 && del2.rerouted_from_role === null && del2.printer_id === a);
  await fetchJob(d, MAC_B, pb.token!);
  await confirm(d, MAC_B, pb.token!);
  check("the rerouted order finished on B", (await orderRow(d, web1)).status === "PRINTED" && (await orderRow(d, web1)).print_printer_id === b);
  const { rows } = await d.ordersPool().query(`select down_since from printer_health where printer_id = $1 for update`, [a]);
  check("A's down_since is cleared", rows[0]?.down_since === null);
  check("the BACK line reports 1 ticket printed elsewhere", warnings.some((w) => w.includes("UP again") && w.includes("1 ticket(s)")));
}

async function rec2(d: Deps): Promise<void> {
  begin("Rec2", "flapping A: 10 cycles, every order prints exactly once");
  const { a, b } = await twoPrinters(d);
  const ids: number[] = [];
  for (let i = 0; i < 10; i++) {
    const id = await seed(d, "web");
    ids.push(id);
    if (i % 2 === 0) {
      await printNext(d, MAC_A); // A polls: up again, prints its own order
    } else {
      await silence(d, MAC_A, 70); // down
      await printNext(d, MAC_B);
    }
  }
  const ds = await Promise.all(ids.map((id) => deliveriesFor(d, id)));
  const rows = await Promise.all(ids.map((id) => orderRow(d, id)));
  check("all 10 PRINTED", rows.every((o) => o.status === "PRINTED"));
  check("exactly one delivery each", ds.every((x) => x.length === 1));
  check(
    "even cycles on A plain, odd cycles on B REROUTED",
    ds.every((x, i) =>
      i % 2 === 0
        ? x[0].printer_id === a && x[0].rerouted_from_role === null
        : x[0].printer_id === b && x[0].rerouted_from_role === "takeout",
    ),
  );
}

async function rec3(d: Deps): Promise<void> {
  begin("Rec3", "重印 of a rerouted order re-decides: home when home is back");
  const { a } = await twoPrinters(d);
  await silence(d, MAC_A, 61);
  const web = await seed(d, "web");
  await printNext(d, MAC_B);
  await poll(d, MAC_A); // A back
  await d.repo.requeueForPrint(TENANT, web, "kitchen");
  d.cache.clear();
  const p = await poll(d, MAC_A);
  const del = p.token ? await delivery(d, p.token) : null;
  check("the reprint goes to A, no header", del?.order_id === web && del.printer_id === a && del.rerouted_from_role === null);
}

/* ----------------------------------------------------- unknown printers -- */

async function u1(d: Deps): Promise<void> {
  begin("U1", "an unknown MAC gets nothing and shows up to be assigned");
  await twoPrinters(d);
  const web = await seed(d, "web");
  const answers: PollAnswer[] = [];
  for (let i = 0; i < 5; i++) answers.push(await poll(d, MAC_C));
  const { rows } = await d.ordersPool().query(
    `select role, active from printers where tenant_id = $1 and mac = '001162cc0003' for update`,
    [TENANT],
  );
  check("5 polls, 5 NO_JOBs", answers.every((x) => !x.jobReady));
  check("one inactive, role-less row", rows.length === 1 && rows[0].role === null && rows[0].active === false);
  check("no order touched", (await orderRow(d, web)).print_attempts === 0);
  const board = await kitchenGet(d, "/api/kitchen/orders?completed=0", d.kitchen);
  check("the board flags 1 new printer waiting", board.body.unassignedRecent === 1);
  const page = await kitchenGet(d, "/api/kitchen/printers", d.printersApi);
  const listed = ((page.body.printers ?? []) as Array<{ mac: string; role: string | null }>).find((p) => p.mac === MAC_C);
  check("the printers page lists it unassigned", !!listed && listed.role === null);
}

async function u2(d: Deps): Promise<void> {
  begin("U2", "unknown MACs are capped at 10");
  await twoPrinters(d);
  for (let i = 1; i <= 11; i++) await poll(d, `00:11:62:dd:00:${String(i).padStart(2, "0")}`);
  const { rows } = await d.ordersPool().query(
    `select count(*)::int as n from printers where tenant_id = $1 and role is null`,
    [TENANT],
  );
  check("10 stored, the 11th refused", Number(rows[0].n) === 10, `${rows[0].n} unassigned`);
  check("and logged", warnings.some((w) => w.includes("not stored")));
}

async function u3(d: Deps): Promise<void> {
  begin("U3", "assign C as the POS printer (owner PIN): B is retired in the same move");
  const { b } = await twoPrinters(d);
  const p1 = await seed(d, "phone");
  const held = await poll(d, MAC_B);
  await fetchJob(d, MAC_B, held.token!);
  await poll(d, MAC_C);
  const c = await printerId(d, MAC_C);
  const res = await ownerChange(d, OWNER_PIN, { action: "assign", printerId: c, role: "pos" });
  const { rows } = await d.ordersPool().query(
    `select id, role, active from printers where tenant_id = $1 and id = any($2::uuid[]) for update`,
    [TENANT, [b, c]],
  );
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  check("change accepted", res.body.ok === true, JSON.stringify(res.body));
  check("C active as pos, B inactive", byId.get(c)?.active === true && byId.get(c)?.role === "pos" && byId.get(b)?.active === false);
  const audit = await d.ordersPool().query(
    `select action, target, old_value, new_value from printer_config_audit where tenant_id = $1 and action in ('assign','deactivate') order by id for update`,
    [TENANT],
  );
  const last = audit.rows.slice(-2);
  check(
    "audited: deactivate B, assign C, with old and new values",
    last[0]?.action === "deactivate" && last[0].target === b && last[0].old_value.active === true && last[0].new_value.active === false &&
      last[1]?.action === "assign" && last[1].target === c && last[1].old_value.role === null && last[1].new_value.role === "pos",
  );
  const bPoll = await poll(d, MAC_B);
  check("B now gets nothing", !bPoll.jobReady);
  const p2 = await seed(d, "phone");
  const cFirst = await printNext(d, MAC_C);
  await expireInFlight(d, p1);
  const cSecond = await printNext(d, MAC_C);
  check("C prints new POS orders, then takes over B's expired one", cFirst === p2 && cSecond === p1, `${cFirst},${cSecond}`);
}

async function u4(d: Deps): Promise<void> {
  begin("U4", "the database refuses impossible printer setups");
  await twoPrinters(d);
  await poll(d, MAC_C);
  const c = await printerId(d, MAC_C);
  const refused = async (sql: string, args: unknown[]) => {
    try {
      await d.ordersPool().query(sql, args);
      return false;
    } catch {
      return true;
    }
  };
  check("active without a role", await refused(`update printers set active = true where id = $1`, [c]));
  check("a second active pos", await refused(`update printers set active = true, role = 'pos' where id = $1`, [c]));
  check("no copies at all", await refused(`update print_routes set copy_roles = '{}' where tenant_id = $1 and channel = 'web'`, [TENANT]));
  check("an unknown copy type", await refused(`update print_routes set copy_roles = '{receipt}' where tenant_id = $1 and channel = 'web'`, [TENANT]));
}

/* ------------------------------------------------------------ owner PIN -- */

async function p1(d: Deps): Promise<void> {
  begin("P1", "owner PIN: view freely, change only with the PIN, lock out guessing");
  await twoPrinters(d);
  const route = async () =>
    (await d.ordersPool().query(`select role from print_routes where tenant_id = $1 and channel = 'walk_in' for update`, [TENANT])).rows[0].role;

  const view = await kitchenGet(d, "/api/kitchen/printers", d.printersApi);
  check("the kitchen session can view", view.status === 200 && view.body.ok === true);
  const noSession = await ownerChange(d, OWNER_PIN, { action: "route", channel: "walk_in", role: "takeout" }, false);
  check("no session: refused", noSession.status === 401);
  const wrong = await ownerChange(d, "0000", { action: "route", channel: "walk_in", role: "takeout" });
  const failures = (await d.ordersPool().query(`select count(*)::int as n from printer_config_audit where tenant_id = $1 and action = 'pin_failed'`, [TENANT])).rows[0].n;
  check("wrong PIN: refused, nothing changed, failure recorded", wrong.body.code === "pin_wrong" && (await route()) === "pos" && Number(failures) === 1);
  for (let i = 0; i < 4; i++) await ownerChange(d, "0000", { action: "route", channel: "walk_in", role: "takeout" });
  const locked = await ownerChange(d, OWNER_PIN, { action: "route", channel: "walk_in", role: "takeout" });
  check("after 5 wrong PINs even the right one is locked out", locked.body.code === "pin_locked" && (await route()) === "pos");
  await d.ordersPool().query(`update printer_config_audit set at = at - interval '16 minutes' where tenant_id = $1 and action = 'pin_failed'`, [TENANT]);
  d.cache.clear();
  const ok = await ownerChange(d, OWNER_PIN, { action: "route", channel: "walk_in", role: "takeout" });
  const audit = (await d.ordersPool().query(`select old_value, new_value, ip from printer_config_audit where tenant_id = $1 and action = 'route' and target = 'walk_in' order by id for update`, [TENANT])).rows;
  const last = audit[audit.length - 1];
  check("after the window, the right PIN changes it, audited old -> new", ok.body.ok === true && (await route()) === "takeout" && last?.old_value.role === "pos" && last?.new_value.role === "takeout", JSON.stringify(last));

  const saved = process.env.OWNER_PIN;
  delete process.env.OWNER_PIN;
  const unset = await ownerChange(d, OWNER_PIN, { action: "route", channel: "walk_in", role: "pos" });
  process.env.OWNER_PIN = saved;
  check("OWNER_PIN unset: every change refused", unset.body.code === "pin_not_configured" && (await route()) === "takeout");

  // Atomicity: a failing audit write rolls the change back with it.
  await d.ordersPool().query(`
    create or replace function fail_audit() returns trigger language plpgsql as $$ begin raise exception 'audit down'; end $$;
    create trigger fail_audit before insert on printer_config_audit for each row execute function fail_audit();`);
  let threw = false;
  try {
    await d.printers.setRoute(TENANT, "walk_in", "pos", "test");
  } catch {
    threw = true;
  }
  await d.ordersPool().query(`drop trigger fail_audit on printer_config_audit; drop function fail_audit();`);
  check("a change whose audit row fails is rolled back", threw && (await route()) === "takeout");
}

/* --------------------------------------------------------- owner texts -- */

async function a1(d: Deps): Promise<void> {
  begin("A1", "one printer down 5 min, the other covering: one text, once per spell");
  await twoPrinters(d);
  await silence(d, MAC_A, 61);
  await seed(d, "web");
  await printNext(d, MAC_B); // rerouted
  await silence(d, MAC_A, 301);
  await sweep(d);
  await sweep(d);
  check("one text naming A after 5 min, none on the next sweep", sms.length === 1 && sms[0].includes("外賣機 Takeout printer"), sms.join(" | "));
  check("it says where the tickets went", sms[0]?.includes("POS機 POS printer") && sms[0].includes("REROUTED"));

  await poll(d, MAC_A); // back
  await silence(d, MAC_A, 61);
  await seed(d, "web");
  await printNext(d, MAC_B); // rerouted in the new spell
  await silence(d, MAC_A, 301);
  await sweep(d);
  check("a new spell texts again", sms.length === 2);

  // Paper-out spell that turns into offline: one text for the whole spell.
  await poll(d, MAC_A); // back
  await poll(d, MAC_A, "Paper Empty");
  await blockedFor(d, MAC_A, 301);
  await poll(d, MAC_A, "Paper Empty"); // stamps its own down_since
  await d.ordersPool().query(
    `update printer_health h set down_since = now() - interval '301 seconds' from printers p where p.id = h.printer_id and p.mac = '001162aa0001'`,
  );
  d.cache.clear();
  await seed(d, "web");
  await printNext(d, MAC_B);
  await sweep(d);
  await silence(d, MAC_A, 400); // now it is also silent
  await sweep(d);
  check("paper-out then offline: one text for the spell", sms.length === 3, `${sms.length} texts`);

  // Night: B switched off while A stays on, nothing rerouted.
  await twoPrinters(d);
  await silence(d, MAC_B, 400);
  await sweep(d);
  check("B off at night with nothing rerouted: no text", sms.length === 0);
}

async function a2(d: Deps): Promise<void> {
  begin("A2", "every printer down 2 min: urgent text, repeated every 10 min");
  await twoPrinters(d);
  await seed(d, "web");
  await silence(d, MAC_A, 121);
  await silence(d, MAC_B, 121);
  await sweep(d); // 2 min
  check("urgent text at 2 min", sms.length === 1 && sms[0].startsWith("URGENT"), sms[0]);
  await sweep(d); // 3 min
  const back = async (minutes: number) => {
    await d.ordersPool().query(
      `update print_alert_state set all_down_alerted_at = now() - make_interval(mins => $2) where tenant_id = $1`,
      [TENANT, minutes],
    );
    d.cache.clear();
  };
  await back(9); // sweep 9 min after the first text (11 min in)
  await sweep(d);
  check("no repeat before 10 minutes", sms.length === 1, `${sms.length} texts`);
  await back(10); // 12 min in
  await sweep(d);
  check("one repeat at 10 minutes", sms.length === 2, `${sms.length} texts`);
  await poll(d, MAC_B); // B recovers
  await back(10);
  await sweep(d);
  const state = (await d.ordersPool().query(`select all_down_alerted_at from print_alert_state where tenant_id = $1 for update`, [TENANT])).rows[0];
  check("one printer back: no more urgent texts, stamp cleared", sms.length === 2 && state.all_down_alerted_at === null);

  await twoPrinters(d);
  await silence(d, MAC_A, 200);
  await silence(d, MAC_B, 200);
  await sweep(d);
  check("both down with nothing waiting: no text", sms.length === 0);
}

/* -------------------------------------------------------------- legacy -- */

async function l1(d: Deps): Promise<void> {
  begin("L1", "no printers rows: the first (pinned) MAC bootstraps as today's printer");
  await wipe(d);
  const c = await poll(d, MAC_C); // not the pinned MAC
  const a = await poll(d, MAC_A); // the pinned MAC
  const { rows } = await d.ordersPool().query(
    `select mac, role, active from printers where tenant_id = $1 order by first_seen_at for update`,
    [TENANT],
  );
  const routes = (await d.ordersPool().query(
    `select channel, role, copy_roles from print_routes where tenant_id = $1 order by channel for update`,
    [TENANT],
  )).rows;
  check("a different MAC is NOT bootstrapped (pin honoured)", !c.jobReady && rows.find((r) => r.mac === "001162cc0003")?.role === null);
  check("the pinned MAC becomes the active takeout printer", !a.jobReady && rows.find((r) => r.mac === "001162aa0001")?.role === "takeout");
  check("every channel routes to it, today's copies", routes.length === 4 && routes.every((r) => r.role === "takeout" && r.copy_roles === null));
  const phone = await seed(d, "phone");
  const got = await printNext(d, MAC_A);
  const del = (await deliveriesFor(d, phone))[0];
  check("a phone order prints on it with no header", got === phone && del?.rerouted_from_role === null && (await orderRow(d, phone)).status === "PRINTED");
}

/* ---------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-printers-"));
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  console.log("starting embedded postgres…");
  await pg.initialise();
  await pg.start();

  const admin = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${DB_NAME} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();

  Object.assign(process.env, {
    DATABASE_URL: `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`,
    TENANT_ID: TENANT,
    CLOUDPRNT_SECRET: SECRET,
    CLOUDPRNT_PRINTER_MAC: MAC_A,
    RESTAURANT_TIMEZONE: "America/Los_Angeles",
    TENANT_TIMEZONE: "America/Los_Angeles",
    TENANT_TAX_RATE_BPS: "875",
    ORDER_NUMBER_PREFIX: "A",
    TICKET_COPIES: "3",
    PRINT_CONFIRM_FLOOR_SECONDS: "60",
    PRINT_SECONDS_PER_COPY: "30",
    PRINT_OFFER_CAP: "4",
    ADMIN_DASH_PASSWORD: PASSWORD,
    OWNER_PIN,
    CRON_SECRET: CRON,
    OWNER_ALERT_PHONE: "+16195550123",
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "test",
    TWILIO_VERIFY_SERVICE_SID: "VAtest",
    TWILIO_MESSAGING_FROM: "+16195550100",
  });
  delete process.env.PRINT_CONFIRM_TEST_DELAY_MS;
  delete process.env.PRINT_FETCH_VIA_WORKER;
  delete process.env.TICKET_COPY_ROLES;

  const { ordersPool, closeOrdersPool } = await import("../src/lib/db/postgres");
  await ordersPool().query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));
  const { login } = await import("../src/lib/auth/kitchenSession");
  const cookie = login(PASSWORD);
  if (!cookie) throw new Error("could not mint a kitchen session");

  const cache = installHyperdriveCacheEmulator(60_000);
  const d: Deps = {
    repo: await import("../src/lib/orders/repository"),
    printers: await import("../src/lib/print/printers"),
    render: await import("../src/lib/ticket/render"),
    starprnt: await import("../src/lib/ticket/starprnt"),
    config: await import("../src/config/tenant.server"),
    floor: await import("../src/lib/kitchen/floor-plan"),
    rateLimit: await import("../src/lib/http/rateLimit"),
    ordersPool,
    cache,
    print: (await import("../src/app/api/print/[secret]/route")) as unknown as PrintRoute,
    kitchen: (await import("../src/app/api/kitchen/orders/route")) as unknown as PlainRoute,
    printersApi: (await import("../src/app/api/kitchen/printers/route")) as unknown as Required<PlainRoute>,
    cron: (await import("../src/app/api/cron/unprinted-alert/route")) as unknown as PlainRoute,
    cookie,
  };

  const cases = [r1, r2, r3, r4, c1, f1, f2, f3, f4, f5, f6, f7, rec1, rec2, rec3, u1, u2, u3, u4, p1, a1, a2, l1];
  try {
    for (const run of cases) {
      try {
        await run(d);
      } catch (err) {
        check(`${run.name} threw`, false, err instanceof Error ? err.stack ?? err.message : String(err));
      }
    }
  } finally {
    cache.uninstall();
    globalThis.fetch = realFetch;
    await closeOrdersPool();
    console.log("\nstopping postgres…");
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  const ids = [...new Set(results.map((r) => r.id))];
  const failedCases = ids.filter((id) => results.some((r) => r.id === id && !r.passed));
  const failed = results.filter((r) => !r.passed);
  console.log(
    `\nprinters: ${ids.length - failedCases.length}/${ids.length} cases, ` +
      `${results.length - failed.length}/${results.length} checks passed ` +
      `(L2, every existing check, runs as the rest of the verify suite)`,
  );
  console.log(
    `cache emulator: ${cacheTotals.hits + cache.hits} cached answers served, ` +
      `${cacheTotals.misses + cache.misses} cacheable reads missed, over the whole run`,
  );
  if (failed.length > 0) {
    console.error("\nFAILED:");
    for (const f of failed) console.error(`  ✗ ${f.id} ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exit(1);
  }
  console.log("\ntwo printers: routing, failover, recovery, unknown printers, PIN and texts ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
