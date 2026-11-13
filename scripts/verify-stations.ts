/**
 * Two printers, one system: every ticket comes out of the right printer.
 *
 *   npm run verify:stations
 *
 * The same real-things harness as verify:print-stale-reads: embedded Postgres,
 * the real schema.sql, the real repository and the real CloudPRNT route
 * handlers, with ordinary reads and Hyperdrive caching disabled. Two MACs
 * poll the same endpoint, exactly as the two TSP143IVUEs will. The stale-read
 * verifier separately enables its cache emulator to check the warning.
 *
 * What must hold:
 *   - the channel decides the station (config/stations.ts), at insert;
 *   - each printer only ever claims, holds or re-offers its own station's
 *     tickets, and the two have a job in flight at the same time;
 *   - every hand-over records the printer that took it;
 *   - printer_station_status keeps one row per printer, and one printer's paper-out
 *     withholds nothing from the other;
 *   - 重印 with a station prints a copy on that printer and never moves the
 *     order: status and station stay as they were;
 *   - a station with no MAC configured is printed by the other printer;
 *   - an unknown MAC gets nothing and writes nothing;
 *   - the owner alert names the printer that is down.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
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
    `select station, printer_mac from printer_station_status where tenant_id = $1 order by station for update`,
    [TENANT],
  );
  check("printer_station_status holds one row per printer, with its MAC",
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
  console.log("\nreprint: staff pick the printer; the order does not move");
  const web = await seed(repo, "web");
  const t = await poll(h, MAC_ONLINE);
  await confirm(h, MAC_ONLINE, t!);

  const asked = await repo.requestReprint(TENANT, web, "kitchen", "store");
  check("重印 to the store printer leaves the order on the online station",
    asked?.station === "online" && asked.reprintPending, JSON.stringify({ station: asked?.station, pending: asked?.reprintPending }));

  const fromOnline = await poll(h, MAC_ONLINE);
  check("the online printer does not take the copy meant for the store", fromOnline === null);
  const fromStore = await poll(h, MAC_STORE);
  check("the store printer prints it", fromStore !== null && (await orderOf(pool, fromStore)) === web);
  check("and the hand-over says store", (await deliveryStation(pool, fromStore!)) === "store");
  await confirm(h, MAC_STORE, fromStore!);

  const { rows } = await pool().query(
    `select station from print_deliveries where order_id = $1 and reason = 'manual_reprint' for update`,
    [web],
  );
  check("the reprint marker records the station picked", rows.length === 1 && rows[0].station === "store");
  const after = await repo.getOrderById(TENANT, web);
  check("after the copy prints: still PRINTED, still online, nothing pending",
    after?.status === "PRINTED" && after.station === "online" && !after.reprintPending);

  const same = await repo.requestReprint(TENANT, web, "kitchen");
  check("重印 without a station goes to the order's own printer", same?.station === "online");
  const back = await poll(h, MAC_ONLINE);
  check("which prints it", back !== null && (await orderOf(pool, back)) === web);
  await confirm(h, MAC_ONLINE, back!);
  await drain(h);
}

/**
 * The reported bug: 重印 on an ACCEPTED order set it back to QUEUED, so the
 * card jumped back to "new" on every tablet. A reprint now writes exactly one
 * manual_reprint row and never touches status, before or after the copy prints.
 */
async function reprintKeepsStatus(h: Handlers, repo: Repo, pool: Pool): Promise<void> {
  console.log("\nreprint: an ACCEPTED order stays ACCEPTED");
  const id = await seed(repo, "phone");
  const t = await poll(h, MAC_STORE);
  await confirm(h, MAC_STORE, t!);
  await repo.updateStatus(TENANT, id, "ACCEPTED");

  const count = async () => {
    const { rows } = await pool().query(
      `select count(*)::int as n from (select 1 from print_deliveries where order_id = $1 for update) d`,
      [id],
    );
    return Number(rows[0].n);
  };
  const before = await count();
  const asked = await repo.requestReprint(TENANT, id, "kitchen", "store");
  const statusRow = async () => {
    const { rows } = await pool().query(`select status from orders where id = $1 for update`, [id]);
    return String(rows[0].status);
  };
  check("right after 重印: status still ACCEPTED", asked?.status === "ACCEPTED" && (await statusRow()) === "ACCEPTED");
  const { rows: added } = await pool().query(
    `select reason, station, actor from print_deliveries where order_id = $1 order by offered_at desc limit 1 for update`,
    [id],
  );
  check("exactly one new delivery row: manual_reprint, station store, actor kitchen",
    (await count()) === before + 1 &&
      added[0].reason === "manual_reprint" && added[0].station === "store" && added[0].actor === "kitchen",
    JSON.stringify(added[0]));

  // A double tap before the printer collects it adds nothing.
  await repo.requestReprint(TENANT, id, "kitchen", "store");
  check("a second tap before the printer collects it adds no row", (await count()) === before + 1);

  const board = (await repo.listActiveOrders(TENANT, new Date().toISOString().slice(0, 10))).find((o) => o.id === id);
  check("the board still lists it as ACCEPTED", board?.status === "ACCEPTED");

  const copy = await poll(h, MAC_STORE);
  check("the store printer collects the copy", copy !== null && (await orderOf(pool, copy)) === id);
  await confirm(h, MAC_STORE, copy!);
  const done = await repo.getOrderById(TENANT, id);
  check("after the copy prints: still ACCEPTED, nothing pending",
    done?.status === "ACCEPTED" && !done.reprintPending, `status=${done?.status}`);
  check("and the printer is not offered it again", (await poll(h, MAC_STORE)) === null);
}

async function strangerAndCoverage(h: Handlers, repo: Repo, pool: Pool): Promise<void> {
  console.log("\nidentity on the wire");
  const phone = await seed(repo, "phone");
  const stranger = await poll(h, MAC_STRANGER);
  const { rows } = await pool().query(
    `select count(*)::int as n from (select 1 from printer_station_status where tenant_id = $1 for update) r`,
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
  const storeChip = strip.find((p) => p.station === "store");
  check("the strip says the store station is printed by the online printer",
    storeChip?.printedBy === "online");
  check("and calls the store station \"not set up\": unconfigured, never offline, not blocked",
    storeChip?.health === "not-set-up" && storeChip.configured === false && !storeChip.blocked,
    JSON.stringify(storeChip));

  // Its old health row says it went silent ten minutes ago, with a ticket
  // queued for the store: still no alert, because there is no store printer.
  await seed(repo, "walk_in");
  await pool().query(
    `update printer_station_status set last_seen_at = now() - interval '10 minutes', paper_out = true,
            blocked_since = now() - interval '10 minutes'
      where tenant_id = $1 and station = 'store'`,
    [TENANT],
  );
  const cron = (await import("../src/app/api/cron/unprinted-alert/route")) as unknown as {
    GET: (r: Request) => Promise<Response>;
  };
  const swept = (await (
    await cron.GET(
      new Request("https://example.test/api/cron/unprinted-alert", {
        headers: { authorization: `Bearer ${CRON}` },
      }),
    )
  ).json()) as { printer?: { station: string }[] };
  check("an unconfigured station is never alerted about (offline, paper or cover)",
    !(swept.printer ?? []).some((a) => a.station === "store"), JSON.stringify(swept.printer));
  await drain(h);
  process.env.CLOUDPRNT_PRINTER_MAC_STORE = MAC_STORE;
  await poll(h, MAC_STORE); // back to a fresh, healthy row
}

async function alertNamesTheStation(h: Handlers, repo: Repo, pool: Pool): Promise<void> {
  console.log("\nalerts: per printer, naming the station");
  // Failover off: with it on, the live online printer would (rightly) take
  // the silent store printer's ticket, and there would be nothing waiting to
  // alert about. That case is timedFailover's.
  process.env.PRINT_FAILOVER_AFTER_SECONDS = "0";
  await seed(repo, "dine_in");
  // The store printer went silent ten minutes ago with a ticket behind it.
  await pool().query(
    `update printer_station_status set last_seen_at = now() - interval '10 minutes'
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
    `update printer_station_status set paper_low_since = now() - interval '3 minutes'
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

/**
 * TIMED FAILOVER (PRINT_FAILOVER_AFTER_SECONDS, default 90). The store printer
 * has a MAC and has gone silent: the online printer takes the store's new
 * tickets, the order and the hand-over record the printer that printed them,
 * the ticket says REROUTED FROM STORE, and the owner gets one text when it
 * starts and one when the store printer is back, not one per ticket.
 */
async function timedFailover(h: Handlers, repo: Repo, pool: Pool): Promise<void> {
  console.log("\nfailover: a silent store printer's tickets print on the online printer");
  await drain(h);
  const { printFailoverAfterSeconds, failoverStations } = await import("../src/config/stations");
  check("default window is 90s; 0 disables; junk falls back to 90",
    printFailoverAfterSeconds(undefined) === 90 && printFailoverAfterSeconds("0") === 0 &&
      printFailoverAfterSeconds("abc") === 90 && printFailoverAfterSeconds("120") === 120);
  check("rule: only a configured station that polled before and went silent past the window",
    failoverStations({ printer: "online", configured: ["online", "store"], silentSeconds: { store: 91 }, windowSeconds: 90 }).join() === "store" &&
      failoverStations({ printer: "online", configured: ["online", "store"], silentSeconds: { store: 89 }, windowSeconds: 90 }).length === 0 &&
      failoverStations({ printer: "online", configured: ["online", "store"], silentSeconds: {}, windowSeconds: 90 }).length === 0 &&
      failoverStations({ printer: "online", configured: ["online"], silentSeconds: { store: 500 }, windowSeconds: 90 }).length === 0 &&
      failoverStations({ printer: "online", configured: ["online", "store"], silentSeconds: { store: 500 }, windowSeconds: 0 }).length === 0);

  // Count owner texts without sending any: Twilio's endpoint is stubbed.
  const texts: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.twilio.com")) {
      texts.push(new URLSearchParams(String(init?.body ?? "")).get("Body") ?? "");
      return new Response(JSON.stringify({ sid: "SMxxxx" }), { status: 201, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  Object.assign(process.env, {
    OWNER_ALERT_PHONE: "+16195550199",
    TWILIO_ACCOUNT_SID: "ACverifystations",
    TWILIO_AUTH_TOKEN: "verify-stations-token",
    TWILIO_VERIFY_SERVICE_SID: "VAverifystations",
    TWILIO_MESSAGING_FROM: "+16195550100",
  });
  const cron = (await import("../src/app/api/cron/unprinted-alert/route")) as unknown as {
    GET: (r: Request) => Promise<Response>;
  };
  const sweep = async () =>
    (await (
      await cron.GET(new Request("https://example.test/api/cron/unprinted-alert", { headers: { authorization: `Bearer ${CRON}` } }))
    ).json()) as { failover?: { station: string; phase: string; sent: boolean }[] };

  try {
    process.env.PRINT_FAILOVER_AFTER_SECONDS = "90";
    await drain(h); // both printers fresh, nothing in flight

    // Store printer silent for 60s: inside the window, nothing moves.
    await pool().query(
      `update printer_station_status set last_seen_at = now() - interval '60 seconds' where tenant_id = $1 and station = 'store'`,
      [TENANT],
    );
    const early = await seed(repo, "phone");
    check("60s of silence (inside the window): the online printer does not take the store's ticket",
      (await poll(h, MAC_ONLINE)) === null);

    // Silent for two minutes: past the window.
    await pool().query(
      `update printer_station_status set last_seen_at = now() - interval '2 minutes' where tenant_id = $1 and station = 'store'`,
      [TENANT],
    );
    const t1 = await poll(h, MAC_ONLINE);
    check("past the window, the online printer takes the store's ticket", t1 !== null && (await orderOf(pool, t1)) === early);
    const o1 = await repo.getOrderById(TENANT, early);
    check("the order records the printer that printed it, and where it was meant to go",
      o1?.station === "online" && o1.reroutedFrom === "store", JSON.stringify({ station: o1?.station, from: o1?.reroutedFrom }));
    check("and so does the hand-over", (await deliveryStation(pool, t1!)) === "online");
    await confirm(h, MAC_ONLINE, t1!);

    // The ticket body says so, on one line.
    const { renderTicketJob } = await import("../src/lib/ticket/render");
    const { TICKET_LABELS } = await import("../src/lib/ticket/glyphs");
    check("ticket label is 轉自 + 店內 / 網上",
      TICKET_LABELS.reroutedFrom === "轉自" && TICKET_LABELS.stationStore === "店內" && TICKET_LABELS.stationOnline === "網上");
    const plain = await renderTicketJob({ ...o1!, reroutedFrom: null }, { timezone: "America/Los_Angeles", copies: 1 }, { format: "png" });
    const marked = await renderTicketJob(o1!, { timezone: "America/Los_Angeles", copies: 1 }, { format: "png" });
    check("a rerouted ticket renders one extra header line (taller by one line)",
      marked.totalHeight > plain.totalHeight && marked.totalHeight - plain.totalHeight < 80,
      `${plain.totalHeight} -> ${marked.totalHeight}`);

    const second = await seed(repo, "walk_in");
    const t2 = await poll(h, MAC_ONLINE);
    check("a second store ticket is rerouted too", t2 !== null && (await orderOf(pool, t2)) === second);
    await confirm(h, MAC_ONLINE, t2!);

    const strip = (await (await import("../src/lib/print/boardPrinters")).stationPrinterHealth(TENANT)).find((p) => p.station === "store");
    check("the board says the store's tickets are printing on the online printer", strip?.failoverTo === "online", JSON.stringify(strip));

    const s1 = await sweep();
    const s2 = await sweep();
    check("ONE owner text when failover starts, however many tickets and sweeps",
      texts.length === 1 && /REROUTED FROM STORE/.test(texts[0]) &&
        (s1.failover ?? []).filter((f) => f.sent).length === 1 &&
        (s2.failover ?? []).filter((f) => f.sent).length === 0,
      JSON.stringify({ texts, s1: s1.failover, s2: s2.failover }));

    // The store printer comes back.
    await poll(h, MAC_STORE);
    const after = await seed(repo, "phone");
    const own = await poll(h, MAC_STORE);
    check("once it polls again, the store printer takes its own tickets", own !== null && (await orderOf(pool, own)) === after);
    await confirm(h, MAC_STORE, own!);
    const o3 = await repo.getOrderById(TENANT, after);
    check("not rerouted", o3?.station === "store" && o3.reroutedFrom === null);
    await sweep();
    await sweep();
    check("ONE owner text when it is back", texts.length === 2 && /is back/.test(texts[1]), JSON.stringify(texts));

    // 0 disables: silence never moves a ticket.
    process.env.PRINT_FAILOVER_AFTER_SECONDS = "0";
    await pool().query(
      `update printer_station_status set last_seen_at = now() - interval '10 minutes' where tenant_id = $1 and station = 'store'`,
      [TENANT],
    );
    await seed(repo, "phone");
    check("PRINT_FAILOVER_AFTER_SECONDS=0: the online printer never takes it", (await poll(h, MAC_ONLINE)) === null);
    check("and no failover was stamped",
      (await pool().query(`select failover_since from printer_station_status where tenant_id = $1 and station = 'store' for update`, [TENANT])).rows[0].failover_since === null);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ["OWNER_ALERT_PHONE", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID", "TWILIO_MESSAGING_FROM"]) {
      delete process.env[k];
    }
    delete process.env.PRINT_FAILOVER_AFTER_SECONDS;
    await poll(h, MAC_STORE);
    await drain(h);
  }
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

  try {
    await pureIdentity();
    await routing(route, repo, ordersPool);
    await paperOutIsPerPrinter(route, repo);
    await reprintToStation(route, repo, ordersPool);
    await reprintKeepsStatus(route, repo, ordersPool);
    await strangerAndCoverage(route, repo, ordersPool);
    await alertNamesTheStation(route, repo, ordersPool);
    delete process.env.PRINT_FAILOVER_AFTER_SECONDS;
    await timedFailover(route, repo, ordersPool);
  } finally {
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
