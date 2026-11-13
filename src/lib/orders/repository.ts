import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { ordersPool, withTransaction } from "@/lib/db/postgres";
import { checkOrderRead, checkVersionRead, noteOrderWrite } from "@/lib/db/staleReadTripwire";
import {
  formatOrderNumber,
  isOrderStatus,
  PRINT_STUCK_SECONDS,
  ACTIVE_STATUSES,
  PRINTABLE_STATUSES,
  isOrderChannel,
  TableConflictError,
  type CreateOrderResult,
  type OpenTable,
  type NewOrderInput,
  type Order,
  type OrderChannel,
  type OrderCustomer,
  type OrderLine,
  type OrderStatus,
  type OrderTotals,
  type PrintDelivery,
  type PrintDeliveryReason,
} from "@/lib/orders/types";
import {
  HISTORY_PAGE_SIZE,
  type HistoryPage,
  type HistoryQuery,
  type HistorySummary,
} from "@/lib/orders/history";
import {
  STATIONS,
  isStation,
  stationForChannel,
  type Station,
} from "@/config/stations";
import { MARK_FAILOVER_SQL } from "@/lib/print/healthStore";

/**
 * Which printer is asking, and whose tickets it prints. From
 * lib/print/printerIdentity.ts on the live path. The default is the
 * single-printer world every verifier was written against: one printer that
 * is "online" and prints for every station.
 */
export interface PrinterScope {
  station: Station;
  serves: readonly Station[];
  /**
   * Stations in `serves` ONLY because their own printer has gone silent past
   * PRINT_FAILOVER_AFTER_SECONDS (config/stations failoverStations). A ticket
   * for one of these is rerouted: see applyFailover.
   */
  failoverFrom?: readonly Station[];
}

const SINGLE_PRINTER: PrinterScope = { station: "online", serves: STATIONS };

/**
 * Fallback confirmation window, in seconds, for a hand-over whose caller did
 * not compute one (the concurrency test claims without config in front of it).
 * The real offer path always passes the scaled window from
 * confirmationWindowSeconds(); this is only so a bare claim still stamps a
 * sane, non-null expiry rather than one in the past.
 */
const DEFAULT_CONFIRM_WINDOW_SECONDS = 90;

/** The columns every delivery read returns, and their mapper. */
const DELIVERY_COLUMNS = `
  id,
  order_id,
  tenant_id,
  offered_at,
  expires_at,
  fetched_at,
  fetch_count,
  confirmed_at,
  confirm_code,
  reason,
  actor,
  station
`;

function mapDelivery(row: QueryResultRow): PrintDelivery {
  return {
    id: String(row.id),
    orderId: Number(row.order_id),
    tenantId: String(row.tenant_id),
    offeredAt: (row.offered_at as Date).toISOString(),
    expiresAt: (row.expires_at as Date).toISOString(),
    fetchedAt: row.fetched_at === null ? null : (row.fetched_at as Date).toISOString(),
    fetchCount: Number(row.fetch_count),
    confirmedAt: row.confirmed_at === null ? null : (row.confirmed_at as Date).toISOString(),
    confirmCode: row.confirm_code === null ? null : String(row.confirm_code),
    reason: String(row.reason) as PrintDeliveryReason,
    actor: row.actor === null ? null : String(row.actor),
    station: isStation(row.station) ? row.station : null,
  };
}

/**
 * The only module that knows orders live in Postgres.
 *
 * Callers (the checkout route, the printer, the kitchen board) speak in Orders
 * and never in SQL, so swapping the storage engine again is a change to this
 * file alone — which is exactly what the previous JSON store got right and
 * everything else about it got wrong.
 *
 * CORRECTNESS NOTES, because they are subtle:
 *
 *  1. Idempotency is a UNIQUE INDEX, not an if-statement. The SELECT below is
 *     a fast path only; the guarantee is `orders_idempotency_uniq`.
 *  2. The order number is allocated by ONE atomic UPSERT against a per-day
 *     counter row, whose row lock serializes concurrent checkouts. Fifty
 *     simultaneous orders get fifty distinct numbers.
 *  3. Losing the idempotency race ROLLS BACK, which returns the counter to its
 *     previous value. A lost race does not burn an order number.
 */

/** Columns every read returns, with the two date columns made unambiguous. */
const ORDER_COLUMNS = `
  id,
  tenant_id,
  order_number,
  to_char(business_date, 'YYYY-MM-DD') as business_date,
  status,
  idempotency_key,
  items,
  totals,
  customer,
  phone_verified_at,
  pickup_at,
  ready_from,
  ready_to,
  print_attempts,
  print_offered_at,
  print_delivery_id,
  print_delivery_expires_at,
  printed_at,
  last_print_error,
  alerted_at,
  channel,
  print_station,
  reprint_delivery_id,
  rerouted_from,
  payment_note,
  staff_note,
  table_label,
  guest_count,
  is_addon,
  table_cleared_at,
  created_at,
  updated_at
`;

function mapOrder(row: QueryResultRow): Order {
  const status = String(row.status);
  return {
    id: Number(row.id),
    tenantId: String(row.tenant_id),
    orderNumber: String(row.order_number),
    businessDate: String(row.business_date),
    // A status outside the union means someone wrote to the table by hand.
    // Coerce to QUEUED rather than something plausible-but-finished: an order
    // wrongly shown as needing work is recoverable, one wrongly shown as done
    // is a customer standing at a counter nobody is cooking for.
    status: isOrderStatus(status) ? status : "QUEUED",
    idempotencyKey: String(row.idempotency_key),
    items: row.items as OrderLine[],
    totals: row.totals as OrderTotals,
    customer: row.customer as OrderCustomer,
    phoneVerifiedAt: (row.phone_verified_at as Date).toISOString(),
    pickupAt: (row.pickup_at as Date).toISOString(),
    readyFrom: row.ready_from === null ? null : (row.ready_from as Date).toISOString(),
    readyTo: row.ready_to === null ? null : (row.ready_to as Date).toISOString(),
    printAttempts: Number(row.print_attempts),
    // Nullish rather than a null check: a row selected before migration 006 ran
    // has no such column at all, and `undefined` must read as "nothing in
    // flight" rather than crash the poll that is trying to print it.
    offeredAt:
      row.print_offered_at == null
        ? null
        : (row.print_offered_at as Date).toISOString(),
    printDeliveryId:
      row.print_delivery_id == null ? null : String(row.print_delivery_id),
    printDeliveryExpiresAt:
      row.print_delivery_expires_at == null
        ? null
        : (row.print_delivery_expires_at as Date).toISOString(),
    printedAt: row.printed_at === null ? null : (row.printed_at as Date).toISOString(),
    lastPrintError: row.last_print_error === null ? null : String(row.last_print_error),
    alertedAt: row.alerted_at === null ? null : (row.alerted_at as Date).toISOString(),
    // An unknown value means a hand-written row. 'web' is the reading that
    // changes nothing: no channel banner on the ticket, the ordinary badge.
    channel:
      typeof row.channel === "string" && isOrderChannel(row.channel)
        ? row.channel
        : "web",
    // Unknown means a hand-written row: the online printer, which has always
    // been the one printer that exists.
    station: isStation(row.print_station) ? row.print_station : "online",
    reprintPending: row.reprint_delivery_id != null,
    reroutedFrom: isStation(row.rerouted_from) ? row.rerouted_from : null,
    paymentNote: row.payment_note == null ? null : String(row.payment_note),
    staffNote: row.staff_note == null ? null : String(row.staff_note),
    tableLabel: row.table_label == null ? null : String(row.table_label),
    guestCount: row.guest_count == null ? null : Number(row.guest_count),
    isAddon: row.is_addon === true,
    tableClearedAt:
      row.table_cleared_at == null ? null : (row.table_cleared_at as Date).toISOString(),
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

/** An order our own write returned: remembered by the stale-read tripwire. */
function wrote(order: Order): Order {
  noteOrderWrite(order.tenantId, order.id, order.updatedAt);
  return order;
}

/** wrote(), for the many writes that may match nothing. */
function wroteOrNull(order: Order | null): Order | null {
  return order ? wrote(order) : null;
}

/** An order a plain read returned: checked against our own writes of it. */
function readBack(order: Order, where: string): Order {
  checkOrderRead(order.tenantId, order.id, order.updatedAt, where);
  return order;
}

/** Thrown internally when a concurrent transaction won the idempotency race. */
class IdempotencyRace extends Error {}

async function selectByIdempotencyKey(
  client: PoolClient,
  tenantId: string,
  idempotencyKey: string,
): Promise<Order | null> {
  // A plain read is enough: the guarantee is orders_idempotency_uniq and the
  // ON CONFLICT below, not this fast path.
  const { rows } = await client.query(
    `select ${ORDER_COLUMNS} from orders
      where tenant_id = $1 and idempotency_key = $2`,
    [tenantId, idempotencyKey],
  );
  return rows.length > 0 ? mapOrder(rows[0]) : null;
}

/**
 * Allocate the next daily number for a tenant.
 *
 * One statement, no read-then-write. The UPSERT takes a row lock on
 * (tenant_id, business_date) that is held until the surrounding transaction
 * ends, which is what serializes concurrent allocations.
 */
async function allocateSequence(
  client: PoolClient,
  tenantId: string,
  businessDate: string,
): Promise<number> {
  const { rows } = await client.query(
    `insert into order_counters (tenant_id, business_date, seq)
       values ($1, $2::date, 1)
     on conflict (tenant_id, business_date)
       do update set seq = order_counters.seq + 1
     returning seq`,
    [tenantId, businessDate],
  );
  return Number(rows[0].seq);
}

/**
 * Store a verified order. It is live the moment this returns.
 *
 * There is no payment step to sequence around any more: the row is inserted
 * QUEUED, and the printer picks it up from there. `phone_verified_at` is NOT
 * NULL in the schema, so an unverified order is not merely rejected by the
 * route — it cannot be represented.
 *
 * Returns `created: false` when the key already had a row. The caller must
 * hand back THAT order's confirmation, so a double-tap yields one ticket and
 * one order number rather than two of each.
 */
export async function createOrder(
  input: NewOrderInput,
): Promise<CreateOrderResult> {
  // Bounded: each retry means another transaction committed ahead of us, and
  // its row is then visible to the fast path on the next pass.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await withTransaction(async (client) => {
        const existing = await selectByIdempotencyKey(
          client,
          input.tenantId,
          input.idempotencyKey,
        );
        if (existing) return { order: existing, created: false };

        // Dine-in: is the table in the state this order assumes? Checked
        // here, after the idempotency fast path (a retried seating is handed
        // its original order, not refused as "occupied" by itself), and under
        // a lock, so two tablets seating table 4 at once cannot both win.
        let guestCount: number | null = null;
        if (input.dineIn) {
          guestCount = await checkTable(client, input.tenantId, input.dineIn);
        }

        const seq = await allocateSequence(
          client,
          input.tenantId,
          input.businessDate,
        );
        const orderNumber = formatOrderNumber(input.orderNumberPrefix, seq);

        const { rows } = await client.query(
          `insert into orders (
             tenant_id, order_number, business_date, status, idempotency_key,
             items, totals, customer, phone_verified_at, pickup_at,
             ready_from, ready_to, channel, payment_note, staff_note,
             table_label, guest_count, is_addon, print_station
           ) values ($1, $2, $3::date, 'QUEUED', $4, $5, $6, $7, $8, $9, $10, $11,
                     $12, $13, $14, $15, $16, $17, $18)
           on conflict (tenant_id, idempotency_key) do nothing
           returning ${ORDER_COLUMNS}`,
          [
            input.tenantId,
            orderNumber,
            input.businessDate,
            input.idempotencyKey,
            // jsonb params MUST be pre-stringified: node-pg would otherwise
            // render `items` (an array) as a Postgres array literal, not JSON.
            JSON.stringify(input.items),
            JSON.stringify(input.totals),
            JSON.stringify(input.customer),
            input.phoneVerifiedAt,
            input.pickupAt,
            input.readyFrom ?? null,
            input.readyTo ?? null,
            input.channel ?? "web",
            input.paymentNote ?? null,
            input.staffNote ?? null,
            input.dineIn?.tableLabel ?? null,
            guestCount,
            input.dineIn?.isAddon ?? false,
            // The printer is decided here, once, from the channel. Nothing
            // downstream re-derives it: reprint can move it, nothing else does.
            stationForChannel(input.channel ?? "web"),
          ],
        );

        // Nothing came back: a concurrent transaction committed this key while
        // we were mid-flight. Throwing rolls back — which also returns the
        // counter we just incremented, so no number is wasted.
        if (rows.length === 0) throw new IdempotencyRace();

        return { order: mapOrder(rows[0]), created: true };
      });
      if (result.created) wrote(result.order);
      return result;
    } catch (err) {
      if (err instanceof IdempotencyRace) continue;
      throw err;
    }
  }

  // Three lost races in a row is not concurrency, it is a bug.
  throw new Error(
    "Could not store the order after 3 attempts (idempotency contention).",
  );
}

/**
 * The open-table rule, enforced inside createOrder's transaction.
 *
 * A transaction-scoped advisory lock per tenant serializes every dine-in
 * insert, so the read below and the insert after it are one decision. Seating
 * is a handful of writes an hour; the lock costs nothing.
 *
 *   - A NEW party may not sit at a table any open label already covers: "4"
 *     is refused while "4+5" is open, and "4+5" while "4" is.
 *   - An ADD-ON needs an open seating with exactly its label, and takes that
 *     seating's guest count rather than trusting the request.
 *
 * Returns the guest count to store. Throws TableConflictError otherwise.
 */
async function checkTable(
  client: PoolClient,
  tenantId: string,
  dineIn: NonNullable<NewOrderInput["dineIn"]>,
): Promise<number> {
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [
    `nmc-tables:${tenantId}`,
  ]);
  const { rows } = await client.query(
    `select table_label, guest_count, is_addon
       from orders
      where tenant_id = $1
        and channel = 'dine_in'
        and table_cleared_at is null
        and status <> 'CANCELLED'
      order by created_at asc`,
    [tenantId],
  );
  const open = rows.map((r) => ({
    label: String(r.table_label),
    guests: r.guest_count == null ? null : Number(r.guest_count),
    isAddon: r.is_addon === true,
  }));

  if (dineIn.isAddon) {
    const seating = open.find((o) => o.label === dineIn.tableLabel);
    if (!seating) throw new TableConflictError("not_open", dineIn.tableLabel);
    return seating.guests ?? dineIn.guestCount;
  }

  const wanted = new Set(dineIn.tableIds);
  const taken = open.find((o) => o.label.split("+").some((id) => wanted.has(id)));
  if (taken) throw new TableConflictError("occupied", dineIn.tableLabel);
  return dineIn.guestCount;
}

/**
 * Every open table, for the POS floor plan. Derived, never stored: a table is
 * open while it has a dine-in order with no table_cleared_at. Cancelled orders
 * do not hold a table, so seating a party in error and cancelling its only
 * order frees the table without a separate step.
 */
export async function listOpenTables(tenantId: string): Promise<OpenTable[]> {
  // Display only. Seating is decided by checkTable, under createOrder's
  // advisory lock, not from this list.
  const { rows } = await ordersPool().query(
    `select table_label,
            (array_agg(guest_count order by is_addon asc, created_at asc))[1] as guest_count,
            min(created_at)                                         as seated_at,
            count(*)::int                                           as order_count,
            array_agg(order_number order by created_at asc)         as order_numbers,
            coalesce(sum((totals->>'totalCents')::bigint), 0)::bigint as total_cents
       from (
         select table_label, guest_count, is_addon, created_at, order_number, totals
           from orders
          where tenant_id = $1
            and channel = 'dine_in'
            and table_cleared_at is null
            and status <> 'CANCELLED'
       ) open_orders
      group by table_label
      order by min(created_at) asc`,
    [tenantId],
  );
  return rows.map((r) => ({
    tableLabel: String(r.table_label),
    guestCount: r.guest_count == null ? null : Number(r.guest_count),
    seatedAt: (r.seated_at as Date).toISOString(),
    orderCount: Number(r.order_count),
    orderNumbers: (r.order_numbers as unknown[]).map(String),
    totalCents: Number(r.total_cents),
  }));
}

/**
 * 清台: the party has left. Stamps table_cleared_at on every open order at
 * this label, which is what frees the table.
 *
 * Orders the kitchen has a paper copy of (PRINTED, ACCEPTED) are marked
 * COMPLETED with it: the food was served, the party paid and went. A QUEUED or
 * PRINT_FAILED order keeps its status, so clearing a table can never pull a
 * ticket out of the print queue before it reaches the kitchen. It just stops
 * holding the table.
 *
 * Returns the orders it cleared; an empty list means the table was not open.
 */
export async function clearTable(tenantId: string, tableLabelValue: string): Promise<Order[]> {
  const { rows } = await ordersPool().query(
    `update orders
        set table_cleared_at = now(),
            status = case when status in ('PRINTED', 'ACCEPTED') then 'COMPLETED' else status end,
            updated_at = now()
      where tenant_id = $1
        and channel = 'dine_in'
        and table_label = $2
        and table_cleared_at is null
      returning ${ORDER_COLUMNS}`,
    [tenantId, tableLabelValue],
  );
  return rows.map((r) => wrote(mapOrder(r)));
}

/**
 * Claim the oldest UNCLAIMED order for the printer, atomically.
 *
 * "Unclaimed" is `print_attempts = 0`, and that is the whole trick. Status
 * alone cannot express it: a claimed job stays QUEUED on purpose (only the
 * printer's DELETE may set PRINTED), so without the attempts guard a second
 * poll would happily claim the same ticket again and the kitchen would get
 * two of it.
 *
 * The guard is re-evaluated by the outer UPDATE, under the row lock the UPDATE
 * itself takes. Two concurrent claims therefore serialize: the winner sets
 * attempts to 1, and the loser re-checks after that commit, matches nothing,
 * and returns null. `FOR UPDATE SKIP LOCKED` in the subselect makes them pick
 * different candidate rows in the first place, so the common case does not
 * even reach that contention.
 *
 * NOTE the claim does NOT mark the order printed — it only counts an attempt.
 * A job handed over and never confirmed stays QUEUED so the unprinted-order
 * alert still catches it.
 *
 * The delivery pointer (print_delivery_id + print_delivery_expires_at) is
 * stamped in the SAME statement as the attempt counter, and a print_deliveries
 * row is inserted in the same transaction. Every caller answers the poll with
 * jobReady:true, so counting an attempt and handing over a body are one event;
 * stamping them separately would leave a window in which a second poll saw
 * attempts=1 with nothing identifiably in flight and handed the same body over
 * again. The whole change is that the offer path now measures against the
 * delivery identity, not the self-clearing print_offered_at.
 */
/**
 * "This order needs paper from one of these printers", as a SQL predicate on
 * an `orders` row. Two ways to need paper:
 *
 *   - its FIRST print: status QUEUED (PRINTABLE_STATUSES), on its own
 *     station, with no 重印 pending;
 *   - a 重印 COPY: orders.reprint_delivery_id names a manual_reprint row, and
 *     that row's station is one of these printers. Whatever the order's
 *     status: a reprint of an ACCEPTED order leaves it ACCEPTED. Never a
 *     CANCELLED one.
 *
 * `statuses` and `stations` are the placeholders ("$2", "$5") holding
 * PRINTABLE_STATUSES and the printer's served stations. Every query that
 * decides what a printer may be handed (claim, in-flight, re-offer, the
 * strip's queued count) uses this one definition, so they cannot disagree.
 */
function needsPaperFrom(statuses: string, stations: string): string {
  return `(
    (orders.reprint_delivery_id is null
      and orders.status = any(${statuses}::text[])
      and orders.print_station = any(${stations}::text[]))
    or (orders.reprint_delivery_id is not null
      and orders.status <> 'CANCELLED'
      and exists (
        select 1 from print_deliveries r
         where r.id = orders.reprint_delivery_id
           and r.station = any(${stations}::text[])))
  )`;
}

/**
 * TIMED FAILOVER, at the moment a printer is handed a ticket.
 *
 * If the ticket is here only because its own station's printer has gone
 * silent (scope.failoverFrom), record that, in the claim's transaction:
 *
 *   - orders.rerouted_from = the station it was meant for, so the ticket
 *     header says REROUTED FROM it;
 *   - a first print moves to the printer that took it (print_station), so
 *     the board, the alert and a returning printer all agree whose it is now;
 *     a 重印 copy leaves print_station alone (a copy never moves an order);
 *   - that station's failover_since is stamped (kept if already set), which is
 *     what the owner's one "rerouting" text is sent from.
 *
 * The hand-over itself is untouched: same delivery row (its station is the
 * printer that took it), same body, same window.
 */
async function applyFailover(
  client: PoolClient,
  tenantId: string,
  order: Order,
  scope: PrinterScope,
): Promise<Order> {
  const from = scope.failoverFrom ?? [];
  if (from.length === 0) return order;
  let target: Station = order.station;
  if (order.reprintPending) {
    const { rows } = await client.query(
      `select r.station from orders o join print_deliveries r on r.id = o.reprint_delivery_id
        where o.tenant_id = $1 and o.id = $2`,
      [tenantId, order.id],
    );
    if (rows.length > 0 && isStation(rows[0].station)) target = rows[0].station;
  }
  if (target === scope.station || !from.includes(target)) return order;
  const { rows } = await client.query(
    `update orders
        set rerouted_from = $3,
            print_station = case when reprint_delivery_id is null then $4 else print_station end,
            updated_at = now()
      where tenant_id = $1 and id = $2
      returning ${ORDER_COLUMNS}`,
    [tenantId, order.id, target, scope.station],
  );
  await client.query(MARK_FAILOVER_SQL, [tenantId, target]);
  return rows.length > 0 ? mapOrder(rows[0]) : order;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when a string is a UUID. Confirmation and fetch tokens are now delivery
 * ids; a token that is not a UUID — an order-number token from firmware still
 * holding a pre-deploy job, or garbage — resolves to no delivery rather than
 * making Postgres throw on a bad `uuid` cast.
 */
function isDeliveryId(value: string): boolean {
  return UUID_RE.test(value);
}

/** Insert one hand-over row. Its expires_at matches the order pointer's because
 *  both are `now() + window` evaluated at the same transaction timestamp. */
async function insertDelivery(
  client: PoolClient,
  params: {
    id: string;
    orderId: number;
    tenantId: string;
    windowSeconds: number;
    reason: PrintDeliveryReason;
    actor: string;
    /** The printer being handed this body. */
    station: Station;
  },
): Promise<void> {
  await client.query(
    `insert into print_deliveries
       (id, order_id, tenant_id, offered_at, expires_at, reason, actor, station)
     values ($1, $2, $3, now(), now() + make_interval(secs => $4), $5, $6, $7)`,
    [
      params.id,
      params.orderId,
      params.tenantId,
      params.windowSeconds,
      params.reason,
      params.actor,
      params.station,
    ],
  );
}

export async function claimNextPrintJob(
  tenantId: string,
  windowSeconds: number = DEFAULT_CONFIRM_WINDOW_SECONDS,
  /**
   * The polling printer. It only ever claims its own stations' tickets, so the
   * two printers each have their own head of line and print side by side; a
   * web order cannot come out of the counter printer, or the reverse.
   */
  scope: PrinterScope = SINGLE_PRINTER,
): Promise<Order | null> {
  return wroteOrNull(await withTransaction(async (client) => {
    const deliveryId = randomUUID();
    const { rows } = await client.query(
      `update orders
          set print_attempts            = print_attempts + 1,
              print_offered_at          = now(),
              print_delivery_id         = $3,
              print_delivery_expires_at = now() + make_interval(secs => $4),
              updated_at                = now()
        where id = (
          select id from orders
           where tenant_id = $1
             and print_attempts = 0
             and ${needsPaperFrom("$2", "$5")}
           order by created_at asc
           for update skip locked
           limit 1
        )
          -- Re-checked here, under this statement's own row lock: this is what
          -- makes two simultaneous claims impossible, not the subselect. The
          -- station too: a 重印 to the other printer between the subselect and
          -- this write must not let this printer take it.
          and print_attempts = 0
          and ${needsPaperFrom("$2", "$5")}
        returning ${ORDER_COLUMNS}`,
      [tenantId, PRINTABLE_STATUSES, deliveryId, windowSeconds, [...scope.serves]],
    );
    if (rows.length === 0) return null;
    const order = await applyFailover(client, tenantId, mapOrder(rows[0]), scope);
    await insertDelivery(client, {
      id: deliveryId,
      orderId: order.id,
      tenantId,
      windowSeconds,
      reason: "first-offer",
      actor: "printer",
      station: scope.station,
    });
    return order;
  }));
}

/**
 * The job a printer is mid-transaction on: already claimed (attempts > 0) but
 * not yet confirmed by a DELETE. Returned so a repeated poll or GET before the
 * confirmation gets the SAME ticket rather than a second one.
 */
export async function currentPrintJob(
  tenantId: string,
  /** Only this printer's stations: the other printer's job in flight is not ours to re-offer. */
  serves: readonly Station[] = STATIONS,
): Promise<Order | null> {
  // FOR UPDATE, kept on purpose, and the ONLY locking read left outside a
  // write. The poll's offer/hold/cap decision is made from this row, and the
  // lock orders that read against the printer's own writes to it: a
  // confirmation (confirmPrintDelivery) or a re-offer still in progress is
  // waited for, and the row re-read after it commits, instead of being read
  // around. Without it, a poll racing its own DELETE could decide "capped"
  // from the pre-confirm row and condemn a ticket that just printed.
  //
  // It cannot make claimNextPrintJob skip a QUEUED ticket: it only ever locks
  // rows with print_attempts > 0, and the claim only considers rows with
  // print_attempts = 0. One statement, so the lock is released as it returns.
  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS} from orders
      where tenant_id = $1
        and print_attempts > 0
        and ${needsPaperFrom("$2", "$3")}
      order by created_at asc
      limit 1
      for update`,
    [tenantId, PRINTABLE_STATUSES, [...serves]],
  );
  return rows.length > 0 ? mapOrder(rows[0]) : null;
}

/**
 * RE-OFFER a job already in flight under a NEW delivery identity.
 *
 * Replaces the old bumpPrintAttempt. That one only ticked the counter and
 * re-stamped print_offered_at; the decision then rested on a timestamp the
 * offer path cleared itself, which could not tell a dead print from a late
 * confirmation. Now every re-offer is a fresh delivery with its own id and
 * expiry, so a confirmation for the PREVIOUS hand-over can no longer be
 * mistaken for this one, and the printer is handed a genuinely new URL.
 *
 * Called ONLY when the poll is about to answer jobReady:true for a job that is
 * already claimed (verdict retry, or a continuation piece) — see claimNextPrintJob
 * for why the counter, the stamp and the delivery move together.
 */
export async function reofferPrintDelivery(
  tenantId: string,
  orderId: number,
  windowSeconds: number,
  reason: Exclude<PrintDeliveryReason, "manual_reprint">,
  /**
   * The delivery the caller decided to replace: the print_delivery_id it read
   * (null when nothing was in flight). The write only happens if that is still
   * the order's delivery. This is what makes a decision taken on a stale read
   * harmless: if anything re-offered or confirmed since, nothing is written.
   */
  supersedes: string | null,
  /** The printer being handed the new body. */
  station: Station = "online",
  /** Its failover stations (PrinterScope.failoverFrom): a takeover is a reroute. */
  failoverFrom: readonly Station[] = [],
): Promise<Order | null> {
  return wroteOrNull(await withTransaction(async (client) => {
    const deliveryId = randomUUID();
    const { rows } = await client.query(
      `update orders
          set print_attempts            = print_attempts + 1,
              print_offered_at          = now(),
              print_delivery_id         = $3,
              print_delivery_expires_at = now() + make_interval(secs => $4),
              -- A re-offer publishes a new body under a delivery-scoped key, so
              -- clear the old one: publishJobBody must re-render for this
              -- delivery rather than point the printer back at the previous
              -- delivery's object.
              print_job_key             = null,
              updated_at                = now()
        where tenant_id = $1 and id = $2
          -- STATUS GUARD. A re-offer must never resurrect a finished order.
          -- currentPrintJob filters status at read time, but a confirm can flip
          -- the row to PRINTED between that read and this write — the exact race
          -- that reprinted an order 49s after it was confirmed. Re-checking
          -- status here, under this UPDATE's own row lock, makes the write
          -- refuse a PRINTED / CANCELLED / PRINT_FAILED order regardless of any
          -- pointer or timestamp left on it. (Unless a 重印 copy of it is
          -- pending: then it is the copy being re-offered, and status is not
          -- the reprint's to change. The station is the caller's, already
          -- checked by currentPrintJob, so any station passes here.)
          and ${needsPaperFrom("$5", "$7")}
          -- BELT AND BRACES, the same race seen from the delivery side: never
          -- re-offer while the delivery being superseded is already confirmed.
          and not exists (
            select 1 from print_deliveries d
             where d.id = orders.print_delivery_id
               and d.confirmed_at is not null
          )
          -- COMPARE-AND-SET on the delivery identity. Only replace the delivery
          -- the caller actually saw; a second poll that decided from an older
          -- picture finds a different id here and writes nothing.
          and print_delivery_id is not distinct from $6::uuid
          -- And never inside a live window, whatever the caller believed: the
          -- delivery being replaced must have expired (or there is none).
          and (print_delivery_id is null or print_delivery_expires_at <= now())
        returning ${ORDER_COLUMNS}`,
      [tenantId, orderId, deliveryId, windowSeconds, PRINTABLE_STATUSES, supersedes, [...STATIONS]],
    );
    // No row matched: the order is no longer offerable (status changed, or its
    // current delivery was already confirmed). Do NOT create a delivery.
    if (rows.length === 0) return null;
    const order = await applyFailover(client, tenantId, mapOrder(rows[0]), {
      station,
      serves: STATIONS,
      failoverFrom,
    });
    await insertDelivery(client, {
      id: deliveryId,
      orderId,
      tenantId,
      windowSeconds,
      reason,
      actor: "printer",
      station,
    });
    return order;
  }));
}

/** Read one delivery by id, or null for an unknown/malformed token. */
export async function getPrintDelivery(
  tenantId: string,
  deliveryId: string,
): Promise<PrintDelivery | null> {
  if (!isDeliveryId(deliveryId)) return null;
  // A plain read. Confirming is decided again inside confirmPrintDelivery's
  // transaction, under its own FOR UPDATE on this row.
  const { rows } = await ordersPool().query(
    `select ${DELIVERY_COLUMNS} from print_deliveries
      where tenant_id = $1 and id = $2`,
    [tenantId, deliveryId],
  );
  return rows.length > 0 ? mapDelivery(rows[0]) : null;
}

/**
 * Count one fetch of a delivery's body, stamping fetched_at the first time.
 *
 * This is the write the GET path never made. A printer that fetches the same
 * body twice on its own — the silent double-print — now shows fetch_count = 2
 * instead of being invisible. Returns the new count, or null for an unknown
 * token.
 *
 * NOTE this counts only fetches that come THROUGH the Worker (the fallback GET,
 * and every fetch in the test harness). In production the primary path is a
 * direct R2 object GET that never reaches the Worker, so a re-fetch there is
 * counted by R2 access logs, not here — the per-delivery object key and the
 * delete-on-confirm are what stop it printing twice on that path.
 */
export async function recordDeliveryFetch(
  tenantId: string,
  deliveryId: string,
): Promise<number | null> {
  if (!isDeliveryId(deliveryId)) return null;
  const { rows } = await ordersPool().query(
    `update print_deliveries
        set fetch_count = fetch_count + 1,
            fetched_at  = coalesce(fetched_at, now())
      where tenant_id = $1 and id = $2
      returning fetch_count`,
    [tenantId, deliveryId],
  );
  return rows.length > 0 ? Number(rows[0].fetch_count) : null;
}

/** What confirmPrintDelivery did — one line per outcome for the log. */
export type ConfirmDeliveryKind =
  | "already" // already confirmed: a stale replay or a race with another DELETE
  | "printed" // final piece confirmed; the order is now PRINTED
  | "advanced" // a non-final piece confirmed; the cursor moved to the next
  | "closed" // delivery closed without printing (late, outside the grace window)
  | "failed" // failure code; the order is re-armed to re-offer
  | "reprinted" // a 重印 copy printed; the order's status was left alone
  | "not-printable"; // staff had already advanced the order past printing

export interface ConfirmDeliveryResult {
  kind: ConfirmDeliveryKind;
  orderNumber: string;
  status: OrderStatus;
  /** The R2 object to delete AFTER the transaction commits, or null. */
  jobKey: string | null;
  segment: number;
  segments: number;
  nextSegment: number | null;
}

export interface ConfirmDeliveryInput {
  /** The DELETE's result code, stored verbatim on the delivery. */
  code: string | null;
  /** "success" honours the print; "failure" re-arms the order to re-offer. */
  outcome: "success" | "failure";
  /**
   * When false, close the delivery but do NOT mark the order printed — for a
   * late confirmation outside the grace window, where dragging a PRINT_FAILED
   * order back to PRINTED is exactly what we do not want.
   */
  markPrinted: boolean;
  /** Recorded on the order for the board when outcome is "failure". */
  failError?: string;
}

/**
 * CLOSE a specific delivery and the order it belongs to, ATOMICALLY.
 *
 * This is the half of the fix that does not depend on timing. It replaces the
 * old revoke → (network R2 delete) → markPrinted sequence, which left the row
 * for ~one network round-trip in the exact state — QUEUED, attempts>0, no stamp
 * — that the old offer path re-offered on the very next poll. Everything here
 * is one transaction: the delivery is marked confirmed, the order is closed
 * (PRINTED, or the split cursor advanced), and the pointer is cleared, so that
 * window cannot exist. The R2 delete is the CALLER's job, AFTER this commits;
 * a dangling object is harmless once the delivery is closed.
 *
 * Resolves the delivery by id and confirms ONLY that one. A second DELETE for a
 * delivery already confirmed returns kind "already" and writes nothing —
 * confirmations are idempotent by identity, not by "whatever is in flight now".
 */
export async function confirmPrintDelivery(
  tenantId: string,
  deliveryId: string,
  input: ConfirmDeliveryInput,
): Promise<ConfirmDeliveryResult | null> {
  if (!isDeliveryId(deliveryId)) return null;

  // A fixed fragment (no interpolated input): clears everything that says the
  // printer is holding a body for this order.
  const CLEAR_POINTER = `print_job_key             = null,
              print_offered_at          = null,
              print_delivery_id         = null,
              print_delivery_expires_at = null`;
  // And, once a copy is finished one way or the other, the 重印 it was for.
  const CLEAR_REPRINT = `reprint_delivery_id = null`;

  return withTransaction(async (client) => {
    const d = await client.query(
      `select order_id, confirmed_at from print_deliveries
        where tenant_id = $1 and id = $2 for update`,
      [tenantId, deliveryId],
    );
    if (d.rows.length === 0) return null;
    const orderId = Number(d.rows[0].order_id);

    const o = await client.query(
      `select order_number, status, print_segment, print_segments, print_job_key,
              reprint_delivery_id
         from orders where tenant_id = $1 and id = $2 for update`,
      [tenantId, orderId],
    );
    const orderNumber = o.rows.length > 0 ? String(o.rows[0].order_number) : "?";
    const status = (o.rows.length > 0 ? String(o.rows[0].status) : "QUEUED") as OrderStatus;
    const segment = o.rows.length > 0 ? Number(o.rows[0].print_segment) : 0;
    const segments = o.rows.length > 0 ? Number(o.rows[0].print_segments) : 0;
    const jobKey =
      o.rows.length > 0 && o.rows[0].print_job_key !== null
        ? String(o.rows[0].print_job_key)
        : null;
    const reprinting = o.rows.length > 0 && o.rows[0].reprint_delivery_id !== null;

    if (d.rows[0].confirmed_at !== null) {
      return { kind: "already", orderNumber, status, jobKey: null, segment, segments, nextSegment: null };
    }

    // The delivery has been accounted for on every path from here.
    await client.query(
      `update print_deliveries set confirmed_at = now(), confirm_code = $3
        where tenant_id = $1 and id = $2`,
      [tenantId, deliveryId, input.code],
    );

    // TEST-ONLY seam. Holds the transaction open between closing the delivery
    // and closing the order — the exact window the old route.ts:699→771 sequence
    // left, where a poll landing in it re-offered the job. A poll arriving here
    // now reads the PRE-COMMIT snapshot via MVCC (delivery still in flight,
    // within its window) and correctly holds; the re-offer cannot happen because
    // these two writes are one transaction. Never set in production
    // (PRINT_CONFIRM_TEST_DELAY_MS unset -> Number(undefined ?? "0") === 0).
    const testDelayMs = Number(process.env.PRINT_CONFIRM_TEST_DELAY_MS ?? "0");
    if (testDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, testDelayMs));
    }

    if (input.outcome === "failure") {
      // A reported print failure (e.g. 520 download failed). Re-arm the order —
      // keep its status so the next poll re-offers a fresh delivery — and record
      // the error for the board. The offer cap still condemns after enough tries.
      await client.query(
        `update orders set last_print_error = $3, ${CLEAR_POINTER}, updated_at = now()
          where tenant_id = $1 and id = $2`,
        [tenantId, orderId, input.failError ?? "printer reported a print failure"],
      );
      return { kind: "failed", orderNumber, status, jobKey, segment, segments, nextSegment: null };
    }

    if (!input.markPrinted) {
      // Late confirmation outside the grace window: close the delivery, clear
      // the pointer, but leave the order where it is.
      await client.query(
        `update orders set ${CLEAR_POINTER}, ${CLEAR_REPRINT}, updated_at = now()
          where tenant_id = $1 and id = $2`,
        [tenantId, orderId],
      );
      return { kind: "closed", orderNumber, status, jobKey, segment, segments, nextSegment: null };
    }

    // A split ticket completes the ORDER only on its last piece; an earlier
    // piece advances the cursor and stays QUEUED so the next poll hands over the
    // next piece. print_attempts back to 1 so a multi-piece ticket does not
    // spend its way toward the cap for doing exactly what was asked.
    if (segments > 1 && segment + 1 < segments) {
      const adv = await client.query(
        `update orders
            set print_segment   = print_segment + 1,
                print_attempts  = 1,
                last_print_error = null,
                ${CLEAR_POINTER},
                updated_at = now()
          where tenant_id = $1 and id = $2 and print_segment = $3
          returning print_segment`,
        [tenantId, orderId, segment],
      );
      const nextSegment = adv.rows.length > 0 ? Number(adv.rows[0].print_segment) : segment + 1;
      return { kind: "advanced", orderNumber, status, jobKey, segment, segments, nextSegment };
    }

    // An order that had never made it onto paper (QUEUED, or PRINT_FAILED and
    // now printed after all) is PRINTED by this, whether the copy was its
    // first print or a 重印: the paper is real either way.
    const printed = await client.query(
      `update orders
          set status = 'PRINTED',
              printed_at = now(),
              last_print_error = null,
              print_segment = 0,
              print_segments = 0,
              ${CLEAR_POINTER},
              ${CLEAR_REPRINT},
              updated_at = now()
        where tenant_id = $1 and id = $2 and status in ('QUEUED', 'PRINT_FAILED')
        returning status`,
      [tenantId, orderId],
    );
    if (printed.rows.length > 0) {
      return { kind: "printed", orderNumber, status: "PRINTED", jobKey, segment, segments, nextSegment: null };
    }

    // markPrinted matched nothing: the order is past printing (PRINTED,
    // ACCEPTED, COMPLETED). For a 重印 copy that is the normal ending: the copy
    // is out and the order stays exactly where it was on the board. Otherwise
    // staff advanced it while the printer held it. Either way, clear the
    // pointer so it stops being offered, and never drag it back to PRINTED.
    await client.query(
      `update orders
          set print_segment = 0,
              print_segments = 0,
              ${CLEAR_POINTER},
              ${CLEAR_REPRINT},
              updated_at = now()
        where tenant_id = $1 and id = $2`,
      [tenantId, orderId],
    );
    return {
      kind: reprinting ? "reprinted" : "not-printable",
      orderNumber,
      status,
      jobKey,
      segment,
      segments,
      nextSegment: null,
    };
  });
}

/* ------------------------------------------------- split-ticket sequence -- */

/**
 * Where we are in a ticket the printer cannot take in one piece.
 *
 * `segments` is 0 before the first piece of a ticket has been handed over —
 * i.e. we have not yet rendered it and do not know whether it splits at all.
 */
export interface PrintSegmentState {
  segment: number;
  segments: number;
  /** R2 object holding the body currently on offer, or null if none. */
  jobKey: string | null;
}

export async function printSegmentState(
  tenantId: string,
  orderId: number,
): Promise<PrintSegmentState> {
  const { rows } = await ordersPool().query(
    `select print_segment, print_segments, print_job_key from orders
      where tenant_id = $1 and id = $2`,
    [tenantId, orderId],
  );
  if (rows.length === 0) return { segment: 0, segments: 0, jobKey: null };
  return {
    segment: Number(rows[0].print_segment),
    segments: Number(rows[0].print_segments),
    jobKey: rows[0].print_job_key === null ? null : String(rows[0].print_job_key),
  };
}

/**
 * Remember where this order's published body lives.
 *
 * Written once when the body is uploaded, then read on every re-offer — which
 * is the whole point: the key contains the sha256 of the body, so without this
 * every poll would have to re-render the ticket just to work out the URL.
 */
export async function recordPrintJobKey(
  tenantId: string,
  orderId: number,
  key: string | null,
): Promise<void> {
  await ordersPool().query(
    `update orders set print_job_key = $3, updated_at = now()
      where tenant_id = $1 and id = $2`,
    [tenantId, orderId, key],
  );
}

/** Record how many pieces this ticket turned out to be, at hand-over. */
export async function recordPrintSegments(
  tenantId: string,
  orderId: number,
  segments: number,
): Promise<void> {
  await ordersPool().query(
    `update orders set print_segments = $3, updated_at = now()
      where tenant_id = $1 and id = $2`,
    [tenantId, orderId, segments],
  );
}

/**
 * PAPER IS BACK — put back what the outage broke.
 *
 * Called once, on the blocked→unblocked edge (see healthStore.recordPoll,
 * which reports that edge atomically so two polls cannot both fire this).
 *
 * WHICH ORDERS. Everything condemned to PRINT_FAILED since the outage began,
 * with a lead-in: `since` is the moment the printer first reported the
 * condition, and the grace is because the failure that matters usually happens
 * just BEFORE the printer admits anything. The roll runs out mid-job, the job
 * is never confirmed, the confirmation window expires a few times, the order
 * is condemned — and only then, or in amongst it, does the status flip. An
 * outage window with no lead-in would leave exactly those orders behind.
 *
 * WHY A TIME WINDOW AND NOT `last_print_error LIKE '%paper%'`. The server never
 * writes the word paper into that column: an order dies of "no print
 * confirmation after N hand-overs" whatever the physical reason was. The
 * outage is the thing that is actually known, so the outage is what is matched
 * on.
 *
 * IDEMPOTENT BY CONSTRUCTION. The WHERE clause requires PRINT_FAILED, so a
 * second call matches nothing — the first one already moved them to QUEUED.
 * That, not a flag, is what makes "requeued once" true.
 *
 * The counters reset exactly as a staff 重印 resets them, and for the same
 * reason: this is a fresh attempt, and it must not inherit a budget that a
 * dead printer already spent. Nothing here can double-print — the order goes
 * back to QUEUED with no body in flight, and the confirmation window governs
 * the re-offer from there like any other job.
 */
export async function requeueAfterPrinterRestored(
  tenantId: string,
  since: Date,
  graceSeconds: number,
  /**
   * Only the recovered printer's stations. Paper back in the store printer says
   * nothing about an online ticket that died of something else.
   */
  serves: readonly Station[] = STATIONS,
): Promise<string[]> {
  const { rows } = await ordersPool().query(
    `update orders
        set status = 'QUEUED',
            print_attempts = 0,
            print_offered_at = null,
            print_delivery_id = null,
            print_delivery_expires_at = null,
            print_job_key = null,
            print_segment = 0,
            print_segments = 0,
            last_print_error = null,
            alerted_at = null,
            alert_attempts = 0,
            updated_at = now()
      where tenant_id = $1
        and status = 'PRINT_FAILED'
        and updated_at >= $2::timestamptz - make_interval(secs => $3)
        and print_station = any($4::text[])
      returning order_number`,
    [tenantId, since.toISOString(), graceSeconds, [...serves]],
  );
  return rows.map((r) => String(r.order_number));
}

/** How many orders are waiting for the printer right now. */
export async function countQueuedOrders(
  tenantId: string,
  /** Waiting on THIS printer: the stations it prints for. */
  stations: readonly Station[] = STATIONS,
): Promise<number> {
  // Tickets and 重印 copies alike: whatever this printer still owes paper.
  // No lock: it used to FOR SHARE every waiting ticket, which is exactly the
  // set the printer's FOR UPDATE SKIP LOCKED claim was trying to take.
  const { rows } = await ordersPool().query(
    `select count(*)::int as n from orders
      where tenant_id = $1
        and ${needsPaperFrom("$3", "$2")}`,
    [tenantId, [...stations], PRINTABLE_STATUSES],
  );
  return rows.length > 0 ? Number(rows[0].n) : 0;
}

/** The printer confirmed it printed. The ONLY path to PRINTED. */
export async function markPrinted(
  tenantId: string,
  orderId: number,
): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    `update orders
        set status = 'PRINTED',
            printed_at = now(),
            last_print_error = null,
            -- The sequence is done; the next print of this order starts over.
            print_segment = 0,
            print_segments = 0,
            print_job_key = null,
            print_offered_at = null,
            print_delivery_id = null,
            print_delivery_expires_at = null,
            reprint_delivery_id = null,
            updated_at = now()
      where tenant_id = $1
        and id = $2
        -- Never drag an order staff have already advanced back to PRINTED.
        and status in ('QUEUED', 'PRINT_FAILED')
      returning ${ORDER_COLUMNS}`,
    [tenantId, orderId],
  );
  return rows.length > 0 ? wrote(mapOrder(rows[0])) : null;
}

/**
 * Staff pressed 重印: ask a printer for one more copy of this ticket.
 *
 * THE ORDER DOES NOT MOVE. Status is never written here: an ACCEPTED order
 * stays ACCEPTED, a COMPLETED one COMPLETED, and the board keeps it exactly
 * where it was. (This used to reset the order to QUEUED, which pulled an
 * accepted ticket back to "new" on every tablet.) What a reprint writes:
 *
 *   - ONE print_deliveries row, reason `manual_reprint`, actor and the station
 *     picked. It is the request, and the record that explains the second
 *     ticket: a second ticket that carries one is legitimate, one that does
 *     not is a bug by definition. Its offered_at = expires_at = now(), so it
 *     never reads as a body in flight.
 *   - the order's print bookkeeping (never its status): reprint_delivery_id
 *     points at that row, which is how the printer finds an order whose status
 *     says it is long past printing (see needsPaperFrom), and the hand-over
 *     counters are reset so the copy is claimed like a fresh ticket.
 *
 * The copy is handed over by the next poll of the station's printer, with its
 * own delivery row, and when it is confirmed the pointer clears and status is
 * left alone (confirmPrintDelivery, kind "reprinted"). A copy of an order that
 * never printed (QUEUED, PRINT_FAILED) makes it PRINTED when it comes out,
 * because then it is the order's first paper.
 *
 * `printed_at` is untouched: the order really did print once. `print_station`
 * is untouched too: a copy sent to the other printer does not move the order.
 *
 * A second tap before the printer has collected the first request does not
 * stack a second copy: the pending request is retargeted to the station just
 * picked and no row is added.
 *
 * Refused (null) for a CANCELLED order, and while the printer holds a live
 * delivery of this order inside its window (A-001, 15 Oct: 重印 one second
 * after the offer threw away the delivery being printed). The caller tells
 * which from a fresh getOrderById.
 *
 * `actor` is "kitchen" today: the board is one shared password with no
 * per-person identity (see kitchenSession.ts).
 */
export async function requestReprint(
  tenantId: string,
  orderId: number,
  actor = "kitchen",
  /** Which printer. Omitted = the order's own station. */
  station?: Station,
): Promise<Order | null> {
  return wroteOrNull(await withTransaction(async (client) => {
    const { rows: current } = await client.query(
      `select status, print_station, print_attempts, reprint_delivery_id,
              (print_delivery_id is not null
                and print_delivery_expires_at > now()) as in_flight
         from orders where tenant_id = $1 and id = $2
         for update`,
      [tenantId, orderId],
    );
    if (current.length === 0) return null;
    const row = current[0];
    if (row.status === "CANCELLED" || row.in_flight === true) return null;

    const target: Station = station ?? (isStation(row.print_station) ? row.print_station : "online");

    // Still waiting to be collected: same request, possibly a new printer.
    if (row.reprint_delivery_id !== null && Number(row.print_attempts) === 0) {
      await client.query(
        `update print_deliveries set station = $3
          where tenant_id = $1 and id = $2`,
        [tenantId, row.reprint_delivery_id, target],
      );
      const { rows } = await client.query(
        `select ${ORDER_COLUMNS} from orders where tenant_id = $1 and id = $2`,
        [tenantId, orderId],
      );
      return mapOrder(rows[0]);
    }

    const requestId = randomUUID();
    await client.query(
      `insert into print_deliveries
         (id, order_id, tenant_id, offered_at, expires_at, reason, actor, station)
       values ($1, $2, $3, now(), now(), 'manual_reprint', $4, $5)`,
      [requestId, orderId, tenantId, actor, target],
    );

    // alerted_at and alert_attempts re-arm only for an order that has never
    // printed: findUnprintedForAlert considers QUEUED / PRINT_FAILED rows with
    // alerted_at null, so a reprint of one that ALSO fails must be able to tell
    // the owner again. An order already on paper is not "unprinted".
    const { rows } = await client.query(
      `update orders
          set reprint_delivery_id = $3,
              -- The copy is a new hand-over: rerouted again only if failover
              -- takes this one too.
              rerouted_from = null,
              print_attempts = 0,
              last_print_error = null,
              alerted_at = case when status in ('QUEUED', 'PRINT_FAILED')
                                then null else alerted_at end,
              alert_attempts = case when status in ('QUEUED', 'PRINT_FAILED')
                                    then 0 else alert_attempts end,
              -- The copy starts from its first piece, with nothing in flight.
              print_segment = 0,
              print_segments = 0,
              print_job_key = null,
              print_offered_at = null,
              print_delivery_id = null,
              print_delivery_expires_at = null,
              updated_at = now()
        where tenant_id = $1 and id = $2
        returning ${ORDER_COLUMNS}`,
      [tenantId, orderId, requestId],
    );
    return mapOrder(rows[0]);
  }));
}

/**
 * Orders that should have printed by now and have not been alerted about.
 *
 * This is the query behind the highest-value safety net in the system: with
 * nothing prepaid, an order nobody printed is a customer who believes they
 * ordered and a kitchen that never saw it.
 *
 * PRINT_FAILED stays in on purpose. Hitting the print attempt cap sends
 * nothing by itself; this sweep is the only thing that tells the owner a
 * ticket gave up. CANCELLED, PRINTED and every other status never match.
 *
 * LOOKBACK. Only today's and yesterday's business dates (`today` is the
 * restaurant-local business date, not the database's UTC date). Without it, an
 * order from months ago that was never claimed, for example because no owner
 * phone was configured at the time, matches on every run forever and buries
 * the line about a live order under the same log entry.
 */
export async function findUnprintedForAlert(
  tenantId: string,
  olderThanSeconds: number,
  today: string,
  maxAlertAttempts: number,
): Promise<Order[]> {
  // No lock. The right to alert is claimed by markAlerted's conditional
  // UPDATE; this only finds candidates. Locking them here (it used to FOR
  // SHARE) held exactly the QUEUED rows the printer's claim skips if locked.
  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS} from orders
      where tenant_id = $1
        and status in ('QUEUED', 'PRINT_FAILED')
        and alerted_at is null
        and alert_attempts < $4
        and business_date >= $3::date - 1
        and created_at < now() - make_interval(secs => $2)
      order by created_at asc`,
    [tenantId, olderThanSeconds, today, maxAlertAttempts],
  );
  return rows.map(mapOrder);
}

/**
 * CLAIM the right to alert about this order, before the SMS is attempted.
 *
 * Conditional on `alerted_at IS NULL` so two overlapping cron runs cannot both
 * text the owner about the same order — the second UPDATE matches nothing.
 *
 * Returns the claim timestamp it wrote, or null if another run got there
 * first. The timestamp is the claim TOKEN: `releaseAlertClaim` will only undo
 * a claim it can name, which is what makes releasing safe to do concurrently.
 *
 * Returned as TEXT, not a Date, and deliberately so. `timestamptz` keeps
 * microseconds; a JS Date only keeps milliseconds, so handing the token
 * through a Date silently truncates it and the equality in releaseAlertClaim
 * never matches again. Round-tripping the exact string is what makes the token
 * comparable at all.
 */
export async function markAlerted(
  tenantId: string,
  orderId: number,
): Promise<string | null> {
  const { rows } = await ordersPool().query(
    `update orders set alerted_at = now(), updated_at = now()
      where tenant_id = $1 and id = $2 and alerted_at is null
      returning alerted_at::text`,
    [tenantId, orderId],
  );
  return rows.length > 0 ? (rows[0].alerted_at as string) : null;
}

/**
 * The alert SMS failed. Give the claim back so the next sweep retries — but
 * only up to a ceiling.
 *
 * Why a ceiling: a genuinely bad OWNER_ALERT_PHONE fails every time, and an
 * uncapped release would retry every sixty seconds forever, burning Twilio
 * spend and drowning the logs in a way that MASKS the misconfiguration rather
 * than surfacing it. At the ceiling the claim stays put; the order is still
 * QUEUED or PRINT_FAILED, so the /kitchen board remains the net.
 *
 * Why conditional on the claim timestamp: between our failed send and this
 * call, nothing else should have touched `alerted_at` — but if something did
 * (a concurrent sweep that somehow claimed it, an operator), releasing blindly
 * would clear an alert that is legitimately in flight and invite a duplicate
 * text. `where alerted_at = $3` means we can only ever undo OUR OWN claim.
 * That is the whole race fix, and it needs no lock.
 *
 * The counter is incremented either way, so the ceiling is reached even when
 * the release is skipped.
 *
 * Returns whether the claim was released (true = the next sweep will retry).
 */
export async function releaseAlertClaim(
  tenantId: string,
  orderId: number,
  claimedAt: string,
  maxAttempts: number,
): Promise<{ released: boolean; attempts: number } | null> {
  const { rows } = await ordersPool().query(
    `update orders
        set alert_attempts = alert_attempts + 1,
            alerted_at = case
                           when alert_attempts + 1 >= $4 then alerted_at
                           else null
                         end,
            updated_at = now()
      where tenant_id = $1 and id = $2 and alerted_at = $3::timestamptz
      returning alert_attempts, (alerted_at is null) as released`,
    [tenantId, orderId, claimedAt, maxAttempts],
  );
  if (rows.length === 0) return null;
  return {
    released: rows[0].released === true,
    attempts: Number(rows[0].alert_attempts),
  };
}

/**
 * How many WEB orders this phone number has placed on a given business date.
 *
 * Only `channel = 'web'` counts. The cap is abuse control for anonymous online
 * ordering behind an OTP; a phone or walk-in order was taken by staff talking
 * to the customer, which is stronger proof than the OTP. Counting those would
 * let a regular's phone orders lock them out of ordering online.
 */
export async function countOrdersForPhone(
  tenantId: string,
  businessDate: string,
  phoneE164: string,
): Promise<number> {
  const { rows } = await ordersPool().query(
    `select count(*)::int as n from orders
      where tenant_id = $1
        and business_date = $2::date
        and customer->>'phone' = $3
        and channel = 'web'
        and status <> 'CANCELLED'`,
    [tenantId, businessDate, phoneE164],
  );
  return Number(rows[0].n);
}

export async function getOrderByIdempotencyKey(
  tenantId: string,
  idempotencyKey: string,
): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS} from orders
      where tenant_id = $1 and idempotency_key = $2`,
    [tenantId, idempotencyKey],
  );
  return rows.length > 0 ? readBack(mapOrder(rows[0]), "getOrderByIdempotencyKey") : null;
}

/**
 * Find an order by its number alone, newest first.
 *
 * Order numbers restart each business date, so a number is not unique across
 * the table and `getOrderByNumber` rightly demands a date. A print
 * confirmation does not carry one — it echoes the token we handed out, which
 * is the bare number — and it is always about a job offered minutes ago. So
 * "the most recent order wearing this number" is the correct reading, and the
 * ambiguity it could suffer from needs two orders of the same number within
 * one poll cycle across a business-date rollover.
 */
export async function findRecentOrderByNumber(
  tenantId: string,
  orderNumber: string,
): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS} from orders
      where tenant_id = $1 and order_number = $2
      order by created_at desc
      limit 1`,
    [tenantId, orderNumber],
  );
  return rows.length > 0 ? readBack(mapOrder(rows[0]), "findRecentOrderByNumber") : null;
}

export async function getOrderByNumber(
  tenantId: string,
  businessDate: string,
  orderNumber: string,
): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS} from orders
      where tenant_id = $1 and business_date = $2::date and order_number = $3`,
    [tenantId, businessDate, orderNumber],
  );
  return rows.length > 0 ? readBack(mapOrder(rows[0]), "getOrderByNumber") : null;
}

export async function getOrderById(
  tenantId: string,
  orderId: number,
): Promise<Order | null> {
  // A plain read. The print confirmation compares this row's delivery id with
  // the printer's token; that needs a FRESH row (a Hyperdrive-cached copy from
  // before a reprint once made every confirmation look superseded), which is
  // what caching off gives. The tripwire logs if that ever stops being true.
  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS} from orders where tenant_id = $1 and id = $2`,
    [tenantId, orderId],
  );
  return rows.length > 0 ? readBack(mapOrder(rows[0]), "getOrderById") : null;
}

/**
 * The kitchen board query.
 *
 * PRINT_FAILED first, then QUEUED — between them those are every order nobody
 * has a paper copy of, so they must be impossible to miss. Then oldest-first,
 * because a queue is a queue.
 *
 * A plain read: no lock, no transaction. It only paints a screen, and a lock
 * here would hold the very QUEUED rows the printer's FOR UPDATE SKIP LOCKED
 * claim takes. (now() below is the "did not print" threshold, not a cache
 * trick.)
 *
 * The board fetches this only when readBoardVersion says something changed.
 */
export async function listActiveOrders(
  tenantId: string,
  businessDate: string,
  /** Scripts only. The board never asks: finished orders live in history. */
  options: { includeCompleted?: boolean } = {},
): Promise<Order[]> {
  const statuses = options.includeCompleted
    ? [...ACTIVE_STATUSES, "COMPLETED", "CANCELLED"]
    : ACTIVE_STATUSES;

  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS},
            coalesce(d.delivery_count, 0) as delivery_count,
            coalesce(d.fetch_total, 0)    as fetch_total,
            coalesce(d.reprint_count, 0)  as reprint_count,
            p.pending_since               as print_pending_since,
            (p.pending_since is not null
              and p.pending_since < now() - make_interval(secs => $4)) as print_stuck
       from orders
       left join lateral (
         select count(*)                                          as delivery_count,
                coalesce(sum(fetch_count), 0)                     as fetch_total,
                count(*) filter (where reason = 'manual_reprint') as reprint_count,
                max(offered_at) filter (where reason = 'manual_reprint') as last_reprint_at
           from print_deliveries pd
          where pd.tenant_id = orders.tenant_id and pd.order_id = orders.id
       ) d on true
       -- The current attempt began when the order arrived or at the last 重印.
       -- It is pending while the order still waits for paper and nothing
       -- offered since then has been confirmed.
       left join lateral (
         select case
                  when (orders.status in ('QUEUED', 'PRINT_FAILED')
                        or orders.reprint_delivery_id is not null)
                   and not exists (
                     select 1 from print_deliveries c
                      where c.tenant_id = orders.tenant_id
                        and c.order_id = orders.id
                        and c.reason <> 'manual_reprint'
                        and c.confirmed_at is not null
                        and c.offered_at >= coalesce(d.last_reprint_at, orders.created_at)
                   )
                  then greatest(orders.created_at, coalesce(d.last_reprint_at, orders.created_at))
                end as pending_since
       ) p on true
      where tenant_id = $1
        and business_date = $2::date
        and status = any($3::text[])
      order by (status = 'PRINT_FAILED') desc,
               (status = 'QUEUED') desc,
               created_at asc`,
    [tenantId, businessDate, statuses, PRINT_STUCK_SECONDS],
  );
  return rows.map((r) => readBack(mapActiveOrder(r), "listActiveOrders"));
}

/** What the board's version is computed from. See readBoardVersion. */
export interface BoardVersionInputs {
  /** Open orders today: everything but COMPLETED and CANCELLED. */
  openCount: number;
  /** The newest updated_at among them, ISO, or null when there are none. */
  maxUpdatedAt: string | null;
  /**
   * The sum of their updated_at, in microseconds. Catches a change that max
   * and count miss: a transaction's now() is its START time, so a write that
   * began before another and committed after it lands with an updated_at
   * older than the max already seen, and the count does not move. Any write
   * to any open row moves this sum.
   */
  updatedSum: string;
  /** Both printers' board-visible state, or null with no printer rows. */
  printers: string | null;
  /** The database clock when it was read. */
  dbNow: string;
}

/**
 * Printer state as the version sees it: everything the header strip shows,
 * and the two clock thresholds it changes at, read on the database clock.
 * MARGIN seconds past each threshold, so the board's refetch lands after the
 * strip's own (Worker-clock, rounded) derivation has already flipped.
 */
const VERSION_THRESHOLD_MARGIN_SECONDS = 2;

function printerFingerprintSql(table: "current" | "legacy"): string {
  const station = table === "current" ? "p.station" : "'online'";
  const from = table === "current" ? "printer_station_status" : "printer_status";
  return `(select string_agg(concat_ws(':', ${station}, p.paper_out, p.cover_open, p.paper_low,
                                     coalesce(p.status_code, ''),
                                     p.last_seen_at < now() - make_interval(secs => $3),
                                     $4::int is not null
                                       and p.last_seen_at < now() - make_interval(secs => $4)),
                           ',' order by ${station})
             from ${from} p where p.tenant_id = $1)`;
}

/**
 * THE BOARD'S CHANGE CHECK. One statement, no lock, no transaction: what a
 * tablet's 4-second poll costs when nothing has happened.
 *
 * Index-only on orders_board_version_idx (migration 013), a partial index of
 * exactly the rows this counts, so its cost is today's open orders, however
 * long the day's history grows. The printer half reads printer_station_status
 * by its primary key (two rows).
 *
 * now() here is real input: the printer thresholds, and the clock the board
 * measures "did not print" against (X-Server-Time). That clock is also the
 * stale-read tripwire's second check (checkVersionRead).
 *
 * Covers every input of the board response except two, both deliberate:
 *   - the "did not print" flag, which turns on by the clock alone. The board
 *     computes it itself from printPendingSince and the server's clock
 *     (X-Server-Time), so it needs no poll at all;
 *   - print_deliveries.fetch_count, which the printer bumps without touching
 *     the order. It shows on the card's "N sent / M fetched" note, and is
 *     picked up with the order's next change (its confirmation, normally a
 *     few seconds later).
 */
export async function readBoardVersion(
  tenantId: string,
  businessDate: string,
  thresholds: { offlineAfterSeconds: number; failoverAfterSeconds: number },
): Promise<BoardVersionInputs> {
  const params = [
    tenantId,
    businessDate,
    thresholds.offlineAfterSeconds + VERSION_THRESHOLD_MARGIN_SECONDS,
    // Failover off (0): no failover bit at all, rather than one that flips
    // between a healthy printer's three-second polls.
    thresholds.failoverAfterSeconds > 0
      ? thresholds.failoverAfterSeconds + VERSION_THRESHOLD_MARGIN_SECONDS
      : null,
  ];
  const sql = (table: "current" | "legacy") =>
    `select count(*)::int as open_count,
            max(updated_at) as max_updated_at,
            coalesce(sum((extract(epoch from updated_at) * 1000000)::bigint), 0)::text as updated_sum,
            ${printerFingerprintSql(table)} as printers,
            now() as db_now
       from orders
      where tenant_id = $1
        and business_date = $2::date
        and status not in ('COMPLETED', 'CANCELLED')`;
  let rows: QueryResultRow[];
  try {
    ({ rows } = await ordersPool().query(sql("current"), params));
  } catch (err) {
    // Migration 012 not applied: the online printer's legacy row.
    if (!isUndefinedTable(err)) throw err;
    ({ rows } = await ordersPool().query(sql("legacy"), params));
  }
  const row = rows[0];
  const dbNow = (row.db_now as Date).toISOString();
  checkVersionRead(tenantId, dbNow, "readBoardVersion");
  return {
    openCount: Number(row.open_count),
    maxUpdatedAt: row.max_updated_at == null ? null : (row.max_updated_at as Date).toISOString(),
    updatedSum: String(row.updated_sum),
    printers: row.printers == null ? null : String(row.printers),
    dbNow,
  };
}

/** One station's printer row as the header strip needs it, plus its queue. */
export interface BoardPrinterInput {
  station: Station;
  /** Null when this station's printer has never polled. */
  lastSeenAt: string | null;
  paperOut: boolean;
  coverOpen: boolean;
  paperLow: boolean;
  statusCode: string | null;
  /** Tickets and 重印 copies waiting on this station's printer. */
  queued: number;
}

/**
 * Both printers and their queues for the header strip, in ONE statement and
 * without a lock: the same rows readAllPrinterStatus reads and the same count
 * countQueuedOrders makes. The board only asks when readBoardVersion has
 * changed.
 */
export async function readBoardPrinterInputs(tenantId: string): Promise<BoardPrinterInput[]> {
  const sql = (table: "current" | "legacy") =>
    `select s.station,
            p.last_seen_at, p.paper_out, p.cover_open, p.paper_low, p.status_code,
            (select count(*)::int from orders
              where orders.tenant_id = $1
                and ${needsPaperFrom("$3", "array[s.station]")}) as queued
       from unnest($2::text[]) with ordinality as s(station, n)
       left join ${table === "current" ? "printer_station_status" : "printer_status"} p
         on p.tenant_id = $1 and ${table === "current" ? "p.station = s.station" : "s.station = 'online'"}
      order by s.n`;
  const params = [tenantId, [...STATIONS], PRINTABLE_STATUSES];
  let rows: QueryResultRow[];
  try {
    ({ rows } = await ordersPool().query(sql("current"), params));
  } catch (err) {
    if (!isUndefinedTable(err)) throw err;
    ({ rows } = await ordersPool().query(sql("legacy"), params));
  }
  return rows.map((r) => ({
    station: r.station as Station,
    lastSeenAt: r.last_seen_at == null ? null : (r.last_seen_at as Date).toISOString(),
    paperOut: r.paper_out === true,
    coverOpen: r.cover_open === true,
    paperLow: r.paper_low === true,
    statusCode: r.status_code == null ? null : String(r.status_code),
    queued: Number(r.queued),
  }));
}

/** Postgres "relation does not exist": migration 012's table is missing. */
function isUndefinedTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "42P01";
}

/** mapOrder plus the board-only delivery aggregates. */
function mapActiveOrder(row: QueryResultRow): Order {
  return {
    ...mapOrder(row),
    deliveryCount: Number(row.delivery_count),
    fetchCount: Number(row.fetch_total),
    reprintCount: Number(row.reprint_count),
    printPendingSince:
      row.print_pending_since == null ? null : (row.print_pending_since as Date).toISOString(),
    printStuck: row.print_stuck === true,
  };
}

/** Move an order along the board. Returns null when it does not exist. */
export async function updateStatus(
  tenantId: string,
  orderId: number,
  status: OrderStatus,
): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    `update orders set status = $3, updated_at = now()
      where tenant_id = $1 and id = $2
      returning ${ORDER_COLUMNS}`,
    [tenantId, orderId, status],
  );
  return rows.length > 0 ? wrote(mapOrder(rows[0])) : null;
}

/**
 * Record a print failure — a render error, or too many hand-offs with no
 * confirming DELETE.
 *
 * Never moves an order staff have already advanced (ACCEPTED, COMPLETED): a
 * late failure must not drag a finished order back onto the active board.
 */
export async function recordPrintAttempt(
  tenantId: string,
  orderId: number,
  outcome: { ok: boolean; error?: string },
): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    `update orders
        set last_print_error = $4,
            printed_at = case when $3 = 'PRINTED' then now() else printed_at end,
            status = case
              -- A 重印 copy that gave up (or printed) says nothing about the
              -- order: one already on paper keeps its status. Only an order
              -- that never printed can become PRINT_FAILED from this.
              when reprint_delivery_id is not null
               and status not in ('QUEUED', 'PRINT_FAILED') then status
              when status in ('QUEUED', 'PRINTED', 'PRINT_FAILED')
                then $3
              else status
            end,
            -- The copy is finished either way; stop offering it.
            reprint_delivery_id = null,
            updated_at = now()
      where tenant_id = $1 and id = $2
      returning ${ORDER_COLUMNS}`,
    [
      tenantId,
      orderId,
      outcome.ok ? "PRINTED" : "PRINT_FAILED",
      outcome.ok ? null : (outcome.error ?? "unknown print error"),
    ],
  );
  return rows.length > 0 ? wrote(mapOrder(rows[0])) : null;
}

/**
 * A ticket failed to RENDER. Unlike `recordPrintAttempt`, this does not
 * condemn the order on the first failure.
 *
 * A render failure used to be treated as permanent, on the reasoning that it is
 * our bug and will not fix itself. That holds for a genuine bug and not at all
 * for a cold-start OOM or a transient resource blip, which a retry would have
 * printed. So: count the attempt, keep the order QUEUED, and only condemn it at
 * `maxAttempts`.
 *
 * Staying QUEUED with `print_attempts > 0` is exactly what `currentPrintJob`
 * looks for, so the next poll re-offers this same ticket — the printer's own
 * few-second poll IS the retry scheduler, and nothing needs to be scheduled.
 *
 * One UPDATE, so two printers racing cannot interleave a read and a write. The
 * `status not in (...)` arm is the same guard `recordPrintAttempt` uses: a late
 * failure must never drag an order staff already ACCEPTED back onto the board.
 *
 * NOTE on the counter: `print_attempts` also ticks once per OFFER
 * (`claimNextPrintJob`, `reofferPrintDelivery`), so it counts offers and render
 * failures together. With maxAttempts = 3 that works out to roughly two render
 * attempts before the order is condemned, which is the intent. It is one
 * counter on purpose — a second column would have to be kept in lockstep with
 * this one for no behavioural gain.
 */
export async function recordRenderFailure(
  tenantId: string,
  orderId: number,
  error: string,
  maxAttempts: number,
): Promise<{ status: OrderStatus; attempts: number } | null> {
  const { rows } = await ordersPool().query(
    `update orders
        set print_attempts   = print_attempts + 1,
            last_print_error = $3,
            status = case
                       when status not in ('QUEUED', 'PRINT_FAILED') then status
                       when print_attempts + 1 >= $4 then 'PRINT_FAILED'
                       else 'QUEUED'
                     end,
            -- A 重印 copy that cannot render gives up at the same cap, without
            -- touching status, or it would be offered forever.
            reprint_delivery_id = case
                       when print_attempts + 1 >= $4 then null
                       else reprint_delivery_id
                     end,
            updated_at = now()
      where tenant_id = $1 and id = $2
      returning status, print_attempts`,
    [tenantId, orderId, error, maxAttempts],
  );
  if (rows.length === 0) return null;
  return {
    status: rows[0].status as OrderStatus,
    attempts: Number(rows[0].print_attempts),
  };
}

/* ------------------------------------------------------------ staff POS -- */

/**
 * Cancel an order from the board (取消), recording why.
 *
 * CANCELLED is outside PRINTABLE_STATUSES, so neither claimNextPrintJob nor
 * reofferPrintDelivery can ever hand it to the printer again, and
 * requestReprint refuses it. The in-flight pointer is cleared too, so nothing
 * reads as "a body is out" for an order nobody is cooking. A body the printer
 * already holds may still come out; that is paper, not a re-offer, and the
 * confirmation that follows lands as "not-printable" and changes nothing.
 *
 * The note is appended to staff_note rather than replacing it, so a regular's
 * standing note survives the cancellation of one of their orders.
 */
export async function cancelOrder(
  tenantId: string,
  orderId: number,
  note: string | null,
): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    `update orders
        set status = 'CANCELLED',
            staff_note = case
              when $3::text is null then staff_note
              when staff_note is null or staff_note = '' then $3::text
              else staff_note || E'\n' || $3::text
            end,
            print_job_key = null,
            print_offered_at = null,
            print_delivery_id = null,
            print_delivery_expires_at = null,
            reprint_delivery_id = null,
            updated_at = now()
      where tenant_id = $1 and id = $2 and status <> 'CANCELLED'
      returning ${ORDER_COLUMNS}`,
    [tenantId, orderId, note && note.trim() ? note.trim() : null],
  );
  return rows.length > 0 ? wrote(mapOrder(rows[0])) : null;
}

/**
 * The last few orders placed under a phone number, newest first, for the
 * POS's repeat-customer autofill. ONE query, scoped by tenant: there is no
 * customer table and this does not build one.
 */
export async function recentOrdersForPhone(
  tenantId: string,
  phoneE164: string,
  limit = 3,
): Promise<Order[]> {
  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS} from orders
      where tenant_id = $1
        and customer->>'phone' = $2
        and status <> 'CANCELLED'
      order by created_at desc
      limit $3`,
    [tenantId, phoneE164, limit],
  );
  return rows.map(mapOrder);
}

/** Escape LIKE metacharacters so a typed % or _ matches itself. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The WHERE clause every history read shares. One builder, so the page, the
 * summary and the CSV cannot disagree about which rows are "in range".
 */
function historyWhere(
  tenantId: string,
  query: HistoryQuery,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [tenantId, query.from, query.to];
  const clauses = [
    "o.tenant_id = $1",
    "o.business_date between $2::date and $3::date",
  ];
  if (query.statuses.length > 0) {
    params.push(query.statuses);
    clauses.push(`o.status = any($${params.length}::text[])`);
  }
  if (query.channels.length > 0) {
    params.push(query.channels);
    clauses.push(`o.channel = any($${params.length}::text[])`);
  }
  if (query.stations.length > 0) {
    params.push(query.stations);
    clauses.push(`o.print_station = any($${params.length}::text[])`);
  }
  const q = query.q.trim();
  if (q) {
    params.push(`%${likeLiteral(q)}%`);
    const text = `$${params.length}`;
    const ors = [
      `o.order_number ilike ${text}`,
      `o.customer->>'name' ilike ${text}`,
    ];
    // Phone matches on digits alone, so "555-01", "(619) 555" and "6195550"
    // all find +16195550148. Three digits minimum, or "A-0" would match every
    // phone with a zero in it.
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) {
      params.push(`%${digits}%`);
      ors.push(
        `regexp_replace(coalesce(o.customer->>'phone', ''), '\\D', '', 'g') like $${params.length}`,
      );
    }
    clauses.push(`(${ors.join(" or ")})`);
  }
  return { sql: clauses.join(" and "), params };
}

/** Aggregates over print_deliveries, the same three the board shows. */
const DELIVERY_AGGREGATES = `
  left join lateral (
    select count(*)                                          as delivery_count,
           coalesce(sum(fetch_count), 0)                     as fetch_total,
           count(*) filter (where reason = 'manual_reprint') as reprint_count
      from print_deliveries pd
     where pd.tenant_id = o.tenant_id and pd.order_id = o.id
  ) d on true`;

/** Totals for a filtered range. CANCELLED counts only as cancelledCount. */
export async function summarizeOrders(
  tenantId: string,
  query: HistoryQuery,
): Promise<HistorySummary> {
  const where = historyWhere(tenantId, query);
  const { rows } = await ordersPool().query(
    `select o.channel,
            count(*) filter (where o.status <> 'CANCELLED')::int as n,
            coalesce(sum((o.totals->>'totalCents')::bigint)
                       filter (where o.status <> 'CANCELLED'), 0)::bigint as cents,
            count(*) filter (where o.status = 'CANCELLED')::int as cancelled
       from orders o
      where ${where.sql}
      group by o.channel`,
    where.params,
  );
  const summary: HistorySummary = {
    orderCount: 0,
    salesCents: 0,
    averageCents: 0,
    cancelledCount: 0,
    byChannel: {
      web: { orderCount: 0, salesCents: 0 },
      phone: { orderCount: 0, salesCents: 0 },
      walk_in: { orderCount: 0, salesCents: 0 },
      dine_in: { orderCount: 0, salesCents: 0 },
    },
  };
  for (const row of rows) {
    const channel = isOrderChannel(String(row.channel)) ? (String(row.channel) as OrderChannel) : "web";
    const n = Number(row.n);
    const cents = Number(row.cents);
    summary.byChannel[channel].orderCount += n;
    summary.byChannel[channel].salesCents += cents;
    summary.orderCount += n;
    summary.salesCents += cents;
    summary.cancelledCount += Number(row.cancelled);
  }
  summary.averageCents =
    summary.orderCount > 0 ? Math.round(summary.salesCents / summary.orderCount) : 0;
  return summary;
}

/**
 * One page of order history, newest first, with the range's totals.
 *
 * Kept apart from listActiveOrders on purpose: the board's query is tuned for
 * one day's open orders, fetched whenever the board's 4-second version poll
 * (readBoardVersion) sees a change, and is left exactly as it was.
 */
export async function listOrders(
  tenantId: string,
  query: HistoryQuery,
  page = 1,
): Promise<HistoryPage> {
  const where = historyWhere(tenantId, query);
  const offset = (Math.max(1, page) - 1) * HISTORY_PAGE_SIZE;
  const [list, count, summary] = await Promise.all([
    ordersPool().query(
      `select ${ORDER_COLUMNS},
              coalesce(d.delivery_count, 0) as delivery_count,
              coalesce(d.fetch_total, 0)    as fetch_total,
              coalesce(d.reprint_count, 0)  as reprint_count
         from orders o
         ${DELIVERY_AGGREGATES}
        where ${where.sql}
        order by o.created_at desc, o.id desc
        limit ${HISTORY_PAGE_SIZE} offset ${offset}`,
      where.params,
    ),
    ordersPool().query(
      `select count(*)::int as n from orders o where ${where.sql}`,
      where.params,
    ),
    summarizeOrders(tenantId, query),
  ]);
  return {
    orders: list.rows.map(mapActiveOrder),
    total: Number(count.rows[0].n),
    page: Math.max(1, page),
    pageSize: HISTORY_PAGE_SIZE,
    summary,
  };
}

/**
 * Every order in a filtered range, newest first, in batches.
 *
 * Keyset-paged on (created_at, id) rather than OFFSET, so the CSV export reads
 * a busy month in constant memory and a row inserted mid-export cannot shift a
 * later batch onto a duplicate. The same ordering as listOrders, so the export
 * and the screen list rows in the same sequence.
 */
export async function* iterateOrders(
  tenantId: string,
  query: HistoryQuery,
  batchSize = 500,
): AsyncGenerator<Order[]> {
  const where = historyWhere(tenantId, query);
  let cursor: { createdAt: Date; id: number } | null = null;
  for (;;) {
    const params = [...where.params];
    let keyset = "";
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      keyset = `and (o.created_at, o.id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`;
    }
    const { rows } = await ordersPool().query(
      `select ${ORDER_COLUMNS}, o.created_at as cursor_at
         from orders o
        where ${where.sql} ${keyset}
        order by o.created_at desc, o.id desc
        limit ${Math.max(1, Math.floor(batchSize))}`,
      params,
    );
    if (rows.length === 0) return;
    yield rows.map(mapOrder);
    const last = rows[rows.length - 1];
    cursor = { createdAt: last.cursor_at as Date, id: Number(last.id) };
    if (rows.length < batchSize) return;
  }
}
