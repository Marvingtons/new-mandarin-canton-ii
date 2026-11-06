/**
 * The print path must be correct even when reads come back stale.
 *
 *   npm run verify:print-stale-reads
 *
 * WHY THIS EXISTS. Production reads Postgres through Hyperdrive, and the nmc-db
 * config had query caching on: a plain SELECT is answered from cache for up to
 * 60s, and writes do not invalidate it. On 3 Nov a kitchen 重印 of A-008 ended
 * PRINT_FAILED with five unconfirmed deliveries, three of them offered 3 to 17
 * seconds apart inside a 90s window. Five orders since 31 Aug show the same
 * shape. Two stale reads explain it:
 *
 *   - currentPrintJob (the poll's "what is in flight?") returns the row as it
 *     was BEFORE the last re-offer: an expired delivery. The poll re-offers
 *     again, every 3s, until the cache entry ages out.
 *   - getOrderById (the confirm's "is this still the live delivery?") returns
 *     the row as it was before the reprint, so the printer's confirmation looks
 *     superseded and is dropped. The ticket printed; we never recorded it.
 *
 * HOW. The same real-things harness as verify:print-deliveries (embedded
 * Postgres, real schema, real repository, real route handlers), with
 * scripts/lib/hyperdrive-cache-emulator.ts in front of every query: it serves
 * any non-locking SELECT from a 60s cache that writes never invalidate. Time
 * passing is simulated the way the other print verifiers do it: expire the
 * delivery in the database, and clear() the cache when more than 60s would
 * have gone by.
 *
 * Windows are production's: 3 copies x 30s, floor 60s -> a 90s window, cap 4.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import {
  installHyperdriveCacheEmulator,
  type CacheEmulator,
} from "./lib/hyperdrive-cache-emulator";

const PORT = 55437;
const DB_NAME = "nmc_stale_reads_test";
const SECRET = "verify-print-stale-reads-secret";
const MAC = "00:11:62:00:00:07";
const TENANT = "stale-reads-test";
const BASE = `https://example.test/api/print/${SECRET}`;
const WINDOW_SECONDS = 90;

type Handler = (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
interface Handlers {
  POST: Handler;
  GET: Handler;
  DELETE: Handler;
}
const params = Promise.resolve({ secret: SECRET });

interface Deps {
  repo: typeof import("../src/lib/orders/repository");
  ordersPool: typeof import("../src/lib/db/postgres").ordersPool;
  cache: CacheEmulator;
}

/* ------------------------------------------------------------- printer -- */

interface PollAnswer {
  jobReady: boolean;
  token: string | null;
}

async function poll(h: Handlers): Promise<PollAnswer> {
  const res = await h.POST(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusCode: "200 OK", printerMAC: MAC }),
    }),
    { params },
  );
  const body = (await res.json()) as { jobReady?: boolean; jobToken?: string };
  return { jobReady: body.jobReady === true, token: body.jobToken ?? null };
}

async function fetchJob(h: Handlers, token: string): Promise<number> {
  const url = `${BASE}?token=${encodeURIComponent(token)}&mac=${encodeURIComponent(MAC)}&type=application/vnd.star.starprnt`;
  const res = await h.GET(new Request(url), { params });
  if (res.ok) await res.arrayBuffer();
  return res.status;
}

async function confirm(h: Handlers, token: string, code = "OK"): Promise<number> {
  const url = `${BASE}?mac=${encodeURIComponent(MAC)}&code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`;
  const res = await h.DELETE(new Request(url, { method: "DELETE" }), { params });
  return res.status;
}

/** What /api/kitchen/orders/[id] does for 重印: read the order, then requeue. */
async function kitchenReprint(deps: Deps, orderId: number): Promise<void> {
  const order = await deps.repo.getOrderById(TENANT, orderId);
  if (!order) throw new Error("reprint: order not found");
  await deps.repo.requeueForPrint(TENANT, orderId, "kitchen");
}

/* ---------------------------------------------------------- db helpers -- */

/** Ground truth, read past the cache (a locking read is never cached). */
async function orderRow(deps: Deps, orderId: number) {
  const { rows } = await deps.ordersPool().query(
    `select status, print_attempts, print_delivery_id from orders
      where tenant_id = $1 and id = $2 for update`,
    [TENANT, orderId],
  );
  return rows[0] as { status: string; print_attempts: number; print_delivery_id: string | null };
}

interface DeliveryRow {
  id: string;
  reason: string;
  offered_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
}
async function deliveriesFor(deps: Deps, orderId: number): Promise<DeliveryRow[]> {
  const { rows } = await deps.ordersPool().query(
    `select id, reason, offered_at, expires_at, confirmed_at from print_deliveries
      where tenant_id = $1 and order_id = $2
      order by offered_at asc, created_at asc for update`,
    [TENANT, orderId],
  );
  return rows as DeliveryRow[];
}

/**
 * "The window passed": shift the in-flight delivery (offer and expiry alike)
 * WINDOW+5s into the past, as the other verifiers do instead of sleeping. Only
 * while the order is still QUEUED: a condemned order has nothing in flight.
 */
async function expireInFlight(deps: Deps, orderId: number): Promise<void> {
  const pool = deps.ordersPool();
  const shift = WINDOW_SECONDS + 5;
  await pool.query(
    `update print_deliveries
        set offered_at = offered_at - make_interval(secs => $3),
            expires_at = expires_at - make_interval(secs => $3)
      where tenant_id = $1 and id = (
        select print_delivery_id from orders
         where tenant_id = $1 and id = $2 and status = 'QUEUED')`,
    [TENANT, orderId, shift],
  );
  await pool.query(
    `update orders
        set print_delivery_expires_at = print_delivery_expires_at - make_interval(secs => $3),
            print_offered_at = print_offered_at - make_interval(secs => $3)
      where tenant_id = $1 and id = $2 and status = 'QUEUED'`,
    [TENANT, orderId, shift],
  );
}

let seq = 0;
async function seedOrder(deps: Deps): Promise<{ id: number; orderNumber: string }> {
  seq++;
  const { order } = await deps.repo.createOrder({
    tenantId: TENANT,
    businessDate: "2026-11-03",
    orderNumberPrefix: "A",
    idempotencyKey: `stale-reads-${seq}-${Date.now()}`,
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
    customer: { name: "Stale Read Test", phone: "+16195550000" },
    phoneVerifiedAt: new Date(),
    pickupAt: new Date(Date.now() + 25 * 60_000),
  });
  return { id: order.id, orderNumber: order.orderNumber };
}

async function reset(deps: Deps): Promise<void> {
  await deps.ordersPool().query("delete from orders where tenant_id = $1", [TENANT]);
  deps.cache.clear();
  deps.cache.resetStats();
}

/* ------------------------------------------------------------- results -- */

const results: { name: string; passed: boolean; detail: string }[] = [];
function check(name: string, passed: boolean, detail = ""): void {
  results.push({ name, passed, detail });
  console.log(`   ${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const offers = (ds: DeliveryRow[]) => ds.filter((d) => d.reason !== "manual_reprint");

/* ----------------------------------------------------------- scenarios -- */

// A. The A-008 retry burst. After one legitimate retry, polls 3s apart must
//    HOLD the new delivery for its whole window, cache or no cache.
async function a_noRetryBurst(h: Handlers, deps: Deps): Promise<void> {
  console.log("\nA. after a retry, the next polls hold (no 3-second retry burst)");
  await reset(deps);
  const order = await seedOrder(deps);

  const p1 = await poll(h); // first-offer D1
  await fetchJob(h, p1.token!);
  await expireInFlight(deps, order.id);
  deps.cache.clear(); // 90s passed: anything cached has aged out
  const p2 = await poll(h); // legitimate retry D2
  // The printer polls every ~3s. Five more polls inside D2's window:
  const burst: PollAnswer[] = [];
  for (let i = 0; i < 5; i++) burst.push(await poll(h));

  const ds = offers(await deliveriesFor(deps, order.id));
  check("first poll offered D1", p1.jobReady && !!p1.token);
  check("expired D1 was retried once as D2", p2.jobReady && !!p2.token && p2.token !== p1.token);
  check(
    "the 5 polls inside D2's window were all held",
    burst.every((b) => !b.jobReady),
    `offered on ${burst.filter((b) => b.jobReady).length} of 5 (cache hits ${deps.cache.hits}, misses ${deps.cache.misses})`,
  );
  check("exactly 2 deliveries exist (D1, D2)", ds.length === 2, `${ds.length} deliveries`);
}

// B. Retries never come faster than the 90s window: every offer after the first
//    starts no earlier than the previous one's expiry, and every window is 90s.
async function b_retrySpacing(h: Handlers, deps: Deps): Promise<void> {
  console.log(`\nB. retries are spaced by the full ${WINDOW_SECONDS}s window, up to the cap`);
  await reset(deps);
  const order = await seedOrder(deps);

  // Drive the order to its cap the way a printer that never confirms would:
  // poll every 3s, and let each window run out before the next round.
  // Each round is one 90s window: 4 polls 3s apart, then the window runs out.
  const offersPerWindow: number[] = [];
  for (let round = 0; round < 6; round++) {
    let offered = 0;
    for (let i = 0; i < 4; i++) if ((await poll(h)).jobReady) offered++;
    offersPerWindow.push(offered);
    await expireInFlight(deps, order.id);
  }
  const ds = offers(await deliveriesFor(deps, order.id));
  const windows = ds.map((d) => Math.round((+d.expires_at - +d.offered_at) / 1000));
  const row = await orderRow(deps, order.id);
  check(
    `every delivery got the full ${WINDOW_SECONDS}s window`,
    windows.every((w) => w === WINDOW_SECONDS),
    `windows = ${windows.join(", ")}s`,
  );
  check(
    "at most one offer per 90s window (4 windows, then none after the cap)",
    offersPerWindow.join(",") === "1,1,1,1,0,0",
    `offers per window = ${offersPerWindow.join(", ")}`,
  );
  check("one offer per window: 4 offers for 4 windows (cap 4)", ds.length === 4, `${ds.length} offers`);
  check("the order is condemned at the cap", row.status === "PRINT_FAILED", `status=${row.status}`);
}

// C. 重印 produces exactly one new delivery, and its confirmation lands.
async function c_reprintConfirms(h: Handlers, deps: Deps): Promise<void> {
  console.log("\nC. 重印 -> exactly one new delivery -> confirm -> PRINTED");
  await reset(deps);
  const order = await seedOrder(deps);

  // The original ticket prints normally.
  const p1 = await poll(h);
  await fetchJob(h, p1.token!);
  await confirm(h, p1.token!);
  const printed = await orderRow(deps, order.id);
  check("original ticket PRINTED", printed.status === "PRINTED", `status=${printed.status}`);

  // Seconds later, staff press 重印 on the board.
  await kitchenReprint(deps, order.id);
  const p2 = await poll(h);
  const fetched = p2.token ? await fetchJob(h, p2.token) : 0;
  const confirmed = p2.token ? await confirm(h, p2.token) : 0;
  // The printer keeps polling; nothing more should be offered.
  const after: PollAnswer[] = [];
  for (let i = 0; i < 3; i++) after.push(await poll(h));

  const row = await orderRow(deps, order.id);
  const ds = await deliveriesFor(deps, order.id);
  const afterReprint = offers(ds).slice(1);
  check("the reprint was offered", p2.jobReady && !!p2.token, `token=${p2.token}`);
  check("the reprint body was served", fetched === 200, `GET ${fetched}`);
  check("the confirm was acknowledged", confirmed === 200);
  check("order is PRINTED after the reprint", row.status === "PRINTED", `status=${row.status}`);
  check(
    "exactly one delivery after the 重印 marker",
    afterReprint.length === 1,
    `${afterReprint.length}: ${afterReprint.map((d) => d.reason).join(", ")}`,
  );
  check(
    "that delivery is confirmed",
    afterReprint.length === 1 && afterReprint[0].confirmed_at !== null,
  );
  check("no further offers after the confirm", after.every((a) => !a.jobReady));
}

// D. A confirmation lands even when the order row was read just before it was
//    offered (the board refreshes every few seconds and reads every order).
async function d_confirmAfterBoardRead(h: Handlers, deps: Deps): Promise<void> {
  console.log("\nD. a confirm lands even if the order was read moments before the offer");
  await reset(deps);
  const order = await seedOrder(deps);

  await deps.repo.getOrderById(TENANT, order.id); // the board, or a GET
  const p1 = await poll(h);
  await fetchJob(h, p1.token!);
  await confirm(h, p1.token!);
  const row = await orderRow(deps, order.id);
  check("order is PRINTED", row.status === "PRINTED", `status=${row.status}`);
}

// E. 重印 while the printer holds a live copy is refused, so the delivery it is
//    printing stays confirmable (A-001, 15 Oct: 重印 one second after the offer).
async function e_reprintWhilePrinting(h: Handlers, deps: Deps): Promise<void> {
  console.log("\nE. 重印 during a live delivery is refused; the live one still confirms");
  await reset(deps);
  const order = await seedOrder(deps);

  const p1 = await poll(h);
  await fetchJob(h, p1.token!);
  const refused = await deps.repo.requeueForPrint(TENANT, order.id, "kitchen");
  await confirm(h, p1.token!);
  const row = await orderRow(deps, order.id);
  const ds = await deliveriesFor(deps, order.id);
  check("重印 mid-print is refused", refused === null);
  check("no 重印 marker was written", ds.every((d) => d.reason !== "manual_reprint"));
  check("the live delivery confirmed and the order is PRINTED", row.status === "PRINTED", `status=${row.status}`);
}

// F. The board flags a ticket that has gone 2 minutes without a confirmation,
//    and stops flagging it once the printer confirms.
async function f_boardFlagsStuckTicket(h: Handlers, deps: Deps): Promise<void> {
  console.log("\nF. the board flags a ticket unconfirmed for 2 minutes");
  await reset(deps);
  const order = await seedOrder(deps);
  const board = async () =>
    (await deps.repo.listActiveOrders(TENANT, "2026-11-03")).find((o) => o.id === order.id);

  const p1 = await poll(h);
  await fetchJob(h, p1.token!);
  const fresh = await board();
  // Two minutes pass with no confirmation.
  await deps.ordersPool().query(
    `update orders set created_at = created_at - make_interval(secs => 125) where tenant_id = $1 and id = $2`,
    [TENANT, order.id],
  );
  const late = await board();
  await confirm(h, p1.token!);
  const done = await board();
  check("not flagged in its first 2 minutes", fresh?.printStuck === false, `printStuck=${fresh?.printStuck}`);
  check("flagged after 2 minutes unconfirmed", late?.printStuck === true, `printStuck=${late?.printStuck}`);
  check("cleared once the printer confirms", done?.printStuck === false && done?.printPendingSince === null);

  // A 重印 starts a new attempt: flagged again only if IT goes 2 minutes.
  await deps.repo.requeueForPrint(TENANT, order.id, "kitchen");
  const afterReprint = await board();
  check("a fresh 重印 is not flagged yet", afterReprint?.printStuck === false);
}

/* ---------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-stale-reads-"));
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
  process.env.CLOUDPRNT_SECRET = SECRET;
  process.env.CLOUDPRNT_PRINTER_MAC = MAC;
  process.env.RESTAURANT_TIMEZONE = "America/Los_Angeles";
  process.env.TENANT_TAX_RATE_BPS = "875";
  process.env.ORDER_NUMBER_PREFIX = "A";
  // Production's numbers: 3 copies x 30s over a 60s floor = 90s; cap 4.
  process.env.TICKET_COPIES = "3";
  process.env.PRINT_CONFIRM_FLOOR_SECONDS = "60";
  process.env.PRINT_SECONDS_PER_COPY = "30";
  process.env.PRINT_OFFER_CAP = "4";
  delete process.env.PRINT_CONFIRM_TEST_DELAY_MS;
  delete process.env.PRINT_FETCH_VIA_WORKER;

  const { ordersPool, closeOrdersPool } = await import("../src/lib/db/postgres");
  await ordersPool().query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));

  const repo = await import("../src/lib/orders/repository");
  const route = (await import("../src/app/api/print/[secret]/route")) as unknown as Handlers;
  const cache = installHyperdriveCacheEmulator(60_000);
  const deps: Deps = { repo, ordersPool, cache };

  try {
    await a_noRetryBurst(route, deps);
    await b_retrySpacing(route, deps);
    await c_reprintConfirms(route, deps);
    await d_confirmAfterBoardRead(route, deps);
    await e_reprintWhilePrinting(route, deps);
    await f_boardFlagsStuckTicket(route, deps);
  } finally {
    cache.uninstall();
    await closeOrdersPool();
    console.log("\nstopping postgres…");
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\nprint stale reads: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.error("\nFAILED:");
    for (const f of failed) console.error(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exit(1);
  }
  console.log("\nstale reads cannot make the printer repeat or lose a ticket ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
