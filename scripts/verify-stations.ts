/**
 * Two printers, one system: every ticket comes out of the right printer.
 *
 *   npm run verify:stations
 *
 * The same real-things harness as verify:print-stale-reads: embedded Postgres,
 * the real schema.sql, the real repository and the real CloudPRNT route
 * handlers, with the Hyperdrive cache emulator in front of every query so a
 * plain read is as stale as production can make it. Two MACs poll the same
 * endpoint, exactly as the two TSP143IVUEs will.
 *
 * What must hold:
 *   - the channel decides the station (config/stations.ts), at insert;
 *   - each printer only ever claims, holds or re-offers its own station's
 *     tickets, and the two have a job in flight at the same time;
 *   - every hand-over records the printer that took it;
 *   - printer_status keeps one row per printer, and one printer's paper-out
 *     withholds nothing from the other;
 *   - 重印 with a station moves the ticket to that printer;
 *   - a station with no MAC configured is printed by the other printer;
 *   - an unknown MAC gets nothing and writes nothing;
 *   - the owner alert names the printer that is down.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { installHyperdriveCacheEmulator } from "./lib/hyperdrive-cache-emulator";
import type { OrderChannel } from "../src/lib/orders/types";

const PORT = 55445;
const DB_NAME = "nmc_stations_test";
const SECRET = "verify-stations-secret";
const CRON = "verify-stations-cron";
const MAC_ONLINE = "00:11:62:00:00:0A";
const MAC_STORE = "00:11:62:00:00:0B";
const MAC_STRANGER = "00:11:62:00:00:FF";
const TENANT = "stations-test";
const BASE = `https://example.test/api/print/${SECRET}`;

type Handler = (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
interface Handlers {
  POST: Handler;
  GET: Handler;
  DELETE: Handler;
}
const params = Promise.resolve({ secret: SECRET });

const results: { name: string; passed: boolean; detail?: string }[] = [];
function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "✓" : "✗"} ${name}${!passed && detail ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------------- printer -- */

async function poll(h: Handlers, mac: string, statusCode = "200 OK"): Promise<string | null> {
  const res = await h.POST(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusCode, printerMAC: mac }),
    }),
    { params },
  );
  const body = (await res.json()) as { jobReady?: boolean; jobToken?: string };
  return body.jobReady === true ? (body.jobToken ?? null) : null;
}

async function confirm(h: Handlers, mac: string, token: string): Promise<void> {
  const url = `${BASE}?mac=${encodeURIComponent(mac)}&code=OK&token=${encodeURIComponent(token)}`;
  await h.DELETE(new Request(url, { method: "DELETE" }), { params });
}

/* ------------------------------------------------------------- helpers -- */

type Repo = typeof import("../src/lib/orders/repository");
type Pool = typeof import("../src/lib/db/postgres").ordersPool;

let seq = 0;
async function seed(repo: Repo, channel: OrderChannel): Promise<number> {
  seq++;
  const { order } = await repo.createOrder({
    tenantId: TENANT,
    businessDate: new Date().toISOString().slice(0, 10),
    orderNumberPrefix: "A",
    idempotencyKey: `stations-${seq}-${Date.now()}`,
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
    customer: { name: "Station Test", phone: channel === "web" ? "+16195550000" : "" },
    phoneVerifiedAt: new Date(),
    pickupAt: new Date(Date.now() + 25 * 60_000),
    channel,
  });
  return order.id;
}

async function orderOf(pool: Pool, token: string): Promise<number | null> {
  const { rows } = await pool().query(
    `select order_id from print_deliveries where id = $1 for update`,
    [token],
  );
  return rows.length > 0 ? Number(rows[0].order_id) : null;
}

async function deliveryStation(pool: Pool, token: string): Promise<string | null> {
  const { rows } = await pool().query(
    `select station from print_deliveries where id = $1 for update`,
    [token],
  );
  return rows.length > 0 ? (rows[0].station as string | null) : null;
}

/** Finish everything in flight, so each case starts from an empty queue. */
async function drain(h: Handlers): Promise<void> {
  for (let i = 0; i < 20; i++) {
    let any = false;
    for (const mac of [MAC_ONLINE, MAC_STORE]) {
      const t = await poll(h, mac);
      if (t) {
        any = true;
        await confirm(h, mac, t);
      }
    }
    if (!any) return;
  }
}

/* --------------------------------------------------------------- cases -- */

async function pureIdentity(): Promise<void> {
  console.log("\nidentity: MAC -> station (pure)");
  const { resolvePrinterIdentity, stationCoverage } = await import("../src/lib/print/printerIdentity");
  const { stationForChannel } = await import("../src/config/stations");

  check("web -> online", stationForChannel("web") === "online");
  check("phone, walk_in, dine_in -> store",
    (["phone", "walk_in", "dine_in"] as const).every((c) => stationForChannel(c) === "store"));

  const both = { online: MAC_ONLINE, store: MAC_STORE };
  const a = resolvePrinterIdentity("00-11-62-00-00-0a", both);
  check("online MAC, any spelling, is the online printer serving only online",
    a?.station === "online" && a.serves.join() === "online");
  const b = resolvePrinterIdentity(MAC_STORE, both);
  check("store MAC is the store printer serving only store",
    b?.station === "store" && b.serves.join() === "store");
  check("an unknown MAC is nobody", resolvePrinterIdentity(MAC_STRANGER, both) === null);
  check("no MAC on the request is nobody once MACs are pinned", resolvePrinterIdentity(null, both) === null);

  const onlyOnline = resolvePrinterIdentity(MAC_ONLINE, { online: MAC_ONLINE });
  check("store MAC unset: the online printer serves both",
    onlyOnline?.serves.join() === "online,store");
  const unpinned = resolvePrinterIdentity(MAC_STRANGER, {});
  check("nothing pinned: any printer is online and serves both (today's behaviour)",
    unpinned?.station === "online" && unpinned.serves.length === 2);
  const cov = stationCoverage({ online: MAC_ONLINE });
  check("coverage: store is printed by online while it has no MAC", cov.store === "online" && cov.online === "online");
}

async function routing(h: Handlers, repo: Repo, pool: Pool): Promise<void> {
  console.log("\nrouting: each printer takes only its own station");
  const web = await seed(repo, "web");
  const phone = await seed(repo, "phone");
  const dine = await seed(repo, "dine_in");

  const webOrder = await repo.getOrderById(TENANT, web);
  const phoneOrder = await repo.getOrderById(TENANT, phone);
  check("a web order is stored on the online station", webOrder?.station === "online");
  check("a phone order is stored on the store station", phoneOrder?.station === "store");

  // Store polls FIRST, though the web order is older: it must skip it.
  const storeToken = await poll(h, MAC_STORE);
  const storeGot = storeToken ? await orderOf(pool, storeToken) : null;
  check("the store printer is handed the phone order, not the older web order", storeGot === phone,
    `got order ${storeGot}`);

  const onlineToken = await poll(h, MAC_ONLINE);
  const onlineGot = onlineToken ? await orderOf(pool, onlineToken) : null;
  check("the online printer is handed the web order while the store's is still in flight", onlineGot === web,
    `got order ${onlineGot}`);

  check("each hand-over records its printer",
    (await deliveryStation(pool, storeToken!)) === "store" &&
      (await deliveryStation(pool, onlineToken!)) === "online");

  // The online printer polling again must HOLD its own job, never take the
  // dine-in order queued for the store.
  const again = await poll(h, MAC_ONLINE);
  check("the online printer holds its own job; it never reaches into the store queue", again === null);

  await confirm(h, MAC_STORE, storeToken!);
  const storeNext = await poll(h, MAC_STORE);
  const storeNextGot = storeNext ? await orderOf(pool, storeNext) : null;
  check("after confirming, the store printer moves on to the dine-in order", storeNextGot === dine);
  await confirm(h, MAC_STORE, storeNext!);
  await confirm(h, MAC_ONLINE, onlineToken!);

  const done = await Promise.all([web, phone, dine].map((id) => repo.getOrderById(TENANT, id)));
  check("all three PRINTED", done.every((o) => o?.status === "PRINTED"));

  const { rows } = await pool().query(
    `select station, printer_mac from printer_status where tenant_id = $1 order by station for update`,
    [TENANT],
  );
  check("printer_status holds one row per printer, with its MAC",
    rows.length === 2 &&
      rows[0].station === "online" && rows[0].printer_mac === "00116200000a" &&
      rows[1].station === "store" && rows[1].printer_mac === "00116200000b",
    JSON.stringify(rows));
}

async function paperOutIsPerPrinter(h: Handlers, repo: Repo): Promise<void> {
  console.log("\nhealth: one printer's paper-out withholds nothing from the other");
  const web = await seed(repo, "web");
  const walkIn = await seed(repo, "walk_in");

  const store = await poll(h, MAC_STORE, "503 Paper Empty");
  check("the store printer, out of paper, is offered nothing", store === null);
  const online = await poll(h, MAC_ONLINE);
  check("the online printer still prints", online !== null);
  await confirm(h, MAC_ONLINE, online!);

  const { stationPrinterHealth } = await import("../src/lib/print/boardPrinters");
  const strip = await stationPrinterHealth(TENANT);
  const s = strip.find((p) => p.station === "store");
  const o = strip.find((p) => p.station === "online");
  check("the board strip shows the store printer out of paper with its ticket waiting",
    s?.health === "paper-out" && s.queued === 1 && s.blocked, JSON.stringify(s));
  check("and the online printer fine", o?.health === "ok" && !o.blocked, JSON.stringify(o));

  const back = await poll(h, MAC_STORE, "200 OK");
  check("paper back: the walk-in prints on the store printer", back !== null);
  await confirm(h, MAC_STORE, back!);
  const w = await repo.getOrderById(TENANT, walkIn);
  const x = await repo.getOrderById(TENANT, web);
  check("both PRINTED", w?.status === "PRINTED" && x?.status === "PRINTED");
}

async function reprintToStation(h: Handlers, repo: Repo, pool: Pool): Promise<void> {
  console.log("\nreprint: staff pick the printer");
  const web = await seed(repo, "web");
  const t = await poll(h, MAC_ONLINE);
  await confirm(h, MAC_ONLINE, t!);

  const moved = await repo.requeueForPrint(TENANT, web, "kitchen", "store");
  check("重印 to the store printer moves the order to the store station", moved?.station === "store");

  const fromOnline = await poll(h, MAC_ONLINE);
  check("the online printer does not take it back", fromOnline === null);
  const fromStore = await poll(h, MAC_STORE);
  check("the store printer prints it", fromStore !== null && (await orderOf(pool, fromStore)) === web);
  check("and the hand-over says store", (await deliveryStation(pool, fromStore!)) === "store");
  await confirm(h, MAC_STORE, fromStore!);

  const { rows } = await pool().query(
    `select station from print_deliveries where order_id = $1 and reason = 'manual_reprint' for update`,
    [web],
  );
  check("the reprint marker records the station picked", rows.length === 1 && rows[0].station === "store");

  const same = await repo.requeueForPrint(TENANT, web, "kitchen");
  check("重印 without a station keeps the current one", same?.station === "store");
  await drain(h);
}

async function strangerAndCoverage(h: Handlers, repo: Repo, pool: Pool): Promise<void> {
  console.log("\nidentity on the wire");
  const phone = await seed(repo, "phone");
  const stranger = await poll(h, MAC_STRANGER);
  const { rows } = await pool().query(
    `select count(*)::int as n from (select 1 from printer_status where tenant_id = $1 for update) r`,
    [TENANT],
  );
  check("an unknown MAC is handed nothing and writes no health row", stranger === null && rows[0].n === 2);

  // The store printer's MAC is unset (unit pulled for a swap): its tickets
  // must still come out somewhere.
  process.env.CLOUDPRNT_PRINTER_MAC_STORE = "";
  const covered = await poll(h, MAC_ONLINE);
  check("with no store MAC configured, the online printer prints the store's ticket",
    covered !== null && (await orderOf(pool, covered)) === phone);
  check("and the hand-over records the printer that actually took it",
    (await deliveryStation(pool, covered!)) === "online");
  await confirm(h, MAC_ONLINE, covered!);
  const { stationPrinterHealth } = await import("../src/lib/print/boardPrinters");
  const strip = await stationPrinterHealth(TENANT);
  check("the strip says the store station is printed by the online printer",
    strip.find((p) => p.station === "store")?.printedBy === "online");
  process.env.CLOUDPRNT_PRINTER_MAC_STORE = MAC_STORE;
}

async function alertNamesTheStation(h: Handlers, repo: Repo, pool: Pool): Promise<void> {
  console.log("\nalerts: per printer, naming the station");
  await seed(repo, "dine_in");
  // The store printer went silent ten minutes ago with a ticket behind it.
  await pool().query(
    `update printer_status set last_seen_at = now() - interval '10 minutes'
      where tenant_id = $1 and station = 'store'`,
    [TENANT],
  );
  await poll(h, MAC_ONLINE); // the online printer is alive and idle
  const cron = (await import("../src/app/api/cron/unprinted-alert/route")) as unknown as {
    GET: (r: Request) => Promise<Response>;
  };
  const res = await cron.GET(
    new Request("https://example.test/api/cron/unprinted-alert", {
      headers: { authorization: `Bearer ${CRON}` },
    }),
  );
  const body = (await res.json()) as { printer?: { station: string; condition: string; queued: number }[] };
  const alerts = body.printer ?? [];
  check("exactly one printer alert, for the store printer, offline with its ticket waiting",
    alerts.length === 1 && alerts[0].station === "store" &&
      alerts[0].condition.startsWith("offline") && alerts[0].queued === 1,
    JSON.stringify(alerts));

  // Paper-low on the online printer for over two minutes: a heads-up even
  // with nothing queued.
  await poll(h, MAC_ONLINE, "200 Paper Near End");
  await pool().query(
    `update printer_status set paper_low_since = now() - interval '3 minutes'
      where tenant_id = $1 and station = 'online'`,
    [TENANT],
  );
  const res2 = await cron.GET(
    new Request("https://example.test/api/cron/unprinted-alert", {
      headers: { authorization: `Bearer ${CRON}` },
    }),
  );
  const body2 = (await res2.json()) as { printer?: { station: string; condition: string }[] };
  check("paper-low raises an alert for the online printer by name",
    (body2.printer ?? []).some((a) => a.station === "online" && a.condition === "low on paper"),
    JSON.stringify(body2.printer));
}

/* ---------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-stations-"));
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

  const admin = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${DB_NAME} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();

  process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`;
  process.env.TENANT_ID = TENANT;
  process.env.CLOUDPRNT_SECRET = SECRET;
  delete process.env.CLOUDPRNT_PRINTER_MAC;
  process.env.CLOUDPRNT_PRINTER_MAC_ONLINE = MAC_ONLINE;
  process.env.CLOUDPRNT_PRINTER_MAC_STORE = MAC_STORE;
  process.env.CRON_SECRET = CRON;
  delete process.env.OWNER_ALERT_PHONE;
  process.env.RESTAURANT_TIMEZONE = "America/Los_Angeles";
  process.env.TENANT_TAX_RATE_BPS = "875";
  process.env.ORDER_NUMBER_PREFIX = "A";
  process.env.TICKET_COPIES = "3";
  process.env.PRINT_CONFIRM_FLOOR_SECONDS = "60";
  process.env.PRINT_SECONDS_PER_COPY = "30";
  process.env.PRINT_OFFER_CAP = "4";
  delete process.env.PRINT_CONFIRM_TEST_DELAY_MS;
  delete process.env.PRINT_FETCH_VIA_WORKER;

  const { ordersPool, closeOrdersPool } = await import("../src/lib/db/postgres");
  await ordersPool().query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));

  const repo = await import("../src/lib/orders/repository");
  const route = (await import("../src/app/api/print/[secret]/route")) as unknown as Handlers;
  const cache = installHyperdriveCacheEmulator(60_000);

  try {
    await pureIdentity();
    await routing(route, repo, ordersPool);
    await paperOutIsPerPrinter(route, repo);
    await reprintToStation(route, repo, ordersPool);
    await strangerAndCoverage(route, repo, ordersPool);
    await alertNamesTheStation(route, repo, ordersPool);
  } finally {
    cache.uninstall();
    await closeOrdersPool();
    console.log("\nstopping postgres…");
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\nstations: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.error("\nFAILED:");
    for (const f of failed) console.error(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exit(1);
  }
  console.log("\nevery ticket comes out of the right printer ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
