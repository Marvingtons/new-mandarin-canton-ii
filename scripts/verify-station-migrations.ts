/**
 * Migrations 011-014 (and their rollback) against a copy of production, with BOTH codebases
 * running against every shape the database passes through.
 *
 *   npm run verify:station-migrations
 *
 * The plan this proves: apply 011, apply 012, deploy once. So there are three
 * states the live system can be in, and each must print on every printer:
 *
 *   production   + old code   (today)
 *   011          + old code   (between the two migrations)
 *   011 + 012    + old code   (between the migrations and the deploy)  <- the risky one
 *   011 + 012    + new code   (after the deploy)
 *
 * plus the case the plan should never produce but the new code must survive:
 *
 *   011 only     + new code   (deployed before 012, or 012 failed)
 *
 * "Old code" is not a re-typed copy of its SQL: it is main's actual source,
 * exported from git into a temp directory and run in its own process (so its
 * "@/..." imports resolve to main, not to this branch), driving main's own
 * CloudPRNT route, repository, health store and alert cron against the same
 * database. "New code" is this branch's route, run in this process.
 *
 * THE WAY BACK. On a separate database: main's schema.sql and the seeded day,
 * 011-014 applied, then migrations/down_014_to_010.sql. The result must match a
 * fresh main schema.sql exactly (tables, columns, defaults, constraints,
 * indexes, triggers, functions, RLS, comments) and main's code must print on it.
 *
 * THE COPY OF PRODUCTION. By default: main's schema.sql (production's shape;
 * every migration through 010 is in it) with a realistic day of data: orders
 * of every channel and status, deliveries, a manual reprint marker, the live
 * printer's health row. To run it against a real copy instead, point
 * PROD_DUMP_FILE at a plain-SQL `pg_dump` of production (schema and data, or
 * schema only); it is restored in place of the baseline and the seed, and
 * PROD_TENANT names its tenant (default "nmc"). Nothing here ever connects to
 * production itself.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import type { OrderChannel } from "../src/lib/orders/types";

const PORT = 55443;
const DB = "nmc_station_migrations";
const BASELINE_REF = process.env.BASELINE_REF ?? "main";
const TENANT = process.env.PROD_TENANT ?? "nmc";
const SECRET = "verify-station-migrations-secret";
const CRON = "verify-station-migrations-cron";
const MAC_ONLINE = "00:11:62:55:24:D4";
const MAC_STORE = "00:11:62:55:24:E5";
const DATABASE_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;

const results: { name: string; passed: boolean; detail?: string }[] = [];
function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "✓" : "✗"} ${name}${!passed && detail ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------------ old code -- */

/**
 * Runs inside the exported copy of main. One printer (main has no stations),
 * pinned to the online MAC exactly as production is. Prints JSON on its last
 * line: what main's own code saw.
 */
const OLD_DRIVER = `
import { createOrder, requeueForPrint, getOrderById } from "@/lib/orders/repository";
import { readPrinterStatus } from "@/lib/print/healthStore";
import { closeOrdersPool } from "@/lib/db/postgres";

async function run(): Promise<void> {
const route = await import("@/app/api/print/[secret]/route");
const cron = await import("@/app/api/cron/unprinted-alert/route");
const BASE = "https://example.test/api/print/" + process.env.CLOUDPRNT_SECRET;
const MAC = process.env.CLOUDPRNT_PRINTER_MAC!;
const params = Promise.resolve({ secret: process.env.CLOUDPRNT_SECRET! });
const out: Record<string, unknown> = {};

async function poll(): Promise<string | null> {
  const res = await route.POST(new Request(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ statusCode: "200 OK", printerMAC: MAC }),
  }), { params });
  const body = await res.json() as { jobReady?: boolean; jobToken?: string };
  return body.jobReady ? (body.jobToken ?? null) : null;
}
async function confirm(token: string): Promise<void> {
  await route.DELETE(new Request(BASE + "?mac=" + encodeURIComponent(MAC) + "&code=OK&token=" + token,
    { method: "DELETE" }), { params });
}

try {
  const placed = await createOrder({
    tenantId: process.env.TENANT_ID!,
    businessDate: new Date().toISOString().slice(0, 10),
    orderNumberPrefix: "A",
    idempotencyKey: "old-code-" + process.argv[2] + "-" + Date.now(),
    items: [{ itemId: "kung-pao-chicken", nameEn: "Kung Pao Chicken", nameZh: "宮保雞丁",
      sizeId: "individual", sizeLabel: "Individual", sizeLabelZh: "單點", modifiers: [],
      quantity: 1, unitCents: 2250, lineCents: 2250 }],
    totals: { subtotalCents: 2250, taxCents: 197, tipCents: 0, totalCents: 2447 },
    customer: { name: "Old Code", phone: "" },
    phoneVerifiedAt: new Date(),
    pickupAt: new Date(Date.now() + 20 * 60_000),
    channel: "phone",
  });
  out.created = placed.created;
  const t1 = await poll();
  out.offered = t1 !== null;
  if (t1) await confirm(t1);
  out.statusAfterPrint = (await getOrderById(process.env.TENANT_ID!, placed.order.id))?.status;
  const again = await requeueForPrint(process.env.TENANT_ID!, placed.order.id, "kitchen");
  out.reprintStatus = again?.status ?? null;
  const t2 = await poll();
  out.reprintOffered = t2 !== null;
  if (t2) await confirm(t2);
  out.statusAfterReprint = (await getOrderById(process.env.TENANT_ID!, placed.order.id))?.status;
  const health = await readPrinterStatus(process.env.TENANT_ID!);
  out.healthSeenSecondsAgo = health ? (Date.now() - Date.parse(health.lastSeenAt)) / 1000 : null;
  const sweep = await cron.GET(new Request("https://example.test/api/cron/unprinted-alert",
    { headers: { authorization: "Bearer " + process.env.CRON_SECRET } }));
  out.cronStatus = sweep.status;
  out.ok = true;
} catch (err) {
  out.ok = false;
  out.error = err instanceof Error ? err.message : String(err);
} finally {
  await closeOrdersPool();
}
console.log(JSON.stringify(out));
process.exit(0);
}
void run();
`;

interface OldRun {
  ok: boolean;
  error?: string;
  created?: boolean;
  offered?: boolean;
  statusAfterPrint?: string;
  reprintStatus?: string | null;
  reprintOffered?: boolean;
  statusAfterReprint?: string;
  healthSeenSecondsAgo?: number | null;
  cronStatus?: number;
}

async function exportMain(into: string): Promise<void> {
  await mkdir(into, { recursive: true });
  const archive = join(into, "..", "main.tar");
  execFileSync("git", ["archive", "--format=tar", "-o", archive, BASELINE_REF, "src", "scripts", "tsconfig.json", "package.json"]);
  execFileSync("tar", ["-x", "-f", archive, "-C", into]);
  await symlink(join(process.cwd(), "node_modules"), join(into, "node_modules"), "dir");
  await writeFile(join(into, "scripts", "old-code-driver.ts"), OLD_DRIVER);
}

function runOldCode(mainDir: string, label: string, databaseUrl = DATABASE_URL): OldRun {
  const res = spawnSync(
    "npx",
    ["tsx", "--conditions=react-server", "scripts/old-code-driver.ts", label],
    {
      cwd: mainDir,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        TENANT_ID: TENANT,
        CLOUDPRNT_SECRET: SECRET,
        CLOUDPRNT_PRINTER_MAC: MAC_ONLINE,
        CRON_SECRET: CRON,
        OWNER_ALERT_PHONE: "",
        RESTAURANT_TIMEZONE: "America/Los_Angeles",
        TENANT_TAX_RATE_BPS: "875",
        ORDER_NUMBER_PREFIX: "A",
        TICKET_COPIES: "3",
      },
    },
  );
  const last = (res.stdout ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
  if (!last) return { ok: false, error: `no output (exit ${res.status}): ${(res.stderr ?? "").slice(-800)}` };
  return JSON.parse(last) as OldRun;
}

function oldCodeWorks(state: string, run: OldRun): void {
  check(
    `[old code, ${state}] a POS order prints, 重印 requeues and prints again, health and the alert sweep work`,
    run.ok &&
      run.offered === true &&
      run.statusAfterPrint === "PRINTED" &&
      run.reprintStatus === "QUEUED" &&
      run.reprintOffered === true &&
      run.statusAfterReprint === "PRINTED" &&
      typeof run.healthSeenSecondsAgo === "number" &&
      run.healthSeenSecondsAgo < 30 &&
      run.cronStatus === 200,
    JSON.stringify(run),
  );
}

/* ------------------------------------------------------------ new code -- */

type Handler = (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
interface NewCode {
  route: { POST: Handler; DELETE: Handler };
  repo: typeof import("../src/lib/orders/repository");
  health: typeof import("../src/lib/print/healthStore");
  strip: typeof import("../src/lib/kitchen/boardFeed");
  cron: { GET: (r: Request) => Promise<Response> };
}
const params = Promise.resolve({ secret: SECRET });
const BASE = `https://example.test/api/print/${SECRET}`;

async function newPoll(code: NewCode, mac: string): Promise<string | null> {
  const res = await code.route.POST(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusCode: "200 OK", printerMAC: mac }),
    }),
    { params },
  );
  const body = (await res.json()) as { jobReady?: boolean; jobToken?: string };
  return body.jobReady ? (body.jobToken ?? null) : null;
}

async function newConfirm(code: NewCode, mac: string, token: string): Promise<void> {
  await code.route.DELETE(
    new Request(`${BASE}?mac=${encodeURIComponent(mac)}&code=OK&token=${token}`, { method: "DELETE" }),
    { params },
  );
}

let newSeq = 0;
async function newOrder(code: NewCode, channel: OrderChannel): Promise<number> {
  newSeq++;
  const { order } = await code.repo.createOrder({
    tenantId: TENANT,
    businessDate: new Date().toISOString().slice(0, 10),
    orderNumberPrefix: "A",
    idempotencyKey: `new-code-${newSeq}-${Date.now()}`,
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
    customer: { name: "New Code", phone: channel === "web" ? "+16195550100" : "" },
    phoneVerifiedAt: new Date(),
    pickupAt: new Date(Date.now() + 20 * 60_000),
    channel,
  });
  return order.id;
}

/** Both printers poll; each must be handed its own station's ticket, and print it. */
async function bothPrintersPrint(code: NewCode, db: Client, state: string): Promise<void> {
  const web = await newOrder(code, "web");
  const phone = await newOrder(code, "phone");
  const a = await newPoll(code, MAC_ONLINE);
  const b = await newPoll(code, MAC_STORE);
  const owner = async (t: string | null) =>
    t === null ? null : Number((await db.query(`select order_id from print_deliveries where id = $1`, [t])).rows[0]?.order_id);
  check(`[new code, ${state}] the online printer is handed the web ticket`, (await owner(a)) === web);
  check(`[new code, ${state}] the store printer is handed the phone ticket (printer B is never starved)`,
    (await owner(b)) === phone);
  if (a) await newConfirm(code, MAC_ONLINE, a);
  if (b) await newConfirm(code, MAC_STORE, b);
  const statuses = await db.query(`select status from orders where id = any($1::bigint[]) order by id`, [[web, phone]]);
  check(`[new code, ${state}] both PRINTED`, statuses.rows.every((r) => r.status === "PRINTED"),
    JSON.stringify(statuses.rows));

  const strip = await code.strip.stationPrinterHealth(TENANT);
  const sweep = await code.cron.GET(
    new Request("https://example.test/api/cron/unprinted-alert", { headers: { authorization: `Bearer ${CRON}` } }),
  );
  const swept = (await sweep.json()) as { printer?: unknown[] };
  check(`[new code, ${state}] board strip reads, alert sweep runs, no printer alert`,
    strip.length === 2 && sweep.status === 200 && (swept.printer ?? []).length === 0,
    JSON.stringify({ strip: strip.map((p) => `${p.station}:${p.health}`), printer: swept.printer }));
}

/* ------------------------------------------------------------- seeding -- */

/** A day of production-shaped data, written with main's columns only. */
async function seedProduction(db: Client): Promise<void> {
  const today = `(now() at time zone 'America/Los_Angeles')::date`;
  const rows: [string, string, OrderChannel][] = [
    ["A-001", "COMPLETED", "web"],
    ["A-002", "COMPLETED", "phone"],
    ["A-003", "ACCEPTED", "walk_in"],
    ["A-004", "PRINTED", "dine_in"],
    ["A-005", "CANCELLED", "web"],
    ["A-006", "PRINT_FAILED", "phone"],
    ["A-007", "PRINTED", "web"],
  ];
  for (const [n, status, channel] of rows) {
    await db.query(
      `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
                           customer, phone_verified_at, pickup_at, channel, print_attempts, printed_at,
                           table_label, guest_count)
       values ($1, $2, ${today} - 1, $3, $4, '[]', '{"totalCents": 2447}', '{"name":"Seed"}', now(), now(), $5,
               1, case when $3 in ('PRINTED','ACCEPTED','COMPLETED') then now() end,
               case when $5 = 'dine_in' then '7' end, case when $5 = 'dine_in' then 2 end)`,
      [TENANT, n, status, `seed-${n}`, channel],
    );
  }
  // Their hand-overs, and a reprint marker the OLD code wrote (never confirmed).
  await db.query(
    `insert into print_deliveries (id, order_id, tenant_id, offered_at, expires_at, confirmed_at, confirm_code, reason, actor)
     select gen_random_uuid(), id, tenant_id, now() - interval '1 day', now() - interval '1 day' + interval '90 seconds',
            case when status <> 'PRINT_FAILED' then now() - interval '1 day' end, 'OK', 'first-offer', 'printer'
       from orders where tenant_id = $1`,
    [TENANT],
  );
  await db.query(
    `insert into print_deliveries (id, order_id, tenant_id, offered_at, expires_at, reason, actor)
     select gen_random_uuid(), id, tenant_id, now() - interval '1 day', now() - interval '1 day', 'manual_reprint', 'kitchen'
       from orders where tenant_id = $1 and order_number = 'A-007'`,
    [TENANT],
  );
  await db.query(
    `insert into order_counters (tenant_id, business_date, seq) values ($1, ${today} - 1, 7)`,
    [TENANT],
  );
  await db.query(
    `insert into printer_status (tenant_id, last_seen_at, online, paper_out, cover_open, paper_low, printer_mac)
     values ($1, now(), true, false, false, false, $2)`,
    [TENANT, MAC_ONLINE],
  );
}

/* ------------------------------------------------------- schema shape -- */

/** Everything about public's shape that main's schema.sql decides, as sorted lines. */
async function schemaSnapshot(db: Client): Promise<string[]> {
  const q = async (sql: string) => (await db.query(sql)).rows.map((r) => Object.values(r).join(" | "));
  return [
    ...(await q(`select 'table', c.relname, c.relrowsecurity, coalesce(obj_description(c.oid, 'pg_class'), '')
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind in ('r', 'p')`)),
    ...(await q(`select 'column', table_name, column_name, data_type, is_nullable, coalesce(column_default, ''),
                        coalesce(col_description((quote_ident(table_name))::regclass, ordinal_position::int), '')
                   from information_schema.columns where table_schema = 'public'`)),
    ...(await q(`select 'constraint', conrelid::regclass::text, conname, pg_get_constraintdef(c.oid)
                   from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'`)),
    ...(await q(`select 'index', tablename, indexname, indexdef from pg_indexes where schemaname = 'public'`)),
    ...(await q(`select 'trigger', tgrelid::regclass::text, tgname, pg_get_triggerdef(t.oid)
                   from pg_trigger t where not tgisinternal`)),
    ...(await q(`select 'function', p.proname, pg_get_function_identity_arguments(p.oid), md5(pg_get_functiondef(p.oid))
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.prokind in ('f', 'p')`)),
    ...(await q(`select 'policy', tablename, policyname, cmd, coalesce(qual, '') from pg_policies where schemaname = 'public'`)),
  ].sort();
}

/**
 * main's schema + a seeded day, 011-014 up, down_014_to_010 down: the shape
 * must be main's schema.sql exactly, and main's code must print on it.
 */
async function downMigrationChecks(mainDir: string): Promise<void> {
  console.log("\nthe way back: 011-014 up, down_014_to_010 down, against main's schema.sql");
  const DOWN_DB = "nmc_down_014";
  const REF_DB = "nmc_ref_main";
  const url = (name: string) => `postgresql://postgres:postgres@localhost:${PORT}/${name}`;
  const admin = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  for (const name of [DOWN_DB, REF_DB]) {
    await admin.query(`create database ${name} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  }
  await admin.end();

  const mainSchema = execFileSync("git", ["show", `${BASELINE_REF}:src/lib/db/schema.sql`], { encoding: "utf8" });
  const migration = (f: string) => readFile(join(process.cwd(), "src/lib/db/migrations", f), "utf8");
  const ref = new Client({ connectionString: url(REF_DB) });
  const down = new Client({ connectionString: url(DOWN_DB) });
  await ref.connect();
  await down.connect();
  try {
    await ref.query(mainSchema);
    await down.query(mainSchema);
    await seedProduction(down);
    const seeded = (await down.query(`select count(*)::int as n from orders`)).rows[0].n as number;
    for (const f of ["011_print_stations.sql", "012_printer_status_per_station.sql", "013_board_version_index.sql", "014_recently_done.sql"]) {
      await down.query(await migration(f));
    }
    const want = await schemaSnapshot(ref);
    const up = await schemaSnapshot(down);
    check("control: with 011-014 applied the shape differs from main (the comparison can see them)",
      up.join("\n") !== want.join("\n"));

    await down.query(await migration("down_014_to_010.sql"));
    const got = await schemaSnapshot(down);
    const extra = got.filter((l) => !want.includes(l));
    const missing = want.filter((l) => !got.includes(l));
    check("after down_014_to_010 the schema matches main's schema.sql exactly",
      extra.length === 0 && missing.length === 0,
      `extra: ${JSON.stringify(extra)} missing: ${JSON.stringify(missing)}`);
    check("the down keeps every order",
      (await down.query(`select count(*)::int as n from orders`)).rows[0].n === seeded);
  } finally {
    await ref.end();
    await down.end();
  }
  oldCodeWorks("after down_014_to_010", runOldCode(mainDir, "down", url(DOWN_DB)));
}

/* ---------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const m011 = await readFile(join(process.cwd(), "src/lib/db/migrations/011_print_stations.sql"), "utf8");
  const m012 = await readFile(join(process.cwd(), "src/lib/db/migrations/012_printer_status_per_station.sql"), "utf8");
  const m015 = await readFile(join(process.cwd(), "src/lib/db/migrations/015_order_counters_per_station.sql"), "utf8");
  const d015 = await readFile(join(process.cwd(), "src/lib/db/migrations/down_015_to_014.sql"), "utf8");

  const work = await mkdtemp(join(tmpdir(), "nmc-station-migrations-"));
  const dataDir = join(work, "pg");
  const mainDir = join(work, "main");
  console.log(`exporting ${BASELINE_REF} (the code production runs) to a temp dir…`);
  await exportMain(mainDir);

  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port: PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  const admin = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${DB} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  // The new code's environment, set before its modules load.
  Object.assign(process.env, {
    DATABASE_URL,
    TENANT_ID: TENANT,
    CLOUDPRNT_SECRET: SECRET,
    CLOUDPRNT_PRINTER_MAC_ONLINE: MAC_ONLINE,
    CLOUDPRNT_PRINTER_MAC_STORE: MAC_STORE,
    CRON_SECRET: CRON,
    RESTAURANT_TIMEZONE: "America/Los_Angeles",
    TENANT_TAX_RATE_BPS: "875",
    ORDER_NUMBER_PREFIX: "A",
    TICKET_COPIES: "3",
    PRINT_CONFIRM_FLOOR_SECONDS: "60",
    PRINT_SECONDS_PER_COPY: "30",
    PRINT_OFFER_CAP: "4",
  });
  delete process.env.CLOUDPRNT_PRINTER_MAC;
  delete process.env.OWNER_ALERT_PHONE;

  let closeNew: (() => Promise<void>) | null = null;
  try {
    /* ---- production ---- */
    const dump = process.env.PROD_DUMP_FILE;
    if (dump) {
      console.log(`\nproduction: restoring ${dump}`);
      await db.query(await readFile(dump, "utf8"));
    } else {
      console.log(`\nproduction: schema.sql at ${BASELINE_REF}, plus a seeded day of orders`);
      await db.query(execFileSync("git", ["show", `${BASELINE_REF}:src/lib/db/schema.sql`], { encoding: "utf8" }));
      await seedProduction(db);
    }
    const before = (await db.query(`select count(*)::int as n from orders`)).rows[0].n as number;
    oldCodeWorks("production schema", runOldCode(mainDir, "prod"));

    /* ---- 011 ---- */
    console.log("\napply 011");
    await db.query(m011);
    const { rows: st } = await db.query(
      `select channel, print_station, count(*)::int as n from orders
        where idempotency_key like 'seed-%' group by 1, 2 order by 1, 2`,
    );
    check("existing orders backfilled: web online; phone, walk_in, dine_in store",
      st.every((r) => r.print_station === (r.channel === "web" ? "online" : "store")), JSON.stringify(st));
    check("no existing order looks like a pending 重印 (the old marker is history, not a request)",
      (await db.query(`select count(*)::int as n from orders where reprint_delivery_id is not null`)).rows[0].n === 0);
    check("printer_status untouched by 011 (still keyed by tenant_id alone)",
      (await db.query(`select array_length(conkey, 1) as n from pg_constraint where conname = 'printer_status_pkey'`)).rows[0]?.n === 1);
    oldCodeWorks("after 011", runOldCode(mainDir, "011"));

    // The board's additive Undo columns are independent of printer table shape.
    await db.query("alter table orders add column done_previous_status text, add column done_at timestamptz");

    /* ---- 015: the per-station order counter, needed by every new-code run ---- */
    // 015 is NOT old-code safe, unlike 011-014: the window between applying
    // it and deploying is an ordering outage. Proved here, then undone so the
    // old-code states below are the ones production passes through.
    console.log("\napply 015 (per-station order counters)");
    const counterBefore = (await db.query(`select tenant_id, business_date::text, seq from order_counters order by 1, 2`)).rows;
    await db.query(m015);
    await db.query(m015);
    const counterAfter = (await db.query(`select tenant_id, business_date::text, seq, station from order_counters order by 1, 2`)).rows;
    check("015 is repeatable and backfills every existing counter as online, seq unchanged",
      counterAfter.length === counterBefore.length &&
        counterAfter.every((r, i) => r.station === "online" && r.seq === counterBefore[i].seq && r.business_date === counterBefore[i].business_date),
      JSON.stringify(counterAfter));
    check("015 keys order_counters by (tenant_id, business_date, station)",
      (await db.query(`select array_length(conkey, 1) as n from pg_constraint where conname = 'order_counters_pkey'`)).rows[0]?.n === 3);
    let oldUpsert = "ran";
    try {
      await db.query(`insert into order_counters (tenant_id, business_date, seq) values ($1, current_date, 1)
                      on conflict (tenant_id, business_date) do update set seq = order_counters.seq + 1`, [TENANT]);
    } catch (error) { oldUpsert = (error as { code?: string }).code ?? "error"; }
    check("HAZARD, as documented in 015: the old code's counter UPSERT fails once 015 is applied (42P10)",
      oldUpsert === "42P10", oldUpsert);

    /* ---- new code on the OLD printer shape (011 only) ---- */
    console.log("\nnew code on 011 + 015 only (printer_station_status missing)");
    const code: NewCode = {
      route: (await import("../src/app/api/print/[secret]/route")) as unknown as NewCode["route"],
      repo: await import("../src/lib/orders/repository"),
      health: await import("../src/lib/print/healthStore"),
      strip: await import("../src/lib/kitchen/boardFeed"),
      cron: (await import("../src/app/api/cron/unprinted-alert/route")) as unknown as NewCode["cron"],
    };
    const { closeOrdersPool } = await import("../src/lib/db/postgres");
    closeNew = closeOrdersPool;
    await bothPrintersPrint(code, db, "011 only");
    check("[new code, 011 only] it noticed, and is using the legacy table",
      code.health.printerTableModeForTests() === "legacy");
    const legacy = await db.query(`select printer_mac, last_seen_at > now() - interval '30 seconds' as fresh from printer_status where tenant_id = $1`, [TENANT]);
    check("[new code, 011 only] the online printer's health lands in the legacy row, the same row the old code writes",
      legacy.rows.length === 1 && legacy.rows[0].fresh === true, JSON.stringify(legacy.rows));
    const strip011 = await code.strip.stationPrinterHealth(TENANT);
    check("[new code, 011 only] the store printer, with no health row, reads unknown: never offline",
      strip011.find((p) => p.station === "store")?.health === "unknown");

    // Back to production's counter shape for the old-code states below.
    await db.query(d015);

    /* ---- 012 ---- */
    console.log("\napply 012");
    await db.query(m012);
    check("printer_status still keyed by tenant_id alone after 012",
      (await db.query(`select array_length(conkey, 1) as n from pg_constraint where conname = 'printer_status_pkey'`)).rows[0]?.n === 1);
    check("printer_station_status exists, keyed (tenant_id, station), and starts empty",
      (await db.query(`select array_length(conkey, 1) as n from pg_constraint where conname = 'printer_station_status_pkey'`)).rows[0]?.n === 2 &&
        (await db.query(`select count(*)::int as n from printer_station_status`)).rows[0].n === 0);
    oldCodeWorks("after 011 + 012, before the deploy", runOldCode(mainDir, "012"));

    // Standalone query in autocommit: CONCURRENTLY must never share a transaction.
    const m013 = await readFile(join(process.cwd(), "src/lib/db/migrations/013_board_version_index.sql"), "utf8");
    await db.query(m013);
    await db.query(m013);
    const index = await db.query(`select indisvalid, indisready from pg_index where indexrelid = 'orders_board_version_idx'::regclass`);
    check("013 runs alone after 011/012, is repeatable and leaves a valid ready index",
      index.rows[0]?.indisvalid === true && index.rows[0]?.indisready === true);
    await db.query("begin");
    let rejected = false;
    try { await db.query(m013); } catch (error) { rejected = (error as { code?: string }).code === "25001"; }
    finally { await db.query("rollback"); }
    check("013 rejects a transaction wrapper", rejected);
    await db.query(await readFile(join(process.cwd(), "src/lib/db/migrations/014_recently_done.sql"), "utf8"));

    /* ---- new code on the NEW shape ---- */
    console.log("\napply 015, then new code on 011-015 (after the deploy)");
    await db.query(m015);
    code.health.resetPrinterTableModeForTests();
    await bothPrintersPrint(code, db, "011 + 012");
    check("[new code, 011 + 012] using the per-station table", code.health.printerTableModeForTests() === "current");
    const rowsNew = await db.query(`select station, printer_mac from printer_station_status where tenant_id = $1 order by station`, [TENANT]);
    check("[new code, 011 + 012] one health row per printer, each with its MAC",
      rowsNew.rows.map((r) => `${r.station}:${r.printer_mac}`).join() === "online:0011625524d4,store:0011625524e5",
      JSON.stringify(rowsNew.rows));
    const accepted = await newOrder(code, "walk_in");
    const t = await newPoll(code, MAC_STORE);
    if (t) await newConfirm(code, MAC_STORE, t);
    await code.repo.updateStatus(TENANT, accepted, "ACCEPTED");
    await code.repo.requestReprint(TENANT, accepted, "kitchen", "online");
    const copy = await newPoll(code, MAC_ONLINE);
    if (copy) await newConfirm(code, MAC_ONLINE, copy);
    check("[new code, 011 + 012] a 重印 of an ACCEPTED order prints and leaves it ACCEPTED",
      copy !== null && (await code.repo.getOrderById(TENANT, accepted))?.status === "ACCEPTED");

    /* ---- rollback, and re-runs ---- */
    console.log("\nrollback and re-runs");
    await db.query(d015);
    check("down_015_to_014 restores the (tenant_id, business_date) key and keeps the online count",
      (await db.query(`select array_length(conkey, 1) as n from pg_constraint where conname = 'order_counters_pkey'`)).rows[0]?.n === 2);
    oldCodeWorks("rolled back after the deploy (down_015_to_014, then the Worker)", runOldCode(mainDir, "rollback"));
    await db.query(`update orders set print_station = 'online' where idempotency_key = 'seed-A-002'`);
    await db.query(m011);
    await db.query(m012);
    check("re-running 011 does not re-backfill a row whose station changed",
      (await db.query(`select print_station from orders where idempotency_key = 'seed-A-002'`)).rows[0]?.print_station === "online");
    const after = (await db.query(`select count(*)::int as n from orders`)).rows[0].n as number;
    check("no order lost across the whole sequence", after >= before, `${before} -> ${after}`);
    check("re-running 012 keeps both health rows",
      (await db.query(`select count(*)::int as n from printer_station_status`)).rows[0].n === 2);

    // CONTROL: the previous 012 re-keyed printer_status itself. Do that here
    // and main's poll must stop printing, or the old-code checks above prove
    // nothing.
    console.log("\ncontrol: re-key printer_status the way the previous 012 did");
    await db.query(`alter table printer_status add column if not exists station text not null default 'online'`);
    await db.query(`alter table printer_status drop constraint printer_status_pkey`);
    await db.query(`alter table printer_status add constraint printer_status_pkey primary key (tenant_id, station)`);
    const broken = runOldCode(mainDir, "control");
    check("control: with printer_status re-keyed, main's printer is handed nothing (the bug this layout avoids)",
      broken.offered === false, JSON.stringify(broken));

    await downMigrationChecks(mainDir);
  } finally {
    if (closeNew) await closeNew();
    await db.end();
    await pg.stop();
    await rm(work, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\nstation migrations: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    for (const f of failed) console.error(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
