import "server-only";

import { ordersPool } from "@/lib/db/postgres";
import type { PrinterCondition } from "@/lib/print/printerStatus";
import { printerBlockedReason } from "@/lib/print/printerStatus";
import { STATIONS, isStation, type Station } from "@/config/stations";

/**
 * Each printer's state, across polls.
 *
 * TWO TABLES, ONE ON THE WAY OUT. Per-printer state lives in
 * `printer_station_status`, one row per (tenant, station), created by migration
 * 012. The pre-station table `printer_status` (one row per tenant, primary key
 * tenant_id) is left exactly as it was, because the code running before this
 * deploy upserts it `on conflict (tenant_id)`: re-keying that table would make
 * every poll of the live printer fail between migration and deploy, and no
 * index can give one table both a per-tenant and a per-station arbiter.
 *
 * So this module tolerates both shapes:
 *
 *   new   printer_station_status exists: every station has its own row.
 *   old   it does not (012 not applied yet): the online printer keeps its
 *         health in the legacy printer_status row, with the legacy statement,
 *         and any other printer has no health row at all. It still gets its
 *         jobs: the poll gates on the condition it just sent (see recordPoll's
 *         `untracked`), and the board shows it as unknown, never offline.
 *
 * The mode is found by trying the new table: an "undefined table" error
 * switches this isolate to old mode for LEGACY_RECHECK_MS, then it tries again,
 * so applying 012 under a running deploy takes effect within half a minute.
 *
 * Each row is rewritten every three seconds by that printer's own poll. The
 * only interesting thing about it is when a value CHANGES. So `recordPoll`
 * does the write and reports the transition in the same round trip: the caller
 * logs edges, not polls, and the paper-restored requeue fires off the same
 * answer rather than needing a second read that could race with the next poll.
 */

/** Postgres "undefined_table". */
const UNDEFINED_TABLE = "42P01";
const LEGACY_RECHECK_MS = 30_000;

let legacyUntil = 0;

function usingLegacy(): boolean {
  return Date.now() < legacyUntil;
}

function isUndefinedTable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === UNDEFINED_TABLE
  );
}

/**
 * Run against the per-station table; on "no such table", remember old mode
 * and run the legacy variant instead. Any other error is a real error.
 */
async function eitherShape<T>(current: () => Promise<T>, legacy: () => Promise<T>): Promise<T> {
  if (usingLegacy()) return legacy();
  try {
    return await current();
  } catch (err) {
    if (!isUndefinedTable(err)) throw err;
    if (legacyUntil === 0) {
      console.warn(
        "[printer] printer_station_status does not exist (migration 012 not applied): " +
          "the online printer's health uses the legacy printer_status row, and the " +
          "other printer prints with no health row until 012 runs.",
      );
    }
    legacyUntil = Date.now() + LEGACY_RECHECK_MS;
    return legacy();
  }
}

/** Test seam: forget the remembered mode so the next call probes again. */
export function resetPrinterTableModeForTests(): void {
  legacyUntil = 0;
}

/** Which shape the last call ran against. For the verifier's assertions. */
export function printerTableModeForTests(): "current" | "legacy" {
  return usingLegacy() ? "legacy" : "current";
}

export interface PrinterStatusRow {
  station: Station;
  /** Normalized MAC of the unit that last polled as this station. */
  printerMac: string | null;
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
  /** When the current paper-low spell began; null while the roll is fine. */
  paperLowSince: string | null;
  paperLowAlertedAt: string | null;
  /** When the other printer first took this one's tickets (timed failover); null when not. */
  failoverSince: string | null;
  /** The owner has been texted "rerouting" and not yet "back". */
  failoverAlertedAt: string | null;
}

/** Which alert-once stamp a claim is about. */
export type PrinterAlertKind = "offline" | "paper" | "paper-low";

const ALERT_COLUMN: Record<PrinterAlertKind, string> = {
  offline: "offline_alerted_at",
  paper: "paper_alerted_at",
  "paper-low": "paper_low_alerted_at",
};

/** The stamps the legacy printer_status table has (no paper-low). */
const LEGACY_ALERT_KINDS: ReadonlySet<PrinterAlertKind> = new Set(["offline", "paper"]);

/** What changed between the previous poll and this one. */
export interface PollTransition {
  row: PrinterStatusRow;
  /**
   * True when nothing was recorded for this printer: the old schema has no
   * row for any station but online. Every edge below is then false; the
   * caller still gates on the live condition in `row`.
   */
  untracked: boolean;
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
  /**
   * Seconds since each OTHER printer last polled, by the database's clock,
   * read in the same statement. Absent = that printer has never polled (or
   * the old schema, which tracks no other printer). What timed failover
   * decides from.
   */
  othersSilentSeconds: Partial<Record<Station, number>>;
}

interface RawRow {
  station: string;
  printer_mac: string | null;
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
  paper_low_since: Date | null;
  paper_low_alerted_at: Date | null;
  failover_since: Date | null;
  failover_alerted_at: Date | null;
}

const iso = (d: Date | null | undefined): string | null => (d == null ? null : d.toISOString());

/** Legacy rows have no station or paper-low columns; they are the online printer. */
function mapRow(
  row: Partial<RawRow> &
    Omit<RawRow, "station" | "paper_low_since" | "paper_low_alerted_at" | "failover_since" | "failover_alerted_at">,
): PrinterStatusRow {
  return {
    station: isStation(row.station) ? row.station : "online",
    printerMac: row.printer_mac,
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
    paperLowSince: iso(row.paper_low_since),
    paperLowAlertedAt: iso(row.paper_low_alerted_at),
    failoverSince: iso(row.failover_since),
    failoverAlertedAt: iso(row.failover_alerted_at),
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
  /** The polling printer's station (lib/print/printerIdentity). Its row, nobody else's. */
  station: Station = "online",
): Promise<PollTransition> {
  const blockedNow = printerBlockedReason(condition) !== null;
  const params = [
    tenantId,
    condition.online,
    condition.paperOut,
    condition.coverOpen,
    condition.paperLow,
    condition.statusCode,
    condition.statusRaw,
    printerMac,
    blockedNow,
    station,
  ];

  const rows = await eitherShape(
    async () => (await ordersPool().query(RECORD_POLL_SQL, params)).rows,
    async () => {
      // Old schema: one row, the online printer's, written exactly as the
      // pre-station code writes it. Any other printer records nothing.
      if (station !== "online") return null;
      return (await ordersPool().query(LEGACY_RECORD_POLL_SQL, params.slice(0, 9))).rows;
    },
  );

  if (rows === null) return untrackedTransition(condition, printerMac, station);
  return transitionFrom(rows[0], condition);
}

/**
 * No row to compare against: report the live condition, and no edges. Also
 * what the poll uses when the health write itself fails, so a health-table
 * problem can never cost a printer its jobs.
 */
export function untrackedTransition(
  condition: PrinterCondition,
  printerMac: string | null,
  station: Station,
): PollTransition {
  const now = new Date().toISOString();
  return {
    row: {
      station,
      printerMac,
      lastSeenAt: now,
      online: condition.online,
      paperOut: condition.paperOut,
      coverOpen: condition.coverOpen,
      paperLow: condition.paperLow,
      statusCode: condition.statusCode,
      statusRaw: condition.statusRaw,
      blockedSince: null,
      offlineAlertedAt: null,
      paperAlertedAt: null,
      paperLowSince: null,
      paperLowAlertedAt: null,
      failoverSince: null,
      failoverAlertedAt: null,
    },
    untracked: true,
    firstEver: false,
    returnedFromSilence: false,
    secondsSincePreviousPoll: null,
    unblocked: false,
    blocked: false,
    blockedReason: printerBlockedReason(condition),
    previousBlockedReason: null,
    blockedSince: null,
    othersSilentSeconds: {},
  };
}

/**
 * The pre-station statement, verbatim from the code this deploy replaces, so
 * the online printer's legacy row is written the same way whichever code is
 * running. $1..$9 as in RECORD_POLL_SQL.
 */
const LEGACY_RECORD_POLL_SQL = `with prev as (
       select last_seen_at, paper_out, cover_open, blocked_since
         from printer_status
        where tenant_id = $1
     ),
     upserted as (
       insert into printer_status (
         tenant_id, last_seen_at, online, paper_out, cover_open, paper_low,
         status_code, status_raw, printer_mac, blocked_since, updated_at
       )
       values (
         $1, now(), $2, $3, $4, $5, $6, $7, $8,
         case when $9 then now() else null end,
         now()
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
         blocked_since = case
           when not $9 then null
           when printer_status.blocked_since is null then now()
           else printer_status.blocked_since
         end,
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
       from upserted left join prev on true`;

const RECORD_POLL_SQL = `with prev as (
       select last_seen_at, paper_out, cover_open, blocked_since
         from printer_station_status
        where tenant_id = $1 and station = $10
     ),
     upserted as (
       insert into printer_station_status (
         tenant_id, station, last_seen_at, online, paper_out, cover_open, paper_low,
         status_code, status_raw, printer_mac,
         blocked_since, paper_low_since, updated_at
       )
       values (
         $1, $10, now(), $2, $3, $4, $5, $6, $7, $8,
         case when $9 then now() else null end,
         case when $5 then now() else null end,
         now()
       )
       on conflict (tenant_id, station) do update set
         last_seen_at = now(),
         online       = excluded.online,
         paper_out    = excluded.paper_out,
         cover_open   = excluded.cover_open,
         paper_low    = excluded.paper_low,
         status_code  = excluded.status_code,
         status_raw   = excluded.status_raw,
         printer_mac  = coalesce(excluded.printer_mac, printer_station_status.printer_mac),
         -- Leading edge sets it, the spell keeps it, the trailing edge clears
         -- it. Never refreshed mid-outage: this is when it STARTED.
         blocked_since = case
           when not $9 then null
           when printer_station_status.blocked_since is null then now()
           else printer_station_status.blocked_since
         end,
         -- Cleared the moment the condition clears, so the next outage is
         -- allowed to alert. Held while it persists, so this one does not
         -- alert every minute.
         offline_alerted_at = case
           when $9 then printer_station_status.offline_alerted_at else null
         end,
         paper_alerted_at = case
           when $3 or $4 then printer_station_status.paper_alerted_at else null
         end,
         -- Paper-low has its own spell and its own once-per-roll stamp: a
         -- printer can run low for an hour before it runs out, and the owner
         -- should hear "low" once, then "out" once, not either every minute.
         paper_low_since = case
           when not $5 then null
           when printer_station_status.paper_low_since is null then now()
           else printer_station_status.paper_low_since
         end,
         paper_low_alerted_at = case
           when $5 then printer_station_status.paper_low_alerted_at else null
         end,
         -- This printer is polling, so nobody is covering for it any more.
         -- (failover_alerted_at is left for the sweep's "back" text.)
         failover_since = null,
         updated_at = now()
       returning *
     )
     select upserted.*,
            prev.last_seen_at  as prev_last_seen_at,
            prev.paper_out     as prev_paper_out,
            prev.cover_open    as prev_cover_open,
            prev.blocked_since as prev_blocked_since,
            (select coalesce(json_object_agg(o.station, extract(epoch from now() - o.last_seen_at)), '{}'::json)
               from printer_station_status o
              where o.tenant_id = $1 and o.station <> $10) as others_silent
       from upserted left join prev on true`;

function transitionFrom(raw: unknown, condition: PrinterCondition): PollTransition {
  const row = raw as RawRow & {
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
    untracked: false,
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
    othersSilentSeconds: othersFrom((row as { others_silent?: unknown }).others_silent),
  };
}

/** The others_silent json ({"store": 12.3}) as numbers, ignoring anything odd. */
function othersFrom(raw: unknown): Partial<Record<Station, number>> {
  const out: Partial<Record<Station, number>> = {};
  if (raw && typeof raw === "object") {
    for (const [station, seconds] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(seconds);
      if (isStation(station) && Number.isFinite(n)) out[station] = n;
    }
  }
  return out;
}

const STATUS_COLUMNS = `station, printer_mac, last_seen_at, online, paper_out,
  cover_open, paper_low, status_code, status_raw, blocked_since,
  offline_alerted_at, paper_alerted_at, paper_low_since, paper_low_alerted_at,
  failover_since, failover_alerted_at`;

const LEGACY_STATUS_COLUMNS = `printer_mac, last_seen_at, online, paper_out,
  cover_open, paper_low, status_code, status_raw, blocked_since,
  offline_alerted_at, paper_alerted_at`;

/**
 * Every printer's row, for the board strip and the alert sweep: one plain
 * read, keyed by station. A station whose printer has never polled is absent.
 * The alert sweep decides nothing from it alone: each text is claimed by a
 * conditional UPDATE (claimPrinterAlert).
 */
export async function readAllPrinterStatus(
  tenantId: string,
): Promise<Partial<Record<Station, PrinterStatusRow>>> {
  const rows = await eitherShape(
    async () =>
      (
        await ordersPool().query(
          `select ${STATUS_COLUMNS}
             from printer_station_status where tenant_id = $1 and station = any($2::text[])`,
          [tenantId, [...STATIONS]],
        )
      ).rows,
    // Old schema: the one legacy row is the online printer's.
    async () =>
      (
        await ordersPool().query(
          `select ${LEGACY_STATUS_COLUMNS} from printer_status where tenant_id = $1`,
          [tenantId],
        )
      ).rows,
  );
  const out: Partial<Record<Station, PrinterStatusRow>> = {};
  for (const raw of rows as RawRow[]) {
    const row = mapRow(raw);
    out[row.station] = row;
  }
  return out;
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
  station: Station,
  kind: PrinterAlertKind,
): Promise<boolean> {
  const column = ALERT_COLUMN[kind];
  return eitherShape(
    async () => {
      const { rowCount } = await ordersPool().query(
        `update printer_station_status set ${column} = now(), updated_at = now()
          where tenant_id = $1 and station = $2 and ${column} is null`,
        [tenantId, station],
      );
      return (rowCount ?? 0) > 0;
    },
    async () => {
      // The legacy row is the online printer's, and has no paper-low stamp.
      if (station !== "online" || !LEGACY_ALERT_KINDS.has(kind)) return false;
      const { rowCount } = await ordersPool().query(
        `update printer_status set ${column} = now(), updated_at = now()
          where tenant_id = $1 and ${column} is null`,
        [tenantId],
      );
      return (rowCount ?? 0) > 0;
    },
  );
}

/** Give the claim back when the text could not be sent. */
export async function releasePrinterAlert(
  tenantId: string,
  station: Station,
  kind: PrinterAlertKind,
): Promise<void> {
  const column = ALERT_COLUMN[kind];
  await eitherShape(
    async () => {
      await ordersPool().query(
        `update printer_station_status set ${column} = null, updated_at = now()
          where tenant_id = $1 and station = $2`,
        [tenantId, station],
      );
    },
    async () => {
      if (station !== "online" || !LEGACY_ALERT_KINDS.has(kind)) return;
      await ordersPool().query(
        `update printer_status set ${column} = null, updated_at = now()
          where tenant_id = $1`,
        [tenantId],
      );
    },
  );
}

/**
 * Timed failover: record that the other printer has started taking this
 * station's tickets. Keeps the first time (one spell, one start). Run inside
 * the claim's transaction, so it is true exactly when a ticket was rerouted.
 */
export const MARK_FAILOVER_SQL = `update printer_station_status
    set failover_since = coalesce(failover_since, now()), updated_at = now()
  where tenant_id = $1 and station = $2`;

/**
 * Claim one failover text. "start": a spell is on and nobody has been told.
 * "back": the spell is over (the printer polled) and the owner was told it
 * started. Conditional updates, so two sweeps cannot both text.
 */
export async function claimFailoverAlert(
  tenantId: string,
  station: Station,
  phase: "start" | "back",
): Promise<boolean> {
  const sql =
    phase === "start"
      ? `update printer_station_status set failover_alerted_at = now(), updated_at = now()
          where tenant_id = $1 and station = $2
            and failover_since is not null and failover_alerted_at is null`
      : `update printer_station_status set failover_alerted_at = null, updated_at = now()
          where tenant_id = $1 and station = $2
            and failover_since is null and failover_alerted_at is not null`;
  const { rowCount } = await ordersPool().query(sql, [tenantId, station]);
  return (rowCount ?? 0) > 0;
}

/** Undo a failover claim whose text could not be sent, so the next sweep retries. */
export async function releaseFailoverAlert(
  tenantId: string,
  station: Station,
  phase: "start" | "back",
): Promise<void> {
  await ordersPool().query(
    `update printer_station_status
        set failover_alerted_at = ${phase === "start" ? "null" : "now()"}, updated_at = now()
      where tenant_id = $1 and station = $2`,
    [tenantId, station],
  );
}
