-- down_015_to_014.sql — ROLLBACK of 015_order_counters_per_station.
--
-- Returns order_counters to one row per tenant per day. The store station's
-- rows are dropped: the code before 015 numbers every order from the online
-- row, and B- numbers already issued cannot collide with its A- numbers.
--
-- ⚠️ The same ordering outage as 015, reversed: the per-station code fails on
-- this shape and the old code fails on 015's. Run this and roll the Worker
-- back in the same minute.

begin;
delete from order_counters where station <> 'online';
alter table order_counters drop constraint if exists order_counters_pkey;
alter table order_counters drop constraint if exists order_counters_station_check;
alter table order_counters drop column if exists station;
alter table order_counters
  add constraint order_counters_pkey primary key (tenant_id, business_date);
comment on table order_counters is
  'One row per tenant per business day. Incremented by a single atomic UPSERT so 50 concurrent submissions get 50 distinct numbers.';
commit;
