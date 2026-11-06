import "server-only";

import type { PoolClient, QueryResultRow } from "pg";
import { lockedRead, ordersPool, withTransaction } from "@/lib/db/postgres";
import {
  ORDER_CHANNELS,
  isPrinterRole,
  type OrderChannel,
  type PrinterRole,
} from "@/lib/orders/types";
import { PRINTER_DOWN_AFTER_SECONDS } from "@/lib/orders/repository";
import {
  derivePrinterHealth,
  printerBlockedReason,
  type PrinterCondition,
  type PrinterHealth,
} from "@/lib/print/printerStatus";

/**
 * The printers (migration 011): who each one is, what it is for, how it is,
 * and who changed any of that.
 *
 * Before 011 there was one printer per restaurant and one `printer_status` row
 * per tenant. Now every CloudPRNT client that polls is a row in `printers`,
 * keyed by MAC; its health is a row in `printer_health`; what each channel
 * prints on, and how many copies, is `print_routes`. Routing itself, which
 * printer takes which ticket, is decided in claimForPrinter (orders/repository)
 * inside the claim's own locking statement. Nothing in this file decides where
 * a ticket goes.
 */

/** Unassigned MACs a tenant may accumulate before new ones stop being stored. */
export const UNASSIGNED_PRINTER_CAP = 10;

/** The name the bootstrap gives the first printer. Staff can rename it. */
export const BOOTSTRAP_PRINTER_NAME = "外賣機 Takeout printer";

/**
 * MAC as stored: 12 lowercase hex, separators stripped, so "00:11:62:AA:BB:CC",
 * "00-11-62-aa-bb-cc" and "001162aabbcc" are one printer. Null when the value
 * cannot be a MAC; such a poll is never registered.
 */
export function normalizeMac(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const hex = raw.replace(/[^0-9a-f]/gi, "").toLowerCase();
  return /^[0-9a-f]{12}$/.test(hex) ? hex : null;
}

/** "00:11:62:55:24:d4" for display. */
export function formatMac(mac: string): string {
  return mac.match(/.{2}/g)?.join(":") ?? mac;
}

export interface PrinterRecord {
  id: string;
  tenantId: string;
  mac: string;
  name: string | null;
  role: PrinterRole | null;
  active: boolean;
  firstSeenAt: string;
}

/** What staff read: the name, or the last four of the MAC when unnamed. */
export function printerLabel(p: Pick<PrinterRecord, "name" | "mac">): string {
  return p.name && p.name.trim() ? p.name.trim() : `Printer …${p.mac.slice(-4).toUpperCase()}`;
}

function iso(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : value == null ? null : String(value);
}

function mapPrinter(row: QueryResultRow): PrinterRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    mac: String(row.mac),
    name: row.name == null ? null : String(row.name),
    role: isPrinterRole(row.role) ? row.role : null,
    active: row.active === true,
    firstSeenAt: iso(row.first_seen_at) ?? new Date(0).toISOString(),
  };
}

const PRINTER_COLUMNS = "id, tenant_id, mac, name, role, active, first_seen_at";

/* ------------------------------------------------------------------ poll -- */

/** What changed for THIS printer between its previous poll and this one. */
export interface PollTransition {
  /** True the first time this printer is ever heard from. */
  firstEver: boolean;
  /** The previous poll was over 60s ago: a return, logged as such. */
  returnedFromSilence: boolean;
  secondsSincePreviousPoll: number | null;
  /** Blocked -> not blocked. THE trigger for the paper-restored requeue. */
  unblocked: boolean;
  /** Not blocked -> blocked. */
  blocked: boolean;
  blockedReason: "paper-out" | "cover-open" | null;
  previousBlockedReason: "paper-out" | "cover-open" | null;
  /** When the blocked spell that just ended began. Only set when `unblocked`. */
  blockedSince: string | null;
  /** Blocked for 60s on this poll: it is now DOWN, its tickets go elsewhere. */
  wentDown: boolean;
  /** It was DOWN (silent or blocked) and is up again: when that began. */
  backFromDownSince: string | null;
}

export type PollOutcome =
  /** A printer we already know. */
  | "known"
  /** The very first printer this tenant has seen: registered active 'takeout'. */
  | "bootstrapped"
  /** A MAC nobody has placed: stored inactive, gets nothing, shows on /printers. */
  | "registered-unknown"
  /** An unknown MAC past UNASSIGNED_PRINTER_CAP: not stored, gets nothing. */
  | "capped";

export interface PrinterPollResult {
  outcome: PollOutcome;
  printer: PrinterRecord | null;
  transition: PollTransition | null;
}

/**
 * Record one poll from one MAC: register the printer if it is new, upsert its
 * health, and report what changed. ONE transaction, every read in it locking,
 * so the before-and-after come from one view and the "paper is back" edge
 * fires once however many polls land together.
 *
 * BOOTSTRAP. A tenant with no ASSIGNED printer (a fresh install, or a database
 * 011 found no MAC to seed from) registers the first MAC that polls as the
 * active 'takeout' printer and routes every channel to it, with the
 * environment's copies. That is exactly the one-printer setup, so the kitchen
 * cannot go dark because a seed found nothing. CLOUDPRNT_PRINTER_MAC, when
 * set, is honoured here and only here: a different MAC is never bootstrapped.
 */
export async function recordPrinterPoll(
  tenantId: string,
  mac: string,
  condition: PrinterCondition,
  options: { pinnedMac: string | null },
): Promise<PrinterPollResult> {
  return withTransaction(async (client) => {
    let outcome: PollOutcome = "known";
    let printer = await selectPrinterByMac(client, tenantId, mac);

    if (!printer) {
      // Serialize registration per tenant, so two first polls cannot both
      // bootstrap, and the unassigned cap cannot be raced past.
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`printers:${tenantId}`]);
      printer = await selectPrinterByMac(client, tenantId, mac);
    }

    if (!printer) {
      // Locking subquery: this count decides bootstrap-or-not and the cap, and
      // a cached answer would bootstrap twice or blow through the cap.
      const { rows: counts } = await client.query(
        `select count(*) filter (where role is not null)::int as assigned,
                count(*) filter (where role is null)::int as unassigned
           from (select role from printers where tenant_id = $1 for share) p`,
        [tenantId],
      );
      // No printer has a role yet. Unassigned MACs do not count: a stray
      // client that polled first must not stop the real printer bootstrapping.
      const assigned = Number(counts[0].assigned);
      const unassigned = Number(counts[0].unassigned);
      const pinned = normalizeMac(options.pinnedMac);

      if (assigned === 0 && (pinned === null || pinned === mac)) {
        const { rows } = await client.query(
          `insert into printers (tenant_id, mac, name, role, active)
           values ($1, $2, $3, 'takeout', true)
           returning ${PRINTER_COLUMNS}`,
          [tenantId, mac, BOOTSTRAP_PRINTER_NAME],
        );
        printer = mapPrinter(rows[0]);
        await client.query(
          `insert into print_routes (tenant_id, channel, role, copy_roles)
           select $1, c, 'takeout', null from unnest($2::text[]) as c
           on conflict (tenant_id, channel) do nothing`,
          [tenantId, [...ORDER_CHANNELS]],
        );
        await client.query(
          `insert into print_alert_state (tenant_id) values ($1)
           on conflict (tenant_id) do nothing`,
          [tenantId],
        );
        outcome = "bootstrapped";
      } else if (unassigned >= UNASSIGNED_PRINTER_CAP) {
        return { outcome: "capped", printer: null, transition: null };
      } else {
        const { rows } = await client.query(
          `insert into printers (tenant_id, mac) values ($1, $2)
           on conflict (tenant_id, mac) do update set updated_at = now()
           returning ${PRINTER_COLUMNS}`,
          [tenantId, mac],
        );
        printer = mapPrinter(rows[0]);
        outcome = "registered-unknown";
      }
    }

    const transition = await upsertHealth(client, tenantId, printer.id, condition);
    return { outcome, printer, transition };
  });
}

async function selectPrinterByMac(
  client: PoolClient,
  tenantId: string,
  mac: string,
): Promise<PrinterRecord | null> {
  const { rows } = await client.query(
    `select ${PRINTER_COLUMNS} from printers
      where tenant_id = $1 and mac = $2
      for update`,
    [tenantId, mac],
  );
  return rows.length > 0 ? mapPrinter(rows[0]) : null;
}

/**
 * The health upsert, with the previous row read under the statement's own
 * snapshot (the `prev` CTE), exactly as the single-printer recordPoll did.
 *
 * down_since is this printer's OWN view of being down: blocked for 60s. Being
 * silent is stamped by the others (markSilentPrintersDown), because a silent
 * printer cannot stamp itself. Any poll that is not blocked-for-60s clears it,
 * along with down_alerted_at, so the next spell texts again.
 */
async function upsertHealth(
  client: PoolClient,
  tenantId: string,
  printerId: string,
  condition: PrinterCondition,
): Promise<PollTransition> {
  const blockedNow = printerBlockedReason(condition) !== null;
  const { rows } = await client.query(
    `with prev as (
       select last_seen_at, paper_out, cover_open, blocked_since, down_since
         from printer_health where printer_id = $1
     ),
     calc as (
       select case
                when not $9 then null
                else coalesce((select blocked_since from prev), now())
              end as blocked_since
     ),
     calc2 as (
       select calc.blocked_since,
              case
                when calc.blocked_since is not null
                 and calc.blocked_since <= now() - make_interval(secs => $10)
                  then coalesce((select down_since from prev), now())
                else null
              end as down_since
         from calc
     ),
     upserted as (
       insert into printer_health (
         printer_id, tenant_id, last_seen_at, online, paper_out, cover_open,
         paper_low, status_code, status_raw, blocked_since, down_since, updated_at
       )
       select $1, $2, now(), $3, $4, $5, $6, $7, $8,
              calc2.blocked_since, calc2.down_since, now()
         from calc2
       on conflict (printer_id) do update set
         last_seen_at    = now(),
         online          = excluded.online,
         paper_out       = excluded.paper_out,
         cover_open      = excluded.cover_open,
         paper_low       = excluded.paper_low,
         status_code     = excluded.status_code,
         status_raw      = excluded.status_raw,
         blocked_since   = excluded.blocked_since,
         down_since      = excluded.down_since,
         down_alerted_at = case
           when excluded.down_since is null then null
           else printer_health.down_alerted_at
         end,
         updated_at      = now()
       returning blocked_since, down_since
     )
     select upserted.blocked_since, upserted.down_since,
            prev.last_seen_at  as prev_last_seen_at,
            prev.paper_out     as prev_paper_out,
            prev.cover_open    as prev_cover_open,
            prev.blocked_since as prev_blocked_since,
            prev.down_since    as prev_down_since
       from upserted left join prev on true`,
    [
      printerId,
      tenantId,
      condition.online,
      condition.paperOut,
      condition.coverOpen,
      condition.paperLow,
      condition.statusCode,
      condition.statusRaw,
      blockedNow,
      PRINTER_DOWN_AFTER_SECONDS,
    ],
  );
  const row = rows[0];
  const firstEver = row.prev_last_seen_at == null;
  const secondsSincePreviousPoll = firstEver
    ? null
    : (Date.now() - (row.prev_last_seen_at as Date).getTime()) / 1000;
  const previousBlockedReason = firstEver
    ? null
    : printerBlockedReason({
        paperOut: row.prev_paper_out === true,
        coverOpen: row.prev_cover_open === true,
      });
  const blockedReason = printerBlockedReason(condition);

  return {
    firstEver,
    returnedFromSilence:
      secondsSincePreviousPoll !== null && secondsSincePreviousPoll > PRINTER_DOWN_AFTER_SECONDS,
    secondsSincePreviousPoll,
    unblocked: previousBlockedReason !== null && blockedReason === null,
    blocked: previousBlockedReason === null && blockedReason !== null,
    blockedReason,
    previousBlockedReason,
    blockedSince: iso(row.prev_blocked_since),
    wentDown: row.prev_down_since == null && row.down_since != null,
    backFromDownSince: row.prev_down_since != null && row.down_since == null ? iso(row.prev_down_since) : null,
  };
}

/**
 * Stamp `down_since` on every active printer that has gone SILENT for 60s and
 * is not holding a live delivery (busy printing is not down). Called on every
 * poll and every cron sweep; the `down_since is null` guard makes each outage
 * one edge, returned once, for one log line.
 */
export async function markSilentPrintersDown(
  tenantId: string,
): Promise<Array<{ id: string; label: string; role: PrinterRole | null }>> {
  const { rows } = await ordersPool().query(
    `update printer_health h
        set down_since = h.last_seen_at, updated_at = now()
       from printers p
      where p.id = h.printer_id
        and p.tenant_id = $1
        and p.active
        and h.down_since is null
        and h.last_seen_at < now() - make_interval(secs => $2)
        and not exists (
          select 1 from orders lo
           where lo.tenant_id = p.tenant_id
             and lo.print_printer_id = p.id
             and lo.status = 'QUEUED'
             and lo.print_delivery_id is not null
             and lo.print_delivery_expires_at > now())
      returning p.id, p.name, p.mac, p.role`,
    [tenantId, PRINTER_DOWN_AFTER_SECONDS],
  );
  return rows.map((r) => ({
    id: String(r.id),
    label: printerLabel({ name: r.name == null ? null : String(r.name), mac: String(r.mac) }),
    role: isPrinterRole(r.role) ? r.role : null,
  }));
}

/* ----------------------------------------------------------------- reads -- */

/** A printer with its health, as the board, the alerts and /printers read it. */
export interface PrinterView extends PrinterRecord {
  label: string;
  lastSeenAt: string | null;
  secondsSinceSeen: number | null;
  paperOut: boolean;
  coverOpen: boolean;
  paperLow: boolean;
  statusCode: string | null;
  blockedSince: string | null;
  downSince: string | null;
  downAlertedAt: string | null;
  /** Holding a live delivery right now (busy printing). */
  busy: boolean;
  health: PrinterHealth;
  /**
   * DOWN by the routing rule: silent 60s and not busy, or blocked 60s. The
   * same definition claimForPrinter evaluates in SQL; derived here from the
   * same columns read fresh.
   */
  down: boolean;
  /** When the current down spell began, for "down for N min". */
  downStartedAt: string | null;
}

/**
 * Every printer of the tenant with its health, fresh (locking read): the board
 * banner, the owner alerts and the /printers page all act on this.
 */
export async function listPrinters(tenantId: string): Promise<PrinterView[]> {
  const { rows } = await lockedRead(
    `select p.id, p.tenant_id, p.mac, p.name, p.role, p.active, p.first_seen_at,
            h.last_seen_at, h.paper_out, h.cover_open, h.paper_low, h.status_code,
            h.blocked_since, h.down_since, h.down_alerted_at,
            exists (
              select 1 from orders lo
               where lo.tenant_id = p.tenant_id
                 and lo.print_printer_id = p.id
                 and lo.status = 'QUEUED'
                 and lo.print_delivery_id is not null
                 and lo.print_delivery_expires_at > now()
            ) as busy,
            now() as db_now
       from printers p
       left join printer_health h on h.printer_id = p.id
      where p.tenant_id = $1
      order by p.active desc, p.role nulls last, p.first_seen_at asc
      for share of p`,
    [tenantId],
  );
  return rows.map(mapPrinterView);
}

function mapPrinterView(row: QueryResultRow): PrinterView {
  const base = mapPrinter(row);
  const now = row.db_now instanceof Date ? row.db_now.getTime() : Date.now();
  const lastSeen = row.last_seen_at instanceof Date ? row.last_seen_at : null;
  const secondsSinceSeen = lastSeen ? Math.max(0, Math.round((now - lastSeen.getTime()) / 1000)) : null;
  const paperOut = row.paper_out === true;
  const coverOpen = row.cover_open === true;
  const blockedSince = row.blocked_since instanceof Date ? row.blocked_since : null;
  const busy = row.busy === true;

  const silent = secondsSinceSeen === null || secondsSinceSeen > PRINTER_DOWN_AFTER_SECONDS;
  const blockedLong =
    blockedSince !== null && now - blockedSince.getTime() >= PRINTER_DOWN_AFTER_SECONDS * 1000;
  const down = base.active && ((silent && !busy) || blockedLong);
  const downStartedAt = !down
    ? null
    : silent && !busy
      ? lastSeen
        ? lastSeen.toISOString()
        : base.firstSeenAt
      : (blockedSince as Date).toISOString();

  return {
    ...base,
    label: printerLabel(base),
    lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
    secondsSinceSeen,
    paperOut,
    coverOpen,
    paperLow: row.paper_low === true,
    statusCode: row.status_code == null ? null : String(row.status_code),
    blockedSince: blockedSince ? blockedSince.toISOString() : null,
    downSince: iso(row.down_since),
    downAlertedAt: iso(row.down_alerted_at),
    busy,
    health: derivePrinterHealth({ secondsSinceSeen, paperOut, coverOpen }),
    down,
    downStartedAt,
  };
}

/** One printer by MAC, fresh. For the bare GET and the confirm's MAC check. */
export async function findPrinterByMac(
  tenantId: string,
  mac: string,
): Promise<PrinterRecord | null> {
  const { rows } = await lockedRead(
    `select ${PRINTER_COLUMNS} from printers
      where tenant_id = $1 and mac = $2 for share`,
    [tenantId, mac],
  );
  return rows.length > 0 ? mapPrinter(rows[0]) : null;
}

/** One printer by id, fresh. */
export async function getPrinter(tenantId: string, id: string): Promise<PrinterRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await lockedRead(
    `select ${PRINTER_COLUMNS} from printers
      where tenant_id = $1 and id = $2 for share`,
    [tenantId, id],
  );
  return rows.length > 0 ? mapPrinter(rows[0]) : null;
}

export interface PrintRoute {
  channel: OrderChannel;
  role: PrinterRole;
  /** Null = the environment's TICKET_COPIES / TICKET_COPY_ROLES. */
  copyRoles: string[] | null;
}

/** The route table, fresh. */
export async function listRoutes(tenantId: string): Promise<PrintRoute[]> {
  const { rows } = await lockedRead(
    `select channel, role, copy_roles from print_routes
      where tenant_id = $1
      order by array_position($2::text[], channel)
      for share`,
    [tenantId, [...ORDER_CHANNELS]],
  );
  return rows
    .filter((r) => isPrinterRole(r.role))
    .map((r) => ({
      channel: String(r.channel) as OrderChannel,
      role: r.role as PrinterRole,
      copyRoles: Array.isArray(r.copy_roles) ? (r.copy_roles as unknown[]).map(String) : null,
    }));
}

/* ------------------------------------------------------- owner changes -- */

export const COPY_ROLE_VALUES = ["kitchen", "register", "bag", "all"] as const;

export type PrinterChangeAction = "assign" | "deactivate" | "rename" | "route" | "copies";

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  target: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
}

async function audit(
  client: PoolClient,
  tenantId: string,
  action: PrinterChangeAction | "pin_failed",
  target: string | null,
  oldValue: unknown,
  newValue: unknown,
  ip: string | null,
): Promise<void> {
  await client.query(
    `insert into printer_config_audit (tenant_id, action, target, old_value, new_value, ip)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
    [
      tenantId,
      action,
      target,
      oldValue === undefined ? null : JSON.stringify(oldValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      ip,
    ],
  );
}

/** A change refused for a reason staff can act on (shown on /printers). */
export class PrinterChangeError extends Error {}

function snapshot(p: PrinterRecord) {
  return { name: p.name, role: p.role, active: p.active, mac: formatMac(p.mac) };
}

async function lockPrinter(client: PoolClient, tenantId: string, id: string): Promise<PrinterRecord> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PrinterChangeError("No such printer.");
  const { rows } = await client.query(
    `select ${PRINTER_COLUMNS} from printers where tenant_id = $1 and id = $2 for update`,
    [tenantId, id],
  );
  if (rows.length === 0) throw new PrinterChangeError("No such printer.");
  return mapPrinter(rows[0]);
}

/**
 * Give a printer a role and make it active. Whichever printer held that role
 * is deactivated IN THE SAME TRANSACTION (the unique index forbids two active
 * printers per role, so a half-swap cannot happen). Each side is audited.
 */
export async function assignPrinter(
  tenantId: string,
  printerId: string,
  change: { role: PrinterRole; name?: string | null },
  ip: string | null,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`printers:${tenantId}`]);
    const target = await lockPrinter(client, tenantId, printerId);
    const { rows: holders } = await client.query(
      `select ${PRINTER_COLUMNS} from printers
        where tenant_id = $1 and role = $2 and active and id <> $3
        for update`,
      [tenantId, change.role, printerId],
    );
    for (const h of holders.map(mapPrinter)) {
      await client.query(
        `update printers set active = false, updated_at = now() where id = $1`,
        [h.id],
      );
      await audit(client, tenantId, "deactivate", h.id, snapshot(h), { ...snapshot(h), active: false }, ip);
    }
    const name =
      change.name === undefined ? target.name : change.name && change.name.trim() ? change.name.trim().slice(0, 60) : null;
    const { rows } = await client.query(
      `update printers set role = $3, name = $4, active = true, updated_at = now()
        where tenant_id = $1 and id = $2
        returning ${PRINTER_COLUMNS}`,
      [tenantId, printerId, change.role, name],
    );
    await audit(client, tenantId, "assign", printerId, snapshot(target), snapshot(mapPrinter(rows[0])), ip);
  });
}

/** Rename a printer. Audited. */
export async function renamePrinter(
  tenantId: string,
  printerId: string,
  name: string,
  ip: string | null,
): Promise<void> {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new PrinterChangeError("A printer needs a name.");
  await withTransaction(async (client) => {
    const before = await lockPrinter(client, tenantId, printerId);
    await client.query(
      `update printers set name = $3, updated_at = now() where tenant_id = $1 and id = $2`,
      [tenantId, printerId, clean],
    );
    await audit(client, tenantId, "rename", printerId, { name: before.name }, { name: clean }, ip);
  });
}

/**
 * Take a printer out of service. Refused for the LAST active printer: with
 * none active nothing prints at all, and that is never what someone tapping a
 * button on a tablet means.
 */
export async function deactivatePrinter(
  tenantId: string,
  printerId: string,
  ip: string | null,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`printers:${tenantId}`]);
    const before = await lockPrinter(client, tenantId, printerId);
    if (!before.active) return;
    const { rows } = await client.query(
      `select count(*)::int as n from (
         select 1 from printers where tenant_id = $1 and active and id <> $2 for share
       ) p`,
      [tenantId, printerId],
    );
    if (Number(rows[0].n) === 0) {
      throw new PrinterChangeError("This is the only active printer. Assign another one first.");
    }
    await client.query(
      `update printers set active = false, updated_at = now() where tenant_id = $1 and id = $2`,
      [tenantId, printerId],
    );
    await audit(client, tenantId, "deactivate", printerId, snapshot(before), { ...snapshot(before), active: false }, ip);
  });
}

/** Point a channel at a role. Audited. */
export async function setRoute(
  tenantId: string,
  channel: OrderChannel,
  role: PrinterRole,
  ip: string | null,
): Promise<void> {
  await withTransaction(async (client) => {
    const { rows: before } = await client.query(
      `select role from print_routes where tenant_id = $1 and channel = $2 for update`,
      [tenantId, channel],
    );
    await client.query(
      `insert into print_routes (tenant_id, channel, role)
       values ($1, $2, $3)
       on conflict (tenant_id, channel) do update set role = excluded.role, updated_at = now()`,
      [tenantId, channel, role],
    );
    await audit(
      client,
      tenantId,
      "route",
      channel,
      before.length > 0 ? { role: String(before[0].role) } : null,
      { role },
      ip,
    );
  });
}

/** Set a channel's copy set; null returns it to the environment's. Audited. */
export async function setCopies(
  tenantId: string,
  channel: OrderChannel,
  copyRoles: string[] | null,
  ip: string | null,
): Promise<void> {
  if (copyRoles !== null) {
    if (copyRoles.length < 1 || copyRoles.length > 5) {
      throw new PrinterChangeError("Between 1 and 5 copies.");
    }
    if (!copyRoles.every((r) => (COPY_ROLE_VALUES as readonly string[]).includes(r))) {
      throw new PrinterChangeError("Unknown copy type.");
    }
  }
  await withTransaction(async (client) => {
    const { rows: before } = await client.query(
      `select copy_roles from print_routes where tenant_id = $1 and channel = $2 for update`,
      [tenantId, channel],
    );
    if (before.length === 0) throw new PrinterChangeError("That channel has no route yet.");
    await client.query(
      `update print_routes set copy_roles = $3, updated_at = now()
        where tenant_id = $1 and channel = $2`,
      [tenantId, channel, copyRoles],
    );
    await audit(client, tenantId, "copies", channel, { copyRoles: before[0].copy_roles ?? null }, { copyRoles }, ip);
  });
}

/** The latest changes, newest first. Display only. */
export async function listAudit(tenantId: string, limit = 50): Promise<AuditEntry[]> {
  const { rows } = await ordersPool().query(
    `select id, at, action, target, old_value, new_value, ip
       from printer_config_audit
      where tenant_id = $1
      order by at desc, id desc
      limit $2`,
    [tenantId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    at: iso(r.at) ?? "",
    action: String(r.action),
    target: r.target == null ? null : String(r.target),
    oldValue: r.old_value ?? null,
    newValue: r.new_value ?? null,
    ip: r.ip == null ? null : String(r.ip),
  }));
}

/* ------------------------------------------------------------ owner PIN -- */

/** Wrong PINs in the window that lock changes, and the window. */
export const PIN_FAILURE_LIMIT = 5;
export const PIN_FAILURE_WINDOW_SECONDS = 15 * 60;

/** Record a wrong owner PIN (no value stored, just the time and IP). */
export async function recordPinFailure(tenantId: string, ip: string | null): Promise<void> {
  await withTransaction((client) => audit(client, tenantId, "pin_failed", null, undefined, undefined, ip));
}

/**
 * Wrong PINs for this tenant in the window, fresh. The in-memory limiter is per
 * Worker isolate, so this database count is the lockout that actually holds.
 */
export async function recentPinFailures(tenantId: string): Promise<number> {
  const { rows } = await lockedRead(
    `select count(*)::int as n from (
       select 1 from printer_config_audit
        where tenant_id = $1 and action = 'pin_failed'
          and at > now() - make_interval(secs => $2)
        for share
     ) f`,
    [tenantId, PIN_FAILURE_WINDOW_SECONDS],
  );
  return rows.length > 0 ? Number(rows[0].n) : 0;
}

/* -------------------------------------------------------- owner alerts -- */

/** Claim the one text for this printer's down spell. False if already sent. */
export async function claimPrinterDownAlert(printerId: string): Promise<boolean> {
  const { rowCount } = await ordersPool().query(
    `update printer_health set down_alerted_at = now(), updated_at = now()
      where printer_id = $1 and down_since is not null and down_alerted_at is null`,
    [printerId],
  );
  return (rowCount ?? 0) > 0;
}

/** Give the claim back when the text could not be sent. */
export async function releasePrinterDownAlert(printerId: string): Promise<void> {
  await ordersPool().query(
    `update printer_health set down_alerted_at = null, updated_at = now() where printer_id = $1`,
    [printerId],
  );
}

/**
 * Claim the urgent every-printer-down text: free when never sent this spell,
 * or when the last one went out `repeatSeconds` ago. Returns the previous
 * stamp so a failed send can put it back exactly.
 */
export async function claimAllDownAlert(
  tenantId: string,
  repeatSeconds: number,
): Promise<{ claimed: boolean; previous: string | null }> {
  const { rows } = await ordersPool().query(
    `with prev as (
       select all_down_alerted_at from print_alert_state where tenant_id = $1
     )
     insert into print_alert_state (tenant_id, all_down_alerted_at, updated_at)
     values ($1, now(), now())
     on conflict (tenant_id) do update
        set all_down_alerted_at = now(), updated_at = now()
      where print_alert_state.all_down_alerted_at is null
         or print_alert_state.all_down_alerted_at <= now() - make_interval(secs => $2)
     returning (select all_down_alerted_at from prev) as previous`,
    [tenantId, repeatSeconds],
  );
  return { claimed: rows.length > 0, previous: rows.length > 0 ? iso(rows[0].previous) : null };
}

export async function releaseAllDownAlert(tenantId: string, previous: string | null): Promise<void> {
  await ordersPool().query(
    `update print_alert_state set all_down_alerted_at = $2::timestamptz, updated_at = now()
      where tenant_id = $1`,
    [tenantId, previous],
  );
}

/** Any printer is up: the all-down spell is over, the next one texts again. */
export async function clearAllDownAlert(tenantId: string): Promise<void> {
  await ordersPool().query(
    `update print_alert_state set all_down_alerted_at = null, updated_at = now()
      where tenant_id = $1 and all_down_alerted_at is not null`,
    [tenantId],
  );
}
