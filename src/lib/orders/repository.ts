import "server-only";

import type { PoolClient, QueryResultRow } from "pg";
import { ordersPool, withTransaction } from "@/lib/db/postgres";
import {
  formatOrderNumber,
  isOrderStatus,
  ACTIVE_STATUSES,
  PRINTABLE_STATUSES,
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
  items,
  totals,
  customer,
  phone_verified_at,
  pickup_at,
  ready_from,
  ready_to,
  print_attempts,
  printed_at,
  last_print_error,
  alerted_at,
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
    printedAt: row.printed_at === null ? null : (row.printed_at as Date).toISOString(),
    lastPrintError: row.last_print_error === null ? null : String(row.last_print_error),
    alertedAt: row.alerted_at === null ? null : (row.alerted_at as Date).toISOString(),
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
             items, totals, customer, phone_verified_at, pickup_at,
             ready_from, ready_to
           ) values ($1, $2, $3::date, 'QUEUED', $4, $5, $6, $7, $8, $9, $10, $11)
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
    "Could not store the order after 3 attempts (idempotency contention).",
  );
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
 */
export async function claimNextPrintJob(
  tenantId: string,
): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    `update orders
        set print_attempts = print_attempts + 1,
            updated_at     = now()
      where id = (
        select id from orders
         where tenant_id = $1
           and status = any($2::text[])
           and print_attempts = 0
         order by created_at asc
         for update skip locked
         limit 1
      )
        -- Re-checked here, under this statement's own row lock: this is what
        -- makes two simultaneous claims impossible, not the subselect.
        and status = any($2::text[])
        and print_attempts = 0
      returning ${ORDER_COLUMNS}`,
    [tenantId, PRINTABLE_STATUSES],
  );
  return rows.length > 0 ? mapOrder(rows[0]) : null;
}

/**
 * The job a printer is mid-transaction on: already claimed (attempts > 0) but
 * not yet confirmed by a DELETE. Returned so a repeated poll or GET before the
 * confirmation gets the SAME ticket rather than a second one.
 */
export async function currentPrintJob(tenantId: string): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS} from orders
      where tenant_id = $1
        and status = any($2::text[])
        and print_attempts > 0
      order by created_at asc
      limit 1`,
    [tenantId, PRINTABLE_STATUSES],
  );
  return rows.length > 0 ? mapOrder(rows[0]) : null;
}

/**
 * Count one more unconfirmed offer of a job already in flight.
 *
 * Separate from `claimNextPrintJob` because that one also selects; this only
 * ticks the counter that eventually trips PRINT_FAILED.
 */
export async function bumpPrintAttempt(
  tenantId: string,
  orderId: number,
): Promise<number> {
  const { rows } = await ordersPool().query(
    `update orders
        set print_attempts = print_attempts + 1, updated_at = now()
      where tenant_id = $1 and id = $2
      returning print_attempts`,
    [tenantId, orderId],
  );
  return rows.length > 0 ? Number(rows[0].print_attempts) : 0;
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
            updated_at = now()
      where tenant_id = $1
        and id = $2
        -- Never drag an order staff have already advanced back to PRINTED.
        and status in ('QUEUED', 'PRINT_FAILED')
      returning ${ORDER_COLUMNS}`,
    [tenantId, orderId],
  );
  return rows.length > 0 ? mapOrder(rows[0]) : null;
}

/** Put a printed or failed order back in the queue (staff pressed 重印). */
export async function requeueForPrint(
  tenantId: string,
  orderId: number,
): Promise<Order | null> {
  const { rows } = await ordersPool().query(
    // alerted_at and alert_attempts are reset alongside the print counters,
    // and that is load-bearing rather than tidiness.
    //
    // findUnprintedForAlert only ever considers orders with `alerted_at IS
    // NULL`, and nothing else in the system clears that column — not
    // updateStatus, not the print path. So an order that was alerted about,
    // then requeued by staff (重印), kept its stamp forever: if the reprint
    // ALSO failed to print, the owner was never told a second time. A staff
    // reprint silently disarmed the one safety net that catches a ticket the
    // kitchen never saw.
    //
    // A requeue is a fresh attempt at printing, so it gets a fresh attempt at
    // alerting too. alert_attempts goes back to 0 for the same reason: the
    // send-failure retry budget belongs to this attempt, not to the last one.
    `update orders
        set status = 'QUEUED',
            print_attempts = 0,
            last_print_error = null,
            alerted_at = null,
            alert_attempts = 0,
            updated_at = now()
      where tenant_id = $1 and id = $2
      returning ${ORDER_COLUMNS}`,
    [tenantId, orderId],
  );
  return rows.length > 0 ? mapOrder(rows[0]) : null;
}

/**
 * Orders that should have printed by now and have not been alerted about.
 *
 * This is the query behind the highest-value safety net in the system: with
 * nothing prepaid, an order nobody printed is a customer who believes they
 * ordered and a kitchen that never saw it.
 */
export async function findUnprintedForAlert(
  tenantId: string,
  olderThanSeconds: number,
): Promise<Order[]> {
  const { rows } = await ordersPool().query(
    `select ${ORDER_COLUMNS} from orders
      where tenant_id = $1
        and status in ('QUEUED', 'PRINT_FAILED')
        and alerted_at is null
        and created_at < now() - make_interval(secs => $2)
      order by created_at asc`,
    [tenantId, olderThanSeconds],
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

/** How many orders this phone number has placed on a given business date. */
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
 * PRINT_FAILED first, then QUEUED — between them those are every order nobody
 * has a paper copy of, so they must be impossible to miss. Then oldest-first,
 * because a queue is a queue.
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
      order by (status = 'PRINT_FAILED') desc,
               (status = 'QUEUED') desc,
               created_at asc`,
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
              when status in ('QUEUED', 'PRINTED', 'PRINT_FAILED')
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
 * (`claimNextPrintJob`, `bumpPrintAttempt`), so it counts offers and render
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
