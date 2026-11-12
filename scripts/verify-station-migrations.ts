/**
 * Migrations 011 and 012 against a database in the shape production has today.
 *
 *   npm run verify:station-migrations
 *
 * Builds the 010-era schema (main's schema.sql before 011, kept verbatim in
 * git history, so this reads it from `git show`), puts a live printer row and
 * orders of every channel in it, then walks the deploy order:
 *
 *   apply 011  -> the OLD code's poll upsert still works; orders backfilled
 *   (deploy)   -> the NEW code's online upsert works, store is refused
 *   apply 012  -> both printers can have a row
 *   re-run both -> nothing changes (a reprint's station survives)
 */

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const PORT = 55443;
const DB = "nmc_station_migrations";
const BASELINE_REF = process.env.BASELINE_REF ?? "551d748";

const results: { name: string; passed: boolean; detail?: string }[] = [];
function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "✓" : "✗"} ${name}${!passed && detail ? ` — ${detail}` : ""}`);
}

async function fails(db: Client, sql: string, args: unknown[] = []): Promise<boolean> {
  try {
    await db.query("savepoint s");
    await db.query(sql, args);
    await db.query("release savepoint s");
    return false;
  } catch {
    await db.query("rollback to savepoint s");
    return true;
  }
}

const OLD_UPSERT = `insert into printer_status (tenant_id, last_seen_at, online, paper_out, cover_open, paper_low, printer_mac, updated_at)
  values ('nmc', now(), true, false, false, false, '00:11:62:55:24:d4', now())
  on conflict (tenant_id) do update set last_seen_at = now()`;
const NEW_UPSERT = `insert into printer_status (tenant_id, station, last_seen_at, online, paper_out, cover_open, paper_low, printer_mac, updated_at)
  values ('nmc', $1, now(), true, false, false, false, $2, now())
  on conflict (tenant_id, station) do update set last_seen_at = now(), printer_mac = excluded.printer_mac`;

async function main(): Promise<void> {
  const baseline = execFileSync("git", ["show", `${BASELINE_REF}:src/lib/db/schema.sql`], {
    encoding: "utf8",
  });
  const m011 = await readFile(join(process.cwd(), "src/lib/db/migrations/011_print_stations.sql"), "utf8");
  const m012 = await readFile(
    join(process.cwd(), "src/lib/db/migrations/012_printer_status_per_station.sql"),
    "utf8",
  );

  const dataDir = await mkdtemp(join(tmpdir(), "nmc-station-migrations-"));
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port: PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  const admin = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${DB} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();

  const db = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: DB });
  await db.connect();

  try {
    console.log(`\nbaseline: schema.sql at ${BASELINE_REF} (production's shape)`);
    await db.query(baseline);
    await db.query(OLD_UPSERT);
    for (const [i, channel] of ["web", "phone", "walk_in", "dine_in"].entries()) {
      await db.query(
        `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
                             customer, phone_verified_at, pickup_at, channel)
         values ('nmc', $1, current_date, 'PRINTED', $2, '[]', '{}', '{}', now(), now(), $3)`,
        [`A-00${i + 1}`, `k${i}`, channel],
      );
    }

    console.log("\napply 011");
    await db.query(m011);
    const { rows: st } = await db.query(`select channel, print_station from orders order by id`);
    check("orders backfilled: web online, phone/walk_in/dine_in store",
      st.map((r) => `${r.channel}:${r.print_station}`).join() ===
        "web:online,phone:store,walk_in:store,dine_in:store",
      JSON.stringify(st));
    const { rows: ps } = await db.query(`select station from printer_status`);
    check("the live printer's row became the online printer", ps.length === 1 && ps[0].station === "online");

    await db.query("begin");
    check("the OLD code's poll upsert still works after 011", !(await fails(db, OLD_UPSERT)));
    check("an order the OLD code inserts defaults to the online printer",
      !(await fails(db,
        `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
                             customer, phone_verified_at, pickup_at, channel)
         values ('nmc', 'A-010', current_date, 'QUEUED', 'gap', '[]', '{}', '{}', now(), now(), 'phone')`)));
    check("the NEW code's online upsert works before 012", !(await fails(db, NEW_UPSERT, ["online", "0011625524d4"])));
    check("the store printer is refused until 012 (old key still one row per tenant)",
      await fails(db, NEW_UPSERT, ["store", "001162aabbcc"]));
    await db.query("commit");

    console.log("\napply 012");
    await db.query(m012);
    await db.query("begin");
    check("after 012, the store printer gets its own row", !(await fails(db, NEW_UPSERT, ["store", "001162aabbcc"])));
    check("and the online printer still upserts", !(await fails(db, NEW_UPSERT, ["online", "0011625524d4"])));
    await db.query("commit");
    const { rows: two } = await db.query(`select station from printer_status order by station`);
    check("two printer rows", two.map((r) => r.station).join() === "online,store");
    await db.query("begin");
    check("an unknown station is refused by the check constraint",
      await fails(db, NEW_UPSERT, ["kitchen", "x"]));
    await db.query("commit");

    console.log("\nre-run both");
    await db.query(`update orders set print_station = 'online' where order_number = 'A-002'`); // a 重印 moved it
    await db.query(m011);
    await db.query(m012);
    const { rows: kept } = await db.query(`select print_station from orders where order_number = 'A-002'`);
    check("re-running 011 does not undo a reprint's station", kept[0].print_station === "online");
    const { rows: pk } = await db.query(
      `select array_length(conkey, 1) as n from pg_constraint where conname = 'printer_status_pkey'`,
    );
    check("primary key is (tenant_id, station)", Number(pk[0].n) === 2);
    await db.query("begin");
    check("the delivery station column exists",
      !(await fails(db, `select station from print_deliveries where station is null`)));
    await db.query("commit");
  } finally {
    await db.end();
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\nstation migrations: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
