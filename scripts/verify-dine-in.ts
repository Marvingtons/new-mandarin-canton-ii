/**
 * Prove dine-in is the SAME pipeline as every other order, and that the table
 * rules hold where they are enforced: on the server.
 *
 *   npm run verify:dine-in
 *
 * Real things, not mocks, in the shape of verify:staff-orders: an embedded
 * Postgres with the real schema.sql, the real repository, and the REAL route
 * handlers (POST /api/kitchen/orders, /api/kitchen/tables, the board's order
 * actions, history and its CSV).
 *
 * What it pins down:
 *   - a dine-in order is priced, numbered and queued exactly like takeout
 *   - occupancy is derived from open dine-in rows, and a combined 4+5 holds
 *     both tables
 *   - a taken table is refused, including by overlap, and by two tablets at
 *     the same instant (exactly one wins)
 *   - an add-on needs an open seating and takes ITS guest count
 *   - 清台 frees the table, completes what the kitchen already printed, and
 *     never pulls a QUEUED ticket out of the print queue
 *   - every write is refused on a preview host before it touches anything
 *   - the ticket renders the dine-in header with no missing glyphs
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const PORT = 55437;
const DB_NAME = "nmc_dine_in_test";
const TENANT = "dine-in-test";
const PASSWORD = "verify-dine-in-password";
const BYPASS = "verify-dine-in-bypass";
const TIMEZONE = "America/Los_Angeles";
const PREVIEW_HOST = "feat-dine-in-pos-nmc-web.example.workers.dev";

let failures = 0;
let passes = 0;
function check(name: string, passed: boolean, detail = ""): void {
  if (passed) passes++;
  else failures++;
  console.log(`   ${passed ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
}

type Handler = (r: Request, ctx?: unknown) => Promise<Response>;

interface Mods {
  repo: typeof import("../src/lib/orders/repository");
  pool: typeof import("../src/lib/db/postgres");
  render: typeof import("../src/lib/ticket/render");
  session: typeof import("../src/lib/auth/kitchenSession");
  catalog: typeof import("../src/lib/menu/catalog");
  types: typeof import("../src/lib/menu/types");
  kitchenOrders: { POST: Handler };
  tables: { GET: Handler; POST: Handler };
  orderAction: { POST: (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };
  history: { GET: Handler };
  historyCsv: { GET: Handler };
}

let cookie = "";
let keySeq = 0;
const nextKey = () => `dine-${Date.now()}-${++keySeq}`;

function req(path: string, init: RequestInit = {}, host = "localhost", auth = true): Request {
  const headers = new Headers(init.headers);
  if (auth) headers.set("cookie", cookie);
  if (init.body) headers.set("content-type", "application/json");
  headers.set("x-gate-bypass", BYPASS);
  headers.set("host", host);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function json(res: Response) {
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let line: { itemId: string; sizeId: string; modifierIds: string[]; quantity: number };

async function seat(m: Mods, label: string, guests: number, extra: Record<string, unknown> = {}, host = "localhost") {
  return json(
    await m.kitchenOrders.POST(
      req("/api/kitchen/orders", {
        method: "POST",
        body: JSON.stringify({ lines: [line], channel: "dine_in", table: { label, guests }, idempotencyKey: nextKey(), ...extra }),
      }, host),
    ),
  );
}

async function openTables(m: Mods) {
  const r = await json(await m.tables.GET(req("/api/kitchen/tables")));
  return (r.body.tables ?? []) as { tableLabel: string; guestCount: number | null; orderCount: number }[];
}

async function clear(m: Mods, label: string, host = "localhost") {
  return json(await m.tables.POST(req("/api/kitchen/tables", { method: "POST", body: JSON.stringify({ action: "clear", label }) }, host)));
}

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-dine-in-test-"));
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port: PORT, persistent: false });
  console.log("starting embedded postgres…");
  await pg.initialise();
  await pg.start();
  const admin = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${DB_NAME} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();

  process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`;
  process.env.TENANT_ID = TENANT;
  process.env.RESTAURANT_TIMEZONE = TIMEZONE;
  process.env.TENANT_TIMEZONE = TIMEZONE;
  process.env.TENANT_TAX_RATE_BPS = "875";
  process.env.ORDER_NUMBER_PREFIX = "A";
  process.env.ADMIN_DASH_PASSWORD = PASSWORD;
  process.env.ORDER_GATE_BYPASS = BYPASS;
  delete process.env.TWILIO_ACCOUNT_SID;

  const pool = await import("../src/lib/db/postgres");
  await pool.ordersPool().query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));

  const m: Mods = {
    repo: await import("../src/lib/orders/repository"),
    pool,
    render: await import("../src/lib/ticket/render"),
    session: await import("../src/lib/auth/kitchenSession"),
    catalog: await import("../src/lib/menu/catalog"),
    types: await import("../src/lib/menu/types"),
    kitchenOrders: (await import("../src/app/api/kitchen/orders/route")) as unknown as Mods["kitchenOrders"],
    tables: (await import("../src/app/api/kitchen/tables/route")) as unknown as Mods["tables"],
    orderAction: (await import("../src/app/api/kitchen/orders/[id]/route")) as unknown as Mods["orderAction"],
    history: (await import("../src/app/api/kitchen/history/route")) as unknown as Mods["history"],
    historyCsv: (await import("../src/app/api/kitchen/history/csv/route")) as unknown as Mods["historyCsv"],
  };
  cookie = `nmc_kitchen=${m.session.login(PASSWORD)}`;

  // A simple available dish with no required choices.
  const item = m.catalog
    .catalogMenu()
    .categories.flatMap((c) => c.items)
    .find((i) => m.types.isAvailable(i) && !i.lunchSpecial && i.modifierGroups.every((g) => (g.minRequired ?? 0) === 0));
  if (!item) throw new Error("no simple dish in the catalogue");
  line = { itemId: item.id, sizeId: m.types.itemSizes(item)[0].id, modifierIds: [], quantity: 2 };

  try {
    console.log("\n1. same pipeline as takeout");
    const takeout = await json(
      await m.kitchenOrders.POST(
        req("/api/kitchen/orders", {
          method: "POST",
          body: JSON.stringify({
            lines: [line], channel: "walk_in", customer: { name: "Takeout Twin" },
            pickup: { time: "asap" }, idempotencyKey: nextKey(),
          }),
        }),
      ),
    );
    const key = nextKey();
    const first = await json(
      await m.kitchenOrders.POST(
        req("/api/kitchen/orders", {
          method: "POST",
          body: JSON.stringify({ lines: [line], channel: "dine_in", table: { label: "4", guests: 3 }, idempotencyKey: key }),
        }),
      ),
    );
    const o1 = first.body.order as { id: number; orderNumber: string; totalCents: number; tableLabel: string; guestCount: number };
    const t1 = takeout.body.order as { orderNumber: string; totalCents: number };
    check("seat table 4 for 3", first.status === 200 && o1.tableLabel === "4" && o1.guestCount === 3, `${first.status}`);
    check("same cart costs the same as takeout", o1.totalCents === t1.totalCents, `${o1.totalCents} vs ${t1.totalCents}`);
    check("next number in the same store B-xxx sequence as a walk-in", o1.orderNumber === "B-002" && t1.orderNumber === "B-001", `${t1.orderNumber}, ${o1.orderNumber}`);
    const stored = await m.repo.getOrderById(TENANT, o1.id);
    check("stored as dine_in, QUEUED, unprinted", stored?.channel === "dine_in" && stored.status === "QUEUED" && stored.printAttempts === 0 && stored.isAddon === false);
    const replay = await json(
      await m.kitchenOrders.POST(
        req("/api/kitchen/orders", {
          method: "POST",
          body: JSON.stringify({ lines: [line], channel: "dine_in", table: { label: "4", guests: 3 }, idempotencyKey: key }),
        }),
      ),
    );
    check("a double tap is the same order, not 'occupied'", replay.status === 200 && replay.body.duplicate === true && (replay.body.order as { id: number }).id === o1.id);

    console.log("\n2. occupancy");
    check("table 4 again is refused", (await seat(m, "4", 2)).status === 409);
    const overlap = await seat(m, "4+5", 6);
    check("4+5 is refused while 4 is seated", overlap.status === 409 && overlap.body.code === "table_occupied");
    check("table 5 alone is free", (await seat(m, "5", 2)).status === 200);
    check("labels not on the floor plan are refused", (await seat(m, "5+4", 2)).status === 400 && (await seat(m, "10", 2)).status === 400);
    let open = await openTables(m);
    check("open tables are 4 and 5", open.map((t) => t.tableLabel).sort().join() === "4,5");

    console.log("\n3. add-ons");
    const addon = await seat(m, "4", 7, { addon: true });
    const ao = addon.body.order as { id: number; isAddon: boolean; guestCount: number };
    check("an add-on to table 4 is accepted", addon.status === 200 && ao.isAddon === true);
    check("the add-on takes the seated party's 3, not the request's 7", ao.guestCount === 3, `${ao.guestCount}`);
    const noParty = await seat(m, "6", 2, { addon: true });
    check("an add-on to an empty table is refused", noParty.status === 409 && noParty.body.code === "table_not_open");
    open = await openTables(m);
    check("table 4 shows 2 orders, 3 guests", open.some((t) => t.tableLabel === "4" && t.orderCount === 2 && t.guestCount === 3));

    console.log("\n4. 清台");
    await m.repo.updateStatus(TENANT, o1.id, "PRINTED");
    const cleared = await clear(m, "4");
    const c = (cleared.body.cleared ?? []) as { id: number; status: string }[];
    check("clearing 4 clears both its orders", cleared.status === 200 && c.length === 2);
    check("the printed seating is COMPLETED", c.find((x) => x.id === o1.id)?.status === "COMPLETED");
    check("the still-QUEUED add-on stays QUEUED (its ticket still prints)", c.find((x) => x.id === ao.id)?.status === "QUEUED");
    check("table 4 is free again", !(await openTables(m)).some((t) => t.tableLabel === "4"));
    check("clearing it twice says it is not seated", (await clear(m, "4")).status === 409);
    check("an add-on after 清台 is refused", (await seat(m, "4", 3, { addon: true })).status === 409);
    check("table 4 can be seated again", (await seat(m, "4", 2)).status === 200);

    console.log("\n5. combined tables");
    await clear(m, "4");
    await clear(m, "5");
    const combo = await seat(m, "4+5", 9);
    check("4+5 seats as one", combo.status === 200);
    check("4 alone is refused while 4+5 is seated", (await seat(m, "4", 2)).status === 409);
    check("5 alone is refused while 4+5 is seated", (await seat(m, "5", 2)).status === 409);
    check("the floor plan lists one open label, 4+5", (await openTables(m)).map((t) => t.tableLabel).join() === "4+5");

    console.log("\n6. two tablets, one table");
    const [a, b] = await Promise.all([seat(m, "7", 2), seat(m, "7", 4)]);
    check("exactly one seating wins", [a.status, b.status].sort().join() === "200,409", `${a.status}, ${b.status}`);

    console.log("\n7. a cancelled seating frees its table");
    const six = await seat(m, "6", 2);
    const sixId = (six.body.order as { id: number }).id;
    await m.orderAction.POST(req(`/api/kitchen/orders/${sixId}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) }), {
      params: Promise.resolve({ id: String(sixId) }),
    });
    check("table 6 is free after its only order is cancelled", !(await openTables(m)).some((t) => t.tableLabel === "6"));

    console.log("\n8. preview hosts are refused before anything happens");
    const before = Number((await pool.ordersPool().query("select count(*) from orders")).rows[0].count);
    const pOrder = await seat(m, "9", 2, {}, PREVIEW_HOST);
    check("POS submit on a preview host is 403", pOrder.status === 403 && pOrder.body.reason === "preview_host");
    const pClear = await clear(m, "4+5", PREVIEW_HOST);
    check("清台 on a preview host is 403", pClear.status === 403);
    const pAction = await json(
      await m.orderAction.POST(req(`/api/kitchen/orders/${o1.id}`, { method: "POST", body: JSON.stringify({ action: "reprint" }) }, PREVIEW_HOST), {
        params: Promise.resolve({ id: String(o1.id) }),
      }),
    );
    check("重印 on a preview host is 403", pAction.status === 403);
    const after = Number((await pool.ordersPool().query("select count(*) from orders")).rows[0].count);
    check("nothing was written", before === after, `${before} -> ${after}`);
    check("4+5 is still seated", (await openTables(m)).some((t) => t.tableLabel === "4+5"));

    console.log("\n9. sessions and shapes");
    check("tables GET without a session is 401", (await m.tables.GET(req("/api/kitchen/tables", {}, "localhost", false))).status === 401);
    check(
      "tables POST without a session is 401",
      (await m.tables.POST(req("/api/kitchen/tables", { method: "POST", body: JSON.stringify({ action: "clear", label: "4+5" }) }, "localhost", false))).status === 401,
    );
    const mixed = await json(
      await m.kitchenOrders.POST(
        req("/api/kitchen/orders", {
          method: "POST",
          body: JSON.stringify({
            lines: [line], channel: "phone", customer: { name: "X", phone: "6195550100" },
            pickup: { time: "asap" }, table: { label: "4", guests: 2 }, idempotencyKey: nextKey(),
          }),
        }),
      ),
    );
    check("a takeout order carrying a table is a hard 400", mixed.status === 400);
    const priced = await json(
      await m.kitchenOrders.POST(
        req("/api/kitchen/orders", {
          method: "POST",
          body: JSON.stringify({ lines: [line], channel: "dine_in", table: { label: "1", guests: 2 }, totalCents: 1, idempotencyKey: nextKey() }),
        }),
      ),
    );
    check("a dine-in order carrying money is a hard 400", priced.status === 400);

    console.log("\n10. history and the ticket");
    const today = (await m.repo.getOrderById(TENANT, o1.id))!.businessDate;
    const h = await json(await m.history.GET(req(`/api/kitchen/history?from=${today}&to=${today}&channel=dine_in`)));
    const ho = (h.body.orders ?? []) as { channel: string; tableLabel: string | null }[];
    check("history filters to dine-in", ho.length > 0 && ho.every((o) => o.channel === "dine_in" && !!o.tableLabel));
    const csvRes = await m.historyCsv.GET(req(`/api/kitchen/history/csv?from=${today}&to=${today}&channel=dine_in`));
    const csvText = await csvRes.text();
    check(
      "CSV carries table, guests and station",
      csvText.split("\n")[0].trim().endsWith("table,guests,addon,station") && /,4\+5,9,[^,\n]*,store/.test(csvText),
    );
    const combined = await m.repo.getOrderById(TENANT, (combo.body.order as { id: number }).id);
    const svg = await m.render.composeTicketSvg(combined!, { timezone: TIMEZONE });
    check("the dine-in ticket draws every glyph", svg.missing.length === 0, svg.missing.map((cp) => String.fromCodePoint(cp)).join(""));
    const png = await m.render.renderTicket(combined!, { timezone: TIMEZONE });
    check("and rasterizes through the same printer path", png.length > 1000);
  } finally {
    await pool.closeOrdersPool();
    console.log("\nstopping postgres…");
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(`\ndine-in: ${passes}/${passes + failures} checks passed`);
  if (failures > 0) {
    console.log(`\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log("\none pipeline: dine-in orders price, number, print and hold tables on the server ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
