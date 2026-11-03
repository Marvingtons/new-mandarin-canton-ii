-- ---------------------------------------------------------------------------
-- 010: dine-in orders from the staff POS, seated at a table.
--
-- Run this against a database that already has the 009 shape. A fresh project
-- should just run schema.sql instead, which already includes everything here.
--
-- ⚠️ DEPLOY ORDER: apply this BEFORE deploying the code that reads it. The
-- repository selects these columns on every read, so code ahead of the schema
-- fails every order query, including the printer's poll. Same rule as 009.
--
-- WHY. Staff seat a party on the POS's floor plan and send its order to the
-- kitchen. Like phone and walk-in orders, a dine-in order is NOT a second
-- system: it is a row in `orders`, numbered from the same daily A-xxx counter,
-- priced by the same server recompute, printed by the same CloudPRNT path, and
-- paid at the counter. The row additionally knows which table it is for.
--
-- WHAT THIS ADDS (additive only: nothing is dropped, renamed or backfilled)
--   orders.channel           now also allows 'dine_in'.
--   orders.table_label       "4", or "4+5" for two tables pushed together. The
--                            labels a room allows live in lib/kitchen/floor-plan.ts,
--                            not here, so rearranging the room needs no migration.
--   orders.guest_count       party size. Guidance on the ticket; never a cap.
--   orders.is_addon          true for a later round of dishes for a party that
--                            is already seated. Prints 加菜 ADD-ON.
--   orders.table_cleared_at  when staff cleared the table. A dine_in order with
--                            this NULL is an OPEN table; occupancy is derived
--                            from exactly that, server-side, never stored twice.
--   orders_open_tables_idx   partial index for that occupancy read: only
--                            uncleared dine-in rows, so it stays tiny.
--
-- Every existing row reads channel 'web' (or phone/walk_in), NULL table, NULL
-- guests, is_addon false, and is never an open table. No backfill needed.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

alter table orders add column if not exists table_label      text;
alter table orders add column if not exists guest_count      int;
alter table orders add column if not exists is_addon         boolean not null default false;
alter table orders add column if not exists table_cleared_at timestamptz;

alter table orders drop constraint if exists orders_channel_check;
alter table orders add  constraint orders_channel_check
  check (channel in ('web', 'phone', 'walk_in', 'dine_in'));

-- A party is at least one person. No upper bound: seats are guidance.
alter table orders drop constraint if exists orders_guest_count_check;
alter table orders add  constraint orders_guest_count_check
  check (guest_count is null or guest_count >= 1);

create index if not exists orders_open_tables_idx
  on orders (tenant_id, table_label)
  where channel = 'dine_in' and table_cleared_at is null;

commit;
