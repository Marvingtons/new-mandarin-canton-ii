/**
 * Prove 改單 EDIT ORDER end to end against a real database.
 *
 *   npm run verify:edit-order
 *
 * In the shape of verify:staff-orders: a real embedded Postgres with the real
 * schema.sql, the real repository, and the REAL route handlers (POS order
 * create, the edit route, the revisions route, the board's 重印, the
 * CloudPRNT poll / fetch / confirm). What it asserts (docs/edit-order.md):
 *
 *   1. the save is one transaction: previous version snapshotted, current
 *      row rewritten, revision bumped, change ticket queued, and it PRINTS
 *      through the CloudPRNT path without moving the order's status
 *   2. idempotent on the edit token: a double tap is one revision, one ticket
 *   3. the optimistic lock: a stale tablet gets 409 conflict
 *   4. lunch is judged at the ORIGINAL order time
 *   5. untouched lines keep their stored price; new lines are priced fresh
 *   6. never handed over: the queued ticket is replaced, no change ticket
 *   7. handed over but unconfirmed: a change ticket, and retries of the first
 *      ticket render the ORIGINAL revision
 *   8. a waiting, never-offered change ticket is widened, not doubled;
 *      an offered one refuses the next edit until it prints
 *   9. a 重印 of a change ticket is byte-identical to the first print
 *  10. removed / size / note-only blocks; empty and no-change refusals;
 *      cancelled and long-done orders refused; a just-done order records
 *      without printing unless asked; a web order's staff note
 *  11. a change ticket that gives up is marked failed and found by the alert
 *  12. the revisions route reports each edit
 *
 * ⚠️ WINDOWS: PostgreSQL refuses to start under an administrative token; run
 * from a NON-ELEVATED shell.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const PORT = 55453;
const DB_NAME = "nmc_edit_test";
const TENANT = "edit-test";
const PASSWORD = "verify-edit-order-password";
const BYPASS = "verify-edit-order-bypass";
const PRINT_SECRET = "verify-edit-order-print";
const MAC = "00:11:62:00:00:17";
const TIMEZONE = "America/Los_Angeles";

let failures = 0;
let passes = 0;
function check(name: string, passed: boolean, detail = ""): void {
  if (passed) passes++;
  else failures++;
  console.log(`   ${passed ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
}

type Ctx = { params: Promise<{ id: string }> };
interface Mods {
  repo: typeof import("../src/lib/orders/repository");
  pool: typeof import("../src/lib/db/postgres");
  catalog: typeof import("../src/lib/menu/catalog");
  types: typeof import("../src/lib/menu/types");
  rice: typeof import("../src/lib/menu/rice");
  render: typeof import("../src/lib/ticket/render");
  session: typeof import("../src/lib/auth/kitchenSession");
  rate: typeof import("../src/lib/http/rateLimit");
  kitchenOrders: { POST: (r: Request) => Promise<Response> };
  webOrders: { POST: (r: Request) => Promise<Response> };
  otp: typeof import("../src/lib/otp/session");
  edit: { POST: (r: Request, ctx: Ctx) => Promise<Response> };
  revisions: { GET: (r: Request, ctx: Ctx) => Promise<Response> };
  orderAction: { POST: (r: Request, ctx: Ctx) => Promise<Response> };
  print: {
    POST: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
    GET: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
    DELETE: (r: Request, ctx: { params: Promise<{ secret: string }> }) => Promise<Response>;
  };
}

let cookie = "";
function kitchenRequest(path: string, init: RequestInit = {}, bypass = true): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body) headers.set("content-type", "application/json");
  if (bypass) headers.set("x-gate-bypass", BYPASS);
  return new Request(`http://localhost${path}`, { ...init, headers });
}
const ctx = (id: number): Ctx => ({ params: Promise.resolve({ id: String(id) }) });

let keySeq = 0;
const nextKey = () => `edit-verify-${Date.now()}-${++keySeq}`;

interface Line {
  lineId?: string;
  itemId: string;
  sizeId: string;
  modifierIds: string[];
  quantity: number;
  specialInstructions?: string;
}

function line(m: Mods, itemId: string, sizeId?: string, quantity = 1, note?: string): Line {
  const item = m.types.indexItems(m.catalog.catalogMenu()).get(itemId);
  if (!item) throw new Error(`no such item ${itemId}`);
  const size = sizeId ?? m.types.itemSizes(item)[0].id;
  const modifierIds = m.rice
    .groupsForSize(item, size)
    .filter((g) => g.minRequired > 0)
    .map((g) => g.modifiers[0].id);
  return { itemId, sizeId: size, modifierIds, quantity, ...(note ? { specialInstructions: note } : {}) };
}

/** The POS's view of a stored order: every line, tagged orig:<index>. */
function loaded(order: { items: { itemId: string; sizeId: string; modifiers: { id: string }[]; quantity: number; specialInstructions?: string }[] }): Line[] {
  return order.items.map((l, i) => ({
    lineId: `orig:${i}`,
    itemId: l.itemId,
    sizeId: l.sizeId,
    modifierIds: l.modifiers.map((x) => x.id),
    quantity: l.quantity,
    ...(l.specialInstructions ? { specialInstructions: l.specialInstructions } : {}),
  }));
}

async function place(m: Mods, lines: Line[], channel = "phone"): Promise<number> {
  const res = await m.kitchenOrders.POST(
    kitchenRequest("/api/kitchen/orders", {
      method: "POST",
      body: JSON.stringify({
        lines,
        channel,
        customer: { name: "Edit Test", phone: "(619) 555-0117" },
        pickup: { time: "asap" },
        idempotencyKey: nextKey(),
      }),
    }),
  );
  const body = (await res.json()) as { ok: boolean; order?: { id: number }; error?: string };
  if (!body.ok || !body.order) throw new Error(`place: ${JSON.stringify(body)}`);
  return body.order.id;
}

interface EditAnswer {
  status: number;
  body: {
    ok: boolean;
    code?: string;
    revision?: number;
    duplicate?: boolean;
    replaced?: boolean;
    changeTicketId?: string | null;
    changeTicket?: { diff: { added: unknown[]; removed: unknown[]; changed: { fields: string[] }[]; unchangedCount: number }; fromRevision: number; revision: number } | null;
    diff?: { added: unknown[]; removed: unknown[]; changed: { fields: string[] }[] };
    totals?: { totalCents: number };
    print?: string;
    noChanges?: boolean;
  };
}

async function edit(
  m: Mods,
  id: number,
  baseRevision: number,
  lines: Line[],
  extra: Record<string, unknown> = {},
  bypass = true,
): Promise<EditAnswer> {
  const res = await m.edit.POST(
    kitchenRequest(
      `/api/kitchen/orders/${id}/edit`,
      { method: "POST", body: JSON.stringify({ baseRevision, editToken: nextKey(), lines, ...extra }) },
      bypass,
    ),
    ctx(id),
  );
  return { status: res.status, body: (await res.json()) as EditAnswer["body"] };
}

const printParams = Promise.resolve({ secret: PRINT_SECRET });
const PRINT_BASE = `https://example.test/api/print/${PRINT_SECRET}`;

async function poll(m: Mods): Promise<string | null> {
  const res = await m.print.POST(
    new Request(PRINT_BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusCode: "200 OK", printerMAC: MAC }),
    }),
    { params: printParams },
  );
  const body = (await res.json()) as { jobReady?: boolean; jobToken?: string };
  return body.jobReady ? (body.jobToken ?? null) : null;
}
async function fetchBody(m: Mods, token: string): Promise<Buffer> {
  const res = await m.print.GET(
    new Request(`${PRINT_BASE}?token=${encodeURIComponent(token)}&mac=${encodeURIComponent(MAC)}&type=application/vnd.star.starprnt`),
    { params: printParams },
  );
  if (res.status !== 200) throw new Error(`GET ${token}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function confirm(m: Mods, token: string): Promise<void> {
  await m.print.DELETE(
    new Request(`${PRINT_BASE}?mac=${encodeURIComponent(MAC)}&code=OK&token=${encodeURIComponent(token)}`, { method: "DELETE" }),
    { params: printParams },
  );
}
/** One full print: poll, fetch, confirm. Returns the bytes, or null if nothing was offered. */
async function printNext(m: Mods): Promise<{ token: string; bytes: Buffer } | null> {
  const token = await poll(m);
  if (!token) return null;
  const bytes = await fetchBody(m, token);
  await confirm(m, token);
  return { token, bytes };
}
async function drain(m: Mods): Promise<number> {
  let n = 0;
  while ((await printNext(m)) && n < 10) n++;
  return n;
}
/** The body a delivery renders, as text lines (single copy). */
async function deliveryText(m: Mods, orderId: number, token: string): Promise<string[]> {
  const order = (await m.repo.getOrderById(TENANT, orderId))!;
  const body = await m.repo.printBodyFor(TENANT, order, token);
  const svg = await m.render.composeTicketSvg(body.order, {
    timezone: TIMEZONE,
    change: body.change,
    revision: body.revision,
  });
  return svg.lines.map((l) => l.text);
}

async function reset(m: Mods): Promise<void> {
  await m.pool.ordersPool().query("delete from orders where tenant_id = $1", [TENANT]);
  await m.pool.ordersPool().query("delete from order_counters where tenant_id = $1", [TENANT]);
  m.rate.resetRateLimits();
}
const q = (m: Mods, sql: string, params: unknown[] = []) => m.pool.ordersPool().query(sql, params);

/* ------------------------------------------------------------ scenarios -- */

async function s1_transaction(m: Mods): Promise<void> {
  console.log("\n1. one transaction; the change ticket prints; status does not move");
  await reset(m);
  const id = await place(m, [line(m, "beef-broccoli", undefined, 2), line(m, "mandarin-special", "party-tray")]);
  check("the first ticket prints", (await drain(m)) === 1);
  const before = (await m.repo.getOrderById(TENANT, id))!;
  await m.orderAction.POST(kitchenRequest(`/api/kitchen/orders/${id}`, { method: "POST", body: JSON.stringify({ action: "accept" }) }), ctx(id));

  const res = await edit(m, id, 0, [...loaded(before), line(m, "egg-rolls", undefined, 2)]);
  check("the edit saves", res.status === 200 && res.body.ok && res.body.revision === 1, JSON.stringify(res.body).slice(0, 200));
  check("one + block, nothing else", res.body.changeTicket?.diff.added.length === 1 && res.body.changeTicket.diff.removed.length === 0 && res.body.changeTicket.diff.changed.length === 0);
  check("其餘不變 counts the 3 untouched dishes", res.body.changeTicket?.diff.unchangedCount === 3);

  const after = (await m.repo.getOrderById(TENANT, id))!;
  const { rows: revs } = await q(m, "select revision, items, totals, actor, diff from order_revisions where order_id = $1", [id]);
  check("the previous version is in order_revisions as revision 0", revs.length === 1 && revs[0].revision === 0 && JSON.stringify(revs[0].items) === JSON.stringify(before.items));
  check("the snapshot keeps the old totals and the actor", revs[0]?.totals.totalCents === before.totals.totalCents && revs[0]?.actor === "kitchen");
  check("orders holds the current version, revision 1, edited_at set", after.revision === 1 && after.items.length === 3 && after.editedAt !== null);
  check("the order number never changes", after.orderNumber === before.orderNumber);
  check("status stays ACCEPTED", after.status === "ACCEPTED");
  check("a change ticket is pending", after.changePending);

  const token = await poll(m);
  check("the printer is offered the change ticket", token !== null);
  const text = await deliveryText(m, id, token!);
  check("it prints 改單 CHANGE · <number>", text.includes(`改單 CHANGE · ${after.orderNumber}`), text.slice(0, 3).join(" | "));
  check("with a + 加 ADDED block", text.includes("+ 加 ADDED"));
  check("and no - or 改 block", !text.includes("- 減 REMOVED") && !text.includes("改 CHANGED"));
  check("其餘不變 OTHER 3 ITEMS UNCHANGED", text.includes("其餘不變 OTHER 3 ITEMS UNCHANGED"));
  await fetchBody(m, token!);
  await confirm(m, token!);
  const printed = (await m.repo.getOrderById(TENANT, id))!;
  check("confirmed: no change pending, status still ACCEPTED", !printed.changePending && printed.status === "ACCEPTED");
  check("nothing more is offered", (await poll(m)) === null);
  const { rows: ct } = await q(m, "select printed_at, from_revision, to_revision from order_change_tickets where order_id = $1", [id]);
  check("the change ticket row says printed, 0 -> 1", ct.length === 1 && ct[0].printed_at !== null && ct[0].from_revision === 0 && ct[0].to_revision === 1);
}

async function s2_idempotency(m: Mods): Promise<void> {
  console.log("\n2. a double tap is one revision and one change ticket");
  await reset(m);
  const id = await place(m, [line(m, "beef-broccoli")]);
  await drain(m);
  const order = (await m.repo.getOrderById(TENANT, id))!;
  const body = JSON.stringify({ baseRevision: 0, editToken: "double-tap-token-1", lines: [...loaded(order), line(m, "egg-rolls")] });
  const [a, b] = await Promise.all([
    m.edit.POST(kitchenRequest(`/api/kitchen/orders/${id}/edit`, { method: "POST", body }), ctx(id)),
    m.edit.POST(kitchenRequest(`/api/kitchen/orders/${id}/edit`, { method: "POST", body }), ctx(id)),
  ]);
  const ja = (await a.json()) as EditAnswer["body"];
  const jb = (await b.json()) as EditAnswer["body"];
  const statuses = [a.status, b.status].sort().join(",");
  check("both taps answer 200 (one saved, one its repeat)", statuses === "200,200", `${statuses} ${JSON.stringify([ja.code, jb.code])}`);
  check("exactly one says duplicate", [ja.duplicate, jb.duplicate].filter(Boolean).length === 1);
  const retry = await m.edit.POST(kitchenRequest(`/api/kitchen/orders/${id}/edit`, { method: "POST", body }), ctx(id));
  const jr = (await retry.json()) as EditAnswer["body"];
  check("a later retry of the same token is the same save, not a conflict", retry.status === 200 && jr.duplicate === true && jr.revision === 1);
  const { rows: revs } = await q(m, "select count(*)::int as n from order_revisions where order_id = $1", [id]);
  const { rows: cts } = await q(m, "select count(*)::int as n from order_change_tickets where order_id = $1", [id]);
  check("one revision row", revs[0].n === 1, `${revs[0].n}`);
  check("one change ticket", cts[0].n === 1, `${cts[0].n}`);
  check("one print job results", (await drain(m)) === 1);
}

async function s3_lock(m: Mods): Promise<void> {
  console.log("\n3. two tablets: the second save is refused");
  await reset(m);
  const id = await place(m, [line(m, "beef-broccoli")]);
  await drain(m);
  const order = (await m.repo.getOrderById(TENANT, id))!;
  const first = await edit(m, id, 0, [...loaded(order), line(m, "egg-rolls")]);
  const second = await edit(m, id, 0, [...loaded(order), line(m, "hot-sour-soup")]);
  check("the first tablet saves", first.status === 200);
  check("the second gets 409 conflict", second.status === 409 && second.body.code === "conflict", `${second.status} ${second.body.code}`);
  const stalePreview = await edit(m, id, 0, [...loaded(order), line(m, "hot-sour-soup")], { dryRun: true });
  check("its confirm sheet (dry run) says so too, never a diff against a version it did not load", stalePreview.status === 409 && stalePreview.body.code === "conflict");
  const { rows } = await q(m, "select count(*)::int as n from order_revisions where order_id = $1", [id]);
  check("only one revision exists", rows[0].n === 1);
}

async function s4_lunch(m: Mods): Promise<void> {
  console.log("\n4. lunch is judged at the ORIGINAL order time");
  await reset(m);
  const lunchItem = m.catalog.catalogMenu().categories.flatMap((c) => c.items).find((i) => i.lunchSpecial);
  if (!lunchItem) {
    check("the catalogue has a lunch special", false);
    return;
  }
  const id = await place(m, [line(m, "beef-broccoli")]);
  await drain(m);
  const order = (await m.repo.getOrderById(TENANT, id))!;
  // Placed at 11:30 local, edited now (whatever now is), with NO bypass.
  await q(m, "update orders set created_at = (current_date + time '11:30') at time zone $2 where id = $1", [id, TIMEZONE]);
  const ok = await edit(m, id, 0, [...loaded(order), line(m, lunchItem.id)], {}, false);
  check("an 11:30 order may still take a lunch special", ok.status === 200, `${ok.status} ${ok.body.code}`);
  const late = await place(m, [line(m, "beef-broccoli")]);
  await drain(m);
  const lateOrder = (await m.repo.getOrderById(TENANT, late))!;
  await q(m, "update orders set created_at = (current_date + time '16:30') at time zone $2 where id = $1", [late, TIMEZONE]);
  const refused = await edit(m, late, 0, [...loaded(lateOrder), line(m, lunchItem.id)], {}, false);
  check("a 4:30 order may not", refused.status === 400 && refused.body.code === "rejected", `${refused.status} ${refused.body.code}`);
}

async function s5_storedPrices(m: Mods): Promise<void> {
  console.log("\n5. untouched lines keep their stored price; new lines are priced fresh");
  await reset(m);
  const id = await place(m, [line(m, "beef-broccoli", undefined, 1), line(m, "egg-rolls")]);
  await drain(m);
  // Pretend the menu has moved since: the stored line says $9.99 a unit.
  await q(
    m,
    `update orders set items = jsonb_set(jsonb_set(items, '{0,unitCents}', '999'), '{0,lineCents}', '999') where id = $1`,
    [id],
  );
  const order = (await m.repo.getOrderById(TENANT, id))!;
  const lines = loaded(order);
  lines[0].quantity = 3;
  const res = await edit(m, id, 0, [...lines, line(m, "egg-rolls", undefined, 1, "extra sauce")]);
  const after = (await m.repo.getOrderById(TENANT, id))!;
  check("the edit saves", res.status === 200, `${res.status} ${res.body.code}`);
  check("the untouched dish keeps $9.99 a unit, now x3", after.items[0].unitCents === 999 && after.items[0].lineCents === 2997, JSON.stringify(after.items[0]).slice(0, 120));
  const egg = m.types.indexItems(m.catalog.catalogMenu()).get("egg-rolls")!;
  const eggPrice = m.types.itemSizes(egg)[0].priceCents;
  check("the new line is priced from the menu", after.items[2].unitCents === eggPrice);
  const subtotal = after.items.reduce((n, l) => n + l.lineCents, 0);
  check("totals are the sum, with tax", after.totals.subtotalCents === subtotal && after.totals.taxCents === Math.round((subtotal * 875) / 10_000));
  const tampered = await edit(m, id, 1, [{ ...loaded(after)[0], unitCents: 1 } as unknown as Line]);
  check("a line carrying a price is a hard 400", tampered.status === 400);
  const moved = loaded(after);
  moved[0] = { ...moved[0], sizeId: "party-tray", modifierIds: [] };
  const resized = await edit(m, id, 1, moved);
  const r = (await m.repo.getOrderById(TENANT, id))!;
  check("a line whose size changed is priced fresh, not carried", resized.status === 200 && r.items[0].unitCents !== 999 && r.items[0].sizeId === "party-tray", `${resized.status} ${resized.body.code}`);
}

async function s6_unprinted(m: Mods): Promise<void> {
  console.log("\n6. never handed over (printer offline): the queued ticket is replaced");
  await reset(m);
  const id = await place(m, [line(m, "beef-broccoli")]);
  const order = (await m.repo.getOrderById(TENANT, id))!;
  check("no body was ever offered (ticket_revision null)", order.ticketRevision === null);
  const res = await edit(m, id, 0, [...loaded(order), line(m, "egg-rolls")]);
  check("saved as a replace, no change ticket", res.status === 200 && res.body.replaced === true && !res.body.changeTicket);
  const { rows } = await q(m, "select count(*)::int as n from order_change_tickets where order_id = $1", [id]);
  check("no change ticket row", rows[0].n === 0);
  const token = await poll(m);
  const text = await deliveryText(m, id, token!);
  check("the first ticket the kitchen sees already has the egg rolls", text.some((t) => t.includes("Egg Rolls")), text.join(" | ").slice(0, 200));
  check("and is a normal ticket, not a change ticket", !text.some((t) => t.includes("CHANGE")));
  await fetchBody(m, token!);
  await confirm(m, token!);
  check("exactly one paper ticket", (await poll(m)) === null);

  console.log("   PRINT_FAILED: replaced too, and the next 重印 prints it current");
  const failed = await place(m, [line(m, "beef-broccoli")]);
  const t1 = await poll(m);
  await q(m, "update orders set status = 'PRINT_FAILED', print_delivery_expires_at = now() - interval '1 second' where id = $1", [failed]);
  const f = (await m.repo.getOrderById(TENANT, failed))!;
  check("a failed order had been handed over", t1 !== null && f.ticketRevision === 0);
  const fr = await edit(m, failed, 0, [...loaded(f), line(m, "egg-rolls")]);
  check("its edit replaces, no change ticket", fr.status === 200 && fr.body.replaced === true && !fr.body.changeTicket);
  await m.orderAction.POST(kitchenRequest(`/api/kitchen/orders/${failed}`, { method: "POST", body: JSON.stringify({ action: "reprint" }) }), ctx(failed));
  const rt = await poll(m);
  const rtext = rt ? await deliveryText(m, failed, rt) : [];
  check("the 重印 prints the current contents", rtext.some((t) => t.includes("Egg Rolls")) && !rtext.some((t) => t.includes("CHANGE")));
}

async function s7_handedOver(m: Mods): Promise<void> {
  console.log("\n7. handed over, not confirmed: change ticket; the first ticket's retry stays at revision 0");
  await reset(m);
  const id = await place(m, [line(m, "beef-broccoli")]);
  const first = await poll(m);
  const order = (await m.repo.getOrderById(TENANT, id))!;
  check("the first ticket is out (ticket_revision 0)", first !== null && order.ticketRevision === 0);
  const res = await edit(m, id, 0, [...loaded(order), line(m, "egg-rolls")]);
  check("the edit makes a change ticket, not a replace", res.status === 200 && res.body.replaced === false && !!res.body.changeTicket, JSON.stringify(res.body).slice(0, 160));
  // The first delivery's window passes unconfirmed: the poll re-offers IT.
  await q(m, "update orders set print_delivery_expires_at = now() - interval '1 second' where id = $1", [id]);
  const retry = await poll(m);
  const text = await deliveryText(m, id, retry!);
  check("the retry is the first ticket, not the change", !text.some((t) => t.includes("CHANGE")));
  check("and renders revision 0: no egg rolls", !text.some((t) => t.includes("Egg Rolls")), text.join(" | ").slice(0, 200));
  await fetchBody(m, retry!);
  await confirm(m, retry!);
  const next = await poll(m);
  const changeText = next ? await deliveryText(m, id, next) : [];
  check("after it prints, the change ticket is offered", changeText.includes("+ 加 ADDED"));
}

async function s8_merge(m: Mods): Promise<void> {
  console.log("\n8. a waiting change ticket is widened; an offered one holds the next edit");
  await reset(m);
  const id = await place(m, [line(m, "beef-broccoli")]);
  await drain(m);
  const o0 = (await m.repo.getOrderById(TENANT, id))!;
  const e1 = await edit(m, id, 0, [...loaded(o0), line(m, "egg-rolls")]);
  const o1 = (await m.repo.getOrderById(TENANT, id))!;
  const e2 = await edit(m, id, 1, [...loaded(o1), line(m, "hot-sour-soup")]);
  check("two edits saved", e1.status === 200 && e2.status === 200, `${e2.status} ${e2.body.code}`);
  const { rows } = await q(m, "select from_revision, to_revision, payload from order_change_tickets where order_id = $1", [id]);
  check("one change ticket, widened 0 -> 2", rows.length === 1 && rows[0].from_revision === 0 && rows[0].to_revision === 2);
  check("it adds both dishes", rows[0]?.payload.diff.added.length === 2);
  const o2 = (await m.repo.getOrderById(TENANT, id))!;
  const back = await edit(m, id, 2, loaded(o2).slice(0, 1));
  const { rows: gone } = await q(m, "select count(*)::int as n from order_change_tickets where order_id = $1", [id]);
  check("edited back to what the kitchen has: the waiting ticket is dropped", back.status === 200 && gone[0].n === 0 && !(await m.repo.getOrderById(TENANT, id))!.changePending);

  const o3 = (await m.repo.getOrderById(TENANT, id))!;
  await edit(m, id, 3, [...loaded(o3), line(m, "egg-rolls")]);
  const offered = await poll(m);
  const o4 = (await m.repo.getOrderById(TENANT, id))!;
  const held = await edit(m, id, 4, [...loaded(o4), line(m, "hot-sour-soup")]);
  check("an offered change ticket refuses the next edit (409 change_printing)", offered !== null && held.status === 409 && held.body.code === "change_printing", `${held.status} ${held.body.code}`);
  await fetchBody(m, offered!);
  await confirm(m, offered!);
  const after = await edit(m, id, 4, [...loaded(o4), line(m, "hot-sour-soup")]);
  check("once it prints, the next edit makes a new ticket from revision 4", after.status === 200 && after.body.changeTicket?.fromRevision === 4);
}

async function s9_reprintChange(m: Mods): Promise<void> {
  console.log("\n9. a 重印 of a change ticket is byte-identical");
  await reset(m);
  const id = await place(m, [line(m, "beef-broccoli", undefined, 2), line(m, "mandarin-special", "party-tray")]);
  await drain(m);
  const o = (await m.repo.getOrderById(TENANT, id))!;
  const lines = loaded(o);
  lines[0].quantity = 3;
  const res = await edit(m, id, 0, lines);
  const first = await printNext(m);
  check("the change ticket prints", first !== null);
  const rep = await m.orderAction.POST(
    kitchenRequest(`/api/kitchen/orders/${id}`, { method: "POST", body: JSON.stringify({ action: "reprint", changeTicketId: res.body.changeTicketId }) }),
    ctx(id),
  );
  check("staff ask for it again", rep.status === 200, `${rep.status}`);
  const again = await printNext(m);
  check("the reprint's bytes equal the first print's", !!again && !!first && again.bytes.equals(first.bytes), `${first?.bytes.length} vs ${again?.bytes.length}`);
  const full = await m.orderAction.POST(
    kitchenRequest(`/api/kitchen/orders/${id}`, { method: "POST", body: JSON.stringify({ action: "reprint" }) }),
    ctx(id),
  );
  const fullJob = await poll(m);
  const fullText = fullJob ? await deliveryText(m, id, fullJob) : [];
  check("a plain 重印 still prints the full ticket, marked 已改 REVISED", full.status === 200 && fullText.some((t) => t.includes("已改")) && !fullText.some((t) => t.includes("CHANGE")));
}

async function s10_cases(m: Mods): Promise<void> {
  console.log("\n10. the blocks, the refusals, done orders, web orders");
  await reset(m);
  const id = await place(m, [line(m, "beef-broccoli", undefined, 2, "加辣"), line(m, "mandarin-special", "party-tray")]);
  await drain(m);
  const o = (await m.repo.getOrderById(TENANT, id))!;

  const removed = await edit(m, id, 0, loaded(o).slice(1), { dryRun: true });
  check("dry run: remove one line gives one - block, nothing written", removed.status === 200 && removed.body.diff?.removed.length === 1 && removed.body.print === "change" && (await m.repo.getOrderById(TENANT, id))!.revision === 0);
  const sized = loaded(o);
  sized[1] = { ...sized[1], sizeId: "half-tray" };
  const size = await edit(m, id, 0, sized, { dryRun: true });
  check("餐盤 -> 半盤 is one 改 line with the size field", size.body.diff?.changed.length === 1 && size.body.diff.changed[0].fields.join() === "size");
  const noted = loaded(o);
  noted[0] = { ...noted[0], specialInstructions: "走辣" };
  const note = await edit(m, id, 0, noted);
  check("a note-only edit saves", note.status === 200);
  check("and its change ticket is just the 改 note line", note.body.changeTicket?.diff.changed.length === 1 && note.body.changeTicket.diff.changed[0].fields.join() === "note" && note.body.changeTicket.diff.added.length === 0);

  const o1 = (await m.repo.getOrderById(TENANT, id))!;
  const same = await edit(m, id, 1, loaded(o1));
  check("an identical ticket is refused: 422 no_changes", same.status === 422 && same.body.code === "no_changes");
  const empty = await edit(m, id, 1, []);
  check("no lines is refused: 422 empty (use Cancel)", empty.status === 422 && empty.body.code === "empty");

  await m.orderAction.POST(kitchenRequest(`/api/kitchen/orders/${id}`, { method: "POST", body: JSON.stringify({ action: "complete" }) }), ctx(id));
  await drain(m);
  const done = (await m.repo.getOrderById(TENANT, id))!;
  const quiet = await edit(m, id, 1, [...loaded(done), line(m, "egg-rolls")]);
  check("a just-done order saves without a change ticket", quiet.status === 200 && !quiet.body.changeTicket && !(await m.repo.getOrderById(TENANT, id))!.changePending);
  const d2 = (await m.repo.getOrderById(TENANT, id))!;
  const loud = await edit(m, id, 2, [...loaded(d2), line(m, "hot-sour-soup")], { printChange: true });
  check("unless staff ask to print it", loud.status === 200 && !!loud.body.changeTicket);
  await drain(m);
  check("a done order stays COMPLETED", (await m.repo.getOrderById(TENANT, id))!.status === "COMPLETED");
  await q(m, "update orders set done_at = now() - interval '31 minutes' where id = $1", [id]);
  const stale = await edit(m, id, 3, [...loaded((await m.repo.getOrderById(TENANT, id))!), line(m, "egg-rolls")]);
  check("31 minutes after done: 409 not_editable", stale.status === 409 && stale.body.code === "not_editable");

  const cancelled = await place(m, [line(m, "beef-broccoli")]);
  await m.orderAction.POST(kitchenRequest(`/api/kitchen/orders/${cancelled}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) }), ctx(cancelled));
  const c = (await m.repo.getOrderById(TENANT, cancelled))!;
  const ce = await edit(m, cancelled, 0, [...loaded(c), line(m, "egg-rolls")]);
  check("a cancelled order: 409 not_editable", ce.status === 409 && ce.body.code === "not_editable");

  const web = await m.webOrders.POST(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `nmc_phone=${m.otp.mintToken("+16195550188")}`,
        "x-gate-bypass": BYPASS,
        "x-forwarded-for": "10.0.0.88",
      },
      body: JSON.stringify({ lines: [line(m, "beef-broccoli")], pickup: { name: "Web", phone: "6195550188", time: "asap" }, idempotencyKey: nextKey() }),
    }),
  );
  const wb = (await web.json()) as { ok: boolean; orderNumber: string };
  const { rows } = await q(m, "select id from orders where order_number = $1 and tenant_id = $2", [wb.orderNumber, TENANT]);
  const webId = Number(rows[0].id);
  const w = (await m.repo.getOrderById(TENANT, webId))!;
  const was = (w.totals.totalCents / 100).toFixed(2);
  const we = await edit(m, webId, 0, [...loaded(w), line(m, "egg-rolls")]);
  const w1 = (await m.repo.getOrderById(TENANT, webId))!;
  check("a web order is editable", we.status === 200, `${we.status} ${we.body.code}`);
  check(`its staff note says "edited by staff, was $${was}"`, (w1.staffNote ?? "").includes(`edited by staff, was $${was}`), w1.staffNote ?? "none");
  check("the staff note is not on the paper", !(await deliveryText(m, webId, (await poll(m)) ?? "")).some((t) => t.includes("edited by staff")));
}

async function s11_failure(m: Mods): Promise<void> {
  console.log("\n11. a change ticket that never prints is marked failed and alerted on");
  await reset(m);
  const id = await place(m, [line(m, "beef-broccoli")]);
  await drain(m);
  const o = (await m.repo.getOrderById(TENANT, id))!;
  await edit(m, id, 0, [...loaded(o), line(m, "egg-rolls")]);
  for (let i = 0; i < 8; i++) {
    const t = await poll(m);
    if (!t) break;
    await q(m, "update orders set print_delivery_expires_at = now() - interval '1 second' where id = $1", [id]);
  }
  const after = (await m.repo.getOrderById(TENANT, id))!;
  const { rows } = await q(m, "select failed_at, printed_at from order_change_tickets where order_id = $1", [id]);
  check("the change ticket is marked failed", rows[0]?.failed_at !== null && rows[0]?.printed_at === null);
  check("the order keeps its status (PRINTED), no change pending", after.status === "PRINTED" && !after.changePending, after.status);
  const board = await m.repo.listActiveOrders(TENANT, o.businessDate);
  const card = board.find((x) => x.id === id);
  check("the board card says the change failed, 改 ×1", card?.changeFailed === true && card.changeCount === 1);
  const due = await m.repo.findUnprintedChangeTickets(TENANT, 120, o.businessDate);
  check("the alert sweep finds it", due.length === 1 && due[0].failed);
  check("and claims it once", (await m.repo.markChangeTicketAlerted(TENANT, due[0].id)) && !(await m.repo.markChangeTicketAlerted(TENANT, due[0].id)));
}

async function s12_revisions(m: Mods): Promise<void> {
  console.log("\n12. the revisions route");
  await reset(m);
  const id = await place(m, [line(m, "beef-broccoli")]);
  await drain(m);
  const o = (await m.repo.getOrderById(TENANT, id))!;
  await edit(m, id, 0, [...loaded(o), line(m, "egg-rolls")]);
  await drain(m);
  const o1 = (await m.repo.getOrderById(TENANT, id))!;
  await edit(m, id, 1, loaded(o1).slice(1));
  const res = await m.revisions.GET(kitchenRequest(`/api/kitchen/orders/${id}/revisions`), ctx(id));
  const body = (await res.json()) as { ok: boolean; revision: number; edits: { revision: number; diff: { added: unknown[]; removed: unknown[] } }[]; original: { items: unknown[] }; changeTickets: unknown[] };
  check("200, revision 2, two edits newest first", res.status === 200 && body.revision === 2 && body.edits.map((e) => e.revision).join() === "2,1");
  check("edit 1 added, edit 2 removed", body.edits[1].diff.added.length === 1 && body.edits[0].diff.removed.length === 1);
  check("the original is the order as placed", body.original.items.length === 1);
  check("two change tickets listed", body.changeTickets.length === 2);
  const unauth = await m.revisions.GET(new Request(`http://localhost/api/kitchen/orders/${id}/revisions`), ctx(id));
  check("no session: 401", unauth.status === 401);
  const noSession = await m.edit.POST(new Request(`http://localhost/api/kitchen/orders/${id}/edit`, { method: "POST", body: "{}" }), ctx(id));
  check("edit without a session: 401", noSession.status === 401);
}

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-edit-test-"));
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
  process.env.OTP_SIGNING_SECRET = "verify-edit-order-otp-secret-0123456789abcdef";
  process.env.CLOUDPRNT_SECRET = PRINT_SECRET;
  process.env.CLOUDPRNT_PRINTER_MAC = MAC;
  process.env.TICKET_COPIES = "1";
  process.env.PRINT_CONFIRM_FLOOR_SECONDS = "25";
  process.env.PRINT_SECONDS_PER_COPY = "0";
  process.env.PRINT_OFFER_CAP = "3";
  process.env.MAX_ORDERS_PER_PHONE_PER_DAY = "50";
  delete process.env.PRINT_CONFIRM_TEST_DELAY_MS;
  delete process.env.TWILIO_ACCOUNT_SID;

  const pool = await import("../src/lib/db/postgres");
  await pool.ordersPool().query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));
  const m: Mods = {
    repo: await import("../src/lib/orders/repository"),
    pool,
    catalog: await import("../src/lib/menu/catalog"),
    types: await import("../src/lib/menu/types"),
    rice: await import("../src/lib/menu/rice"),
    render: await import("../src/lib/ticket/render"),
    session: await import("../src/lib/auth/kitchenSession"),
    rate: await import("../src/lib/http/rateLimit"),
    otp: await import("../src/lib/otp/session"),
    kitchenOrders: (await import("../src/app/api/kitchen/orders/route")) as unknown as Mods["kitchenOrders"],
    webOrders: (await import("../src/app/api/orders/route")) as unknown as Mods["webOrders"],
    edit: (await import("../src/app/api/kitchen/orders/[id]/edit/route")) as unknown as Mods["edit"],
    revisions: (await import("../src/app/api/kitchen/orders/[id]/revisions/route")) as unknown as Mods["revisions"],
    orderAction: (await import("../src/app/api/kitchen/orders/[id]/route")) as unknown as Mods["orderAction"],
    print: (await import("../src/app/api/print/[secret]/route")) as unknown as Mods["print"],
  };
  cookie = `nmc_kitchen=${m.session.login(PASSWORD)}`;

  try {
    await s1_transaction(m);
    await s2_idempotency(m);
    await s3_lock(m);
    await s4_lunch(m);
    await s5_storedPrices(m);
    await s6_unprinted(m);
    await s7_handedOver(m);
    await s8_merge(m);
    await s9_reprintChange(m);
    await s10_cases(m);
    await s11_failure(m);
    await s12_revisions(m);
  } finally {
    await pool.closeOrdersPool();
    console.log("\nstopping postgres…");
    await pg.stop();
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(`\nedit order: ${passes}/${passes + failures} checks passed`);
  if (failures > 0) {
    console.log(`\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log("\n改單: edits are recorded, priced on the server, and reach the kitchen as change tickets ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
