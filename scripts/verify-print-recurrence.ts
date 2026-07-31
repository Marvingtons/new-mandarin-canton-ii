/**
 * Prove that one order produces exactly one copy-set.
 *
 *   npm run verify:print-recurrence
 *
 * An order printed its three cut copies and then kept printing. This script is
 * the regression test for that, and it is deliberately built out of the real
 * things rather than mocks:
 *
 *   - a real Postgres (embedded, on its own port), with the real schema.sql
 *   - the real repository, so the SQL that stamps and clears the offer runs
 *   - the REAL route handlers from src/app/api/print/[secret]/route.ts, called
 *     the way the printer calls them: POST to poll, GET to fetch, DELETE to
 *     confirm
 *   - real wall-clock seconds, because the bug IS a timing bug and a fake clock
 *     is exactly the thing that would have let it through
 *
 * It takes a few minutes. That is the point: a 3-copy job legitimately needs
 * tens of seconds, and the whole failure was a server that would not wait.
 *
 * R2 is not configured here, so the poll answers without a jobGetUrl and the
 * simulated printer fetches the body from the Worker path — the same code, one
 * fewer hop. What is being measured is how many times a body is handed over,
 * which is identical either way.
 *
 * ⚠️ WINDOWS: PostgreSQL refuses to start under a token holding administrative
 * privileges, so run this from a NON-ELEVATED shell. From an elevated one it
 * dies at initdb with "Execution of PostgreSQL by a user with administrative
 * permissions is not permitted"; `runas /trustlevel:0x20000 "cmd /c npm run
 * verify:print-recurrence"` drops the privileges without asking for a password.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const PORT = 55433;
const DB_NAME = "nmc_print_test";
const SECRET = "verify-print-recurrence-secret";
const MAC = "00:11:62:00:00:01";
const TENANT = "print-test";
const BASE = `https://example.test/api/print/${SECRET}`;

/** Poll cadence. The real printer polls roughly this often. */
const POLL_MS = 3_000;

/* ------------------------------------------------------------- harness -- */

interface Handlers {
  POST: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
  GET: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
  DELETE: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
}

const params = Promise.resolve({ secret: SECRET });

function elapsed(from: number): string {
  return `t+${((Date.now() - from) / 1000).toFixed(1).padStart(5)}s`;
}

/** One POST, as the printer sends it. Returns the parsed poll answer. */
async function poll(h: Handlers): Promise<{ jobReady: boolean; token?: string }> {
  const res = await h.POST(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusCode: "200 OK", printerMAC: MAC }),
    }),
    { params },
  );
  const body = (await res.json()) as { jobReady?: boolean; jobToken?: string };
  return { jobReady: body.jobReady === true, token: body.jobToken };
}

/** One job GET, as the printer sends it. Returns the body length. */
async function fetchJob(h: Handlers): Promise<number> {
  const url = `${BASE}?mac=${encodeURIComponent(MAC)}&type=application/vnd.star.starprnt`;
  const res = await h.GET(new Request(url), { params });
  if (!res.ok) throw new Error(`job GET answered ${res.status}`);
  return (await res.arrayBuffer()).byteLength;
}

/** The confirming DELETE, with the token the poll handed us. */
async function confirm(h: Handlers, token: string): Promise<number> {
  const url = `${BASE}?mac=${encodeURIComponent(MAC)}&code=OK&token=${encodeURIComponent(token)}`;
  const res = await h.DELETE(new Request(url, { method: "DELETE" }), { params });
  return res.status;
}

/* ---------------------------------------------------------- scenarios -- */

interface Repo {
  createOrder: typeof import("../src/lib/orders/repository").createOrder;
  getOrderByNumber: typeof import("../src/lib/orders/repository").getOrderByNumber;
}

let seq = 0;

/** A fresh QUEUED order, ready for the printer to claim. */
async function seedOrder(repo: Repo, businessDate: string) {
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
      quantity: 2,
      unitCents: 2250,
      lineCents: 4500,
    },
  ];
  const { order } = await repo.createOrder({
    tenantId: TENANT,
    businessDate,
    orderNumberPrefix: "A",
    idempotencyKey: `print-test-${seq}-${Date.now()}`,
    items,
    totals: { subtotalCents: 4500, taxCents: 349, tipCents: 0, totalCents: 4849 },
    customer: { name: "Print Test", phone: "+16195550000" },
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

/**
 * SLOW CONFIRM — the production failure, reproduced.
 *
 * The printer takes the job, spends 45 seconds physically printing three copies
 * and cutting between them, and only then confirms. Throughout, it keeps
 * polling every three seconds exactly as the real one does.
 *
 * PASS = the body is handed over EXACTLY ONCE and the order ends PRINTED.
 * Before the fix this handed over twice within the first six seconds.
 */
async function slowConfirm(h: Handlers, repo: Repo, businessDate: string): Promise<Result> {
  const order = await seedOrder(repo, businessDate);
  const t0 = Date.now();
  const CONFIRM_AFTER_MS = 45_000;

  console.log(`\n── slow confirm: 3 copies, DELETE after 45s (${order.orderNumber})`);

  let handovers = 0;
  let token: string | null = null;
  let confirmed = false;

  while (Date.now() - t0 < CONFIRM_AFTER_MS + 12_000) {
    const answer = await poll(h);
    if (answer.jobReady && answer.token === order.orderNumber) {
      handovers++;
      const bytes = await fetchJob(h);
      token = answer.token;
      console.log(
        `   ${elapsed(t0)}  POST -> jobReady:true   GET -> ${bytes} bytes   ` +
          `HAND-OVER #${handovers}`,
      );
    } else if (answer.jobReady) {
      console.log(`   ${elapsed(t0)}  POST -> jobReady:true for ${answer.token} (another order)`);
    }

    if (!confirmed && token && Date.now() - t0 >= CONFIRM_AFTER_MS) {
      const status = await confirm(h, token);
      confirmed = true;
      console.log(`   ${elapsed(t0)}  DELETE code=OK token=${token} -> ${status}`);
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  const final = await repo.getOrderByNumber(TENANT, businessDate, order.orderNumber);
  const passed = handovers === 1 && final?.status === "PRINTED";
  return {
    name: "slow confirm (3 copies, DELETE at 45s)",
    passed,
    detail:
      `${handovers} hand-over(s), final status ${final?.status ?? "?"}, ` +
      `attempts=${final?.printAttempts ?? "?"} — expected 1 and PRINTED`,
  };
}

/**
 * TRUE DEATH — the case the retry exists for.
 *
 * The printer takes the job and never confirms: unplugged, jammed, out of
 * paper. The server must eventually try again, but not before the scaled
 * window has expired.
 *
 * PASS = exactly one hand-over inside the window, a second one after it, and
 * the second no earlier than the window allows.
 */
async function trueDeath(
  h: Handlers,
  repo: Repo,
  businessDate: string,
  windowSeconds: number,
): Promise<Result> {
  const order = await seedOrder(repo, businessDate);
  const t0 = Date.now();
  const RUN_FOR_MS = (windowSeconds + 15) * 1000;

  console.log(
    `\n── true death: 3 copies, no DELETE ever, ${windowSeconds}s window (${order.orderNumber})`,
  );

  const handoverAt: number[] = [];
  while (Date.now() - t0 < RUN_FOR_MS) {
    const answer = await poll(h);
    if (answer.jobReady && answer.token === order.orderNumber) {
      const at = (Date.now() - t0) / 1000;
      handoverAt.push(at);
      const bytes = await fetchJob(h);
      console.log(
        `   ${elapsed(t0)}  POST -> jobReady:true   GET -> ${bytes} bytes   ` +
          `HAND-OVER #${handoverAt.length}`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  const first = handoverAt[0] ?? -1;
  const second = handoverAt[1] ?? -1;
  const gap = second >= 0 && first >= 0 ? second - first : -1;
  // One poll interval of slack: the re-offer can only land on a poll boundary.
  const passed =
    handoverAt.length === 2 && gap >= windowSeconds && gap < windowSeconds + POLL_MS / 1000 + 2;

  return {
    name: `true death (no DELETE, ${windowSeconds}s window)`,
    passed,
    detail:
      `${handoverAt.length} hand-over(s) at ${handoverAt.map((t) => `${t.toFixed(1)}s`).join(", ")}` +
      ` — gap ${gap.toFixed(1)}s, expected 2 hand-overs one window (${windowSeconds}s) apart`,
  };
}

/**
 * THE GUARD HAS TEETH — the pre-fix condition, reproduced on demand.
 *
 * Scenario 1 passing only means something. It means "exactly one hand-over"
 * IF the harness could have observed more than one. So this runs the identical
 * slow print with the confirmation window shrunk below the print time, which is
 * exactly the state the shipped code was in: a flat 60s window against a
 * 3-copy job that takes longer, and a second hand-over allowed with no delay
 * at all.
 *
 * PASS = the failure reproduces. Several hand-overs, several copy-sets. If
 * this ever stops reproducing, scenario 1 has stopped proving anything.
 */
async function guardHasTeeth(h: Handlers, repo: Repo, businessDate: string): Promise<Result> {
  const order = await seedOrder(repo, businessDate);
  const t0 = Date.now();
  const RUN_FOR_MS = 20_000;

  // Shrunk, not disabled: this is the shape of the old configuration, where
  // the window was a constant that did not know how much paper the job was.
  process.env.PRINT_CONFIRM_FLOOR_SECONDS = "2";
  process.env.PRINT_SECONDS_PER_COPY = "0";

  console.log(
    `\n── guard check: same 3-copy print, window shrunk to 2s (${order.orderNumber})`,
  );

  let handovers = 0;
  try {
    while (Date.now() - t0 < RUN_FOR_MS) {
      const answer = await poll(h);
      if (answer.jobReady && answer.token === order.orderNumber) {
        handovers++;
        await fetchJob(h);
        console.log(`   ${elapsed(t0)}  HAND-OVER #${handovers} — a duplicate copy-set`);
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  } finally {
    delete process.env.PRINT_CONFIRM_FLOOR_SECONDS;
    delete process.env.PRINT_SECONDS_PER_COPY;
  }

  return {
    name: "guard check (window below print time -> failure reproduces)",
    passed: handovers >= 3,
    detail:
      `${handovers} hand-over(s) in 20s — expected 3 or more, which is the ` +
      "defect this fix removes; a 1 here would mean scenario 1 proves nothing",
  };
}

/* --------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-print-test-"));

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

  // NOT pg.createDatabase(): initdb takes its encoding from the host locale,
  // which on a US Windows box is WIN1252, and the fixture order is called
  // 宮保雞丁. Created from template0 so a non-default encoding is allowed at
  // all — production is UTF8 and a test that cannot store the menu is testing
  // a different system.
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

  // Every value the route reads, set BEFORE the modules are imported.
  process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`;
  process.env.TENANT_ID = TENANT;
  process.env.CLOUDPRNT_SECRET = SECRET;
  process.env.CLOUDPRNT_PRINTER_MAC = MAC;
  process.env.RESTAURANT_TIMEZONE = "America/Los_Angeles";
  process.env.TENANT_TAX_RATE_BPS = "775";
  process.env.ORDER_NUMBER_PREFIX = "A";
  // The production configuration, unchanged — this test is only meaningful
  // against the numbers that actually ship.
  process.env.TICKET_COPIES = "3";
  delete process.env.PRINT_CONFIRM_FLOOR_SECONDS;
  delete process.env.PRINT_SECONDS_PER_COPY;
  delete process.env.PRINT_OFFER_CAP;

  const { ordersPool } = await import("../src/lib/db/postgres");
  await ordersPool().query(
    await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"),
  );

  const repo = (await import("../src/lib/orders/repository")) as unknown as Repo;
  const { businessDateFor } = await import("../src/lib/orders/businessDate");
  const route = (await import("../src/app/api/print/[secret]/route")) as unknown as Handlers;
  const { confirmationWindowSeconds } = await import("../src/lib/print/entitlement");
  const config = await import("../src/config/tenant.server");

  const copies = config.ticketCopies();
  const windowSeconds = confirmationWindowSeconds(
    copies,
    config.printConfirmFloorSeconds(),
    config.printSecondsPerCopy(),
  );
  console.log(
    `\nconfiguration: copies=${copies}  floor=${config.printConfirmFloorSeconds()}s  ` +
      `per-copy=${config.printSecondsPerCopy()}s  ->  confirmation window ${windowSeconds}s  ` +
      `(delivery cap ${config.printOfferCap()})`,
  );

  const businessDate = businessDateFor("America/Los_Angeles");
  const results: Result[] = [];

  try {
    results.push(await slowConfirm(route, repo, businessDate));
    results.push(await trueDeath(route, repo, businessDate, windowSeconds));
    results.push(await guardHasTeeth(route, repo, businessDate));
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
    console.error(`\n${failed} scenario(s) FAILED`);
    process.exit(1);
  }
  console.log("\none order, one copy-set ✓");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
