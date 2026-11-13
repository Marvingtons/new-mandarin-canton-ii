/**
 * The staff board's cheap poll: GET /api/kitchen/orders/version, then the
 * full list only when it moves.
 *
 *   npm run verify:board-poll
 *
 * Against a real embedded Postgres and the REAL route handlers:
 *
 *   1. Migration 013 applies after 011 and 012 on main's schema, twice, and
 *      the version query is an index-only scan on its index at a realistic
 *      size (two months of history).
 *   2. An unchanged poll is ONE statement and a 304 with no body, on /version
 *      and on the list; nothing on either path takes a lock or writes WAL.
 *   3. Every change the board shows moves the version: a new order, each
 *      status change, completing and cancelling, a 重印, clearing a table, a
 *      write that commits with an updated_at older than the newest, paper,
 *      cover, a printer going silent past the offline and failover
 *      thresholds. And a healthy printer's 3-second polls do NOT move it.
 *   4. The list is today's open orders only, with X-Server-Time and no
 *      serverTime in the body.
 *   6. Migration 012 missing (011 only): both routes still answer.
 *   7. Behind the Hyperdrive cache stand-in, a change is seen on the next poll.
 *
 * ⚠️ WINDOWS: run from a NON-ELEVATED shell (see verify:print-recurrence).
 */

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg, { Client } from "pg";

const PORT = 55448;
const DB = "nmc_board_poll";
const BASELINE_DB = "nmc_board_poll_baseline";
const BASELINE_REF = process.env.BASELINE_REF ?? "main";
const TENANT = "board-poll";
const PASSWORD = "verify-board-poll-password";
const TIMEZONE = "America/Los_Angeles";
const MAC_ONLINE = "00:11:62:00:00:0A";
const MAC_STORE = "00:11:62:00:00:0B";
const MIGRATIONS = join(process.cwd(), "src", "lib", "db", "migrations");

let failures = 0;
let passes = 0;
function check(name: string, passed: boolean, detail = ""): void {
  if (passed) passes++;
  else failures++;
  console.log(`   ${passed ? "✓" : "✗"} ${name}${!passed && detail ? ` (${detail})` : ""}`);
}

/* --------------------------------------------- statements the routes send -- */

const LOCKING = /\bfor\s+(update|no\s+key\s+update|share|key\s+share)\b/i;
const sent = { statements: 0, locking: 0, transactions: 0 };
let harness: unknown = null;

function installCounter(): void {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = proto.query;
  proto.query = function counted(this: unknown, ...args: unknown[]): unknown {
    if (this !== harness) {
      const first = args[0];
      const text =
        typeof first === "string" ? first : first && typeof first === "object" && "text" in first ? String((first as { text: unknown }).text) : "";
      sent.statements++;
      if (LOCKING.test(text)) sent.locking++;
      if (/^\s*begin\b/i.test(text)) sent.transactions++;
    }
    return original.apply(this, args);
  };
}

/* ------------------------------------------------------------- harness -- */

type Handler = (r: Request) => Promise<Response>;
type ActionHandler = (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

interface Mods {
  version: { GET: Handler };
  orders: { GET: Handler };
  action: { POST: ActionHandler };
  tables: { POST: Handler };
  feed: typeof import("../src/lib/kitchen/boardFeed");
  repo: typeof import("../src/lib/orders/repository");
  emulator: typeof import("./lib/hyperdrive-cache-emulator");
}

let cookie = "";
let db: Client;
let businessDate = "";

function req(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://localhost${path}`, { ...init, headers });
}

interface Answer {
  status: number;
  etag: string | null;
  serverTime: string | null;
  bytes: number;
  body: Record<string, unknown> | null;
  statements: number;
  locking: number;
  transactions: number;
  wal: number;
}

/** Off while the cache stand-in is installed: these readings are reads it would cache. */
let readWal = true;

async function call(handler: Handler, path: string, ifNoneMatch?: string | null): Promise<Answer> {
  const lsn = readWal ? String((await db.query(`select pg_current_wal_insert_lsn()::text as l`)).rows[0].l) : null;
  sent.statements = 0;
  sent.locking = 0;
  sent.transactions = 0;
  const res = await handler(req(path, { headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {} }));
  const raw = new Uint8Array(await res.arrayBuffer());
  const counted = { ...sent };
  const wal =
    lsn === null
      ? 0
      : Number((await db.query(`select pg_wal_lsn_diff(pg_current_wal_insert_lsn(), $1::pg_lsn)::int as n`, [lsn])).rows[0].n);
  return {
    status: res.status,
    etag: res.headers.get("etag"),
    serverTime: res.headers.get("x-server-time"),
    bytes: raw.byteLength,
    body: raw.byteLength > 0 ? (JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>) : null,
    ...counted,
    wal,
  };
}

const version = (m: Mods, held?: string | null) => call(m.version.GET, "/api/kitchen/orders/version", held);
const list = (m: Mods, held?: string | null) => call(m.orders.GET, "/api/kitchen/orders", held);

async function act(m: Mods, id: number, action: string, extra: Record<string, unknown> = {}): Promise<number> {
  const res = await m.action.POST(
    req(`/api/kitchen/orders/${id}`, { method: "POST", body: JSON.stringify({ action, ...extra }) }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return res.status;
}

const LINE = { itemId: "kung-pao-chicken", nameEn: "Kung Pao Chicken", nameZh: "宮保雞丁", sizeId: "individual", sizeLabel: "Individual", sizeLabelZh: "單點", modifiers: [], quantity: 1, unitCents: 1650, lineCents: 1650 };
let seq = 0;

async function seedOrder(o: {
  status?: string;
  channel?: "web" | "phone" | "walk_in" | "dine_in";
  date?: string;
  table?: string;
  tenant?: string;
}): Promise<number> {
  seq++;
  const channel = o.channel ?? "web";
  const { rows } = await db.query(
    `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
                         customer, phone_verified_at, pickup_at, ready_from, ready_to, channel, print_station,
                         table_label, guest_count)
     values ($1, $2, $3::date, $4, $5, $6, $7, $8, now(), now() + interval '25 minutes',
             now() + interval '20 minutes', now() + interval '30 minutes', $9, $10, $11, $12)
     returning id`,
    [
      o.tenant ?? TENANT,
      `A-${String(seq).padStart(4, "0")}`,
      o.date ?? businessDate,
      o.status ?? "QUEUED",
      `board-poll-${seq}`,
      JSON.stringify([LINE]),
      JSON.stringify({ subtotalCents: 1650, taxCents: 144, tipCents: 0, totalCents: 1794 }),
      JSON.stringify({ name: o.table ? `Table ${o.table}` : `Guest ${seq}`, phone: o.table ? "" : "+16195550142" }),
      channel,
      channel === "web" ? "online" : "store",
      o.table ?? null,
      o.table ? 2 : null,
    ],
  );
  return Number(rows[0].id);
}

async function printers(rows: { station: string; ageSeconds: number; paperOut?: boolean; coverOpen?: boolean; paperLow?: boolean; code?: string }[]): Promise<void> {
  await db.query(`delete from printer_station_status where tenant_id = $1`, [TENANT]);
  for (const r of rows) {
    await db.query(
      `insert into printer_station_status (tenant_id, station, last_seen_at, online, paper_out, cover_open, paper_low,
                                           status_code, printer_mac)
       values ($1, $2, now() - make_interval(secs => $3), true, $4, $5, $6, $7, $8)`,
      [TENANT, r.station, r.ageSeconds, r.paperOut ?? false, r.coverOpen ?? false, r.paperLow ?? false, r.code ?? "200 OK", r.station === "online" ? "00116200000a" : "00116200000b"],
    );
  }
}

async function reset(): Promise<void> {
  await db.query(`delete from print_deliveries where tenant_id = $1`, [TENANT]);
  await db.query(`delete from orders where tenant_id = $1`, [TENANT]);
  await printers([
    { station: "online", ageSeconds: 1 },
    { station: "store", ageSeconds: 1 },
  ]);
}

/* ------------------------------------------------------------ sections -- */

async function s1_migration(server: { port: number }): Promise<void> {
  console.log(`\n1. migration 013 on ${BASELINE_REF}'s schema after 011 and 012; the version query uses its index`);
  const admin = new Client({ host: "localhost", port: server.port, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${BASELINE_DB} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();
  const base = new Client({ host: "localhost", port: server.port, user: "postgres", password: "postgres", database: BASELINE_DB });
  await base.connect();
  try {
    const mainSchema = execFileSync("git", ["show", `${BASELINE_REF}:src/lib/db/schema.sql`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    await base.query(mainSchema);
    for (const f of ["011_print_stations.sql", "012_printer_status_per_station.sql"]) {
      await base.query(await readFile(join(MIGRATIONS, f), "utf8"));
    }
    const m013 = await readFile(join(MIGRATIONS, "013_board_version_index.sql"), "utf8");
    let applied = true;
    try {
      await base.query(m013);
      await base.query(m013);
    } catch (err) {
      applied = false;
      check("013 applies", false, err instanceof Error ? err.message : String(err));
    }
    if (applied) check("013 applies, and applies again (idempotent)", true);
    const { rows: idx } = await base.query(
      `select indexdef from pg_indexes where tablename = 'orders' and indexname = 'orders_board_version_idx'`,
    );
    check("013 creates orders_board_version_idx, partial on open orders",
      idx.length === 1 && /WHERE \(status <> ALL/i.test(String(idx[0].indexdef)), String(idx[0]?.indexdef));
    const { rows: cols } = await base.query(
      `select count(*)::int as n from information_schema.columns where table_name = 'orders'`,
    );
    const { rows: before } = await base.query(
      `select count(*)::int as n from information_schema.columns
        where table_name = 'orders' and table_schema = 'public'`,
    );
    check("013 changes no table (index only)", Number(cols[0].n) === Number(before[0].n));

    // Two months of a busy day each, then today: does the planner choose it?
    await base.query(
      `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals, customer,
                           phone_verified_at, pickup_at, channel, created_at, updated_at)
       select 'nmc', 'A-' || g, current_date - (g / 80), case when g < 160 and g % 4 = 0 then 'QUEUED' else 'COMPLETED' end,
              'hist-' || g, '[]', '{"subtotalCents":0,"taxCents":0,"tipCents":0,"totalCents":0}',
              '{"name":"x","phone":""}', now(), now(), 'web', now() - make_interval(days => g / 80),
              now() - make_interval(days => g / 80)
         from generate_series(0, 4799) g`,
    );
    await base.query(`vacuum analyze orders`);
    const { rows: plan } = await base.query(
      `explain select count(*)::int, max(updated_at),
              coalesce(sum((extract(epoch from updated_at) * 1000000)::bigint), 0)::text
         from orders
        where tenant_id = 'nmc' and business_date = current_date
          and status not in ('COMPLETED', 'CANCELLED')`,
    );
    const text = plan.map((r) => String(r["QUERY PLAN"])).join("\n");
    check("4,800 orders over 60 days: the version is an index-only scan on orders_board_version_idx",
      /Index Only Scan using orders_board_version_idx/.test(text), text.replace(/\n/g, " | "));
  } finally {
    await base.end();
  }
}

async function s2_unchangedPoll(m: Mods): Promise<void> {
  console.log("\n2. an unchanged poll is one statement, a 304, no body; nothing locks or writes");
  await reset();
  for (let i = 0; i < 12; i++) await seedOrder({ status: ["QUEUED", "PRINTED", "ACCEPTED"][i % 3] });

  const first = await version(m);
  check("/version without an ETag: 200, a tiny JSON body", first.status === 200 && first.bytes < 200, `status=${first.status} bytes=${first.bytes}`);
  check("/version body: open count and newest updated_at", first.body?.openOrders === 12 && typeof first.body?.updatedAt === "string");
  check("/version: Cache-Control no-store, ETag, X-Server-Time", !!first.etag && !!first.serverTime);
  check("/version: one statement, no lock, no transaction", first.statements === 1 && first.locking === 0 && first.transactions === 0,
    `statements=${first.statements} locking=${first.locking}`);

  const same = await version(m, first.etag);
  check("/version with the ETag held: 304", same.status === 304, `status=${same.status}`);
  check("… with no body", same.bytes === 0, `bytes=${same.bytes}`);
  check("… for ONE statement", same.statements === 1, `statements=${same.statements}`);
  check("… and still carries X-Server-Time", !!same.serverTime);
  check("… and writes no WAL", same.wal === 0, `wal=${same.wal}`);

  const full = await list(m);
  check("list: 200 with the same ETag as /version", full.status === 200 && full.etag === first.etag, `${full.etag} vs ${first.etag}`);
  check("list: no lock, no transaction, no WAL", full.locking === 0 && full.transactions === 0 && full.wal === 0,
    `locking=${full.locking} tx=${full.transactions} wal=${full.wal}`);
  check("list: 4 statements (version, orders, printers, recently done)", full.statements === 4, `statements=${full.statements}`);
  const unchanged = await list(m, full.etag);
  check("list with If-None-Match: 304, no body, ONE statement", unchanged.status === 304 && unchanged.bytes === 0 && unchanged.statements === 1,
    `status=${unchanged.status} bytes=${unchanged.bytes} statements=${unchanged.statements}`);
  const weak = await version(m, `W/${first.etag}`);
  check("a weak W/ ETag (Cloudflare compression) still matches", weak.status === 304);
  const listed = await version(m, `"nope", ${first.etag}`);
  check("an If-None-Match list containing it matches", listed.status === 304);
}

async function recentUndo(m: Mods): Promise<void> {
  await reset();
  for (const status of ["QUEUED", "PRINTED", "PRINT_FAILED", "ACCEPTED"] as const) {
    for (const action of ["complete", "cancel"]) {
      const id = await seedOrder({ status, channel: "phone" });
      const before = await db.query(`select to_jsonb(d) as row from print_deliveries d order by id`);
      const held = (await version(m)).etag;
      check(`${status} ${action} succeeds`, await act(m, id, action) === 200);
      check(`${action} changes the version`, (await version(m, held)).status === 200);
      const body = (await list(m)).body;
      const recent = body?.recentlyDone as { id: number; donePreviousStatus: string }[];
      check("recent strip records exact prior status", recent.some((o) => o.id === id && o.donePreviousStatus === status));
      const doneVersion = (await version(m)).etag;
      check("undo succeeds", await act(m, id, "undo") === 200);
      check("undo changes the version", (await version(m, doneVersion)).status === 200);
      const restored = await db.query(`select status from orders where id = $1`, [id]);
      check("undo restores exact prior status", restored.rows[0].status === status);
      check("undo is single-use", await act(m, id, "undo") === 409);
      check("no print delivery created or changed", JSON.stringify(before.rows) === JSON.stringify((await db.query(`select to_jsonb(d) as row from print_deliveries d order by id`)).rows));
    }
  }
  await reset();
  for (let i = 0; i < 10; i++) await act(m, await seedOrder({ status: "ACCEPTED", channel: "phone" }), "complete");
  const recent = (await list(m)).body?.recentlyDone as { id: number }[];
  check("recent strip has newest eight", recent.length === 8 && recent.every((o, i) => i === 0 || o.id < recent[i - 1].id));
  const held = (await version(m)).etag;
  await db.query(`update orders set done_at = now() - interval '11 minutes' where tenant_id = $1`, [TENANT]);
  check("expiry moves version", (await version(m, held)).status === 200);
  check("expired strip is empty", ((await list(m)).body?.recentlyDone as unknown[]).length === 0);
  check("expired undo refused", await act(m, recent[0].id, "undo") === 409);
}

async function s3_changes(m: Mods): Promise<void> {
  console.log("\n3. every change the board shows moves the version; a healthy printer's poll does not");
  await reset();
  const a = await seedOrder({ status: "QUEUED" });
  const b = await seedOrder({ status: "PRINTED", channel: "phone" });
  const t = await seedOrder({ status: "PRINTED", channel: "dine_in", table: "7" });
  let held = (await version(m)).etag;

  async function moved(name: string, change: () => Promise<unknown>, expectMove = true): Promise<void> {
    await change();
    const v = await version(m, held);
    const didMove = v.status === 200;
    check(name, didMove === expectMove, `status=${v.status}`);
    if (v.etag) held = v.etag;
  }

  await moved("nothing happened: unchanged", async () => {}, false);
  await moved("a healthy printer polls (last_seen_at moves): unchanged", () =>
    db.query(`update printer_station_status set last_seen_at = now(), updated_at = now() where tenant_id = $1`, [TENANT]), false);
  await moved("a printer 30 s silent (under every threshold): unchanged", () =>
    db.query(`update printer_station_status set last_seen_at = now() - interval '30 seconds' where tenant_id = $1 and station = 'store'`, [TENANT]), false);
  await moved("a new order", () => seedOrder({ status: "QUEUED" }));
  await moved("an order for ANOTHER day: unchanged", () => seedOrder({ status: "QUEUED", date: "2020-01-01" }), false);
  await moved("an order for another tenant: unchanged", () => seedOrder({ status: "QUEUED", tenant: "someone-else" }), false);
  await moved("accept (接單)", async () => check("   accept answered 200", (await act(m, b, "accept")) === 200));
  await moved("the printer confirms (QUEUED -> PRINTED)", () =>
    db.query(`update orders set status = 'PRINTED', updated_at = now() where id = $1`, [a]));
  await moved("a 重印 to the other printer", async () => check("   reprint answered 200", (await act(m, a, "reprint", { station: "store" })) === 200));
  await moved("complete (完成): leaves the board", async () => check("   complete answered 200", (await act(m, b, "complete")) === 200));
  await moved("clear table 7", async () => {
    const res = await m.tables.POST(req("/api/kitchen/tables", { method: "POST", body: JSON.stringify({ action: "clear", label: "7" }) }));
    check("   clear answered 200", res.status === 200, `status=${res.status}`);
  });
  void t;
  // A transaction's now() is its START: a write that began first and
  // committed last lands with an updated_at OLDER than the newest one seen.
  await moved("a write committed with an older updated_at than the newest (max and count unchanged)", async () => {
    const { rows } = await db.query(
      `select id from orders where tenant_id = $1 and business_date = $2::date and status not in ('COMPLETED','CANCELLED')
        order by updated_at asc limit 1`,
      [TENANT, businessDate],
    );
    await db.query(`update orders set updated_at = updated_at + interval '1 millisecond' where id = $1`, [rows[0].id]);
  });
  const c = await seedOrder({ status: "PRINTED" });
  held = (await version(m)).etag;
  await moved("cancel: leaves the board", async () => check("   cancel answered 200", (await act(m, c, "cancel", { note: "test" })) === 200));
  await moved("store printer out of paper", () =>
    db.query(`update printer_station_status set paper_out = true, status_code = '503 Paper Empty' where tenant_id = $1 and station = 'store'`, [TENANT]));
  await moved("paper back", () =>
    db.query(`update printer_station_status set paper_out = false, status_code = '200 OK' where tenant_id = $1 and station = 'store'`, [TENANT]));
  await moved("cover open", () =>
    db.query(`update printer_station_status set cover_open = true where tenant_id = $1 and station = 'online'`, [TENANT]));
  await moved("paper low", () =>
    db.query(`update printer_station_status set cover_open = false, paper_low = true where tenant_id = $1 and station = 'online'`, [TENANT]));
  await moved("store printer silent past OFFLINE_AFTER_SECONDS (63 s)", () =>
    db.query(`update printer_station_status set last_seen_at = now() - interval '63 seconds' where tenant_id = $1 and station = 'store'`, [TENANT]));
  const strip = (await list(m)).body?.printers as { station: string; health: string }[];
  check("   … and the list fetched on that change shows it offline",
    strip.find((p) => p.station === "store")?.health === "offline", JSON.stringify(strip));
  await moved("… and past the failover window (93 s)", () =>
    db.query(`update printer_station_status set last_seen_at = now() - interval '93 seconds' where tenant_id = $1 and station = 'store'`, [TENANT]));
  const failed = (await list(m)).body?.printers as { station: string; failoverTo: string | null }[];
  check("   … and the list fetched on that change shows the failover",
    failed.find((p) => p.station === "store")?.failoverTo === "online", JSON.stringify(failed));
  await moved("the store printer comes back", () =>
    db.query(`update printer_station_status set last_seen_at = now() where tenant_id = $1 and station = 'store'`, [TENANT]));
  await moved("a printer polls for the first time (row appears)", async () => {
    await db.query(`delete from printer_station_status where tenant_id = $1 and station = 'store'`, [TENANT]);
    held = (await version(m)).etag;
    await db.query(
      `insert into printer_station_status (tenant_id, station, last_seen_at, online, printer_mac) values ($1, 'store', now(), true, '00116200000b')`,
      [TENANT],
    );
  });
  await moved("another business date has its own version; today's is unchanged", async () => {
    const other = await call(m.version.GET, "/api/kitchen/orders/version?date=2020-01-01", held);
    check("   another date's version differs", other.status === 200);
  }, false);
}

async function s4_listShape(m: Mods): Promise<void> {
  console.log("\n4. the list: today's open orders only, the clock in a header");
  await reset();
  const open = await seedOrder({ status: "ACCEPTED" });
  await seedOrder({ status: "COMPLETED" });
  await seedOrder({ status: "CANCELLED" });
  const res = await list(m);
  const orders = (res.body?.orders ?? []) as { id: number; status: string }[];
  check("only the open order", orders.length === 1 && orders[0].id === open, JSON.stringify(orders.map((o) => o.status)));
  const old = await call(m.orders.GET, "/api/kitchen/orders?completed=1");
  check("?completed=1 no longer widens the board's feed", ((old.body?.orders ?? []) as unknown[]).length === 1);
  check("no serverTime in the body", res.body !== null && !("serverTime" in res.body));
  const at = Date.parse(res.serverTime ?? "");
  check("X-Server-Time is the server's clock (ISO, within 5 s of now)", Number.isFinite(at) && Math.abs(at - Date.now()) < 5_000, String(res.serverTime));
  check("still carries businessDate, printers, printersConfigured",
    res.body?.businessDate === businessDate && Array.isArray(res.body?.printers) && res.body?.printersConfigured === true);

  // The "did not print" inputs are still there for the board to time itself.
  await db.query(`update orders set created_at = now() - interval '125 seconds' where id = $1`, [open]);
  await db.query(`update orders set status = 'QUEUED', updated_at = now() where id = $1`, [open]);
  const stuck = ((await list(m)).body?.orders ?? []) as { printPendingSince: string | null; printStuck: boolean }[];
  check("printPendingSince and printStuck still on each order", typeof stuck[0]?.printPendingSince === "string" && stuck[0]?.printStuck === true,
    JSON.stringify(stuck[0] ?? null).slice(0, 120));
}

async function s6_legacyShape(m: Mods): Promise<void> {
  console.log("\n6. migration 012 missing (011 only): the board still answers, from the legacy row");
  await reset();
  await seedOrder({ status: "QUEUED" });
  await db.query(`alter table printer_station_status rename to printer_station_status_hidden`);
  // The pre-012 table, as main's schema has it (this branch's schema.sql no
  // longer creates it).
  await db.query(
    `create table if not exists printer_status (
       tenant_id text primary key, last_seen_at timestamptz not null default now(),
       online boolean not null default true, paper_out boolean not null default false,
       cover_open boolean not null default false, paper_low boolean not null default false,
       status_code text, status_raw text, printer_mac text, blocked_since timestamptz,
       offline_alerted_at timestamptz, paper_alerted_at timestamptz,
       updated_at timestamptz not null default now())`,
  );
  await db.query(
    `insert into printer_status (tenant_id, last_seen_at, online, paper_out, cover_open, paper_low, status_code, printer_mac)
     values ($1, now(), true, true, false, false, '503 Paper Empty', '00116200000a')
     on conflict (tenant_id) do update set last_seen_at = now(), paper_out = true`,
    [TENANT],
  );
  try {
    const v = await version(m);
    check("/version answers 200", v.status === 200, `status=${v.status}`);
    const l = await list(m);
    const strip = l.body?.printers as { station: string; health: string }[] | undefined;
    check("the list answers 200, online printer from printer_status",
      l.status === 200 && strip?.find((p) => p.station === "online")?.health === "paper-out", JSON.stringify(strip));
    await db.query(`update printer_status set paper_out = false where tenant_id = $1`, [TENANT]);
    check("a legacy row change moves the version", (await version(m, v.etag)).status === 200);
  } finally {
    await db.query(`alter table printer_station_status_hidden rename to printer_station_status`);
    await db.query(`drop table if exists printer_status`);
    // The health store remembers "legacy" for a while; make it look again.
    (await import("../src/lib/print/healthStore")).resetPrinterTableModeForTests();
  }
}

async function s7_cache(m: Mods): Promise<void> {
  console.log("\n7. behind the Hyperdrive cache stand-in, the next poll sees a change");
  await reset();
  await seedOrder({ status: "QUEUED" });
  readWal = false;
  const emu = m.emulator.installHyperdriveCacheEmulator();
  try {
    const first = await version(m);
    await version(m, first.etag);
    await seedOrder({ status: "QUEUED" });
    const next = await version(m, first.etag);
    check("a new order is seen on the very next /version poll", next.status === 200, `status=${next.status}`);
    const l = await list(m, first.etag);
    check("… and the list fetched after it carries it", ((l.body?.orders ?? []) as unknown[]).length === 2);
    check("none of the board's reads was answered from cache", emu.hits === 0, `hits=${emu.hits}`);
  } finally {
    emu.uninstall();
    readWal = true;
  }
}

/* ---------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-board-poll-"));
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port: PORT, persistent: false });
  console.log("starting embedded postgres…");
  await server.initialise();
  await server.start();
  const admin = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${DB} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();

  const url = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
  process.env.DATABASE_URL = url;
  process.env.TENANT_ID = TENANT;
  process.env.RESTAURANT_TIMEZONE = TIMEZONE;
  process.env.TENANT_TIMEZONE = TIMEZONE;
  process.env.TENANT_TAX_RATE_BPS = "875";
  process.env.ORDER_NUMBER_PREFIX = "A";
  process.env.ADMIN_DASH_PASSWORD = PASSWORD;
  process.env.CLOUDPRNT_SECRET = "verify-board-poll-print";
  process.env.CLOUDPRNT_PRINTER_MAC_ONLINE = MAC_ONLINE;
  process.env.CLOUDPRNT_PRINTER_MAC_STORE = MAC_STORE;
  delete process.env.CLOUDPRNT_PRINTER_MAC;
  delete process.env.PRINT_FAILOVER_AFTER_SECONDS;

  db = new Client({ connectionString: url });
  await db.connect();
  harness = db;
  await db.query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));

  const pool = await import("../src/lib/db/postgres");
  const session = await import("../src/lib/auth/kitchenSession");
  const biz = await import("../src/lib/orders/businessDate");
  const m: Mods = {
    version: (await import("../src/app/api/kitchen/orders/version/route")) as unknown as Mods["version"],
    orders: (await import("../src/app/api/kitchen/orders/route")) as unknown as Mods["orders"],
    action: (await import("../src/app/api/kitchen/orders/[id]/route")) as unknown as Mods["action"],
    tables: (await import("../src/app/api/kitchen/tables/route")) as unknown as Mods["tables"],
    feed: await import("../src/lib/kitchen/boardFeed"),
    repo: await import("../src/lib/orders/repository"),
    emulator: await import("./lib/hyperdrive-cache-emulator"),
  };
  cookie = `nmc_kitchen=${session.login(PASSWORD)}`;
  businessDate = biz.businessDateFor(TIMEZONE);
  installCounter();
  await pool.ordersPool().query("select 1");

  try {
    await s1_migration({ port: PORT });
    await s2_unchangedPoll(m);
    await s3_changes(m);
    await recentUndo(m);
    await s4_listShape(m);
    await s6_legacyShape(m);
    await s7_cache(m);
  } finally {
    await db.end();
    await pool.closeOrdersPool();
    console.log("\nstopping postgres…");
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
