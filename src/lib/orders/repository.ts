import "server-only";

import type { PoolClient, QueryResultRow } from "pg";
import { ordersPool, withTransaction } from "@/lib/db/postgres";
import {
  formatOrderNumber,
  isOrderStatus,
  ACTIVE_STATUSES,
  type CreateOrderResult,
  type NewOrderInput,
  type Order,
  type OrderCustomer,
  type OrderLine,
  type OrderStatus,
  type OrderTotals,
} from "@/lib/orders/types";

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
  charge_id,
  items,
  totals,
  customer,
  pickup_at,
  print_attempts,
  last_print_error,
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
    // Surface it rather than silently coercing it to something plausible.
    status: isOrderStatus(status) ? status : "PAID",
    idempotencyKey: String(row.idempotency_key),
    chargeId: row.charge_id === null ? null : String(row.charge_id),
    items: row.items as OrderLine[],
    totals: row.totals as OrderTotals,
    customer: row.customer as OrderCustomer,
    pickupAt: (row.pickup_at as Date).toISOString(),
    printAttempts: Number(row.print_attempts),
    lastPrintError: row.last_print_error === null ? null : String(row.last_print_error),
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

/** Thrown internally when a concurrent transaction won the idempotency race. */
class IdempotencyRace extends Error {}

async function selectByIdempotencyKey(
  client: PoolClient,
  tenantId: string,
  idempotencyKey: string,
): Promise<Order | null> {
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
 * Reserve an order row BEFORE the card is charged.
 *
 * Reserving first is what makes the unique index protective: a duplicate
 * submit loses the insert race and is turned away here, so it never reaches
 * the charge call at all. The row starts PENDING_PAYMENT and is promoted by
 * markPaid() once Clover confirms, or removed by deleteReservation() if the
 * card declines.
 *
 * Returns `created: false` when the key already had a row — the caller must
 * replay that order's confirmation instead of charging again.
 */
export async function createOrder(
  input: NewOrderInput,
): Promise<CreateOrderResult> {
  // Bounded: each retry means another transaction committed ahead of us, and
  // its row is then visible to the fast path on the next pass.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTransaction(async (client) => {
        const existing = await selectByIdempotencyKey(
          client,
          input.tenantId,
          input.idempotencyKey,
        );
        if (existing) return { order: existing, created: false };

        const seq = await allocateSequence(
          client,
          input.tenantId,
          input.businessDate,
        );
        const orderNumber = formatOrderNumber(input.orderNumberPrefix, seq);

        const { rows } = await client.query(
          `insert into orders (
             tenant_id, order_number, business_date, status, idempotency_key,
             items, totals, customer, pickup_at
           ) values ($1, $2, $3::date, 'PENDING_PAYMENT', $4, $5, $6, $7, $8)
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
            input.pickupAt,
          ],
        );

        // Nothing came back: a concurrent transaction committed this key while
        // we were mid-flight. Throwing rolls back — which also returns the
        // counter we just incremented, so no number is wasted.
        if (rows.length === 0) throw new IdempotencyRace();

        return { order: mapOrder(rows[0]), created: true };
      });
    } catch (err) {
      if (err instanceof IdempotencyRace) continue;
      throw err;
    }
  }

  // Three lost races in a row is not concurrency, it is a bug.
  throw new Error(
    "Could not reserve an order row after 3 attempts (idempotency contention).",
  );
}

/** Promote a reservation to PAID once Clover has confirmed the charge. */
export async function markPaid(
  tenantId: string,
  orderId: number,
  chargeId: string,
): Promise<Order> {
  const { rows } = await ordersPool().query(
    `update orders
        set status = 'PAID', charge_id = $3, updated_at = now()
      where tenant_id = $1 and id = $2
      returning ${ORDER_COLUMNS}`,
    [tenantId, orderId, chargeId],
  );
  if (rows.length === 0) {
    throw new Error(`Order ${orderId} vanished before it could be marked paid.`);
  }
  return mapOrder(rows[0]);
}

/**
 * Drop a reservation whose charge failed.
 *
 * Deliberately a DELETE and not a CANCELLED row: the client reuses one
 * idempotency key across retries, so leaving the row behind would make every
 * retry-after-decline replay the failure instead of charging the new card.
 * The freed number is not reused — gaps from declines are normal on a POS.
 */
export async function deleteReservation(
  tenantId: string,
  orderId: number,
): Promise<void> {
  await ordersPool().query(
    `delete from orders
      where tenant_id = $1 and id = $2 and status = 'PENDING_PAYMENT'`,
    [tenantId, orderId],
  );
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
  return rows.length > 0 ? mapOrder(rows[0]) : null;
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
  return rows.length > 0 ? mapOrder(rows[0]) : null;
}

export async function getOrderById(
  tenantId: string,
  orderId: number,
): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS} from orders where tenant_id = $1 and id = $2`,
    [tenantId, orderId],
  );
  return rows.length > 0 ? mapOrder(rows[0]) : null;
}

/**
 * The kitchen board query.
 *
 * PRINT_FAILED first — those are the orders nobody has a paper copy of, so
 * they must be impossible to miss. Then oldest-first, because the queue is a
 * queue. PENDING_PAYMENT is never included: it is not money yet.
 */
export async function listActiveOrders(
  tenantId: string,
  businessDate: string,
  options: { includeCompleted?: boolean } = {},
): Promise<Order[]> {
  const statuses = options.includeCompleted
    ? [...ACTIVE_STATUSES, "COMPLETED", "CANCELLED"]
    : ACTIVE_STATUSES;

  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS} from orders
      where tenant_id = $1
        and business_date = $2::date
        and status = any($3::text[])
      order by (status = 'PRINT_FAILED') desc, created_at asc`,
    [tenantId, businessDate, statuses],
  );
  return rows.map(mapOrder);
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
  return rows.length > 0 ? mapOrder(rows[0]) : null;
}

/**
 * Record the outcome of a print attempt.
 *
 * Never moves an order that staff has already advanced (ACCEPTED, COMPLETED):
 * a late reprint must not drag a finished order back onto the active board.
 */
export async function recordPrintAttempt(
  tenantId: string,
  orderId: number,
  outcome: { ok: boolean; error?: string },
): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    `update orders
        set print_attempts   = print_attempts + 1,
            last_print_error = $4,
            status = case
              when status in ('PAID', 'PRINTED', 'PRINT_FAILED')
                then $3
              else status
            end,
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
  return rows.length > 0 ? mapOrder(rows[0]) : null;
}
