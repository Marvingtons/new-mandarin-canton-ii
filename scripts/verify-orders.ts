/**
 * Prove the durable order store actually holds under the conditions the old
 * JSON store failed at.
 *
 *   npm run verify:orders
 *
 * Spins up a real, throwaway Postgres (embedded-postgres downloads a genuine
 * server binary — not an emulator, not an in-process shim), applies
 * src/lib/db/schema.sql, and asserts:
 *
 *   1. IDEMPOTENCY  — the same key inserted twice yields ONE row and the SAME
 *                     order number.
 *   2. CONCURRENCY  — 50 simultaneous allocations produce 50 distinct,
 *                     sequential numbers: no gaps, no duplicates.
 *   3. TIMEZONE     — 23:30 restaurant-local belongs to TODAY's business date,
 *                     not tomorrow's, even though it is already tomorrow UTC.
 *   4. RACE HYGIENE — a checkout that loses the idempotency race does not burn
 *                     an order number.
 *
 * If an existing DATABASE_URL is set, that database is used instead and the
 * embedded server is skipped. Everything runs against a tenant id unique to
 * this run, so it is safe to point at a dev database.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const RUN_TENANT = `verify-${process.pid}`;

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Start a throwaway Postgres, or reuse DATABASE_URL when one is provided. */
async function startDatabase(): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  if (process.env.DATABASE_URL) {
    console.log("using existing DATABASE_URL\n");
    return { url: process.env.DATABASE_URL, stop: async () => {} };
  }

  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-verify-pg-"));
  // A high, fixed-ish port keeps this out of the way of a real local Postgres.
  const port = 55_000 + (process.pid % 5_000);

  console.log(`starting embedded postgres on port ${port} …`);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("orders_verify");
  console.log("postgres up\n");

  return {
    url: `postgresql://postgres:postgres@localhost:${port}/orders_verify`,
    stop: async () => {
      await pg.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function main(): Promise<void> {
  const db = await startDatabase();
  process.env.DATABASE_URL = db.url;

  // Imported AFTER DATABASE_URL is set — the pool reads it at construction.
  const { ordersPool, closeOrdersPool } = await import("../src/lib/db/postgres");
  const repo = await import("../src/lib/orders/repository");
  const { businessDateFor } = await import("../src/lib/orders/businessDate");
  const { formatOrderNumber } = await import("../src/lib/orders/types");

  const schema = await readFile(
    join(process.cwd(), "src", "lib", "db", "schema.sql"),
    "utf8",
  );
  await ordersPool().query(schema);
  console.log("schema applied\n");

  const line = {
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
  };
  const totals = {
    subtotalCents: 2250,
    taxCents: 174,
    tipCents: 0,
    totalCents: 2424,
  };
  const baseInput = {
    tenantId: RUN_TENANT,
    orderNumberPrefix: "A",
    items: [line],
    totals,
    customer: { name: "Verify Bot", phone: "(619) 555-0100" },
    pickupAt: new Date("2026-07-27T01:45:00.000Z"),
  };

  /* ------------------------------------------------ 1. idempotency ------ */
  console.log("1. idempotency — same key twice");
  {
    const businessDate = "2026-01-05";
    const first = await repo.createOrder({
      ...baseInput,
      businessDate,
      idempotencyKey: "idem-fixed-key",
    });
    const second = await repo.createOrder({
      ...baseInput,
      businessDate,
      idempotencyKey: "idem-fixed-key",
    });

    check("first insert created a row", first.created);
    check("second insert did NOT create a row", !second.created);
    check(
      "same order number returned",
      first.order.orderNumber === second.order.orderNumber,
      `${first.order.orderNumber} vs ${second.order.orderNumber}`,
    );

    const { rows } = await ordersPool().query(
      "select count(*)::int as n from orders where tenant_id = $1 and idempotency_key = $2",
      [RUN_TENANT, "idem-fixed-key"],
    );
    check("exactly one row in the table", rows[0].n === 1, `found ${rows[0].n}`);

    // The unique index must be the guarantee, not the application fast path.
    let indexRejected = false;
    try {
      await ordersPool().query(
        `insert into orders (tenant_id, order_number, business_date, status,
           idempotency_key, items, totals, customer, pickup_at)
         values ($1, 'A-999', $2::date, 'PAID', 'idem-fixed-key', '[]', '{}', '{}', now())`,
        [RUN_TENANT, businessDate],
      );
    } catch {
      indexRejected = true;
    }
    check("raw duplicate insert rejected by the unique index", indexRejected);
  }

  /* ------------------------------------------------ 2. concurrency ------ */
  console.log("\n2. concurrency — 50 simultaneous allocations");
  {
    const businessDate = "2026-02-10";
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        repo.createOrder({
          ...baseInput,
          businessDate,
          idempotencyKey: `concurrent-${i}`,
        }),
      ),
    );

    const numbers = results.map((r) => r.order.orderNumber);
    const unique = new Set(numbers);
    check("all 50 created a row", results.every((r) => r.created));
    check("50 distinct numbers", unique.size === 50, `${unique.size} distinct`);

    const seqs = numbers
      .map((n) => Number.parseInt(n.split("-")[1], 10))
      .sort((a, b) => a - b);
    const contiguous = seqs.every((n, i) => n === i + 1);
    check(
      "sequential 1..50 with no gaps",
      contiguous,
      `min ${seqs[0]}, max ${seqs[seqs.length - 1]}`,
    );
    check(
      "formatting is zero-padded (A-001 … A-050)",
      numbers.includes(formatOrderNumber("A", 1)) &&
        numbers.includes(formatOrderNumber("A", 50)),
    );

    const counter = await ordersPool().query(
      "select seq from order_counters where tenant_id = $1 and business_date = $2::date",
      [RUN_TENANT, businessDate],
    );
    check("counter landed on exactly 50", counter.rows[0].seq === 50, `seq=${counter.rows[0].seq}`);
  }

  /* ------------------------------------------------ 3. timezone --------- */
  console.log("\n3. business date in the restaurant timezone");
  {
    const tz = "America/Los_Angeles";

    // 2026-07-27 23:30 PDT === 2026-07-28 06:30 UTC. UTC has already rolled
    // over; the restaurant has not. The order belongs to the 27th.
    const lateEvening = new Date("2026-07-28T06:30:00.000Z");
    const local = businessDateFor(tz, lateEvening);
    check(
      "23:30 local stays on today's date",
      local === "2026-07-27",
      `got ${local} (UTC date is ${lateEvening.toISOString().slice(0, 10)})`,
    );

    // Just after midnight local — this one really is the next day.
    const afterMidnight = new Date("2026-07-28T07:30:00.000Z");
    check(
      "00:30 local rolls to the next date",
      businessDateFor(tz, afterMidnight) === "2026-07-28",
      businessDateFor(tz, afterMidnight),
    );

    // Winter, to confirm the offset is read per-instant rather than assumed.
    const winter = new Date("2026-01-15T07:30:00.000Z"); // 23:30 PST on the 14th
    check(
      "PST (winter) handled too",
      businessDateFor(tz, winter) === "2026-01-14",
      businessDateFor(tz, winter),
    );

    // And the number sequence must key off that local date.
    const evening = await repo.createOrder({
      ...baseInput,
      businessDate: businessDateFor(tz, lateEvening),
      idempotencyKey: "tz-late-evening",
    });
    const nextDay = await repo.createOrder({
      ...baseInput,
      businessDate: businessDateFor(tz, afterMidnight),
      idempotencyKey: "tz-after-midnight",
    });
    check(
      "the daily sequence resets across the local midnight",
      evening.order.orderNumber === "A-001" &&
        nextDay.order.orderNumber === "A-001",
      `${evening.order.orderNumber} then ${nextDay.order.orderNumber}`,
    );
    check(
      "…on two different business dates",
      evening.order.businessDate === "2026-07-27" &&
        nextDay.order.businessDate === "2026-07-28",
      `${evening.order.businessDate} / ${nextDay.order.businessDate}`,
    );
  }

  /* ------------------------------------------------ 4. race hygiene ----- */
  console.log("\n4. a lost idempotency race does not burn a number");
  {
    const businessDate = "2026-03-03";
    await repo.createOrder({
      ...baseInput,
      businessDate,
      idempotencyKey: "race-a",
    });

    // Ten concurrent retries of a key that already exists. Every one of them
    // takes the counter lock, finds the row, and rolls back.
    await Promise.all(
      Array.from({ length: 10 }, () =>
        repo.createOrder({
          ...baseInput,
          businessDate,
          idempotencyKey: "race-a",
        }),
      ),
    );

    const next = await repo.createOrder({
      ...baseInput,
      businessDate,
      idempotencyKey: "race-b",
    });
    check(
      "next real order is A-002, not A-012",
      next.order.orderNumber === "A-002",
      next.order.orderNumber,
    );
  }

  /* ------------------------------------------------ 5. repository API --- */
  console.log("\n5. repository reads and status transitions");
  {
    const businessDate = "2026-04-04";
    const created = await repo.createOrder({
      ...baseInput,
      businessDate,
      idempotencyKey: "api-1",
    });

    const paid = await repo.markPaid(RUN_TENANT, created.order.id, "chg_test_1");
    check("markPaid sets PAID + charge id", paid.status === "PAID" && paid.chargeId === "chg_test_1");

    const byNumber = await repo.getOrderByNumber(
      RUN_TENANT,
      businessDate,
      created.order.orderNumber,
    );
    check("getOrderByNumber finds it", byNumber?.id === created.order.id);

    const byKey = await repo.getOrderByIdempotencyKey(RUN_TENANT, "api-1");
    check("getOrderByIdempotencyKey finds it", byKey?.id === created.order.id);
    check(
      "integer cents survive the jsonb round trip",
      byKey?.totals.totalCents === 2424 &&
        Number.isInteger(byKey?.totals.totalCents) &&
        byKey?.items[0].nameZh === "宮保雞丁",
    );

    const active = await repo.listActiveOrders(RUN_TENANT, businessDate);
    check("listActiveOrders returns the paid order", active.length === 1);

    const failed = await repo.recordPrintAttempt(RUN_TENANT, created.order.id, {
      ok: false,
      error: "printer offline",
    });
    check(
      "recordPrintAttempt marks PRINT_FAILED",
      failed?.status === "PRINT_FAILED" &&
        failed.printAttempts === 1 &&
        failed.lastPrintError === "printer offline",
    );

    await repo.updateStatus(RUN_TENANT, created.order.id, "ACCEPTED");
    const late = await repo.recordPrintAttempt(RUN_TENANT, created.order.id, {
      ok: true,
    });
    check(
      "a late reprint does not drag an ACCEPTED order backwards",
      late?.status === "ACCEPTED" && late.printAttempts === 2,
      `${late?.status}, attempts=${late?.printAttempts}`,
    );

    // A PENDING_PAYMENT reservation must never appear on the kitchen board.
    const pending = await repo.createOrder({
      ...baseInput,
      businessDate,
      idempotencyKey: "api-pending",
    });
    const board = await repo.listActiveOrders(RUN_TENANT, businessDate);
    check(
      "PENDING_PAYMENT is hidden from the board",
      !board.some((o) => o.id === pending.order.id),
    );

    await repo.deleteReservation(RUN_TENANT, pending.order.id);
    check(
      "deleteReservation frees the key for a retry",
      (await repo.getOrderByIdempotencyKey(RUN_TENANT, "api-pending")) === null,
    );
  }

  /* ------------------------------------------------ teardown ------------ */
  await ordersPool().query("delete from orders where tenant_id = $1", [RUN_TENANT]);
  await ordersPool().query("delete from order_counters where tenant_id = $1", [RUN_TENANT]);
  await closeOrdersPool();
  await db.stop();

  console.log(
    failures === 0
      ? "\nALL CHECKS PASSED"
      : `\n${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
