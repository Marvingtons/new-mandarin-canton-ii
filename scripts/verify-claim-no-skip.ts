/**
 * The printer's claim never skips a QUEUED ticket because of a read.
 *
 *   npm run verify:claim-no-skip
 *
 * claimNextPrintJob takes the oldest unclaimed ticket with FOR UPDATE SKIP
 * LOCKED. A row another session holds ANY lock on (FOR SHARE included) is
 * skipped as if it were not there: the printer is told "nothing to print"
 * with tickets waiting, or prints the second ticket before the first. So a
 * read that locks QUEUED rows, run often enough by enough tablets and the
 * cron, starves the printer.
 *
 * HOW. Embedded Postgres, the real schema, the real route handlers. Twenty
 * readers loop without pause for the whole run, through the board's and the
 * cron's real handlers:
 *
 *   5 x GET /api/kitchen/orders/version   (the board's 4-second poll)
 *   5 x GET /api/kitchen/orders           (the board's full list)
 *   5 x GET /api/kitchen/tables           (the floor plan)
 *   5 x GET /api/cron/unprinted-alert     (the minute sweep)
 *
 * The data makes every one of those reach its QUEUED rows: the tickets are
 * three minutes old (past the sweep's 120 s alert threshold), a third are
 * dine-in at open tables, and both printers' rows are ten minutes stale, so
 * the sweep counts the queue behind each. OWNER_ALERT_PHONE is unset, so the
 * sweep writes nothing: everything here is a read.
 *
 * Meanwhile the printer claims one ticket after another. Every claim must
 * return the oldest unclaimed QUEUED ticket. A null while tickets wait, or
 * any other ticket, is a skip.
 *
 * Self-checking: the same harness with a reader that holds FOR SHARE on the
 * queue must produce skips, or this check could not see one.
 *
 * ⚠️ WINDOWS: run from a NON-ELEVATED shell (see verify:print-recurrence).
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const PORT = 55451;
const DB = "nmc_claim_no_skip";
const TENANT = "claim-no-skip";
const PASSWORD = "verify-claim-no-skip-password";
const CRON = "verify-claim-no-skip-cron";
const TIMEZONE = "America/Los_Angeles";
const TICKETS_PER_ROUND = 40;
const ROUNDS = 5;
const READERS_PER_KIND = 5;

let failures = 0;
let passes = 0;
function check(name: string, passed: boolean, detail = ""): void {
  if (passed) passes++;
  else failures++;
  console.log(`   ${passed ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
}

type Handler = (r: Request) => Promise<Response>;
interface Mods {
  version: { GET: Handler };
  orders: { GET: Handler };
  tables: { GET: Handler };
  cron: { GET: Handler };
  repo: typeof import("../src/lib/orders/repository");
}

let db: Client;
let cookie = "";
let businessDate = "";
let seq = 0;

const LINE = { itemId: "kung-pao-chicken", nameEn: "Kung Pao Chicken", nameZh: "宮保雞丁", sizeId: "individual", sizeLabel: "Individual", sizeLabelZh: "單點", modifiers: [], quantity: 1, unitCents: 1650, lineCents: 1650 };

/** TICKETS_PER_ROUND QUEUED tickets, oldest first, three minutes old. */
async function seedQueue(): Promise<number[]> {
  await db.query(`delete from print_deliveries where tenant_id = $1`, [TENANT]);
  await db.query(`delete from orders where tenant_id = $1`, [TENANT]);
  const ids: number[] = [];
  for (let i = 0; i < TICKETS_PER_ROUND; i++) {
    seq++;
    const dineIn = i % 3 === 0;
    const channel = dineIn ? "dine_in" : i % 3 === 1 ? "web" : "phone";
    const { rows } = await db.query(
      `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
                           customer, phone_verified_at, pickup_at, channel, print_station, table_label, guest_count,
                           created_at, updated_at)
       values ($1, $2, $3::date, 'QUEUED', $4, $5, $6, $7, now(), now() + interval '20 minutes', $8, $9, $10, $11,
               now() - interval '180 seconds' + make_interval(secs => $12 * 0.01),
               now() - interval '180 seconds')
       returning id`,
      [
        TENANT,
        `A-${String(seq).padStart(4, "0")}`,
        businessDate,
        `no-skip-${seq}`,
        JSON.stringify([LINE]),
        JSON.stringify({ subtotalCents: 1650, taxCents: 144, tipCents: 0, totalCents: 1794 }),
        JSON.stringify({ name: `Guest ${seq}`, phone: dineIn ? "" : "+16195550142" }),
        channel,
        channel === "web" ? "online" : "store",
        dineIn ? String(i + 1) : null,
        dineIn ? 2 : null,
        i,
      ],
    );
    ids.push(Number(rows[0].id));
  }
  return ids;
}

/** The oldest QUEUED ticket nobody has claimed yet: what the claim must return. */
async function headOfLine(): Promise<number | null> {
  const { rows } = await db.query(
    `select id from orders where tenant_id = $1 and status = 'QUEUED' and print_attempts = 0
      order by created_at asc limit 1`,
    [TENANT],
  );
  return rows.length > 0 ? Number(rows[0].id) : null;
}

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { headers: { cookie, ...headers } });
}

/** Twenty readers, each looping its handler until stopped. */
function startReaders(m: Mods, extra?: () => Promise<unknown>): { stop: () => Promise<number> } {
  let running = true;
  let reads = 0;
  const kinds: (() => Promise<unknown>)[] = [
    async () => (await m.version.GET(req("/api/kitchen/orders/version"))).arrayBuffer(),
    async () => (await m.orders.GET(req("/api/kitchen/orders"))).arrayBuffer(),
    async () => (await m.tables.GET(req("/api/kitchen/tables"))).arrayBuffer(),
    async () =>
      (await m.cron.GET(req("/api/cron/unprinted-alert", { authorization: `Bearer ${CRON}` }))).arrayBuffer(),
  ];
  const loops: Promise<void>[] = [];
  for (const kind of extra ? [...kinds, extra] : kinds) {
    for (let i = 0; i < READERS_PER_KIND; i++) {
      loops.push(
        (async () => {
          while (running) {
            await kind();
            reads++;
          }
        })(),
      );
    }
  }
  return {
    stop: async () => {
      running = false;
      await Promise.all(loops);
      return reads;
    },
  };
}

interface RunResult {
  claims: number;
  skips: number;
  reads: number;
  firstSkip: string;
}

async function run(m: Mods, extra?: () => Promise<unknown>): Promise<RunResult> {
  const result: RunResult = { claims: 0, skips: 0, reads: 0, firstSkip: "" };
  for (let round = 0; round < ROUNDS; round++) {
    await seedQueue();
    const readers = startReaders(m, extra);
    // Let every reader get going before the first claim.
    await new Promise((r) => setTimeout(r, 50));
    try {
      for (let attempt = 0; attempt < TICKETS_PER_ROUND * 50; attempt++) {
        const want = await headOfLine();
        if (want === null) break;
        const got = await m.repo.claimNextPrintJob(TENANT, 90);
        result.claims++;
        if (got?.id !== want) {
          result.skips++;
          if (!result.firstSkip) {
            result.firstSkip = got ? `claimed ${got.id} while ${want} was first in line` : `claimed nothing while ${want} was waiting`;
          }
          if (extra) break; // The control only needs one observed skip per round.
          // A skipped head is still unclaimed; keep claiming and the next
          // pass expects it again.
          if (!got) await new Promise((r) => setTimeout(r, 1));
        }
      }
    } finally {
      result.reads += await readers.stop();
    }
  }
  return result;
}

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-claim-no-skip-"));
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
  Object.assign(process.env, {
    DATABASE_URL: url,
    // Twenty readers and the printer each get a connection of their own, as
    // twenty tablets and a cron do in production.
    DATABASE_POOL_MAX: "32",
    TENANT_ID: TENANT,
    RESTAURANT_TIMEZONE: TIMEZONE,
    TENANT_TIMEZONE: TIMEZONE,
    TENANT_TAX_RATE_BPS: "875",
    ORDER_NUMBER_PREFIX: "A",
    ADMIN_DASH_PASSWORD: PASSWORD,
    CRON_SECRET: CRON,
    CLOUDPRNT_SECRET: "verify-claim-no-skip-print",
    CLOUDPRNT_PRINTER_MAC_ONLINE: "00:11:62:00:00:1A",
    CLOUDPRNT_PRINTER_MAC_STORE: "00:11:62:00:00:1B",
  });
  delete process.env.CLOUDPRNT_PRINTER_MAC;
  delete process.env.OWNER_ALERT_PHONE;
  delete process.env.PRINT_FAILOVER_AFTER_SECONDS;

  db = new Client({ connectionString: url });
  await db.connect();
  await db.query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));
  // Both printers silent for ten minutes: the sweep counts each one's queue.
  for (const [station, mac] of [["online", "00116200001a"], ["store", "00116200001b"]]) {
    await db.query(
      `insert into printer_station_status (tenant_id, station, last_seen_at, online, printer_mac)
       values ($1, $2, now() - interval '10 minutes', true, $3)`,
      [TENANT, station, mac],
    );
  }

  const pool = await import("../src/lib/db/postgres");
  const session = await import("../src/lib/auth/kitchenSession");
  const biz = await import("../src/lib/orders/businessDate");
  const m: Mods = {
    version: (await import("../src/app/api/kitchen/orders/version/route")) as unknown as Mods["version"],
    orders: (await import("../src/app/api/kitchen/orders/route")) as unknown as Mods["orders"],
    tables: (await import("../src/app/api/kitchen/tables/route")) as unknown as Mods["tables"],
    cron: (await import("../src/app/api/cron/unprinted-alert/route")) as unknown as Mods["cron"],
    repo: await import("../src/lib/orders/repository"),
  };
  cookie = `nmc_kitchen=${session.login(PASSWORD)}`;
  businessDate = biz.businessDateFor(TIMEZONE);

  try {
    console.log(`\n1. the printer claims ${ROUNDS} x ${TICKETS_PER_ROUND} tickets against ${4 * READERS_PER_KIND} looping board and cron reads`);
    const real = await run(m);
    check(
      "every claim took the oldest unclaimed QUEUED ticket: none skipped",
      real.skips === 0,
      `${real.claims} claims, ${real.skips} skipped, ${real.reads} reads${real.firstSkip ? `; first: ${real.firstSkip}` : ""}`,
    );
    check("the readers really ran alongside (at least one read per claim)", real.reads >= real.claims, `${real.reads} reads, ${real.claims} claims`);

    console.log("\n2. control: one more reader that holds FOR SHARE on the queue must cause skips");
    const lockingRead = async () => {
      const c = await pool.ordersPool().connect();
      try {
        await c.query("begin");
        await c.query(`select 1 from orders where tenant_id = $1 and status = 'QUEUED' for share`, [TENANT]);
        await c.query("commit");
      } finally {
        c.release();
      }
    };
    const control = await run(m, lockingRead);
    check("with a locking reader in the mix, the claim skips", control.skips > 0, `${control.claims} claims, ${control.skips} skipped`);
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
