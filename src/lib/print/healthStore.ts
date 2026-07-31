import "server-only";

import { ordersPool } from "@/lib/db/postgres";
import type { PrinterCondition } from "@/lib/print/printerStatus";
import { printerBlockedReason } from "@/lib/print/printerStatus";

/**
 * The printer's state, across polls.
 *
 * One row per tenant, rewritten every three seconds, and the only interesting
 * thing about it is when a value CHANGES. So `recordPoll` does the write and
 * reports the transition in the same round trip: the caller logs edges, not
 * polls, and the paper-restored requeue fires off the same answer rather than
 * needing a second read that could race with the next poll.
 */

export interface PrinterStatusRow {
  lastSeenAt: string;
  online: boolean;
  paperOut: boolean;
  coverOpen: boolean;
  paperLow: boolean;
  statusCode: string | null;
  statusRaw: string | null;
  blockedSince: string | null;
  offlineAlertedAt: string | null;
  paperAlertedAt: string | null;
}

/** What changed between the previous poll and this one. */
export interface PollTransition {
  row: PrinterStatusRow;
  /** True the first time this deployment ever hears from a printer. */
  firstEver: boolean;
  /** True when the previous poll was long enough ago to count as a return. */
  returnedFromSilence: boolean;
  /** Seconds since the previous poll, or null on the first ever. */
  secondsSincePreviousPoll: number | null;
  /** Blocked -> not blocked. THE trigger for the paper-restored requeue. */
  unblocked: boolean;
  /** Not blocked -> blocked. */
  blocked: boolean;
  /** Why it is blocked now, or null. */
  blockedReason: "paper-out" | "cover-open" | null;
  /** Why it was blocked before, or null. */
  previousBlockedReason: "paper-out" | "cover-open" | null;
  /** When the spell that just ended began. Only set when `unblocked`. */
  blockedSince: string | null;
}

interface RawRow {
  last_seen_at: Date;
  online: boolean;
  paper_out: boolean;
  cover_open: boolean;
  paper_low: boolean;
  status_code: string | null;
  status_raw: string | null;
  blocked_since: Date | null;
  offline_alerted_at: Date | null;
  paper_alerted_at: Date | null;
}

function mapRow(row: RawRow): PrinterStatusRow {
  return {
    lastSeenAt: row.last_seen_at.toISOString(),
    online: row.online,
    paperOut: row.paper_out,
    coverOpen: row.cover_open,
    paperLow: row.paper_low,
    statusCode: row.status_code,
    statusRaw: row.status_raw,
    blockedSince: row.blocked_since === null ? null : row.blocked_since.toISOString(),
    offlineAlertedAt:
      row.offline_alerted_at === null ? null : row.offline_alerted_at.toISOString(),
    paperAlertedAt:
      row.paper_alerted_at === null ? null : row.paper_alerted_at.toISOString(),
  };
}

/**
 * Record one poll and report what changed.
 *
 * ONE STATEMENT, and that is what makes the transition trustworthy. The `prev`
 * CTE reads the row under the statement's own snapshot — before the upsert
 * writes — so the before-and-after come from a single atomic view. Reading the
 * row, then writing it, would let two polls three milliseconds apart both
 * observe the same "paper is back" edge and both fire the requeue.
 *
 * `blocked_since` is set on the leading edge and left alone while the
 * condition persists, so it marks the START of the outage rather than the last
 * poll during it — the requeue needs the former to know how far back to look.
 *
 * The alert stamps clear themselves here, on the trailing edge. That is what
 * makes "alert once per outage" true rather than "alert once, ever".
 */
export async function recordPoll(
  tenantId: string,
  condition: PrinterCondition,
  printerMac: string | null,
): Promise<PollTransition> {
  const blockedNow = printerBlockedReason(condition) !== null;

  const { rows } = await ordersPool().query(
    `with prev as (
       select last_seen_at, paper_out, cover_open, blocked_since
         from printer_status
        where tenant_id = $1
     ),
     upserted as (
       insert into printer_status (
         tenant_id, last_seen_at, online, paper_out, cover_open, paper_low,
         status_code, status_raw, printer_mac,
         blocked_since, updated_at
       )
       values (
         $1, now(), $2, $3, $4, $5, $6, $7, $8,
         case when $9 then now() else null end, now()
       )
       on conflict (tenant_id) do update set
         last_seen_at = now(),
         online       = excluded.online,
         paper_out    = excluded.paper_out,
         cover_open   = excluded.cover_open,
         paper_low    = excluded.paper_low,
         status_code  = excluded.status_code,
         status_raw   = excluded.status_raw,
         printer_mac  = coalesce(excluded.printer_mac, printer_status.printer_mac),
         -- Leading edge sets it, the spell keeps it, the trailing edge clears
         -- it. Never refreshed mid-outage: this is when it STARTED.
         blocked_since = case
           when not $9 then null
           when printer_status.blocked_since is null then now()
           else printer_status.blocked_since
         end,
         -- Cleared the moment the condition clears, so the next outage is
         -- allowed to alert. Held while it persists, so this one does not
         -- alert every minute.
         offline_alerted_at = case
           when $9 then printer_status.offline_alerted_at else null
         end,
         paper_alerted_at = case
           when $3 or $4 then printer_status.paper_alerted_at else null
         end,
         updated_at = now()
       returning *
     )
     select upserted.*,
            prev.last_seen_at  as prev_last_seen_at,
            prev.paper_out     as prev_paper_out,
            prev.cover_open    as prev_cover_open,
            prev.blocked_since as prev_blocked_since
       from upserted left join prev on true`,
    [
      tenantId,
      condition.online,
      condition.paperOut,
      condition.coverOpen,
      condition.paperLow,
      condition.statusCode,
      condition.statusRaw,
      printerMac,
      blockedNow,
    ],
  );

  const row = rows[0] as RawRow & {
    prev_last_seen_at: Date | null;
    prev_paper_out: boolean | null;
    prev_cover_open: boolean | null;
    prev_blocked_since: Date | null;
  };

  const firstEver = row.prev_last_seen_at === null;
  const secondsSincePreviousPoll = firstEver
    ? null
    : (Date.now() - row.prev_last_seen_at!.getTime()) / 1000;

  const previousBlockedReason = firstEver
    ? null
    : printerBlockedReason({
        paperOut: row.prev_paper_out === true,
        coverOpen: row.prev_cover_open === true,
      });
  const blockedReason = printerBlockedReason(condition);

  return {
    row: mapRow(row),
    firstEver,
    // One missed poll is a dropped packet; twenty is an absence. The same
    // threshold the kitchen screen calls "offline", so the log and the screen
    // never disagree about what counts as coming back.
    returnedFromSilence:
      secondsSincePreviousPoll !== null && secondsSincePreviousPoll > 60,
    secondsSincePreviousPoll,
    unblocked: previousBlockedReason !== null && blockedReason === null,
    blocked: previousBlockedReason === null && blockedReason !== null,
    blockedReason,
    previousBlockedReason,
    blockedSince:
      row.prev_blocked_since === null ? null : row.prev_blocked_since.toISOString(),
  };
}

/** The stored row, for the kitchen screen and the alert sweep. Null if never polled. */
export async function readPrinterStatus(
  tenantId: string,
): Promise<PrinterStatusRow | null> {
  const { rows } = await ordersPool().query(
    `select last_seen_at, online, paper_out, cover_open, paper_low,
            status_code, status_raw, blocked_since,
            offline_alerted_at, paper_alerted_at
       from printer_status where tenant_id = $1`,
    [tenantId],
  );
  return rows.length > 0 ? mapRow(rows[0] as RawRow) : null;
}

/**
 * Claim the right to send ONE alert for a condition.
 *
 * The same conditional-UPDATE claim the unprinted-order sweep uses on
 * `alerted_at`: whichever concurrent run's UPDATE matches first is the one
 * that texts, and the loser matches nothing. Returns false when the stamp is
 * already set — i.e. somebody has already been told about THIS outage.
 */
export async function claimPrinterAlert(
  tenantId: string,
  kind: "offline" | "paper",
): Promise<boolean> {
  const column = kind === "offline" ? "offline_alerted_at" : "paper_alerted_at";
  const { rowCount } = await ordersPool().query(
    `update printer_status set ${column} = now(), updated_at = now()
      where tenant_id = $1 and ${column} is null`,
    [tenantId],
  );
  return (rowCount ?? 0) > 0;
}

/** Give the claim back when the text could not be sent. */
export async function releasePrinterAlert(
  tenantId: string,
  kind: "offline" | "paper",
): Promise<void> {
  const column = kind === "offline" ? "offline_alerted_at" : "paper_alerted_at";
  await ordersPool().query(
    `update printer_status set ${column} = null, updated_at = now()
      where tenant_id = $1`,
    [tenantId],
  );
}
