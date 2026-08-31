import "server-only";

import { randomUUID } from "node:crypto";
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
  type PrintDelivery,
  type PrintDeliveryReason,
} from "@/lib/orders/types";

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
  actor
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
  },
): Promise<void> {
  await client.query(
    `insert into print_deliveries
       (id, order_id, tenant_id, offered_at, expires_at, reason, actor)
     values ($1, $2, $3, now(), now() + make_interval(secs => $4), $5, $6)`,
    [
      params.id,
      params.orderId,
      params.tenantId,
      params.windowSeconds,
      params.reason,
      params.actor,
    ],
  );
}

export async function claimNextPrintJob(
  tenantId: string,
  windowSeconds: number = DEFAULT_CONFIRM_WINDOW_SECONDS,
): Promise<Order | null> {
  return withTransaction(async (client) => {
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
      [tenantId, PRINTABLE_STATUSES, deliveryId, windowSeconds],
    );
    if (rows.length === 0) return null;
    const order = mapOrder(rows[0]);
    await insertDelivery(client, {
      id: deliveryId,
      orderId: order.id,
      tenantId,
      windowSeconds,
      reason: "first-offer",
      actor: "printer",
    });
    return order;
  });
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
): Promise<Order | null> {
  return withTransaction(async (client) => {
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
        returning ${ORDER_COLUMNS}`,
      [tenantId, orderId, deliveryId, windowSeconds],
    );
    if (rows.length === 0) return null;
    const order = mapOrder(rows[0]);
    await insertDelivery(client, {
      id: deliveryId,
      orderId,
      tenantId,
      windowSeconds,
      reason,
      actor: "printer",
    });
    return order;
  });
}

/** Read one delivery by id, or null for an unknown/malformed token. */
export async function getPrintDelivery(
  tenantId: string,
  deliveryId: string,
): Promise<PrintDelivery | null> {
  if (!isDeliveryId(deliveryId)) return null;
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

  return withTransaction(async (client) => {
    const d = await client.query(
      `select order_id, confirmed_at from print_deliveries
        where tenant_id = $1 and id = $2 for update`,
      [tenantId, deliveryId],
    );
    if (d.rows.length === 0) return null;
    const orderId = Number(d.rows[0].order_id);

    const o = await client.query(
      `select order_number, status, print_segment, print_segments, print_job_key
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
        `update orders set ${CLEAR_POINTER}, updated_at = now()
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

    const printed = await client.query(
      `update orders
          set status = 'PRINTED',
              printed_at = now(),
              last_print_error = null,
              print_segment = 0,
              print_segments = 0,
              ${CLEAR_POINTER},
              updated_at = now()
        where tenant_id = $1 and id = $2 and status in ('QUEUED', 'PRINT_FAILED')
        returning status`,
      [tenantId, orderId],
    );
    if (printed.rows.length > 0) {
      return { kind: "printed", orderNumber, status: "PRINTED", jobKey, segment, segments, nextSegment: null };
    }

    // markPrinted matched nothing: staff already advanced the order past
    // printing. Still clear the pointer so it stops being offered, but do not
    // drag it back to PRINTED.
    await client.query(
      `update orders set ${CLEAR_POINTER}, updated_at = now()
        where tenant_id = $1 and id = $2`,
      [tenantId, orderId],
    );
    return { kind: "not-printable", orderNumber, status, jobKey, segment, segments, nextSegment: null };
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
      returning order_number`,
    [tenantId, since.toISOString(), graceSeconds],
  );
  return rows.map((r) => String(r.order_number));
}

/** How many orders are waiting for the printer right now. */
export async function countQueuedOrders(tenantId: string): Promise<number> {
  const { rows } = await ordersPool().query(
    `select count(*)::int as n from orders
      where tenant_id = $1 and status = 'QUEUED'`,
    [tenantId],
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

/**
 * Put a printed or failed order back in the queue (staff pressed 重印).
 *
 * This is now the ONLY legitimate path to a second ticket, and it says so in
 * the record: a `manual_reprint` delivery row is written with the actor, so a
 * second ticket that carries one is explained and a second ticket that does not
 * is a bug by definition. `printed_at` is deliberately left untouched — the
 * order really did print once — and previous deliveries are left in place as
 * the history of that first print.
 *
 * The marker is NOT an in-flight hand-over: it does not stamp the order pointer
 * and its expiry is now(), so it never reads as "a body is in flight". The real
 * hand-over is made by the next poll's claimNextPrintJob, exactly as for any
 * fresh order — which is why the order is reset to claimable (attempts 0, no
 * pointer) here.
 *
 * `actor` identifies who reprinted. Today that is only ever "kitchen": the board
 * is a single shared password with no per-person identity (see
 * kitchenSession.ts). TODO(confirm) if per-person attribution is ever wanted.
 */
export async function requeueForPrint(
  tenantId: string,
  orderId: number,
  actor = "kitchen",
): Promise<Order | null> {
  return withTransaction(async (client) => {
    // alerted_at and alert_attempts are reset alongside the print counters, and
    // that is load-bearing rather than tidiness. findUnprintedForAlert only
    // considers orders with `alerted_at IS NULL`, and nothing else clears it —
    // so a reprint that ALSO fails to print must re-arm the alert, or the owner
    // is never told a second time.
    const { rows } = await client.query(
      `update orders
          set status = 'QUEUED',
              print_attempts = 0,
              last_print_error = null,
              alerted_at = null,
              alert_attempts = 0,
              -- A reprint starts the ticket again from its first piece.
              print_segment = 0,
              print_segments = 0,
              print_job_key = null,
              -- Nothing is in flight: pressing 重印 decides that whatever the
              -- printer may still hold is not going to arrive.
              print_offered_at = null,
              print_delivery_id = null,
              print_delivery_expires_at = null,
              updated_at = now()
        where tenant_id = $1 and id = $2
        returning ${ORDER_COLUMNS}`,
      [tenantId, orderId],
    );
    if (rows.length === 0) return null;
    const order = mapOrder(rows[0]);
    // The labeled marker. offered_at = expires_at = now() so it is never "in
    // flight"; it exists to be counted (已重印 ×N) and to explain the second
    // ticket the next poll is about to produce.
    await client.query(
      `insert into print_deliveries
         (id, order_id, tenant_id, offered_at, expires_at, reason, actor)
       values ($1, $2, $3, now(), now(), 'manual_reprint', $4)`,
      [randomUUID(), orderId, tenantId, actor],
    );
    return order;
  });
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
    `select ${ORDER_COLUMNS},
            coalesce(d.delivery_count, 0) as delivery_count,
            coalesce(d.fetch_total, 0)    as fetch_total,
            coalesce(d.reprint_count, 0)  as reprint_count
       from orders
       left join lateral (
         select count(*)                                          as delivery_count,
                coalesce(sum(fetch_count), 0)                     as fetch_total,
                count(*) filter (where reason = 'manual_reprint') as reprint_count
           from print_deliveries pd
          where pd.tenant_id = orders.tenant_id and pd.order_id = orders.id
       ) d on true
      where tenant_id = $1
        and business_date = $2::date
        and status = any($3::text[])
      order by (status = 'PRINT_FAILED') desc,
               (status = 'QUEUED') desc,
               created_at asc`,
    [tenantId, businessDate, statuses],
  );
  return rows.map(mapActiveOrder);
}

/** mapOrder plus the board-only delivery aggregates. */
function mapActiveOrder(row: QueryResultRow): Order {
  return {
    ...mapOrder(row),
    deliveryCount: Number(row.delivery_count),
    fetchCount: Number(row.fetch_total),
    reprintCount: Number(row.reprint_count),
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
