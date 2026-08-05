/**
 * Prove that a printer out of paper costs an order nothing.
 *
 *   npm run verify:printer-health
 *
 * The failure being tested: paper runs out, the printer keeps polling, the
 * server keeps handing it jobs it cannot print, and every hand-over spends part
 * of a retry budget that ends in PRINT_FAILED. Paper comes back to a queue
 * whose orders have already been condemned. Nobody notices until a customer
 * does.
 *
 * Built out of the real things, like verify-print-recurrence: a real Postgres,
 * the real schema, the real repository, and the REAL route handler from
 * src/app/api/print/[secret]/route.ts driven with the poll bodies a Star
 * printer sends.
 *
 * ⚠️ WINDOWS: PostgreSQL refuses to start under a token holding administrative
 * privileges, so run this from a NON-ELEVATED shell, or
 * `runas /trustlevel:0x20000 "cmd /c npm run verify:printer-health"`.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const PORT = 55434;
const DB_NAME = "nmc_health_test";
const SECRET = "verify-printer-health-secret";
const MAC = "00:11:62:00:00:01";
const TENANT = "health-test";

/**
 * EACH SCENARIO GETS ITS OWN TENANT.
 *
 * Not tidiness — correctness. The offer loop allows ONE job in flight per
 * tenant and protects it with a 90s confirmation window, so an order handed
 * over in an earlier scenario legitimately blocks every later one from being
 * offered at all. Sharing a tenant made a passing production rule look like a
 * failing test. Every scenario also gets its own printer_status row, which is
 * what lets each drive its own paper-out edge from a clean slate.
 */
function scenarioTenant(name: string): string {
  const id = `${TENANT}-${name}`;
  process.env.TENANT_ID = id;
  return id;
}
const BASE = `https://example.test/api/print/${SECRET}`;

/* -------------------------------------------------------------- harness -- */

interface Handlers {
  POST: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
}

const params = Promise.resolve({ secret: SECRET });

/** The poll bodies a Star printer sends, as this system will receive them. */
const POLL = {
  /** Healthy. statusCode is URL-encoded on the wire; readPoll sees it raw. */
  ok: { statusCode: "200%20OK", printerMAC: MAC },
  /** Out of paper. The reason phrase is what the parser reads. */
  paperOut: { statusCode: "803%20Paper%20Empty", printerMAC: MAC, status: "23060000" },
  /** Running low but still printing — must NOT be read as empty. */
  paperLow: { statusCode: "200%20OK%20Paper%20Near%20End", printerMAC: MAC },
  /** Lid up. Gated for the same reason paper-out is. */
  coverOpen: { statusCode: "801%20Cover%20Open", printerMAC: MAC },
} as const;

async function poll(
  h: Handlers,
  body: Record<string, unknown>,
): Promise<{ jobReady: boolean; token?: string }> {
  const res = await h.POST(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params },
  );
  const json = (await res.json()) as { jobReady?: boolean; jobToken?: string };
  return { jobReady: json.jobReady === true, token: json.jobToken };
}

interface Repo {
  createOrder: typeof import("../src/lib/orders/repository").createOrder;
  getOrderByNumber: typeof import("../src/lib/orders/repository").getOrderByNumber;
}

let seq = 0;

async function seedOrder(repo: Repo, tenant: string, businessDate: string) {
  seq++;
  const items = [
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
  ];
  const { order } = await repo.createOrder({
    tenantId: tenant,
    businessDate,
    orderNumberPrefix: "A",
    idempotencyKey: `health-test-${seq}-${Date.now()}`,
    items,
    // 2250 @ 875 bps = 196.875c -> 197c half-up.
    totals: { subtotalCents: 2250, taxCents: 197, tipCents: 0, totalCents: 2447 },
    customer: { name: "Health Test", phone: "+16195550000" },
    phoneVerifiedAt: new Date(),
    pickupAt: new Date(Date.now() + 25 * 60_000),
  });
  return order;
}

interface Result {
  name: string;
  passed: boolean;
  detail: string;
}

function check(name: string, passed: boolean, detail: string): Result {
  return { name, passed, detail };
}

/* ------------------------------------------------------------ scenarios -- */

/**
 * PAPER OUT: no offer, and no attempt counted.
 *
 * The second half is the one that matters. Refusing to offer is easy; refusing
 * to SPEND anything while refusing is what keeps the order alive. Twenty polls
 * of paper-out here — a full minute of the real printer's cadence — and the
 * order must come out the other side untouched.
 */
async function paperOutCostsNothing(
  h: Handlers,
  repo: Repo,
  businessDate: string,
): Promise<Result[]> {
  const tenant = scenarioTenant("paper");
  const order = await seedOrder(repo, tenant, businessDate);
  console.log(`\n── paper out: 20 polls with a queued order (${order.orderNumber})`);

  let offers = 0;
  for (let i = 0; i < 20; i++) {
    const answer = await poll(h, POLL.paperOut);
    if (answer.jobReady) offers++;
  }

  const after = await repo.getOrderByNumber(tenant, businessDate, order.orderNumber);
  console.log(
    `   offers=${offers}  status=${after?.status}  attempts=${after?.printAttempts}  ` +
      `offeredAt=${after?.offeredAt ?? "null"}`,
  );

  return [
    check(
      "paper out -> no offer",
      offers === 0,
      `${offers} job(s) offered across 20 paper-out polls — expected 0`,
    ),
    check(
      "paper out -> no attempt spent",
      after?.printAttempts === 0 && after?.offeredAt === null,
      `print_attempts=${after?.printAttempts}, print_offered_at=${after?.offeredAt ?? "null"} ` +
        "— expected 0 and null, i.e. the retry budget untouched",
    ),
    check(
      "paper out -> order still QUEUED",
      after?.status === "QUEUED",
      `status is ${after?.status} — expected QUEUED, still waiting`,
    ),
  ];
}

/**
 * THE A-00x HISTORY CASE, both ways.
 *
 * Under the old logic an order behind a paper-out printer was offered on every
 * poll until the delivery cap condemned it: the budget drained while the
 * printer physically could not print. This runs the same sequence — a
 * paper-out spell long enough to exhaust the cap several times over — and
 * asserts the budget never moves, then that paper coming back drains the queue
 * for real.
 *
 * The "old logic" half is asserted by arithmetic rather than by reverting the
 * code: the delivery cap is 4, the spell is 20 polls, so under a server that
 * offered on every poll the order would have been condemned five times over.
 */
async function historyCase(
  h: Handlers,
  repo: Repo,
  businessDate: string,
  deliveryCap: number,
): Promise<Result[]> {
  const tenant = scenarioTenant("history");
  const order = await seedOrder(repo, tenant, businessDate);
  console.log(`\n── history case: ${order.orderNumber} through an outage and out again`);

  const POLLS_DURING_OUTAGE = 20;
  for (let i = 0; i < POLLS_DURING_OUTAGE; i++) await poll(h, POLL.paperOut);

  const during = await repo.getOrderByNumber(tenant, businessDate, order.orderNumber);
  console.log(
    `   during outage: status=${during?.status} attempts=${during?.printAttempts} ` +
      `(old logic would have spent ${POLLS_DURING_OUTAGE}, cap is ${deliveryCap})`,
  );

  // Paper returns. The very next poll must hand the job over.
  const restored = await poll(h, POLL.ok);
  const after = await repo.getOrderByNumber(tenant, businessDate, order.orderNumber);
  console.log(
    `   first healthy poll: jobReady=${restored.jobReady} token=${restored.token} ` +
      `-> attempts=${after?.printAttempts}`,
  );

  return [
    check(
      "history: outage never decrements the budget",
      during?.printAttempts === 0 && during?.status === "QUEUED",
      `after ${POLLS_DURING_OUTAGE} paper-out polls: attempts=${during?.printAttempts}, ` +
        `status=${during?.status}. Old logic: ${POLLS_DURING_OUTAGE} attempts against a ` +
        `cap of ${deliveryCap} — condemned ${Math.floor(POLLS_DURING_OUTAGE / deliveryCap)}× over`,
    ),
    check(
      "history: first healthy poll drains the queue",
      restored.jobReady && restored.token === order.orderNumber,
      `jobReady=${restored.jobReady} token=${restored.token} — expected the queued order`,
    ),
  ];
}

/**
 * RESTORE: the auto-requeue fires exactly once.
 *
 * An order condemned during the outage — which is what the OLD server did to
 * every one of them, and what a printer reporting a failure code can still do
 * — must come back when paper does. And the transition is an edge, so a second
 * healthy poll must not requeue it a second time.
 */
async function restoreRequeuesOnce(
  h: Handlers,
  repo: Repo,
  businessDate: string,
): Promise<Result[]> {
  const tenant = scenarioTenant("restore");
  const order = await seedOrder(repo, tenant, businessDate);
  console.log(`\n── restore: a condemned order comes back (${order.orderNumber})`);

  // Enter the outage, then condemn the order the way the old server would
  // have: straight to PRINT_FAILED, mid-outage.
  await poll(h, POLL.paperOut);
  const { recordPrintAttempt } = await import("../src/lib/orders/repository");
  await recordPrintAttempt(tenant, order.id, {
    ok: false,
    error: "no print confirmation after 4 hand-overs",
  });
  const condemned = await repo.getOrderByNumber(tenant, businessDate, order.orderNumber);
  console.log(`   condemned mid-outage: status=${condemned?.status}`);

  // Paper returns.
  await poll(h, POLL.ok);
  const restored = await repo.getOrderByNumber(tenant, businessDate, order.orderNumber);
  console.log(
    `   after restore: status=${restored?.status} attempts=${restored?.printAttempts}`,
  );

  // A second healthy poll is NOT an edge. Condemn it again and check that a
  // steady healthy printer leaves it alone — proving the requeue is bound to
  // the transition and not to "the printer is fine".
  await recordPrintAttempt(tenant, order.id, { ok: false, error: "unrelated failure" });
  await poll(h, POLL.ok);
  const second = await repo.getOrderByNumber(tenant, businessDate, order.orderNumber);
  console.log(`   after a second healthy poll: status=${second?.status} (no new edge)`);

  return [
    check(
      "restore -> condemned order is requeued, budget reset",
      condemned?.status === "PRINT_FAILED" &&
        restored?.status === "QUEUED" &&
        (restored?.printAttempts ?? 99) <= 1,
      `PRINT_FAILED -> ${restored?.status} with attempts=${restored?.printAttempts}. ` +
        "Expected QUEUED and at most 1: the requeue resets to 0, and the SAME poll " +
        "then hands the order over for real, which is one legitimate delivery — " +
        "recovery is immediate rather than one poll later. Anything above 1 would " +
        "mean the old budget survived.",
    ),
    check(
      "restore -> fires once, on the edge only",
      second?.status === "PRINT_FAILED",
      `a later healthy poll left it ${second?.status} — expected PRINT_FAILED, ` +
        "i.e. no second requeue without a second outage",
    ),
  ];
}

/** Cover-open is gated the same way, and paper-LOW is not gated at all. */
async function coverAndLow(
  h: Handlers,
  repo: Repo,
  businessDate: string,
): Promise<Result[]> {
  const tenant = scenarioTenant("cover");
  const order = await seedOrder(repo, tenant, businessDate);
  console.log(`\n── cover open / paper low (${order.orderNumber})`);

  const covered = await poll(h, POLL.coverOpen);
  const afterCover = await repo.getOrderByNumber(tenant, businessDate, order.orderNumber);
  const low = await poll(h, POLL.paperLow);
  console.log(
    `   cover open: jobReady=${covered.jobReady} attempts=${afterCover?.printAttempts}   ` +
      `paper low: jobReady=${low.jobReady}`,
  );

  return [
    check(
      "cover open -> withheld, nothing spent",
      !covered.jobReady && afterCover?.printAttempts === 0,
      `jobReady=${covered.jobReady} attempts=${afterCover?.printAttempts} — expected false and 0`,
    ),
    check(
      "paper LOW still prints",
      low.jobReady,
      `jobReady=${low.jobReady} — a near-end warning must not stop the kitchen`,
    ),
  ];
}

/** Health flips to offline once the row goes stale, with no polls at all. */
async function offlineAtSixtySeconds(): Promise<Result[]> {
  const { derivePrinterHealth, OFFLINE_AFTER_SECONDS } = await import(
    "../src/lib/print/printerStatus"
  );
  console.log(`\n── offline threshold (${OFFLINE_AFTER_SECONDS}s)`);

  const at = (secondsSinceSeen: number | null) =>
    derivePrinterHealth({ secondsSinceSeen, paperOut: false, coverOpen: false });

  const rows: [string, string][] = [
    ["3s (just polled)", at(3)],
    [`${OFFLINE_AFTER_SECONDS}s (exactly at)`, at(OFFLINE_AFTER_SECONDS)],
    [`${OFFLINE_AFTER_SECONDS + 1}s (one past)`, at(OFFLINE_AFTER_SECONDS + 1)],
    ["never polled", at(null)],
  ];
  for (const [label, value] of rows) console.log(`   ${label.padEnd(26)} ${value}`);

  return [
    check(
      "offline flips one second past the threshold",
      at(3) === "ok" &&
        at(OFFLINE_AFTER_SECONDS) === "ok" &&
        at(OFFLINE_AFTER_SECONDS + 1) === "offline" &&
        at(null) === "unknown",
      rows.map(([l, v]) => `${l}=${v}`).join(", "),
    ),
    check(
      "a paper-out printer that goes silent reads as offline",
      derivePrinterHealth({
        secondsSinceSeen: OFFLINE_AFTER_SECONDS + 1,
        paperOut: true,
        coverOpen: false,
      }) === "offline",
      "silence is the more urgent fact and must win over the last thing it said",
    ),
  ];
}

/** The parser, against the shapes Star's status strings take. */
async function parserTable(): Promise<Result[]> {
  const { readPrinterCondition } = await import("../src/lib/print/printerStatus");
  console.log("\n── status parsing");

  const cases: [string, string | null, { paperOut: boolean; coverOpen: boolean; online: boolean }][] =
    [
      ["200 OK", "200%20OK", { paperOut: false, coverOpen: false, online: true }],
      ["200 OK (already decoded)", "200 OK", { paperOut: false, coverOpen: false, online: true }],
      ["803 Paper Empty", "803%20Paper%20Empty", { paperOut: true, coverOpen: false, online: false }],
      ["Paper End", "Paper%20End", { paperOut: true, coverOpen: false, online: false }],
      ["Receipt Paper Out", "Receipt%20Paper%20Out", { paperOut: true, coverOpen: false, online: false }],
      ["200 OK Paper Near End", "200%20OK%20Paper%20Near%20End", { paperOut: false, coverOpen: false, online: true }],
      ["801 Cover Open", "801%20Cover%20Open", { paperOut: false, coverOpen: true, online: false }],
      ["802 Offline", "802%20Offline", { paperOut: false, coverOpen: false, online: false }],
      ["absent", null, { paperOut: false, coverOpen: false, online: true }],
    ];

  const wrong: string[] = [];
  for (const [label, statusCode, want] of cases) {
    const got = readPrinterCondition({ statusCode });
    const ok =
      got.paperOut === want.paperOut &&
      got.coverOpen === want.coverOpen &&
      got.online === want.online;
    if (!ok) wrong.push(label);
    console.log(
      `   ${ok ? "✓" : "✗"} ${label.padEnd(26)} paperOut=${String(got.paperOut).padEnd(5)} ` +
        `coverOpen=${String(got.coverOpen).padEnd(5)} online=${got.online}`,
    );
  }

  return [
    check(
      "status parsing",
      wrong.length === 0,
      wrong.length === 0 ? `all ${cases.length} cases as intended` : `wrong: ${wrong.join(", ")}`,
    ),
  ];
}

/**
 * THE KITCHEN SCREEN'S DATA PATH, end to end.
 *
 * The strip at the top of the board is only as good as what /api/kitchen/orders
 * hands it, and that payload is derived at read time rather than stored — so
 * "offline" is a thing only this endpoint can ever say. Driven through the real
 * route handler with a real session cookie, because the auth gate is part of
 * the path and a payload nobody can fetch is not a feature.
 */
async function boardSeesTheTruth(
  h: { GET: (r: Request) => Promise<Response> },
  repo: Repo,
  businessDate: string,
): Promise<Result[]> {
  const tenant = scenarioTenant("board");
  await seedOrder(repo, tenant, businessDate);
  console.log("\n── kitchen board payload");

  const { login } = await import("../src/lib/auth/kitchenSession");
  const token = login(process.env.ADMIN_DASH_PASSWORD as string);
  if (!token) throw new Error("could not mint a kitchen session for the test");

  const ask = async () => {
    const res = await h.GET(
      new Request("https://example.test/api/kitchen/orders?completed=0", {
        headers: { cookie: `nmc_kitchen=${token}` },
      }),
    );
    const body = (await res.json()) as {
      ok?: boolean;
      printer?: { health: string; blocked: boolean; secondsSinceSeen: number | null };
    };
    return { status: res.status, printer: body.printer };
  };

  const unauthorised = await h.GET(
    new Request("https://example.test/api/kitchen/orders"),
  );

  const route = await import("../src/app/api/print/[secret]/route");
  await poll(route as unknown as Handlers, POLL.ok);
  const healthy = await ask();

  await poll(route as unknown as Handlers, POLL.paperOut);
  const paper = await ask();

  // Age the row rather than waiting a minute: "offline" is derived from the
  // clock at read time, which is exactly the property being tested.
  const { ordersPool } = await import("../src/lib/db/postgres");
  await ordersPool().query(
    "update printer_status set last_seen_at = now() - interval '5 minutes' where tenant_id = $1",
    [tenant],
  );
  const stale = await ask();

  console.log(
    `   healthy: ${healthy.printer?.health} (blocked=${healthy.printer?.blocked})   ` +
      `paper-out: ${paper.printer?.health} (blocked=${paper.printer?.blocked})   ` +
      `stale row: ${stale.printer?.health} (blocked=${stale.printer?.blocked})`,
  );

  return [
    check(
      "board payload needs a session",
      unauthorised.status === 401,
      `unauthenticated GET returned ${unauthorised.status} — expected 401`,
    ),
    check(
      "board sees OK / PAPER OUT / OFFLINE",
      healthy.printer?.health === "ok" &&
        healthy.printer?.blocked === false &&
        paper.printer?.health === "paper-out" &&
        paper.printer?.blocked === true &&
        stale.printer?.health === "offline" &&
        stale.printer?.blocked === true,
      `ok=${healthy.printer?.health}/${healthy.printer?.blocked}, ` +
        `paper=${paper.printer?.health}/${paper.printer?.blocked}, ` +
        `stale=${stale.printer?.health}/${stale.printer?.blocked}`,
    ),
  ];
}

/* ----------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-health-test-"));

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
    `create database ${DB_NAME} with encoding 'UTF8' ` +
      "lc_collate 'C' lc_ctype 'C' template template0",
  );
  await admin.end();

  process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`;
  process.env.TENANT_ID = TENANT;
  process.env.CLOUDPRNT_SECRET = SECRET;
  process.env.CLOUDPRNT_PRINTER_MAC = MAC;
  process.env.RESTAURANT_TIMEZONE = "America/Los_Angeles";
  process.env.TENANT_TAX_RATE_BPS = "875";
  process.env.ORDER_NUMBER_PREFIX = "A";
  process.env.TICKET_COPIES = "3";
  process.env.ADMIN_DASH_PASSWORD = "verify-printer-health-password";

  const { ordersPool } = await import("../src/lib/db/postgres");
  await ordersPool().query(
    await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"),
  );

  const repo = (await import("../src/lib/orders/repository")) as unknown as Repo;
  const { businessDateFor } = await import("../src/lib/orders/businessDate");
  const route = (await import("../src/app/api/print/[secret]/route")) as unknown as Handlers;
  const config = await import("../src/config/tenant.server");

  const businessDate = businessDateFor("America/Los_Angeles");
  const results: Result[] = [];

  try {
    results.push(...(await parserTable()));
    results.push(...(await offlineAtSixtySeconds()));
    results.push(...(await paperOutCostsNothing(route, repo, businessDate)));
    results.push(...(await coverAndLow(route, repo, businessDate)));
    results.push(...(await restoreRequeuesOnce(route, repo, businessDate)));
    results.push(...(await historyCase(route, repo, businessDate, config.printOfferCap())));
    const ordersRoute = await import("../src/app/api/kitchen/orders/route");
    results.push(...(await boardSeesTheTruth(ordersRoute, repo, businessDate)));
  } finally {
    console.log("\nstopping postgres…");
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log("\nresults:");
  let failed = 0;
  for (const r of results) {
    if (!r.passed) failed++;
    console.log(`  ${r.passed ? "✓" : "✗"} ${r.name}\n      ${r.detail}`);
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\npaper-out costs an order nothing ✓");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
