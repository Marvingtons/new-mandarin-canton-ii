/**
 * Prove the ticket pre-rendered at order creation (lib/print/prerender.ts) is
 * a pure speed change.
 *
 *   npm run verify:print-prerender
 *
 * Real embedded Postgres with the real schema.sql, the real repository, the
 * REAL print route handlers (POST poll, DELETE confirm), and an in-memory R2
 * bucket installed where getCloudflareContext() finds it, so the R2 path the
 * printers use in production is the path under test.
 *
 *   1. hit: the hand-over points the printer at the staged object, and its
 *      bytes equal a fresh render made at hand-over (pixel-identical)
 *   2. an edit between creation and hand-over: the stage is not used, the
 *      edited ticket is rendered, the stale object is deleted
 *   3. the printer claims before the stage lands: nothing is staged, the
 *      uploaded object is deleted
 *   4. single use: a retry after expiry is a new delivery with its own key
 *   5. schedulePrerender (the route's call) stages on its own and never throws
 *   6. a database without migration 018 still prints, and the schedule fails quietly
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const PORT = 55447;
const DB_NAME = "nmc_prerender_test";
const SECRET = "verify-print-prerender-secret";
const MAC = "00:11:62:00:00:07";
const TENANT = "prerender-test";
const TZ = "America/Los_Angeles";
const BASE = `https://example.test/api/print/${SECRET}`;
const PUBLIC_BASE = "https://jobs.example.test";
const TENANT_REF = { tenantId: TENANT, timezone: TZ };

const params = Promise.resolve({ secret: SECRET });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------- in-memory R2 -- */

const objects = new Map<string, Uint8Array>();
const bucket = {
  async put(key: string, value: ArrayBuffer | ArrayBufferView) {
    const v = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    objects.set(key, new Uint8Array(v));
    return {};
  },
  async get(key: string) {
    const v = objects.get(key);
    return v ? { arrayBuffer: async () => v.slice().buffer } : null;
  },
  async delete(key: string) {
    objects.delete(key);
  },
};
(globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] = {
  env: { PRINT_JOBS: bucket, PRINT_JOBS_PUBLIC_BASE: PUBLIC_BASE },
  ctx: undefined,
  cf: undefined,
};

/* ------------------------------------------------------------- results -- */

const results: { name: string; passed: boolean }[] = [];
function check(name: string, passed: boolean, detail = ""): void {
  results.push({ name, passed });
  console.log(`   ${passed ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
}

/* ------------------------------------------------------------ harness -- */

interface Handlers {
  POST: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
  DELETE: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
}

async function poll(h: Handlers): Promise<{ jobReady: boolean; token: string | null; url: string | null }> {
  const res = await h.POST(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusCode: "200 OK", printerMAC: MAC }),
    }),
    { params },
  );
  const b = (await res.json()) as { jobReady?: boolean; jobToken?: string; jobGetUrl?: string };
  return { jobReady: b.jobReady === true, token: b.jobToken ?? null, url: b.jobGetUrl ?? null };
}

async function confirm(h: Handlers, token: string): Promise<number> {
  const url = `${BASE}?mac=${encodeURIComponent(MAC)}&code=OK&token=${encodeURIComponent(token)}`;
  return (await h.DELETE(new Request(url, { method: "DELETE" }), { params })).status;
}

function keyOf(url: string | null): string | null {
  return url && url.startsWith(`${PUBLIC_BASE}/`) ? url.slice(PUBLIC_BASE.length + 1) : null;
}

function same(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return !!a && a.length === b.length && a.every((x, i) => x === b[i]);
}

type Repo = typeof import("../src/lib/orders/repository");
type Pre = typeof import("../src/lib/print/prerender");
type Pool = ReturnType<typeof import("../src/lib/db/postgres").ordersPool>;

let seq = 0;
async function seed(repo: Repo) {
  seq++;
  const { order } = await repo.createOrder({
    tenantId: TENANT,
    businessDate: "2026-11-27",
    orderNumberPrefix: "A",
    idempotencyKey: `prerender-${seq}-${Date.now()}`,
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
    customer: { name: "Prerender Test", phone: "+16195550000" },
    phoneVerifiedAt: new Date(),
    pickupAt: new Date(Date.now() + 25 * 60_000),
  });
  return order;
}

async function staged(pool: Pool, id: number): Promise<{ key: string } | null> {
  const { rows } = await pool.query(`select print_prerender from orders where id = $1`, [id]);
  return (rows[0]?.print_prerender as { key: string } | null) ?? null;
}

/** What a render at hand-over would produce for the delivery now in flight. */
async function freshRender(repo: Repo, pre: Pre, id: number): Promise<Uint8Array> {
  const order = (await repo.getOrderById(TENANT, id))!;
  const body = await repo.printBodyFor(TENANT, order, order.printDeliveryId);
  return (await pre.renderPrinterJob(TZ, body, 0)).body;
}

async function reset(pool: Pool): Promise<void> {
  await pool.query("delete from orders where tenant_id = $1", [TENANT]);
  objects.clear();
}

/* ---------------------------------------------------------- scenarios -- */

async function s1_hit(h: Handlers, repo: Repo, pre: Pre, pool: Pool) {
  console.log("\n1. a pre-rendered ticket is handed over as is, byte-identical to a fresh render");
  await reset(pool);
  const order = await seed(repo);
  await pre.prerenderTicket(TENANT_REF, order);
  const stage = await staged(pool, order.id);
  check("the ticket is staged at creation", !!stage && objects.has(stage.key));
  const p = await poll(h);
  const key = keyOf(p.url);
  check("the poll offers it", p.jobReady && key === stage?.key, `key=${key}`);
  check("the stage is cleared by the hand-over", (await staged(pool, order.id)) === null);
  const state = await repo.printSegmentState(TENANT, order.id);
  check("print_job_key and print_segments recorded as after a render", state.jobKey === key && state.segments === 1, JSON.stringify(state));
  check("the staged bytes equal a render at hand-over", same(objects.get(key!), await freshRender(repo, pre, order.id)));
  check("confirm prints it", (await confirm(h, p.token!)) === 200 && (await repo.getOrderById(TENANT, order.id))?.printedAt !== null);
  check("the object is deleted on confirmation", !objects.has(key!));
  const { rows } = await pool.query(`select count(*)::int as n from print_deliveries where order_id = $1`, [order.id]);
  check("one delivery, as without pre-render", rows[0].n === 1, `n=${rows[0].n}`);
}

async function s2_editedBeforeHandOver(h: Handlers, repo: Repo, pre: Pre, pool: Pool) {
  console.log("\n2. an edit between creation and hand-over: the stage is not used");
  await reset(pool);
  const order = await seed(repo);
  await pre.prerenderTicket(TENANT_REF, order);
  const stale = (await staged(pool, order.id))!.key;
  const saved = await repo.saveOrderEdit(TENANT, {
    orderId: order.id,
    baseRevision: 0,
    editToken: `prerender-edit-${Date.now()}`,
    items: [...order.items, { ...order.items[0], itemId: "egg-rolls", nameEn: "Egg Rolls", nameZh: "春卷", unitCents: 350, lineCents: 350 }],
    totals: { subtotalCents: 2600, taxCents: 228, tipCents: 0, totalCents: 2828 },
    actor: "kitchen",
    printChange: false,
    staffNoteLine: null,
  });
  check("the edit saved", saved.kind === "saved", saved.kind);
  const p = await poll(h);
  const key = keyOf(p.url);
  check("a different object is offered", p.jobReady && !!key && key !== stale, `key=${key}`);
  check("it is the edited ticket, rendered at hand-over", same(objects.get(key!), await freshRender(repo, pre, order.id)));
  check("the stale object is deleted", !objects.has(stale));
  check("the stage is cleared", (await staged(pool, order.id)) === null);
}

async function s3_lostRace(h: Handlers, repo: Repo, pre: Pre, pool: Pool) {
  console.log("\n3. the printer claims before the stage lands");
  await reset(pool);
  const order = await seed(repo);
  const p = await poll(h);
  const offered = keyOf(p.url);
  await pre.prerenderTicket(TENANT_REF, order);
  check("nothing is staged", (await staged(pool, order.id)) === null);
  check("only the hand-over's own object exists", objects.size === 1 && !!offered && objects.has(offered), `${objects.size} objects`);
  check("print_job_key is the hand-over's", (await repo.printSegmentState(TENANT, order.id)).jobKey === offered);
}

async function s4_singleUse(h: Handlers, repo: Repo, pre: Pre, pool: Pool) {
  console.log("\n4. a retry after expiry gets its own key");
  await reset(pool);
  const order = await seed(repo);
  await pre.prerenderTicket(TENANT_REF, order);
  const first = await poll(h);
  await pool.query(
    `update print_deliveries set expires_at = now() - interval '5 seconds' where id = $1`,
    [first.token],
  );
  await pool.query(
    `update orders set print_delivery_expires_at = now() - interval '5 seconds' where id = $1`,
    [order.id],
  );
  const second = await poll(h);
  check("the retry is a new delivery", second.jobReady && !!second.token && second.token !== first.token);
  check("with a new URL", !!second.url && second.url !== first.url, keyOf(second.url) ?? "");
  check("whose key carries the retry's delivery id", (keyOf(second.url) ?? "").includes(second.token!));
}

async function s5_schedule(h: Handlers, repo: Repo, pre: Pre, pool: Pool) {
  console.log("\n5. schedulePrerender, as the order routes call it");
  await reset(pool);
  const order = await seed(repo);
  pre.schedulePrerender(TENANT_REF, order);
  check("returns without waiting for the render", (await staged(pool, order.id)) === null);
  for (let i = 0; i < 50 && (await staged(pool, order.id)) === null; i++) await sleep(50);
  const stage = await staged(pool, order.id);
  check("stages the ticket in the background", !!stage);
  const p = await poll(h);
  check("and the hand-over uses it", keyOf(p.url) === stage?.key);
}

async function s6_withoutMigration(h: Handlers, repo: Repo, pre: Pre, pool: Pool) {
  console.log("\n6. a database without migration 018");
  await reset(pool);
  await pool.query(`alter table orders drop column print_prerender`);
  try {
    const order = await seed(repo);
    let threw = false;
    try {
      pre.schedulePrerender(TENANT_REF, order);
    } catch {
      threw = true;
    }
    await sleep(500);
    check("schedulePrerender does not throw", !threw);
    const p = await poll(h);
    const key = keyOf(p.url);
    check("the poll still hands the ticket over", p.jobReady && !!key);
    check("rendered at hand-over", same(objects.get(key!), await freshRender(repo, pre, order.id)));
    check("and it confirms", (await confirm(h, p.token!)) === 200);
  } finally {
    await pool.query(`alter table orders add column if not exists print_prerender jsonb`);
  }
}

/* --------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-prerender-test-"));
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port: PORT, persistent: false });
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
  process.env.RESTAURANT_TIMEZONE = TZ;
  process.env.TENANT_TAX_RATE_BPS = "875";
  process.env.ORDER_NUMBER_PREFIX = "A";
  process.env.TICKET_COPIES = "2";
  process.env.PRINT_CONFIRM_FLOOR_SECONDS = "25";
  process.env.PRINT_SECONDS_PER_COPY = "0";
  delete process.env.PRINT_FETCH_VIA_WORKER;
  delete process.env.PRINT_OFFER_CAP;

  const { ordersPool, closeOrdersPool } = await import("../src/lib/db/postgres");
  await ordersPool().query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));
  const repo = await import("../src/lib/orders/repository");
  const pre = await import("../src/lib/print/prerender");
  const route = (await import("../src/app/api/print/[secret]/route")) as unknown as Handlers;
  const pool = ordersPool();

  try {
    await s1_hit(route, repo, pre, pool);
    await s2_editedBeforeHandOver(route, repo, pre, pool);
    await s3_lostRace(route, repo, pre, pool);
    await s4_singleUse(route, repo, pre, pool);
    await s5_schedule(route, repo, pre, pool);
    await s6_withoutMigration(route, repo, pre, pool);
  } finally {
    await closeOrdersPool();
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
