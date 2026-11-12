/**
 * What one staff-board poll costs, measured on a real embedded Postgres
 * through the REAL route handlers.
 *
 *   npm run measure:board-poll
 *
 * Counts every statement the route sends to Postgres (BEGIN and COMMIT
 * included, because each is a round trip through Hyperdrive), how many of
 * them take row locks, and the response body in bytes. Runs against whatever
 * code is checked out:
 *
 *   - before the version endpoint existed, a poll is
 *     GET /api/kitchen/orders?completed=1, and an unchanged poll is the same
 *     request again;
 *   - with it, a poll is GET /api/kitchen/orders/version, and the full list is
 *     fetched only when that changes, with If-None-Match.
 *
 * Seeds today's orders the way a service looks: a mix of channels and
 * statuses, three lines each, a confirmed delivery on everything that has
 * printed, both printers polling. The last scenario adds a day's worth of
 * completed and cancelled orders, which the old poll carried on every request.
 *
 * Read-only against its own throwaway database; never touches .env.local.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg, { Client } from "pg";

const PORT = 55447;
const DB_NAME = "nmc_measure_poll";
const TENANT = "measure-poll";
const PASSWORD = "measure-board-poll-password";
const TIMEZONE = "America/Los_Angeles";
const REPS = 25;

/* ------------------------------------------------------ statement count -- */

const LOCKING = /\bfor\s+(update|no\s+key\s+update|share|key\s+share)\b/i;
const counter = { statements: 0, locking: 0, texts: [] as string[] };
/** The harness's own connection: its queries (seeding, WAL readings) are not the route's. */
let harness: unknown = null;

function installCounter(): void {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = proto.query;
  proto.query = function counted(this: unknown, ...args: unknown[]): unknown {
    if (this === harness) return original.apply(this, args);
    const first = args[0];
    const text =
      typeof first === "string"
        ? first
        : first && typeof first === "object" && "text" in first
          ? String((first as { text: unknown }).text)
          : "";
    counter.statements++;
    if (LOCKING.test(text)) counter.locking++;
    counter.texts.push(text.replace(/\s+/g, " ").trim().slice(0, 70));
    return original.apply(this, args);
  };
}

function resetCounter(): void {
  counter.statements = 0;
  counter.locking = 0;
  counter.texts = [];
}

/* ------------------------------------------------------------- harness -- */

type Handler = (r: Request) => Promise<Response>;
let cookie = "";

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { headers: { cookie, ...headers } });
}

interface Sample {
  status: number;
  statements: number;
  locking: number;
  bytes: number;
  etag: string | null;
  ms: number;
  /** WAL the request generated: a locking read writes a row lock into every row it locks. */
  walBytes: number;
}

let walDb: Client | null = null;
async function walLsn(): Promise<string> {
  const { rows } = await walDb!.query(`select pg_current_wal_insert_lsn()::text as lsn`);
  return String(rows[0].lsn);
}
async function walSince(lsn: string): Promise<number> {
  const { rows } = await walDb!.query(`select pg_wal_lsn_diff(pg_current_wal_insert_lsn(), $1::pg_lsn)::int as n`, [lsn]);
  return Number(rows[0].n);
}

async function measure(handler: Handler, path: string, headers: Record<string, string> = {}): Promise<Sample> {
  const lsn = await walLsn();
  resetCounter();
  const t0 = performance.now();
  const res = await handler(get(path, headers));
  const body = new Uint8Array(await res.arrayBuffer());
  const ms = performance.now() - t0;
  const walBytes = await walSince(lsn);
  return {
    walBytes,
    status: res.status,
    statements: counter.statements,
    locking: counter.locking,
    bytes: body.byteLength,
    etag: res.headers.get("etag"),
    ms,
  };
}

/** Median wall time over REPS runs, statements from the last. */
async function median(handler: Handler, path: string, headers: Record<string, string> = {}): Promise<Sample> {
  const samples: Sample[] = [];
  for (let i = 0; i < REPS; i++) samples.push(await measure(handler, path, headers));
  const sorted = [...samples].sort((a, b) => a.ms - b.ms);
  return { ...samples[samples.length - 1], ms: sorted[Math.floor(sorted.length / 2)].ms };
}

/* ---------------------------------------------------------------- seed -- */

const LINES = [
  { itemId: "kung-pao-chicken", nameEn: "Kung Pao Chicken", nameZh: "宮保雞丁", sizeId: "individual", sizeLabel: "Individual", sizeLabelZh: "單點", modifiers: [], quantity: 2, unitCents: 1650, lineCents: 3300 },
  { itemId: "egg-rolls", nameEn: "Egg Rolls", nameZh: "春卷", sizeId: "individual", sizeLabel: "Individual", sizeLabelZh: "單點", modifiers: [], quantity: 1, unitCents: 795, lineCents: 795 },
  { itemId: "chicken-broccoli", nameEn: "Chicken with Broccoli", nameZh: "芥蘭雞", sizeId: "individual", sizeLabel: "Individual", sizeLabelZh: "單點", modifiers: [{ id: "extra-spicy", nameEn: "Extra spicy", nameZh: "加辣", priceCents: 0 }], quantity: 1, unitCents: 1595, lineCents: 1595, specialInstructions: "no onions" },
];
const TOTALS = { subtotalCents: 5690, taxCents: 498, tipCents: 0, totalCents: 6188 };
const ACTIVE = ["QUEUED", "PRINTED", "ACCEPTED", "ACCEPTED", "PRINTED", "PRINT_FAILED"] as const;
const CHANNELS = ["web", "phone", "walk_in", "web", "dine_in"] as const;

let seq = 0;
async function seed(db: Client, businessDate: string, active: number, finished: number): Promise<void> {
  await db.query(`delete from print_deliveries where tenant_id = $1`, [TENANT]);
  await db.query(`delete from orders where tenant_id = $1`, [TENANT]);
  const rows: { status: string; channel: string }[] = [];
  for (let i = 0; i < active; i++) rows.push({ status: ACTIVE[i % ACTIVE.length], channel: CHANNELS[i % CHANNELS.length] });
  for (let i = 0; i < finished; i++) rows.push({ status: i % 8 === 7 ? "CANCELLED" : "COMPLETED", channel: CHANNELS[i % CHANNELS.length] });
  for (const r of rows) {
    seq++;
    const dineIn = r.channel === "dine_in";
    const { rows: ins } = await db.query(
      `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
                           customer, phone_verified_at, pickup_at, ready_from, ready_to, channel, print_station,
                           table_label, guest_count, table_cleared_at, payment_note, staff_note)
       values ($1, $2, $3::date, $4, $5, $6, $7, $8, now(), now() + interval '25 minutes',
               now() + interval '20 minutes', now() + interval '30 minutes', $9, $10, $11, $12, $13, $14, $15)
       returning id`,
      [
        TENANT,
        `A-${String(seq).padStart(3, "0")}`,
        businessDate,
        r.status,
        `measure-${seq}`,
        JSON.stringify(LINES),
        JSON.stringify(TOTALS),
        JSON.stringify({ name: dineIn ? `Table ${seq % 12}` : `Customer ${seq}`, phone: dineIn ? "" : "+16195550142" }),
        r.channel,
        r.channel === "web" ? "online" : "store",
        dineIn ? String(seq % 12) : null,
        dineIn ? 4 : null,
        dineIn && (r.status === "COMPLETED" || r.status === "CANCELLED") ? new Date() : null,
        r.channel === "phone" ? "paid by phone" : null,
        null,
      ],
    );
    if (r.status !== "QUEUED") {
      await db.query(
        `insert into print_deliveries (id, order_id, tenant_id, offered_at, expires_at, reason, actor, station,
                                       fetched_at, fetch_count, confirmed_at, confirm_code)
         values (gen_random_uuid(), $1, $2, now() - interval '5 minutes', now(), 'first-offer', 'printer', $3,
                 now() - interval '5 minutes', 1, now() - interval '4 minutes', '200 OK')`,
        [ins[0].id, TENANT, r.channel === "web" ? "online" : "store"],
      );
    }
  }
  await db.query(`analyze orders`);
  await db.query(`analyze print_deliveries`);
}

/* ---------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-measure-poll-"));
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  const admin = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${DB_NAME} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();

  const url = `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`;
  process.env.DATABASE_URL = url;
  process.env.TENANT_ID = TENANT;
  process.env.RESTAURANT_TIMEZONE = TIMEZONE;
  process.env.TENANT_TIMEZONE = TIMEZONE;
  process.env.TENANT_TAX_RATE_BPS = "875";
  process.env.ORDER_NUMBER_PREFIX = "A";
  process.env.ADMIN_DASH_PASSWORD = PASSWORD;
  process.env.CLOUDPRNT_SECRET = "measure-board-poll-print";
  process.env.CLOUDPRNT_PRINTER_MAC_ONLINE = "00:11:62:00:00:0A";
  process.env.CLOUDPRNT_PRINTER_MAC_STORE = "00:11:62:00:00:0B";

  const db = new Client({ connectionString: url });
  await db.connect();
  harness = db;
  walDb = db;
  await db.query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));
  await db.query(
    `insert into printer_station_status (tenant_id, station, last_seen_at, online, paper_out, cover_open, paper_low,
                                         status_code, printer_mac)
     values ($1, 'online', now(), true, false, false, false, '200 OK', '00116200000a'),
            ($1, 'store',  now(), true, false, false, false, '200 OK', '00116200000b')`,
    [TENANT],
  );

  const pool = await import("../src/lib/db/postgres");
  const session = await import("../src/lib/auth/kitchenSession");
  const biz = await import("../src/lib/orders/businessDate");
  const orders = (await import("../src/app/api/kitchen/orders/route")) as unknown as { GET: Handler };
  let version: { GET: Handler } | null = null;
  try {
    version = (await import("../src/app/api/kitchen/orders/version/route")) as unknown as { GET: Handler };
  } catch {
    version = null;
  }
  cookie = `nmc_kitchen=${session.login(PASSWORD)}`;
  const businessDate = biz.businessDateFor(TIMEZONE);
  installCounter();

  // Warm the pool so the first scenario does not pay for the connection.
  await pool.ordersPool().query("select 1");

  const scenarios: { label: string; active: number; finished: number }[] = [
    { label: "0 orders", active: 0, finished: 0 },
    { label: "10 orders", active: 10, finished: 0 },
    { label: "40 orders", active: 40, finished: 0 },
    { label: "40 open + 120 done today", active: 40, finished: 120 },
  ];

  console.log(`\nmode: ${version ? "AFTER (version endpoint + ETag)" : "BEFORE (full list every poll)"}`);
  console.log(`median of ${REPS} runs on embedded Postgres, same process, no network\n`);
  const lines: string[] = [];
  for (const s of scenarios) {
    await seed(db, businessDate, s.active, s.finished);
    if (!version) {
      const full = await median(orders.GET, "/api/kitchen/orders?completed=1");
      lines.push(
        `| ${s.label} | poll = full list | ${full.statements} (${full.locking} locking) | ${full.bytes} B | ${full.status} | ${full.walBytes} B | ${full.ms.toFixed(1)} ms |`,
        `| ${s.label} | unchanged poll | ${full.statements} (${full.locking} locking) | ${full.bytes} B | ${full.status} | ${full.walBytes} B | ${full.ms.toFixed(1)} ms |`,
      );
      if (s.active === 40 && s.finished === 0) console.log("statements in one poll:\n  " + counter.texts.join("\n  "));
    } else {
      const v = await median(version.GET, "/api/kitchen/orders/version");
      const same = await median(version.GET, "/api/kitchen/orders/version", { "if-none-match": v.etag ?? "" });
      const full = await median(orders.GET, "/api/kitchen/orders");
      const unchanged = await median(orders.GET, "/api/kitchen/orders", { "if-none-match": full.etag ?? "" });
      lines.push(
        `| ${s.label} | unchanged poll: /version, If-None-Match | ${same.statements} (${same.locking} locking) | ${same.bytes} B | ${same.status} | ${same.walBytes} B | ${same.ms.toFixed(1)} ms |`,
        `| ${s.label} | changed poll: /version | ${v.statements} (${v.locking} locking) | ${v.bytes} B | ${v.status} | ${v.walBytes} B | ${v.ms.toFixed(1)} ms |`,
        `| ${s.label} | full list (version changed) | ${full.statements} (${full.locking} locking) | ${full.bytes} B | ${full.status} | ${full.walBytes} B | ${full.ms.toFixed(1)} ms |`,
        `| ${s.label} | full list, If-None-Match | ${unchanged.statements} (${unchanged.locking} locking) | ${unchanged.bytes} B | ${unchanged.status} | ${unchanged.walBytes} B | ${unchanged.ms.toFixed(1)} ms |`,
      );
      if (s.active === 40 && s.finished === 0) {
        await measure(version.GET, "/api/kitchen/orders/version");
        console.log("statements in one /version poll:\n  " + counter.texts.join("\n  "));
        await measure(orders.GET, "/api/kitchen/orders");
        console.log("statements in one full fetch:\n  " + counter.texts.join("\n  "));
      }
    }
  }
  console.log("\n| Orders today | Request | Statements | Body | Status | WAL written | Median |");
  console.log("|---|---|---|---|---|---|---|");
  for (const l of lines) console.log(l);

  await db.end();
  await pool.closeOrdersPool();
  await server.stop();
  await rm(dataDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
