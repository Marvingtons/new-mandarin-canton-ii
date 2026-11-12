-- ---------------------------------------------------------------------------
-- 011: two printers. Every ticket knows which printer (station) it belongs to,
--      every hand-over records which printer took it, and printer_status can
--      hold one row per printer.
--
-- ⚠️ NOT APPLIED. Written for review.
--
-- Run against a database that already has the 010 shape. A fresh project runs
-- schema.sql instead, which already includes 011 and 012.
--
-- DEPLOY ORDER (both files):
--   1. apply 011            additive; the running code keeps working on it
--   2. deploy the code
--   3. apply 012            re-keys printer_status; see that file
--
-- Why this order: the new code selects orders.print_station on every read, so
-- it cannot run ahead of 011. The OLD code upserts printer_status
-- `on conflict (tenant_id)`, so re-keying printer_status before the deploy
-- would make every poll of the live printer fail. Hence two files.
--
-- STATIONS (src/config/stations.ts is the source of truth; this file repeats
-- the mapping once, to backfill):
--   online  printer A: channel web
--   store   printer B: channels phone, walk_in, dine_in (add-ons are dine_in)
--
-- WHAT THIS ADDS
--   orders.print_station         the printer whose queue this ticket is in.
--                                Set from the channel at insert. Default
--                                'online' covers rows the OLD code inserts
--                                between steps 1 and 2: there is one printer
--                                until step 2, and it is the online one.
--   orders_print_station_queue_idx  per-printer head of line (QUEUED only).
--   orders.reprint_delivery_id   a 重印 copy waiting on a printer: the id of its
--                                manual_reprint print_deliveries row, which
--                                names the station picked. A reprint no longer
--                                touches orders.status, so this is how the
--                                printer finds an ACCEPTED order that needs
--                                another copy. NULL on every existing row: the
--                                OLD code reprints by requeueing to QUEUED and
--                                never sets it, so nothing old looks pending.
--   orders_reprint_pending_idx   the rows with a copy pending (tiny, partial).
--   print_deliveries.station     the printer this hand-over went to. NULL on
--                                rows from before this migration (one printer).
--   printer_status.station       which printer this health row is. Existing
--                                row becomes 'online': it IS printer A.
--   printer_status.paper_low_since / paper_low_alerted_at
--                                the near-end spell and its once-per-roll text.
--   printer_status (tenant_id, station) unique index, so the new code's
--                                `on conflict (tenant_id, station)` has an arbiter
--                                while the old primary key is still in place.
--
-- Until 012 runs, the old primary key (tenant_id) still allows only ONE row per
-- tenant: printer A keeps working, and printer B's polls are refused with a
-- logged error (it gets no jobs). Run 012 right after the deploy.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

-- -------------------------------------------------------------- orders

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'orders' and column_name = 'print_station'
  ) then
    alter table orders add column print_station text not null default 'online';
    -- Backfill only on the run that adds the column, so a re-run can never
    -- undo a 重印 that moved an order to the other printer.
    update orders set print_station = 'store'
     where channel in ('phone', 'walk_in', 'dine_in');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_print_station_check'
  ) then
    alter table orders add constraint orders_print_station_check
      check (print_station in ('online', 'store'));
  end if;
end $$;

-- What each printer's claim scans: its own stations' live queue, oldest first.
-- Partial on QUEUED (PRINTABLE_STATUSES), so it holds only the live queue.
create index if not exists orders_print_station_queue_idx
  on orders (tenant_id, print_station, created_at)
  where status = 'QUEUED';

comment on column orders.print_station is
  'Printer whose queue this ticket is in: online (web) or store (phone, walk_in, dine_in). Mapping lives in src/config/stations.ts. A reprint never changes it.';

alter table orders add column if not exists reprint_delivery_id uuid;

create index if not exists orders_reprint_pending_idx
  on orders (tenant_id, created_at)
  where reprint_delivery_id is not null;

comment on column orders.reprint_delivery_id is
  'A reprint copy waiting on a printer: the manual_reprint print_deliveries row (which names the station). Set by a reprint, cleared when the copy prints or gives up. A reprint never changes status.';

-- ---------------------------------------------------- print_deliveries

alter table print_deliveries add column if not exists station text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'print_deliveries_station_check'
  ) then
    alter table print_deliveries add constraint print_deliveries_station_check
      check (station is null or station in ('online', 'store'));
  end if;
end $$;

comment on column print_deliveries.station is
  'Printer this hand-over went to (for a manual_reprint marker, the station staff picked). NULL before migration 011.';

-- ------------------------------------------------------ printer_status

alter table printer_status add column if not exists station text not null default 'online';
alter table printer_status add column if not exists paper_low_since timestamptz;
alter table printer_status add column if not exists paper_low_alerted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'printer_status_station_check'
  ) then
    alter table printer_status add constraint printer_status_station_check
      check (station in ('online', 'store'));
  end if;
end $$;

create unique index if not exists printer_status_tenant_station_key
  on printer_status (tenant_id, station);

commit;
