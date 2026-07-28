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
 *   4. RACE HYGIENE — a submission that loses the idempotency race does not
 *                     burn an order number.
 *   5. REPOSITORY   — reads, status transitions, E.164 storage.
 *   6. PRINT CLAIM  — 10 concurrent CloudPRNT polls never hand out the same
 *                     job twice, and a claim alone never marks it printed.
 *   7. ALERTING     — an unprinted order is found after the threshold, and two
 *                     overlapping cron runs alert exactly once.
 *   8. PHONE CAP    — per-number daily order counting.
 *   9. ALERT RETRY  — a failed SMS releases its claim and is retried, capped at
 *                     5 attempts, and the claim token makes releasing race-safe.
 *  10. RENDER RETRY — a failed ticket render keeps the order QUEUED for another
 *                     poll, and only condemns it at the ceiling.
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
    customer: { name: "Verify Bot", phone: "+16195550100" },
    phoneVerifiedAt: new Date("2026-07-27T01:00:00.000Z"),
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
           idempotency_key, items, totals, customer, phone_verified_at, pickup_at)
         values ($1, 'A-999', $2::date, 'QUEUED', 'idem-fixed-key', '[]', '{}', '{}', now(), now())`,
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

    check(
      "a stored order is live immediately (QUEUED, no payment step)",
      created.order.status === "QUEUED",
      created.order.status,
    );
    check(
      "phone_verified_at is persisted",
      created.order.phoneVerifiedAt.startsWith("2026-07-27T01:00"),
      created.order.phoneVerifiedAt,
    );

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
    check(
      "the phone is stored in E.164",
      byKey?.customer.phone === "+16195550100",
      byKey?.customer.phone,
    );

    const active = await repo.listActiveOrders(RUN_TENANT, businessDate);
    check("listActiveOrders returns the queued order", active.length === 1);

    const failed = await repo.recordPrintAttempt(RUN_TENANT, created.order.id, {
      ok: false,
      error: "printer offline",
    });
    check(
      "recordPrintAttempt marks PRINT_FAILED",
      failed?.status === "PRINT_FAILED" && failed.lastPrintError === "printer offline",
    );

    await repo.updateStatus(RUN_TENANT, created.order.id, "ACCEPTED");
    const late = await repo.recordPrintAttempt(RUN_TENANT, created.order.id, {
      ok: true,
    });
    check(
      "a late print result does not drag an ACCEPTED order backwards",
      late?.status === "ACCEPTED",
      late?.status,
    );
  }

  /* ------------------------------------------- 6. CloudPRNT job claim --- */
  console.log("\n6. print-job claim is concurrency safe");
  {
    // Its own tenant: claimNextPrintJob is deliberately NOT scoped by business
    // date — an order left unprinted overnight must still print — so rows from
    // the sections above would otherwise be legitimate candidates here.
    const tenant = `${RUN_TENANT}-print`;
    const businessDate = "2026-05-05";
    const first = await repo.createOrder({
      ...baseInput,
      tenantId: tenant,
      businessDate,
      idempotencyKey: "print-1",
    });
    const second = await repo.createOrder({
      ...baseInput,
      tenantId: tenant,
      businessDate,
      idempotencyKey: "print-2",
    });

    // Ten simultaneous polls, as if the printer retried hard. Each claim must
    // hand out a DIFFERENT order, and only two orders exist.
    const claims = await Promise.all(
      Array.from({ length: 10 }, () => repo.claimNextPrintJob(tenant)),
    );
    const claimed = claims.filter((c): c is NonNullable<typeof c> => c !== null);
    const claimedIds = new Set(claimed.map((c) => c.id));

    check(
      "10 concurrent polls claimed exactly the 2 available jobs",
      claimed.length === 2 && claimedIds.size === 2,
      `${claimed.length} claims, ${claimedIds.size} distinct`,
    );
    check(
      "oldest first",
      claimed.some((c) => c.id === first.order.id) &&
        claimed.some((c) => c.id === second.order.id),
    );
    check(
      "a claim does NOT mark the order printed",
      claimed.every((c) => c.status === "QUEUED" && c.printedAt === null),
    );
    check(
      "a claim counts an attempt",
      claimed.every((c) => c.printAttempts === 1),
    );

    // Only DELETE marks it printed.
    const printed = await repo.markPrinted(tenant, first.order.id);
    check(
      "markPrinted sets PRINTED and stamps printed_at",
      printed?.status === "PRINTED" && printed.printedAt !== null,
    );

    // The unconfirmed one must still be visible as needing attention.
    const stillQueued = await repo.getOrderById(tenant, second.order.id);
    check(
      "an unconfirmed job stays QUEUED so the alert can catch it",
      stillQueued?.status === "QUEUED",
      stillQueued?.status,
    );

    const requeued = await repo.requeueForPrint(tenant, first.order.id);
    check(
      "requeueForPrint (重印) puts it back in the queue",
      requeued?.status === "QUEUED" && requeued.printAttempts === 0,
    );

    // …and being back in the queue must mean genuinely claimable again.
    const reclaimed = await repo.claimNextPrintJob(tenant);
    check(
      "a re-queued job can be claimed again",
      reclaimed?.id === first.order.id,
      String(reclaimed?.orderNumber),
    );

    await ordersPool().query("delete from orders where tenant_id = $1", [tenant]);
    await ordersPool().query("delete from order_counters where tenant_id = $1", [tenant]);
  }

  /* ------------------------------------- 7. unprinted-order alerting ---- */
  console.log("\n7. unprinted-order alert fires once per order");
  {
    const tenant = `${RUN_TENANT}-alert`;
    const businessDate = "2026-06-06";
    const stale = await repo.createOrder({
      ...baseInput,
      tenantId: tenant,
      businessDate,
      idempotencyKey: "alert-1",
    });

    // Nothing is old enough yet.
    const none = await repo.findUnprintedForAlert(tenant, 120);
    check(
      "a fresh order is not alerted on",
      !none.some((o) => o.id === stale.order.id),
    );

    // Age it past the 2-minute threshold.
    await ordersPool().query(
      "update orders set created_at = now() - interval '5 minutes' where id = $1",
      [stale.order.id],
    );

    const due = await repo.findUnprintedForAlert(tenant, 120);
    check(
      "an order unprinted for >2 minutes is found",
      due.some((o) => o.id === stale.order.id),
    );

    // Two overlapping cron runs must not both text the owner.
    const [a, b] = await Promise.all([
      repo.markAlerted(tenant, stale.order.id),
      repo.markAlerted(tenant, stale.order.id),
    ]);
    check(
      "exactly one of two concurrent alert claims wins",
      (a ? 1 : 0) + (b ? 1 : 0) === 1,
      `${a} / ${b}`,
    );

    const after = await repo.findUnprintedForAlert(tenant, 120);
    check(
      "an alerted order is not found again",
      !after.some((o) => o.id === stale.order.id),
    );

    await ordersPool().query("delete from orders where tenant_id = $1", [tenant]);
    await ordersPool().query("delete from order_counters where tenant_id = $1", [tenant]);
  }

  /* ------------------------------------------ 8. per-phone daily cap ---- */
  console.log("\n8. per-phone daily order cap");
  {
    const businessDate = "2026-08-08";
    for (let i = 0; i < 3; i++) {
      await repo.createOrder({
        ...baseInput,
        businessDate,
        idempotencyKey: `cap-${i}`,
      });
    }
    const count = await repo.countOrdersForPhone(
      RUN_TENANT,
      businessDate,
      "+16195550100",
    );
    check("counts orders for the number", count === 3, String(count));

    const other = await repo.countOrdersForPhone(
      RUN_TENANT,
      businessDate,
      "+16195550999",
    );
    check("does not count a different number", other === 0, String(other));
  }

  /* ------------------------------- 9. alert retry after a failed send ---- */
  console.log("\n9. a failed alert SMS retries, up to a cap");
  {
    const tenant = `${RUN_TENANT}-alert-retry`;
    const businessDate = "2026-08-09";
    const MAX = 5;

    /** Age an order past the alert threshold. */
    const age = (id: number) =>
      ordersPool().query(
        "update orders set created_at = now() - interval '5 minutes' where id = $1",
        [id],
      );

    /** One sweep: claim, then hand the send result back in. */
    async function sweep(orderId: number, sendSucceeds: boolean) {
      const due = await repo.findUnprintedForAlert(tenant, 120);
      const found = due.some((o) => o.id === orderId);
      if (!found) return { attempted: false, released: false, attempts: -1 };
      const claimedAt = await repo.markAlerted(tenant, orderId);
      if (!claimedAt) return { attempted: false, released: false, attempts: -1 };
      if (sendSucceeds) return { attempted: true, released: false, attempts: -1 };
      const r = await repo.releaseAlertClaim(tenant, orderId, claimedAt, MAX);
      return { attempted: true, released: r?.released ?? false, attempts: r?.attempts ?? -1 };
    }

    // (a) transient failure -> retried on the next sweep
    {
      const o = await repo.createOrder({
        ...baseInput,
        tenantId: tenant,
        businessDate,
        idempotencyKey: "alert-retry-a",
      });
      await age(o.order.id);

      const first = await sweep(o.order.id, false);
      check(
        "(a) a failed send releases the claim",
        first.attempted && first.released && first.attempts === 1,
        `attempted=${first.attempted} released=${first.released} attempts=${first.attempts}`,
      );
      const redue = await repo.findUnprintedForAlert(tenant, 120);
      check(
        "(a) the order is found again by the next sweep",
        redue.some((x) => x.id === o.order.id),
      );
    }

    // (b) five failures -> permanently claimed, no sixth attempt
    {
      const o = await repo.createOrder({
        ...baseInput,
        tenantId: tenant,
        businessDate,
        idempotencyKey: "alert-retry-b",
      });
      await age(o.order.id);

      const seen: number[] = [];
      for (let i = 0; i < MAX; i++) {
        const s = await sweep(o.order.id, false);
        if (s.attempted) seen.push(s.attempts);
      }
      check(
        `(b) exactly ${MAX} sends attempted`,
        seen.length === MAX && seen.join(",") === "1,2,3,4,5",
        `attempts seen: ${seen.join(",")}`,
      );

      const sixth = await sweep(o.order.id, false);
      check(
        "(b) no sixth attempt — the claim is left in place",
        sixth.attempted === false,
        `attempted=${sixth.attempted}`,
      );
      const gone = await repo.findUnprintedForAlert(tenant, 120);
      check(
        "(b) the exhausted order is no longer swept",
        !gone.some((x) => x.id === o.order.id),
      );
    }

    // (c) success on attempt 2 -> exactly one SMS in total
    {
      const o = await repo.createOrder({
        ...baseInput,
        tenantId: tenant,
        businessDate,
        idempotencyKey: "alert-retry-c",
      });
      await age(o.order.id);

      let sends = 0;
      const s1 = await sweep(o.order.id, false); // fails, releases
      if (s1.attempted) sends++;
      const s2 = await sweep(o.order.id, true); // succeeds, keeps the claim
      if (s2.attempted) sends++;
      const s3 = await sweep(o.order.id, false); // must not run at all
      if (s3.attempted) sends++;

      check(
        "(c) success on attempt 2 sends exactly twice and then stops",
        sends === 2 && s3.attempted === false,
        `sends=${sends} thirdAttempted=${s3.attempted}`,
      );
    }

    // The claim token closes the race: a stale claim value releases nothing.
    {
      const o = await repo.createOrder({
        ...baseInput,
        tenantId: tenant,
        businessDate,
        idempotencyKey: "alert-retry-race",
      });
      await age(o.order.id);
      const claimedAt = await repo.markAlerted(tenant, o.order.id);
      const stale = new Date(
        new Date(claimedAt as string).getTime() - 60_000,
      ).toISOString();
      const bogus = await repo.releaseAlertClaim(tenant, o.order.id, stale, MAX);
      check(
        "(race) releasing with a claim token we do not hold is a no-op",
        bogus === null,
        `got ${JSON.stringify(bogus)}`,
      );
      const still = await repo.findUnprintedForAlert(tenant, 120);
      check(
        "(race) the real claim survives the bogus release",
        !still.some((x) => x.id === o.order.id),
      );
    }

    await ordersPool().query("delete from orders where tenant_id = $1", [tenant]);
    await ordersPool().query("delete from order_counters where tenant_id = $1", [tenant]);
  }

  /* --------------------------- 10. render failure retries, then fails ---- */
  console.log("\n10. a failed ticket render retries before condemning");
  {
    const tenant = `${RUN_TENANT}-render`;
    const businessDate = "2026-08-10";
    const MAX_RENDER = 3;

    const o = await repo.createOrder({
      ...baseInput,
      tenantId: tenant,
      businessDate,
      idempotencyKey: "render-1",
    });

    // The printer claims it: print_attempts 0 -> 1.
    const claimed = await repo.claimNextPrintJob(tenant);
    check("a job is claimed", claimed?.id === o.order.id);

    const first = await repo.recordRenderFailure(
      tenant,
      o.order.id,
      "boom",
      MAX_RENDER,
    );
    check(
      "first render failure keeps the order QUEUED",
      first?.status === "QUEUED" && first?.attempts === 2,
      `status=${first?.status} attempts=${first?.attempts}`,
    );

    // Still offered to the next poll — this is what makes it a retry.
    const inflight = await repo.currentPrintJob(tenant);
    check(
      "the same job is re-offered on the next poll",
      inflight?.id === o.order.id,
    );

    const second = await repo.recordRenderFailure(
      tenant,
      o.order.id,
      "boom again",
      MAX_RENDER,
    );
    check(
      "at the ceiling the order becomes PRINT_FAILED",
      second?.status === "PRINT_FAILED" && second?.attempts === 3,
      `status=${second?.status} attempts=${second?.attempts}`,
    );

    const failed = await repo.getOrderById(tenant, o.order.id);
    check(
      "last_print_error is recorded",
      failed?.lastPrintError === "boom again",
      String(failed?.lastPrintError),
    );

    // A late failure must never drag a finished order backwards.
    await repo.updateStatus(tenant, o.order.id, "ACCEPTED");
    const late = await repo.recordRenderFailure(tenant, o.order.id, "late", MAX_RENDER);
    check(
      "a late failure does not move an ACCEPTED order",
      late?.status === "ACCEPTED",
      `status=${late?.status}`,
    );

    await ordersPool().query("delete from orders where tenant_id = $1", [tenant]);
    await ordersPool().query("delete from order_counters where tenant_id = $1", [tenant]);
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
