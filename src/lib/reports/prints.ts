import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { ordersPool, withTransaction } from "@/lib/db/postgres";
import { isStation, type Station } from "@/config/stations";
import type { DailyReport, ReportBlocks } from "@/lib/reports/dailyModel";

/**
 * 日結 DAILY REPORT as a PRINT KIND: the `report_prints` queue (migration 016).
 *
 * WHAT IT SHARES WITH A KITCHEN TICKET. The printer, the CloudPRNT poll, the
 * R2 job body and, above all, print_deliveries: every hand-over is a delivery
 * row with its own id, that id is the job token, and a confirmed delivery can
 * never print again (the GET answers 410, a second DELETE is a stale replay).
 * That is the dedup table, and it is why one Print press is one piece of paper.
 *
 * WHAT IT DOES NOT SHARE: the retry. An order the kitchen never saw is the
 * worst outcome in this system, so an unconfirmed ticket is re-offered until a
 * cap. A report is the opposite case: a duplicate is noise, a missing one is
 * seen by the person standing at the printer. So a report is offered ONCE:
 *
 *   QUEUED ──claim──▶ OFFERED ──DELETE ok──▶ PRINTED
 *                        │
 *                        ├── DELETE failure code ──▶ FAILED
 *                        └── window expires ───────▶ FAILED
 *
 * Nothing leads back to QUEUED. A FAILED report is printed again by a person
 * from the sheet, which is a new request and the next #sequence. A success
 * that arrives late, after FAILED, is still honoured as PRINTED: the paper
 * came out, and nothing will re-offer it either way.
 *
 * PRIORITY. A printer takes a report only when it has no kitchen ticket in
 * flight and none waiting, and while a report is in flight it is handed no
 * ticket (one job at a time, as for orders). The window is the one-copy
 * ticket window, so a printer that swallows a report holds the queue for that
 * long at most.
 *
 * MISSING TABLE. The print route wraps every call here: before migration 016
 * is applied they throw "relation does not exist", and the route carries on
 * as if no report were queued, so tickets are never held up by this file.
 */

export type ReportPrintStatus = "QUEUED" | "OFFERED" | "PRINTED" | "FAILED";

export interface ReportPrint {
  id: string;
  tenantId: string;
  businessDate: string;
  sequence: number;
  station: Station;
  blocks: ReportBlocks;
  report: DailyReport;
  code: string;
  requestKey: string;
  status: ReportPrintStatus;
  deliveryId: string | null;
  deliveryExpiresAt: string | null;
  jobKey: string | null;
  printedAt: string | null;
  lastError: string | null;
  requestedAt: string;
}

/** The columns every read returns, optionally qualified by a table alias. */
function columns(alias = ""): string {
  const a = alias ? `${alias}.` : "";
  return `
  ${a}id, ${a}tenant_id, to_char(${a}business_date, 'YYYY-MM-DD') as business_date, ${a}sequence,
  ${a}station, ${a}blocks, ${a}report, ${a}code, ${a}request_key, ${a}status, ${a}delivery_id,
  ${a}delivery_expires_at, ${a}job_key, ${a}printed_at, ${a}last_error, ${a}requested_at
`;
}
const COLUMNS = columns();

const isoOrNull = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);

function mapPrint(row: QueryResultRow): ReportPrint {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    businessDate: String(row.business_date),
    sequence: Number(row.sequence),
    station: isStation(row.station) ? row.station : "store",
    blocks: row.blocks as ReportBlocks,
    report: row.report as DailyReport,
    code: String(row.code),
    requestKey: String(row.request_key),
    status: String(row.status) as ReportPrintStatus,
    deliveryId: row.delivery_id === null ? null : String(row.delivery_id),
    deliveryExpiresAt: isoOrNull(row.delivery_expires_at),
    jobKey: row.job_key === null ? null : String(row.job_key),
    printedAt: isoOrNull(row.printed_at),
    lastError: row.last_error === null ? null : String(row.last_error),
    requestedAt: (row.requested_at as Date).toISOString(),
  };
}

/** Is this error "migration 016 not applied yet"? */
export function isMissingReportTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42P01";
}

/* -------------------------------------------------------------- request -- */

/** The #N the next print of this day will carry. */
export async function nextReportSequence(tenantId: string, businessDate: string): Promise<number> {
  const { rows } = await ordersPool().query(
    `select coalesce(max(sequence), 0) + 1 as next
       from report_prints
      where tenant_id = $1 and kind = 'daily' and business_date = $2::date`,
    [tenantId, businessDate],
  );
  return Number(rows[0].next);
}

/** The day's prints, newest first, for the sheet. */
export async function listReportPrints(tenantId: string, businessDate: string): Promise<ReportPrint[]> {
  const { rows } = await ordersPool().query(
    `select ${COLUMNS} from report_prints
      where tenant_id = $1 and kind = 'daily' and business_date = $2::date
      order by sequence desc`,
    [tenantId, businessDate],
  );
  return rows.map(mapPrint);
}

export interface ReportPrintRequest {
  tenantId: string;
  businessDate: string;
  station: Station;
  blocks: ReportBlocks;
  report: DailyReport;
  /** The #N the sheet showed. The request is idempotent on (tenant, date, sequence). */
  sequence: number;
  /** The client's key for this press of Print. */
  requestKey: string;
}

export type ReportPrintRequestResult =
  /** Queued now. */
  | { kind: "queued"; print: ReportPrint }
  /** The same request again (same key): the print it already made. */
  | { kind: "replay"; print: ReportPrint }
  /** Someone else's print took this #N first; the sheet should refresh. */
  | { kind: "conflict"; nextSequence: number; print: ReportPrint | null };

/**
 * Queue one report print, at most once.
 *
 * IDEMPOTENT ON (tenant, date, sequence), with the request key deciding whose
 * it is: the same key asking again gets its own print back ("replay"); a
 * different key asking for a #N that is already taken, or not the next one,
 * gets "conflict" and the #N to use. A transaction-scoped advisory lock on
 * (tenant, date) makes "is this the next #N?" and the insert one step, so two
 * tablets pressing Print together get #3 and a conflict, never two #3s.
 */
export async function requestReportPrint(req: ReportPrintRequest): Promise<ReportPrintRequestResult> {
  return withTransaction(async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [
      `report_prints:${req.tenantId}:${req.businessDate}`,
    ]);

    const mine = await client.query(
      `select ${COLUMNS} from report_prints where tenant_id = $1 and request_key = $2`,
      [req.tenantId, req.requestKey],
    );
    if (mine.rows.length > 0) return { kind: "replay", print: mapPrint(mine.rows[0]) };

    const { rows } = await client.query(
      `select coalesce(max(sequence), 0) + 1 as next
         from report_prints
        where tenant_id = $1 and kind = 'daily' and business_date = $2::date`,
      [req.tenantId, req.businessDate],
    );
    const next = Number(rows[0].next);
    if (req.sequence !== next) {
      const taken = await client.query(
        `select ${COLUMNS} from report_prints
          where tenant_id = $1 and kind = 'daily' and business_date = $2::date and sequence = $3`,
        [req.tenantId, req.businessDate, req.sequence],
      );
      return {
        kind: "conflict",
        nextSequence: next,
        print: taken.rows.length > 0 ? mapPrint(taken.rows[0]) : null,
      };
    }

    const inserted = await client.query(
      `insert into report_prints
         (id, tenant_id, kind, business_date, sequence, station, blocks, report, code, request_key)
       values ($1, $2, 'daily', $3::date, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
       returning ${COLUMNS}`,
      [
        randomUUID(),
        req.tenantId,
        req.businessDate,
        req.sequence,
        req.station,
        JSON.stringify(req.blocks),
        JSON.stringify(req.report),
        req.report.code,
        req.requestKey,
      ],
    );
    return { kind: "queued", print: mapPrint(inserted.rows[0]) };
  });
}

/* ------------------------------------------------------------ the printer -- */

/**
 * Close every OFFERED report on this printer whose window has run out, as
 * FAILED, then say whether one is still in flight. NEVER re-offers: this is
 * the whole difference from a kitchen ticket. The delivery pointer is kept so
 * a late confirmation can still mark it PRINTED.
 */
export async function settleReportsInFlight(
  tenantId: string,
  /** The polling printer's served stations (PrinterIdentity.serves), as for tickets. */
  stations: readonly Station[],
): Promise<{ holding: ReportPrint | null; failed: ReportPrint[] }> {
  const expired = await ordersPool().query(
    `update report_prints
        set status = 'FAILED',
            last_error = 'no print confirmation before the window closed',
            updated_at = now()
      where tenant_id = $1 and station = any($2::text[])
        and status = 'OFFERED'
        and delivery_expires_at <= now()
      returning ${COLUMNS}`,
    [tenantId, [...stations]],
  );
  const live = await ordersPool().query(
    `select ${COLUMNS} from report_prints
      where tenant_id = $1 and station = any($2::text[]) and status = 'OFFERED'
      order by requested_at asc
      limit 1`,
    [tenantId, [...stations]],
  );
  return {
    holding: live.rows.length > 0 ? mapPrint(live.rows[0]) : null,
    failed: expired.rows.map(mapPrint),
  };
}

/**
 * Hand this printer its oldest QUEUED report, ONCE: QUEUED → OFFERED and one
 * print_deliveries row (reason 'report'), in one transaction. Null when there
 * is nothing waiting or another poll took it first (SKIP LOCKED, then the
 * status re-checked under the row lock, as in claimNextPrintJob).
 */
export async function claimNextReportPrint(
  tenantId: string,
  /** The polling printer's served stations: a one-printer shop prints Store reports too. */
  stations: readonly Station[],
  /** The printer being handed it, for the delivery row. */
  printer: Station,
  windowSeconds: number,
): Promise<ReportPrint | null> {
  return withTransaction(async (client) => {
    const deliveryId = randomUUID();
    const { rows } = await client.query(
      `update report_prints
          set status = 'OFFERED',
              delivery_id = $3,
              delivery_expires_at = now() + make_interval(secs => $4),
              updated_at = now()
        where id = (
          select id from report_prints
           where tenant_id = $1 and station = any($2::text[]) and status = 'QUEUED'
           order by requested_at asc
           for update skip locked
           limit 1
        )
          and status = 'QUEUED'
        returning ${COLUMNS}`,
      [tenantId, [...stations], deliveryId, windowSeconds],
    );
    if (rows.length === 0) return null;
    await client.query(
      `insert into print_deliveries
         (id, order_id, report_print_id, tenant_id, offered_at, expires_at, reason, actor, station)
       values ($1, null, $2, $3, now(), now() + make_interval(secs => $4), 'report', 'kitchen', $5)`,
      [deliveryId, rows[0].id, tenantId, windowSeconds, printer],
    );
    return mapPrint(rows[0]);
  });
}

/** The report a delivery token belongs to, with that delivery's state; null if the token is not a report's. */
export async function reportPrintForDelivery(
  tenantId: string,
  deliveryId: string,
): Promise<{ print: ReportPrint; confirmedAt: string | null; fetchCount: number } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) return null;
  const { rows } = await ordersPool().query(
    `select ${columns("r")},
            d.confirmed_at as d_confirmed_at, d.fetch_count as d_fetch_count
       from print_deliveries d
       join report_prints r on r.id = d.report_print_id
      where d.tenant_id = $1 and d.id = $2`,
    [tenantId, deliveryId],
  );
  if (rows.length === 0) return null;
  return {
    print: mapPrint(rows[0]),
    confirmedAt: isoOrNull(rows[0].d_confirmed_at),
    fetchCount: Number(rows[0].d_fetch_count),
  };
}

/** Remember the published body's R2 key, for the fallback GET and the delete on confirm. */
export async function recordReportJobKey(tenantId: string, id: string, key: string | null): Promise<void> {
  await ordersPool().query(
    `update report_prints set job_key = $3, updated_at = now() where tenant_id = $1 and id = $2`,
    [tenantId, id, key],
  );
}

/** A render or publish failure: the report is FAILED, never retried. */
export async function failReportPrint(tenantId: string, id: string, error: string): Promise<void> {
  await ordersPool().query(
    `update report_prints set status = 'FAILED', last_error = $3, updated_at = now()
      where tenant_id = $1 and id = $2 and status in ('QUEUED', 'OFFERED')`,
    [tenantId, id, error],
  );
}

export type ConfirmReportKind = "printed" | "failed" | "already" | "stale";

/**
 * CLOSE one report delivery: the delivery confirmed, and the report PRINTED or
 * FAILED, in one transaction, like confirmPrintDelivery for an order. The R2
 * delete is the caller's, after this commits.
 */
export async function confirmReportDelivery(
  tenantId: string,
  deliveryId: string,
  input: { code: string | null; outcome: "success" | "failure" },
): Promise<{ kind: ConfirmReportKind; print: ReportPrint | null; jobKey: string | null }> {
  return withTransaction(async (client) => {
    const d = await client.query(
      `select report_print_id, confirmed_at from print_deliveries
        where tenant_id = $1 and id = $2 and report_print_id is not null
        for update`,
      [tenantId, deliveryId],
    );
    if (d.rows.length === 0) return { kind: "stale", print: null, jobKey: null };
    if (d.rows[0].confirmed_at !== null) return { kind: "already", print: null, jobKey: null };

    await client.query(
      `update print_deliveries set confirmed_at = now(), confirm_code = $3
        where tenant_id = $1 and id = $2`,
      [tenantId, deliveryId, input.code],
    );

    const prior = await client.query(
      `select job_key from report_prints where tenant_id = $1 and id = $2 for update`,
      [tenantId, d.rows[0].report_print_id],
    );
    const jobKey =
      prior.rows.length > 0 && prior.rows[0].job_key !== null ? String(prior.rows[0].job_key) : null;

    const success = input.outcome === "success";
    const { rows } = await client.query(
      `update report_prints
          set status     = case when $4 then 'PRINTED' else 'FAILED' end,
              printed_at = case when $4 then now() else printed_at end,
              last_error = case when $4 then null else $5 end,
              job_key    = null,
              updated_at = now()
        where tenant_id = $1 and id = $2 and delivery_id = $3
          and status in ('OFFERED', 'FAILED')
        returning ${COLUMNS}`,
      [
        tenantId,
        d.rows[0].report_print_id,
        deliveryId,
        success,
        `printer reported code ${input.code ?? "(none)"}`,
      ],
    );
    // No row: the delivery is not this report's current one (cannot happen
    // while a report is offered once, kept as the same guard orders have).
    if (rows.length === 0) return { kind: "stale", print: null, jobKey };
    return { kind: success ? "printed" : "failed", print: mapPrint(rows[0]), jobKey };
  });
}
