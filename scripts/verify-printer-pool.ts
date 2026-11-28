/**
 * 印表機 PRINTER POOL: two printers, one queue (docs/printer-pool.md).
 *
 *   npm run verify:printer-pool
 *
 * Real things: an embedded Postgres with the real schema, and the REAL print
 * route (POST poll, GET job by token, DELETE confirm) driven by two simulated
 * printers, each polling on its own loop with jitter, exactly as a TSP143
 * does, on a compressed clock (PRINT_POOL_INTERVAL_MS=200 instead of 3000;
 * the confirmation window and failover are shrunk the same way).
 *
 *   1. both healthy, 200 tickets in singles and bursts: every ticket printed
 *      exactly once; the split within 45/55; every time an idle, healthy
 *      printer is told "no job" while a ticket waits (the alternation
 *      deferring), that ticket is claimed within one poll interval
 *   2. store printer out of paper: online prints 100%, store 0%
 *   3. a printer claims a ticket and dies before fetching it: the other
 *      prints it once its window runs out, no 轉自, exactly once
 *   4. a printer fetches a ticket and dies before confirming: the other
 *      waits for timed failover, then prints it with 轉自 REROUTED FROM
 *   5. the dead printer comes back: at most one job per poll, no flood,
 *      nothing printed twice
 *   6. 重印 and 改單 go to the printer that printed the original while it is
 *      healthy, and to the other when it is out of paper
 *   7. a 日結 report goes through the pool: no printer picked, stamped with
 *      the printer that printed it
 *
 * ⚠️ WINDOWS: run from a NON-ELEVATED shell (see verify:print-recurrence).
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const PORT = 55461;
const DB = "nmc_printer_pool";
const TENANT = "printer-pool";
const PASSWORD = "verify-printer-pool-password";
const BYPASS = "verify-printer-pool-bypass";
const SECRET = "verify-printer-pool-print";
const TIMEZONE = "America/Los_Angeles";
const INTERVAL_MS = 200;
const MAC: Record<Station, string> = { online: "00:11:62:00:00:2A", store: "00:11:62:00:00:2B" };
const BASE = `https://example.test/api/print/${SECRET}`;

type Station = "online" | "store";

let failures = 0;
let passes = 0;
function check(name: string, passed: boolean, detail = ""): void {
  if (passed) passes++;
  else failures++;
  console.log(`   ${passed ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PrintRoute = {
  POST: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
  GET: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
  DELETE: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
};
type Handler = (r: Request, ctx?: unknown) => Promise<Response>;

let db: Client;
let route: PrintRoute;
let repo: typeof import("../src/lib/orders/repository");
let edit: { POST: Handler };
/**
 * The print route's per-IP limiter (120 a minute) is sized for a printer
 * polling every 3 s; this run polls every 200 ms, so it is cleared before
 * each simulated request. It is not what is under test here.
 */
let resetLimits: () => void = () => {};
let cookie = "";
let businessDate = "";
let seq = 0;
const params = Promise.resolve({ secret: SECRET });

const LINE = {
  itemId: "egg-rolls", nameEn: "Egg Rolls (2)", nameZh: "春卷（2條）", sizeId: "regular", sizeLabel: "Regular",
  sizeLabelZh: "例", modifiers: [], quantity: 1, unitCents: 350, lineCents: 350,
};

/** One QUEUED ticket, created now. Channels mixed: web, phone, walk-in. */
async function addTicket(): Promise<number> {
  seq++;
  const channel = seq % 3 === 0 ? "web" : seq % 3 === 1 ? "phone" : "walk_in";
  const { rows } = await db.query(
    `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
                         customer, phone_verified_at, pickup_at, channel, print_station)
     values ($1, $2, $3::date, 'QUEUED', $4, $5, $6, $7, now(), now() + interval '20 minutes', $8, $9)
     returning id`,
    [
      TENANT,
      `${channel === "web" ? "A" : "B"}-${String(seq).padStart(4, "0")}`,
      businessDate,
      `pool-${seq}`,
      JSON.stringify([LINE]),
      JSON.stringify({ subtotalCents: 350, taxCents: 31, tipCents: 0, totalCents: 381 }),
      JSON.stringify({ name: `Guest ${seq}`, phone: "+16195550142" }),
      channel,
      channel === "web" ? "online" : "store",
    ],
  );
  return Number(rows[0].id);
}

/* ------------------------------------------------------------- printers -- */

type Behaviour = "normal" | "claim-no-fetch" | "fetch-no-confirm";

interface PollRecord {
  station: Station;
  /** Database clock, ms. */
  at: number;
  job: boolean;
  /** The oldest unclaimed ticket right after a no-job poll, if any. */
  waiting: number | null;
}

class SimPrinter {
  status = "200 OK";
  behaviour: Behaviour = "normal";
  running = false;
  dead = false;
  /** Tokens this printer was handed, in order. */
  handed: string[] = [];
  /** How many jobs each poll answered with (always 0 or 1 on the wire). */
  jobsPerPoll: number[] = [];
  private loop: Promise<void> | null = null;

  constructor(readonly station: Station, readonly polls: PollRecord[]) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.dead = false;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  /** Stop polling at once, holding whatever it holds: a printer pulled from the wall. */
  async die(): Promise<void> {
    this.dead = true;
    await this.stop();
  }

  private async run(): Promise<void> {
    while (this.running) {
      await this.pollOnce();
      // ±10% jitter, as two real printers never poll in step.
      await sleep(INTERVAL_MS * (0.9 + Math.random() * 0.2));
    }
  }

  async pollOnce(): Promise<string | null> {
    resetLimits();
    const res = await route.POST(
      new Request(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statusCode: this.status, printerMAC: MAC[this.station] }),
      }),
      { params },
    );
    const body = (await res.json()) as { jobReady?: boolean; jobToken?: string };
    const token = body.jobReady ? body.jobToken ?? null : null;
    this.jobsPerPoll.push(token ? 1 : 0);
    const healthy = this.status.startsWith("2");
    // After a no-job answer to an idle, healthy printer: is a ticket waiting?
    let waiting: number | null = null;
    const { rows } = await db.query(
      `select extract(epoch from now()) * 1000 as at,
              (select id from orders where tenant_id = $1 and status = 'QUEUED' and print_attempts = 0
                 and reprint_delivery_id is null and change_ticket_id is null
               order by created_at asc limit 1) as waiting`,
      [TENANT],
    );
    if (!token && healthy && rows[0].waiting !== null) waiting = Number(rows[0].waiting);
    this.polls.push({ station: this.station, at: Number(rows[0].at), job: token !== null, waiting });
    if (!token) return null;
    this.handed.push(token);
    if (this.dead || this.behaviour === "claim-no-fetch") return token;
    const q = `token=${encodeURIComponent(token)}&mac=${encodeURIComponent(MAC[this.station])}`;
    resetLimits();
    await (await route.GET(new Request(`${BASE}?${q}&type=application/vnd.star.starprnt`), { params })).arrayBuffer();
    if (this.behaviour === "fetch-no-confirm") return token;
    // The paper takes a moment to come out.
    await sleep(INTERVAL_MS / 2);
    resetLimits();
    const del = await route.DELETE(new Request(`${BASE}?${q}&code=OK`, { method: "DELETE" }), { params });
    if (del.status !== 200) console.log(`   [sim ${this.station}] DELETE ${token} answered ${del.status}: ${await del.text()}`);
    return token;
  }
}

/* -------------------------------------------------------------- queries -- */

async function reset(): Promise<void> {
  await db.query(`delete from print_deliveries where tenant_id = $1`, [TENANT]);
  await db.query(`delete from report_prints where tenant_id = $1`, [TENANT]);
  await db.query(`delete from order_change_tickets where tenant_id = $1`, [TENANT]);
  await db.query(`delete from order_revisions where tenant_id = $1`, [TENANT]);
  await db.query(`delete from orders where tenant_id = $1`, [TENANT]);
  await db.query(`delete from printer_station_status where tenant_id = $1`, [TENANT]);
}

async function waitFor(what: string, fn: () => Promise<boolean>, timeoutMs = 20_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(50);
  }
  console.log(`   … gave up waiting for ${what}`);
  const { rows } = await db.query(
    `select pid, state, wait_event_type, wait_event, left(regexp_replace(query, '\\s+', ' ', 'g'), 140) as q
       from pg_stat_activity where datname = $1 and pid <> pg_backend_pid() and state <> 'idle'`,
    [DB],
  );
  for (const r of rows) console.log(`     pg ${r.pid} ${r.state} ${r.wait_event_type ?? ""}/${r.wait_event ?? ""}: ${r.q}`);
  return false;
}

async function allPrinted(ids: number[]): Promise<boolean> {
  const { rows } = await db.query(
    `select count(*)::int as n from orders where tenant_id = $1 and id = any($2::bigint[]) and status = 'PRINTED'`,
    [TENANT, ids],
  );
  return rows[0].n === ids.length;
}

/** Confirmed hand-overs per order (first ticket only, not 重印 / 改單). */
async function confirmedByOrder(ids: number[]): Promise<Map<number, { station: Station; reason: string }[]>> {
  const { rows } = await db.query(
    `select order_id, station, reason from print_deliveries
      where tenant_id = $1 and order_id = any($2::bigint[]) and confirmed_at is not null
        and reason in ('first-offer', 'retry') and change_ticket_id is null`,
    [TENANT, ids],
  );
  const out = new Map<number, { station: Station; reason: string }[]>();
  for (const id of ids) out.set(id, []);
  for (const r of rows) out.get(Number(r.order_id))!.push({ station: r.station, reason: r.reason });
  return out;
}

/** When each order was first handed to a printer (database clock, ms). */
async function firstClaims(ids: number[]): Promise<Map<number, number>> {
  const { rows } = await db.query(
    `select order_id, min(extract(epoch from offered_at) * 1000) as at from print_deliveries
      where tenant_id = $1 and order_id = any($2::bigint[]) group by order_id`,
    [TENANT, ids],
  );
  return new Map(rows.map((r) => [Number(r.order_id), Number(r.at)]));
}

async function printedOnce(label: string, ids: number[]): Promise<Map<number, { station: Station; reason: string }[]>> {
  const byOrder = await confirmedByOrder(ids);
  const twice = [...byOrder].filter(([, d]) => d.length !== 1).map(([id, d]) => `${id}:${d.length}`);
  check(`${label}: every ticket printed exactly once`, twice.length === 0, twice.slice(0, 5).join(", "));
  return byOrder;
}

/* ------------------------------------------------------------ scenarios -- */

async function s1_bothHealthy(online: SimPrinter, store: SimPrinter, polls: PollRecord[]): Promise<void> {
  console.log("\n1. both printers healthy: 200 tickets in singles and bursts");
  await reset();
  polls.length = 0;
  online.start();
  store.start();
  const ids: number[] = [];
  while (ids.length < 200) {
    // A third singles, the rest bursts of 2 to 6, with gaps of 1 to 4 polls.
    const burst = Math.random() < 0.33 ? 1 : 2 + Math.floor(Math.random() * 5);
    for (let i = 0; i < burst && ids.length < 200; i++) ids.push(await addTicket());
    await sleep(INTERVAL_MS * (1 + Math.random() * 3));
  }
  check("all 200 printed", await waitFor("200 printed", () => allPrinted(ids), 60_000));
  await online.stop();
  await store.stop();

  const byOrder = await printedOnce("both healthy", ids);
  const { rows: dup } = await db.query(
    `select order_id from print_deliveries where tenant_id = $1 and order_id = any($2::bigint[])
      group by order_id having count(*) filter (where reason = 'first-offer') > 1`,
    [TENANT, ids],
  );
  check("no ticket was claimed twice (one first-offer hand-over each)", dup.length === 0, `${dup.length}`);
  const onlineShare = [...byOrder.values()].filter((d) => d[0]?.station === "online").length / ids.length;
  check(
    "the split is within 45/55",
    onlineShare >= 0.45 && onlineShare <= 0.55,
    `online ${(onlineShare * 100).toFixed(1)}%, store ${((1 - onlineShare) * 100).toFixed(1)}%`,
  );
  const webOnStore = await db.query(
    `select count(*)::int as n from print_deliveries d join orders o on o.id = d.order_id
      where d.tenant_id = $1 and d.confirmed_at is not null and o.channel = 'web' and d.station = 'store'`,
    [TENANT],
  );
  check("web tickets print on either printer (the pool ignores channel)", webOnStore.rows[0].n > 0, `${webOnStore.rows[0].n} web on store`);
  const stationIsPrinter = await db.query(
    `select count(*)::int as n from orders o
      where o.tenant_id = $1 and o.id = any($2::bigint[])
        and o.print_station <> (select d.station from print_deliveries d
                                 where d.order_id = o.id and d.confirmed_at is not null limit 1)`,
    [TENANT, ids],
  );
  check("print_station is the printer that printed it, on every ticket", stationIsPrinter.rows[0].n === 0, `${stationIsPrinter.rows[0].n} differ`);

  // THE BOUND. Each time an idle, healthy printer heard "no job" while a
  // ticket waited, that ticket must be claimed within one poll interval
  // (plus the poll's own jitter and the claim's round trip).
  const claims = await firstClaims(ids);
  const bound = INTERVAL_MS * 1.1 + 120;
  const deferrals = polls.filter((p) => p.waiting !== null);
  const late = deferrals
    .map((p) => ({ id: p.waiting!, delay: (claims.get(p.waiting!) ?? Infinity) - p.at }))
    .filter((x) => x.delay > bound);
  const worst = deferrals.reduce((m, p) => Math.max(m, (claims.get(p.waiting!) ?? Infinity) - p.at), 0);
  check(
    `no ticket waited more than one poll interval because a printer held back (${deferrals.length} hold-backs)`,
    late.length === 0,
    `worst ${worst.toFixed(0)}ms, bound ${bound.toFixed(0)}ms${late.length ? `, late: ${late.slice(0, 3).map((x) => `${x.id} ${x.delay.toFixed(0)}ms`).join(", ")}` : ""}`,
  );

  // Singles with both idle alternate.
  const order = ids.map((id) => byOrder.get(id)![0]?.station);
  let alternations = 0;
  for (let i = 1; i < order.length; i++) if (order[i] !== order[i - 1]) alternations++;
  check("consecutive tickets mostly alternate printers", alternations / (order.length - 1) > 0.5, `${alternations}/${order.length - 1}`);
}

/**
 * The hold-back, step by step, with the polls placed by hand rather than by
 * timing luck: what the bulk run can only sample, this pins down.
 */
async function s1b_holdBackStepByStep(online: SimPrinter, store: SimPrinter): Promise<void> {
  console.log("\n1b. the hold-back, step by step");
  await reset();
  // Online prints a ticket, so it printed last; both have just polled.
  const first = await addTicket();
  await online.pollOnce();
  check("online printed the first ticket", (await confirmedByOrder([first])).get(first)![0]?.station === "online");
  await store.pollOnce();

  // A new ticket: online polls first and is held back, store takes it.
  const t1 = await addTicket();
  const held = await online.pollOnce();
  check("online (printed last) is held back while store is idle and polling", held === null);
  const took = await store.pollOnce();
  check("  store takes it on its next poll", took !== null && (await confirmedByOrder([t1])).get(t1)![0]?.station === "store");

  // Store printed last now. A ticket arrives; store is held back, and online
  // does not poll. After one interval store takes it anyway.
  await online.pollOnce();
  const t2 = await addTicket();
  const created = Date.now();
  check("store (printed last) is held back while online is idle and polling", (await store.pollOnce()) === null);
  await sleep(INTERVAL_MS + 30);
  const late = await store.pollOnce();
  check(
    "  and takes it itself one interval later when online did not",
    late !== null && (await confirmedByOrder([t2])).get(t2)![0]?.station === "store",
    `${Date.now() - created}ms after it arrived`,
  );

  // Online busy (holding an unconfirmed job): store takes everything at once.
  online.behaviour = "claim-no-fetch";
  await addTicket();
  await online.pollOnce();
  online.behaviour = "normal";
  const t3 = await addTicket();
  check("with online busy, store takes the next ticket at once even though it printed last", (await store.pollOnce()) !== null && (await confirmedByOrder([t3])).get(t3)![0]?.station === "store");
}

async function s2_oneUnhealthy(online: SimPrinter, store: SimPrinter): Promise<void> {
  console.log("\n2. the store printer is out of paper");
  await reset();
  store.handed = [];
  store.status = "503 Paper Empty";
  online.start();
  store.start();
  const ids: number[] = [];
  for (let i = 0; i < 40; i++) {
    ids.push(await addTicket());
    if (i % 4 === 3) await sleep(INTERVAL_MS * 2);
  }
  check("all 40 printed", await waitFor("40 printed", () => allPrinted(ids), 30_000));
  await online.stop();
  await store.stop();
  store.status = "200 OK";
  const byOrder = await printedOnce("one unhealthy", ids);
  const onStore = [...byOrder.values()].filter((d) => d[0]?.station === "store").length;
  check("100/0: the healthy printer printed every ticket", onStore === 0, `${ids.length - onStore}/${onStore}`);
  check("the paper-out printer was handed nothing", store.handed.length === 0, `${store.handed.length}`);
}

async function s3_claimedNeverFetched(online: SimPrinter, store: SimPrinter): Promise<void> {
  console.log("\n3. a printer claims a ticket and dies before fetching it");
  await reset();
  store.dead = false;
  store.handed = [];
  store.behaviour = "claim-no-fetch";
  const id = await addTicket();
  const token = await store.pollOnce();
  check("the store printer was handed it", token !== null);
  await store.die();
  store.behaviour = "normal";
  const t0 = Date.now();
  online.start();
  const printed = await waitFor("taken over", () => allPrinted([id]), 15_000);
  await online.stop();
  check("the online printer printed it after its window ran out", printed, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const byOrder = await printedOnce("claimed, never fetched", [id]);
  check("  on the online printer", byOrder.get(id)?.[0]?.station === "online");
  const { rows } = await db.query(`select rerouted_from, print_station from orders where id = $1`, [id]);
  check("  with no 轉自 line (it was never on paper)", rows[0].rerouted_from === null, String(rows[0].rerouted_from));
  check("  and print_station is the printer that printed it", rows[0].print_station === "online");
}

async function s4_fetchedNeverConfirmed(online: SimPrinter, store: SimPrinter): Promise<void> {
  console.log("\n4. a printer fetches a ticket and dies before confirming it");
  await reset();
  store.dead = false;
  store.behaviour = "fetch-no-confirm";
  const id = await addTicket();
  await store.pollOnce();
  await store.die();
  store.behaviour = "normal";
  const t0 = Date.now();
  online.start();
  await sleep(2_400);
  const early = await confirmedByOrder([id]);
  check("not taken inside the failover window (it may be on paper)", early.get(id)!.length === 0);
  const printed = await waitFor("failover takeover", () => allPrinted([id]), 15_000);
  await online.stop();
  check("taken over once timed failover had the printer", printed, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const byOrder = await printedOnce("fetched, never confirmed", [id]);
  check("  on the online printer", byOrder.get(id)?.[0]?.station === "online");
  const { rows } = await db.query(`select rerouted_from from orders where id = $1`, [id]);
  check("  with 轉自 REROUTED FROM STORE", rows[0].rerouted_from === "store", String(rows[0].rerouted_from));
}

async function s5_recovery(online: SimPrinter, store: SimPrinter): Promise<void> {
  console.log("\n5. the dead printer comes back");
  // The queue built up while the store printer was dead, and online is busy.
  const ids: number[] = [];
  for (let i = 0; i < 12; i++) ids.push(await addTicket());
  store.jobsPerPoll = [];
  store.handed = [];
  online.start();
  store.start();
  check("all 12 printed", await waitFor("12 printed", () => allPrinted(ids), 30_000));
  await online.stop();
  await store.stop();
  check("the returning printer took at most one job per poll", store.jobsPerPoll.every((n) => n <= 1));
  check("it rejoined: it printed some of the backlog", store.handed.length > 0, `${store.handed.length}`);
  await printedOnce("after recovery", ids);
  const { rows } = await db.query(
    `select count(*)::int as n from print_deliveries where tenant_id = $1 and confirmed_at is not null
      and order_id in (select id from orders where tenant_id = $1)
      group by order_id, coalesce(change_ticket_id::text, ''), reason having count(*) > 1`,
    [TENANT],
  );
  check("nothing from before the outage printed again", rows.length === 0, `${rows.length}`);
}

async function s6_reprintAndChange(online: SimPrinter, store: SimPrinter): Promise<void> {
  console.log("\n6. 重印 and 改單 follow the printer that printed the original");
  await reset();
  // The store printer prints the original (online not yet polling).
  const id = await addTicket();
  await store.pollOnce();
  check("the store printer printed the original", (await confirmedByOrder([id])).get(id)![0]?.station === "store");

  const reprintedOn = async (): Promise<Station | null> => {
    const { rows } = await db.query(
      `select station from print_deliveries where order_id = $1 and confirmed_at is not null
         and reason <> 'manual_reprint' order by confirmed_at desc limit 1`,
      [id],
    );
    return rows[0]?.station ?? null;
  };
  const reprintDone = () =>
    waitFor("reprint", async () => {
      const { rows } = await db.query(`select reprint_delivery_id from orders where id = $1`, [id]);
      return rows[0].reprint_delivery_id === null;
    });

  // Healthy: the original's printer, even when the other is preferred.
  online.start();
  store.start();
  await sleep(INTERVAL_MS * 2);
  await repo.requestReprint(TENANT, id, "kitchen");
  await reprintDone();
  check("重印, both healthy: the printer that printed it (store)", (await reprintedOn()) === "store");

  // Store out of paper: the other printer takes it.
  store.status = "503 Paper Empty";
  await sleep(INTERVAL_MS * 2);
  await repo.requestReprint(TENANT, id, "kitchen");
  await reprintDone();
  check("重印, store out of paper: the online printer", (await reprintedOn()) === "online");
  store.status = "200 OK";
  await sleep(INTERVAL_MS * 2);

  // 改單: an edit after it printed makes a change ticket.
  const changeOn = async (): Promise<Station | null> => {
    const { rows } = await db.query(
      `select d.station from print_deliveries d where d.order_id = $1 and d.confirmed_at is not null
         and d.change_ticket_id is not null order by d.confirmed_at desc limit 1`,
      [id],
    );
    return rows[0]?.station ?? null;
  };
  const saveEdit = async (quantity: number): Promise<boolean> => {
    const { rows } = await db.query(`select revision from orders where id = $1`, [id]);
    const res = await edit.POST(
      new Request(`http://localhost/api/kitchen/orders/${id}/edit`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", "x-gate-bypass": BYPASS },
        body: JSON.stringify({
          baseRevision: Number(rows[0].revision),
          editToken: `pool-edit-${Date.now()}-${Math.random()}`,
          lines: [{ lineId: "orig:0", itemId: "egg-rolls", sizeId: "regular", modifierIds: [], quantity }],
        }),
      }),
      { params: Promise.resolve({ id: String(id) }) },
    );
    const body = (await res.json()) as { ok: boolean };
    return body.ok;
  };
  const changeDone = () =>
    waitFor("change ticket", async () => {
      const { rows } = await db.query(`select change_ticket_id from orders where id = $1`, [id]);
      return rows[0].change_ticket_id === null;
    });
  // The last ticket printed was the reprint on online, so store is preferred:
  // the change ticket still goes to the store printer, which printed it.
  check("改單 saved", await saveEdit(2));
  await changeDone();
  check("改單, both healthy: the printer that printed the original (store)", (await changeOn()) === "store");
  store.status = "503 Paper Empty";
  await sleep(INTERVAL_MS * 2);
  check("改單 saved again", await saveEdit(3));
  await changeDone();
  check("改單, store out of paper: the online printer", (await changeOn()) === "online");
  store.status = "200 OK";
  await online.stop();
  await store.stop();
}

async function s7_report(online: SimPrinter, store: SimPrinter): Promise<void> {
  console.log("\n7. a 日結 report goes through the pool");
  await reset();
  const sheet = (await import("../src/app/api/kitchen/reports/daily/print/route")) as unknown as { POST: Handler };
  const res = await sheet.POST(
    new Request("http://localhost/api/kitchen/reports/daily/print", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ date: businessDate, sequence: 1, requestKey: "pool-report-0001" }),
    }),
  );
  check("Print with no printer picked is accepted", res.status === 200, `status=${res.status}`);
  store.status = "503 Paper Empty";
  online.start();
  store.start();
  const done = await waitFor("report printed", async () => {
    const { rows } = await db.query(`select status from report_prints where tenant_id = $1`, [TENANT]);
    return rows[0]?.status === "PRINTED";
  });
  await online.stop();
  await store.stop();
  store.status = "200 OK";
  const { rows } = await db.query(`select status, station from report_prints where tenant_id = $1`, [TENANT]);
  check("the report printed, on the printer that had paper", done && rows[0]?.station === "online", JSON.stringify(rows[0]));
}

/* ----------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-printer-pool-"));
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
    DATABASE_POOL_MAX: "16",
    TENANT_ID: TENANT,
    RESTAURANT_TIMEZONE: TIMEZONE,
    TENANT_TIMEZONE: TIMEZONE,
    TENANT_TAX_RATE_BPS: "875",
    ORDER_NUMBER_PREFIX: "A",
    ADMIN_DASH_PASSWORD: PASSWORD,
    ORDER_GATE_BYPASS: BYPASS,
    CLOUDPRNT_SECRET: SECRET,
    CLOUDPRNT_PRINTER_MAC_ONLINE: MAC.online,
    CLOUDPRNT_PRINTER_MAC_STORE: MAC.store,
    PRINTER_POOL: "on",
    PRINT_POOL_INTERVAL_MS: String(INTERVAL_MS),
    // The compressed clock: a 2s confirmation window, 3s to failover.
    TICKET_COPIES: "1",
    PRINT_CONFIRM_FLOOR_SECONDS: "2",
    PRINT_SECONDS_PER_COPY: "0",
    PRINT_FAILOVER_AFTER_SECONDS: "3",
  });
  delete process.env.CLOUDPRNT_PRINTER_MAC;
  delete process.env.OWNER_ALERT_PHONE;

  db = new Client({ connectionString: url });
  await db.connect();
  await db.query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));

  const pool = await import("../src/lib/db/postgres");
  const session = await import("../src/lib/auth/kitchenSession");
  const biz = await import("../src/lib/orders/businessDate");
  route = (await import("../src/app/api/print/[secret]/route")) as unknown as PrintRoute;
  repo = await import("../src/lib/orders/repository");
  edit = (await import("../src/app/api/kitchen/orders/[id]/edit/route")) as unknown as { POST: Handler };
  resetLimits = (await import("../src/lib/http/rateLimit")).resetRateLimits;
  cookie = `nmc_kitchen=${session.login(PASSWORD)}`;
  businessDate = biz.businessDateFor(TIMEZONE);

  const polls: PollRecord[] = [];
  const online = new SimPrinter("online", polls);
  const store = new SimPrinter("store", polls);

  // The rule itself, pure.
  console.log("\n0. the alternation rule");
  const s = (o: Partial<import("../src/lib/orders/repository").PoolState>) => ({
    lastStation: null, otherHealthy: true, otherRecent: true, otherInFlight: false, ...o,
  });
  check("nothing printed yet: take it", repo.poolMayClaimNow("store", s({})));
  check("the other printed last: take it", repo.poolMayClaimNow("store", s({ lastStation: "online" })));
  check("I printed last, the other is idle, healthy and polling: leave it", !repo.poolMayClaimNow("store", s({ lastStation: "store" })));
  check("I printed last but the other is printing: take it", repo.poolMayClaimNow("store", s({ lastStation: "store", otherInFlight: true })));
  check("I printed last but the other is out of paper: take it", repo.poolMayClaimNow("store", s({ lastStation: "store", otherHealthy: false })));
  check("I printed last but the other has not polled this interval: take it", repo.poolMayClaimNow("store", s({ lastStation: "store", otherRecent: false })));

  try {
    await s1_bothHealthy(online, store, polls);
    await s1b_holdBackStepByStep(online, store);
    await s2_oneUnhealthy(online, store);
    await s3_claimedNeverFetched(online, store);
    await s4_fetchedNeverConfirmed(online, store);
    await s5_recovery(online, store);
    await s6_reprintAndChange(online, store);
    await s7_report(online, store);
  } finally {
    await online.stop();
    await store.stop();
    await db.end();
    await pool.closeOrdersPool();
    console.log("\nstopping postgres…");
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(`\nprinter pool: ${passes}/${passes + failures} checks passed`);
  if (failures > 0) {
    console.log(`\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log("\none queue, two printers: every ticket once, evenly, never held back past one poll ✓");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
