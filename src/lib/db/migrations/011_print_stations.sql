-- ---------------------------------------------------------------------------
-- 011: two printers, the orders side. Every ticket knows which printer
--      (station) it belongs to, every hand-over records which printer took it,
--      and a 重印 copy can wait for a printer without touching the order's
--      status. Printer health is 012's.
--
-- ⚠️ NOT APPLIED. Written for review.
--
-- Run against a database that already has the 010 shape. A fresh project runs
-- schema.sql instead, which already includes 011 and 012.
--
-- DEPLOY ORDER (both files): apply 011, then 012, then deploy once.
--
--   Both files are additive. The code running today keeps working on the
--   result (verify:station-migrations runs main's own code against it), and
--   the new code needs both. 011 must come first only because the new code
--   reads orders.print_station; 012 does not depend on 011, but run them in
--   number order.
--
--   Nothing here touches printer_status. The running code upserts it
--   `on conflict (tenant_id)`, which needs (tenant_id) to stay its key, so the
--   per-printer health table is a NEW table (012) rather than a re-keyed one.
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
--                                between this migration and the deploy: until
--                                the deploy there is one printer, the online
--                                one, and it is where those tickets print.
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

commit;
