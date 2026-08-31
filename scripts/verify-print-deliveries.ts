/**
 * Prove per-delivery identity: one order → one ticket, and every second ticket
 * is explained.
 *
 *   npm run verify:print-deliveries
 *
 * The regression test for duplicate kitchen tickets, built out of the real
 * things rather than mocks — the same shape as verify:print-recurrence:
 *
 *   - a real embedded Postgres on its own port, with the real schema.sql
 *   - the real repository (the SQL that stamps, closes and audits deliveries)
 *   - the REAL route handlers from src/app/api/print/[secret]/route.ts, called
 *     the way the printer calls them: POST to poll, GET to fetch, DELETE to
 *     confirm
 *
 * Time is compressed where it does not change the mechanism: a confirmation
 * window is set to 25s, and "the window passed" is simulated by expiring the
 * in-flight delivery in the database rather than sleeping. The one genuinely
 * time-based check — a poll landing DURING the confirm transaction (scenario 5)
 * — uses the PRINT_CONFIRM_TEST_DELAY_MS seam and real concurrency, because that
 * race is the whole point of making the confirm atomic.
 *
 * The eight scenarios are the fix prompt's STEP 5, verbatim in intent.
 *
 * ⚠️ WINDOWS: PostgreSQL refuses to start under an administrative token; run
 * from a NON-ELEVATED shell (see verify:print-recurrence for the runas note).
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const PORT = 55435;
const DB_NAME = "nmc_delivery_test";
const SECRET = "verify-print-deliveries-secret";
const MAC = "00:11:62:00:00:02";
const TENANT = "delivery-test";
const BASE = `https://example.test/api/print/${SECRET}`;

/* ------------------------------------------------------------- harness -- */

interface Handlers {
  POST: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
  GET: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
  DELETE: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
}

const params = Promise.resolve({ secret: SECRET });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PollAnswer {
  jobReady: boolean;
  token: string | null;
  jobGetUrl: string | null;
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
  const body = (await res.json()) as {
    jobReady?: boolean;
    jobToken?: string;
    jobGetUrl?: string;
  };
  return {
    jobReady: body.jobReady === true,
    token: body.jobToken ?? null,
    jobGetUrl: body.jobGetUrl ?? null,
  };
}

/** GET the body by delivery token — the way a printer honouring jobGetUrl does. */
async function getByToken(h: Handlers, token: string): Promise<{ status: number; bytes: number }> {
  const url = `${BASE}?token=${encodeURIComponent(token)}&mac=${encodeURIComponent(MAC)}&type=application/vnd.star.starprnt`;
  const res = await h.GET(new Request(url), { params });
  const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
  return { status: res.status, bytes };
}

/** The confirming DELETE, with the delivery token and a result code. */
async function confirm(h: Handlers, token: string, code = "OK"): Promise<number> {
  const url = `${BASE}?mac=${encodeURIComponent(MAC)}&code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`;
  const res = await h.DELETE(new Request(url, { method: "DELETE" }), { params });
  return res.status;
}

/* ------------------------------------------------------------- results -- */

interface Result {
  name: string;
  passed: boolean;
  detail: string;
}
const results: Result[] = [];
function check(name: string, passed: boolean, detail = ""): void {
  results.push({ name, passed, detail });
  console.log(`   ${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/* --------------------------------------------------------------- deps -- */

interface Deps {
  createOrder: typeof import("../src/lib/orders/repository").createOrder;
  getOrderById: typeof import("../src/lib/orders/repository").getOrderById;
  requeueForPrint: typeof import("../src/lib/orders/repository").requeueForPrint;
  listActiveOrders: typeof import("../src/lib/orders/repository").listActiveOrders;
  ordersPool: typeof import("../src/lib/db/postgres").ordersPool;
}

let seq = 0;
async function seedOrder(deps: Deps): Promise<{ id: number; orderNumber: string }> {
  seq++;
  const { order } = await deps.createOrder({
    tenantId: TENANT,
    businessDate: "2026-08-31",
    orderNumberPrefix: "A",
    idempotencyKey: `delivery-test-${seq}-${Date.now()}`,
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
    customer: { name: "Delivery Test", phone: "+16195550000" },
    phoneVerifiedAt: new Date(),
    pickupAt: new Date(Date.now() + 25 * 60_000),
  });
  return { id: order.id, orderNumber: order.orderNumber };
}

/** Delete this tenant's orders (deliveries cascade) so each scenario is clean. */
async function reset(deps: Deps): Promise<void> {
  await deps.ordersPool().query("delete from orders where tenant_id = $1", [TENANT]);
}

interface DeliveryRow {
  id: string;
  reason: string;
  actor: string | null;
  fetch_count: number;
  confirmed_at: string | null;
  expires_at: string;
}
async function deliveriesFor(deps: Deps, orderId: number): Promise<DeliveryRow[]> {
  const { rows } = await deps.ordersPool().query(
    `select id, reason, actor, fetch_count, confirmed_at, expires_at
       from print_deliveries where tenant_id = $1 and order_id = $2
       order by offered_at asc, created_at asc`,
    [TENANT, orderId],
  );
  return rows as DeliveryRow[];
}

/** Simulate "the window passed" without waiting: expire the in-flight delivery. */
async function expireInFlight(deps: Deps, orderId: number): Promise<void> {
  await deps.ordersPool().query(
    `update orders
        set print_delivery_expires_at = now() - make_interval(secs => 5)
      where tenant_id = $1 and id = $2`,
    [TENANT, orderId],
  );
  await deps.ordersPool().query(
    `update print_deliveries
        set expires_at = now() - make_interval(secs => 5)
      where tenant_id = $1 and id = (
        select print_delivery_id from orders where tenant_id = $1 and id = $2
      )`,
    [TENANT, orderId],
  );
}

/* --------------------------------------------------------- scenarios -- */

// 1. Poll -> offer (D1) -> GET -> poll again within the window, no DELETE -> held.
async function s1_holdWithinWindow(h: Handlers, deps: Deps): Promise<void> {
  console.log("\n1. within the window, a second poll is HELD (no duplicate offer)");
  await reset(deps);
  const order = await seedOrder(deps);

  const p1 = await poll(h);
  await getByToken(h, p1.token!);
  await sleep(300);
  const p2 = await poll(h);

  const ds = await deliveriesFor(deps, order.id);
  check("first poll offered a delivery", p1.jobReady && !!p1.token, `token=${p1.token}`);
  check("second poll within the window is held", p2.jobReady === false, `jobReady=${p2.jobReady}`);
  check("still exactly one delivery, unconfirmed", ds.length === 1 && ds[0].confirmed_at === null, `${ds.length} deliveries`);
}

// 2. GET D1, DELETE D1 -> PRINTED, delivery closed, no re-offer.
async function s2_confirmPrints(h: Handlers, deps: Deps): Promise<void> {
  console.log("\n2. a confirmation for the in-flight delivery PRINTS and closes it");
  await reset(deps);
  const order = await seedOrder(deps);

  const p1 = await poll(h);
  await getByToken(h, p1.token!);
  const status = await confirm(h, p1.token!);
  const after = await deps.getOrderById(TENANT, order.id);
  const p2 = await poll(h);
  const ds = await deliveriesFor(deps, order.id);

  check("DELETE acknowledged 200", status === 200, `status=${status}`);
  check("order is PRINTED", after?.status === "PRINTED", `status=${after?.status}`);
  check("delivery closed (confirmed_at set)", ds.length === 1 && ds[0].confirmed_at !== null);
  check("no re-offer after confirmation", p2.jobReady === false, `jobReady=${p2.jobReady}`);
}

// 3. GET D1, no DELETE, window passes -> D2 offered with a NEW url; D1 GET -> 410.
async function s3_expiryReoffersWithNewIdentity(h: Handlers, deps: Deps): Promise<void> {
  console.log("\n3. an expired delivery re-offers as a NEW identity; the old handle is 410");
  await reset(deps);
  const order = await seedOrder(deps);

  const p1 = await poll(h);
  await getByToken(h, p1.token!);
  await expireInFlight(deps, order.id);
  const p2 = await poll(h);
  const d1Get = await getByToken(h, p1.token!); // the stale, superseded handle

  const ds = await deliveriesFor(deps, order.id);
  check("expired window re-offers a delivery", p2.jobReady && !!p2.token, `token=${p2.token}`);
  check("the re-offer is a NEW delivery id", p2.token !== p1.token, `${p1.token} -> ${p2.token}`);
  check("the re-offer is a NEW url", p2.jobGetUrl !== p1.jobGetUrl && !!p2.jobGetUrl);
  check("the superseded handle (D1) is 410 Gone", d1Get.status === 410, `status=${d1Get.status}`);
  check("two deliveries exist (D1, D2)", ds.length === 2, `${ds.length} deliveries`);
  // keep D1/D2 for scenario 4, which continues from this state
  scenario4State = { orderId: order.id, d1: p1.token!, d2: p2.token! };
}

let scenario4State: { orderId: number; d1: string; d2: string } | null = null;

// 4. DELETE with D1 token AFTER D2 was offered -> 200, stale, D2 unaffected.
async function s4_supersededConfirmIsStale(h: Handlers, deps: Deps): Promise<void> {
  console.log("\n4. a DELETE for the superseded delivery is stale; the live one is untouched");
  const st = scenario4State!;
  const before = await deps.getOrderById(TENANT, st.orderId);
  const status = await confirm(h, st.d1); // confirm the OLD, superseded delivery
  const after = await deps.getOrderById(TENANT, st.orderId);
  const ds = await deliveriesFor(deps, st.orderId);
  const d2 = ds.find((d) => d.id === st.d2);

  check("stale DELETE still acknowledged 200", status === 200, `status=${status}`);
  check("order NOT marked printed by the stale confirm", after?.status === "QUEUED" && after?.status === before?.status, `status=${after?.status}`);
  check("the live delivery D2 is still the pointer", after?.printDeliveryId === st.d2, `pointer=${after?.printDeliveryId}`);
  check("D2 remains unconfirmed (unaffected)", !!d2 && d2.confirmed_at === null);
}

// 5. A poll landing DURING the confirm transaction must not re-offer (699->771).
async function s5_noReofferDuringConfirm(h: Handlers, deps: Deps): Promise<void> {
  console.log("\n5. a poll landing DURING the confirm transaction cannot re-offer");
  await reset(deps);
  const order = await seedOrder(deps);
  const p1 = await poll(h);
  await getByToken(h, p1.token!);

  // Hold the confirm transaction open between closing the delivery and closing
  // the order — the exact old gap — and poll while it is open.
  process.env.PRINT_CONFIRM_TEST_DELAY_MS = "1500";
  const confirming = confirm(h, p1.token!);
  await sleep(500); // now inside the transaction's held window
  const during = await poll(h);
  const status = await confirming;
  delete process.env.PRINT_CONFIRM_TEST_DELAY_MS;

  const after = await deps.getOrderById(TENANT, order.id);
  const ds = await deliveriesFor(deps, order.id);
  check("the poll during the confirm did NOT re-offer", during.jobReady === false, `jobReady=${during.jobReady}`);
  check("still exactly one delivery (no duplicate hand-over)", ds.length === 1, `${ds.length} deliveries`);
  check("confirm completed and PRINTED", status === 200 && after?.status === "PRINTED", `status=${after?.status}`);
}

// 6. Printer GETs D1 twice before DELETE -> fetch_count = 2, one delivery, one confirm.
async function s6_fetchCounted(h: Handlers, deps: Deps): Promise<void> {
  console.log("\n6. two fetches of one delivery are COUNTED (the silent double-print is visible)");
  await reset(deps);
  const order = await seedOrder(deps);
  const p1 = await poll(h);
  const g1 = await getByToken(h, p1.token!);
  const g2 = await getByToken(h, p1.token!);
  const status = await confirm(h, p1.token!);
  const ds = await deliveriesFor(deps, order.id);
  const after = await deps.getOrderById(TENANT, order.id);

  check("both fetches served 200", g1.status === 200 && g2.status === 200);
  check("fetch_count = 2 on the one delivery", ds.length === 1 && ds[0].fetch_count === 2, `count=${ds[0]?.fetch_count}`);
  check("still one delivery, one confirm -> PRINTED", ds.length === 1 && ds[0].confirmed_at !== null && status === 200 && after?.status === "PRINTED");
}

// 7. 520 on D1 -> delivery failed/closed, order re-armed, next poll offers D2.
async function s7_downloadFailedReoffers(h: Handlers, deps: Deps): Promise<void> {
  console.log("\n7. a 520 download-failed confirm re-arms the order; the next poll offers a new delivery");
  await reset(deps);
  const order = await seedOrder(deps);
  const p1 = await poll(h);
  await getByToken(h, p1.token!);
  const status = await confirm(h, p1.token!, "520 Download failed");
  const p2 = await poll(h); // immediately, no expiry wait needed
  const ds = await deliveriesFor(deps, order.id);

  check("failure DELETE acknowledged 200", status === 200, `status=${status}`);
  check("D1 closed with its failure code", !!ds.find((d) => d.id === p1.token) && ds.find((d) => d.id === p1.token)!.confirmed_at !== null);
  check("order stays QUEUED (not condemned on one failure)", (await deps.getOrderById(TENANT, order.id))?.status === "QUEUED");
  check("next poll offers a NEW delivery immediately", p2.jobReady && p2.token !== p1.token, `token=${p2.token}`);

  // …but repeated failures must still condemn: a re-offer that clears the
  // pointer must not loop forever. Keep failing until the cap (default 4) bites.
  let last = p2;
  let guard = 0;
  while (last.jobReady && guard < 12) {
    await getByToken(h, last.token!);
    await confirm(h, last.token!, "520 Download failed");
    last = await poll(h);
    guard++;
  }
  const final = await deps.getOrderById(TENANT, order.id);
  check(
    "repeated failures eventually condemn (the cap bites, no infinite re-offer)",
    final?.status === "PRINT_FAILED",
    `status=${final?.status} attempts=${final?.printAttempts} after ${guard} more failures`,
  );
}

// 8. Manual reprint -> labeled manual_reprint delivery, printed_at untouched, badged.
async function s8_manualReprintIsLabeled(h: Handlers, deps: Deps): Promise<void> {
  console.log("\n8. a manual 重印 is LABELED; printed_at is untouched; the card is badged");
  await reset(deps);
  const order = await seedOrder(deps);

  // Print it once, cleanly.
  const p1 = await poll(h);
  await getByToken(h, p1.token!);
  await confirm(h, p1.token!);
  const printed = await deps.getOrderById(TENANT, order.id);
  const printedAt = printed?.printedAt ?? null;

  // Staff press 重印.
  await deps.requeueForPrint(TENANT, order.id, "kitchen");
  const requeued = await deps.getOrderById(TENANT, order.id);
  const ds = await deliveriesFor(deps, order.id);
  const reprint = ds.find((d) => d.reason === "manual_reprint");

  // The reprint prints on the next poll — a labeled, legitimate second ticket.
  const p2 = await poll(h);
  await getByToken(h, p2.token!);
  await confirm(h, p2.token!);

  const board = await deps.listActiveOrders(TENANT, "2026-08-31", { includeCompleted: true });
  const card = board.find((o) => o.id === order.id);

  check("a manual_reprint delivery was written", !!reprint, reprint ? `actor=${reprint.actor}` : "none");
  check("its actor is recorded", reprint?.actor === "kitchen");
  check("printed_at was NOT cleared by the reprint", requeued?.printedAt === printedAt && printedAt !== null, `printed_at=${requeued?.printedAt}`);
  check("the order was re-queued (claimable again)", requeued?.status === "QUEUED" && requeued?.printAttempts === 0);
  check("the board card is badged 已重印 (reprintCount ≥ 1)", (card?.reprintCount ?? 0) >= 1, `reprintCount=${card?.reprintCount}`);
  check("the reprint produced a second, explained delivery", (card?.deliveryCount ?? 0) >= 2, `deliveryCount=${card?.deliveryCount}`);
}

/* --------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-delivery-test-"));

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

  const admin = new Client({
    host: "localhost",
    port: PORT,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await admin.connect();
  await admin.query(
    `create database ${DB_NAME} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`,
  );
  await admin.end();

  // Every value the route reads, set BEFORE the modules are imported.
  process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`;
  process.env.TENANT_ID = TENANT;
  process.env.CLOUDPRNT_SECRET = SECRET;
  process.env.CLOUDPRNT_PRINTER_MAC = MAC;
  process.env.RESTAURANT_TIMEZONE = "America/Los_Angeles";
  process.env.TENANT_TAX_RATE_BPS = "875";
  process.env.ORDER_NUMBER_PREFIX = "A";
  process.env.TICKET_COPIES = "3";
  // A 25s window — long enough that "within the window" is unambiguous, short
  // enough to be honest. Expiry is simulated by expireInFlight(), not by waiting.
  process.env.PRINT_CONFIRM_FLOOR_SECONDS = "25";
  process.env.PRINT_SECONDS_PER_COPY = "0";
  delete process.env.PRINT_OFFER_CAP;
  delete process.env.PRINT_CONFIRM_TEST_DELAY_MS;

  const { ordersPool, closeOrdersPool } = await import("../src/lib/db/postgres");
  await ordersPool().query(
    await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"),
  );

  const repo = await import("../src/lib/orders/repository");
  const route = (await import("../src/app/api/print/[secret]/route")) as unknown as Handlers;
  const deps: Deps = {
    createOrder: repo.createOrder,
    getOrderById: repo.getOrderById,
    requeueForPrint: repo.requeueForPrint,
    listActiveOrders: repo.listActiveOrders,
    ordersPool,
  };

  try {
    await s1_holdWithinWindow(route, deps);
    await s2_confirmPrints(route, deps);
    await s3_expiryReoffersWithNewIdentity(route, deps);
    await s4_supersededConfirmIsStale(route, deps);
    await s5_noReofferDuringConfirm(route, deps);
    await s6_fetchCounted(route, deps);
    await s7_downloadFailedReoffers(route, deps);
    await s8_manualReprintIsLabeled(route, deps);
  } finally {
    await closeOrdersPool();
    console.log("\nstopping postgres…");
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\nprint deliveries: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.error("\nFAILED:");
    for (const f of failed) console.error(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exit(1);
  }
  console.log("\none order, one ticket — and every second ticket is explained ✓");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
