-- ---------------------------------------------------------------------------
-- 012: printer health, one row per printer, in a NEW table.
--
-- ⚠️ NOT APPLIED. Written for review.
--
-- DEPLOY ORDER: apply 011, then this, then deploy once. Both are safe under the
-- code running today; see 011.
--
-- WHY A NEW TABLE and not a re-keyed printer_status. The running code upserts
-- printer_status `on conflict (tenant_id)`. Postgres resolves that against a
-- unique index on exactly (tenant_id), and a partial index (one per station)
-- is not a candidate unless the statement names its predicate, which the old
-- statement does not. So a printer_status keyed (tenant_id, station) makes
-- every poll of the live printer fail until the deploy lands, and a
-- printer_status keyed (tenant_id) cannot hold a second printer. Two tables:
--
--   printer_status          untouched. Written by the old code until the
--                           deploy, and by nothing after it. Rolling back to
--                           the old code needs no schema change at all.
--   printer_station_status  this file. One row per (tenant, station). The new
--                           code writes it; if it is missing (this file not
--                           applied) the new code falls back to printer_status
--                           for the online printer and prints the store
--                           printer's jobs with no health row.
--
-- NOT BACKFILLED from printer_status on purpose: a copied row would carry a
-- last_seen_at frozen at migration time, and between this migration and the
-- deploy it would age into "offline" on the board and in the owner alert. With
-- no row, each printer reads as "waiting for first poll" until its first poll
-- after the deploy, three seconds later.
--
-- CLEANUP, later and optional: once the new code has been live long enough
-- that rolling back is off the table, `drop table printer_status;`. Not in this
-- file, because it must not run before the deploy.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

create table if not exists printer_station_status (
  tenant_id          text        not null,
  -- 'online' or 'store' (src/config/stations.ts), identified on each poll by
  -- its MAC (src/lib/print/printerIdentity.ts).
  station            text        not null,
  -- The poll clock. "Offline" is this column going stale.
  last_seen_at       timestamptz not null default now(),
  online             boolean     not null default true,
  paper_out          boolean     not null default false,
  cover_open         boolean     not null default false,
  paper_low          boolean     not null default false,
  status_code        text,
  status_raw         text,
  printer_mac        text,
  blocked_since      timestamptz,
  offline_alerted_at timestamptz,
  paper_alerted_at   timestamptz,
  paper_low_since      timestamptz,
  paper_low_alerted_at timestamptz,
  -- Timed failover: when the other printer first took one of this printer's
  -- tickets because this one had gone silent; cleared by this printer's next
  -- poll. failover_alerted_at: the owner's "rerouting" text, cleared with the
  -- "back" text.
  failover_since       timestamptz,
  failover_alerted_at  timestamptz,
  updated_at         timestamptz not null default now(),

  constraint printer_station_status_pkey primary key (tenant_id, station),
  constraint printer_station_status_station_check check (station in ('online', 'store'))
);

-- A table created by an earlier draft of this file gains the failover columns.
alter table printer_station_status add column if not exists failover_since timestamptz;
alter table printer_station_status add column if not exists failover_alerted_at timestamptz;

alter table printer_station_status enable row level security;

comment on table printer_station_status is
  'One row per printer, keyed (tenant_id, station), rewritten on every CloudPRNT poll. Health is derived from last_seen_at against the clock; alert-once stamps clear when their condition clears. Replaces printer_status (one row per tenant), which is left for the pre-two-printer code.';

commit;
