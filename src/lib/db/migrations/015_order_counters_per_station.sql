-- 015_order_counters_per_station.sql — one daily order-number sequence PER STATION.
--
-- Web orders keep A-001, A-002 …; store orders (phone, walk-in, dine-in) get
-- their own B-001, B-002 … (prefixes in src/config/stations.ts). The counter
-- row gains a station, existing rows become the online sequence they always
-- were, and the primary key becomes (tenant_id, business_date, station) so
-- each station's single atomic UPSERT has its own row.
--
-- ⚠️ APPLY THIS BEFORE DEPLOYING THE CODE THAT NEEDS IT, AND DEPLOY RIGHT AFTER.
--   - New code on a database without 015: every order fails (its ON CONFLICT
--     names three columns; the station column does not exist).
--   - Old code on a database WITH 015: every order also fails. Its
--     ON CONFLICT (tenant_id, business_date) no longer matches a unique
--     constraint ("there is no unique or exclusion constraint matching the
--     ON CONFLICT specification"). Postgres cannot infer a partial index for
--     it, so no extra index can keep the old statement working.
--   So the window between this migration and the deploy is an ordering
--   outage. Keep it to seconds: apply, then deploy immediately, ideally while
--   the store is closed. Rollback: down_015_to_014.sql, same caveat reversed.
--
-- Idempotent: safe to run twice, and after a rollback. Takes a brief ACCESS EXCLUSIVE lock on
-- order_counters (a handful of rows), so the PK rebuild is instant.

begin;

-- The default backfills every existing row as 'online' (they are all the A-
-- sequence), and is what a row written without a station means.
alter table order_counters
  add column if not exists station text not null default 'online';

alter table order_counters drop constraint if exists order_counters_station_check;
alter table order_counters
  add constraint order_counters_station_check check (station in ('online', 'store'));

alter table order_counters drop constraint if exists order_counters_pkey;
alter table order_counters
  add constraint order_counters_pkey primary key (tenant_id, business_date, station);

-- Re-applied after a rollback (down_015_to_014 drops the store rows), the
-- store sequence must resume past the B- numbers already issued that day, or
-- the next store order would be B-001 again and collide on
-- orders (tenant_id, business_date, order_number). On a first apply there
-- are no B- orders and this inserts nothing.
insert into order_counters (tenant_id, business_date, station, seq)
select tenant_id, business_date, 'store', max(substring(order_number from '[0-9]+$')::int)
  from orders
 where order_number ~ '^B-[0-9]+$'
 group by tenant_id, business_date
on conflict (tenant_id, business_date, station)
  do update set seq = greatest(order_counters.seq, excluded.seq);

comment on table order_counters is
  'One row per tenant per business day per station (online = A-, store = B-). Incremented by a single atomic UPSERT so 50 concurrent submissions get 50 distinct numbers.';

commit;
