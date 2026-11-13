-- down_014_to_010.sql — ROLLBACK of migrations 014, 013, 012 and 011.
--
-- WHAT IT REVERTS, newest first:
--   014_recently_done           orders.done_previous_status, orders.done_at,
--                               index orders_recent_done_idx
--   013_board_version_index     index orders_board_version_idx
--   012_printer_status_per_station
--                               table printer_station_status (per-printer
--                               health; printer_status, which 012 left alone,
--                               is what main reads and is untouched here)
--   011_print_stations          print_deliveries.station and its check;
--                               orders.print_station, reprint_delivery_id,
--                               rerouted_from, their checks and the indexes
--                               orders_print_station_queue_idx and
--                               orders_reprint_pending_idx
-- leaving the schema exactly as main's schema.sql (migrations through 010).
-- verify:station-migrations applies 011-014, runs this, compares the result
-- with main's schema.sql and runs main's print path against it.
--
-- ⚠️ RUN THIS ONLY AFTER THE WORKER HAS BEEN ROLLED BACK TO MAIN. The branch's
-- code reads and writes every column dropped here; running it under the
-- branch Worker breaks printing, the board and the health strip at once.
-- Order: roll the Worker back to main, confirm main is serving and printing,
-- then run this. Main's code does not need it (it ignores the extra columns),
-- so there is no hurry: it is for returning the database to main's shape.
--
-- What is lost, by design: which printer each order and hand-over was routed
-- to, any 重印 copy still waiting on a printer (staff re-request it on main),
-- the failover marks, the per-printer health rows (main's printer_status is
-- rewritten on the next poll) and the Recently done Undo state.
--
-- One transaction. The index drops are plain DROP INDEX (not CONCURRENTLY,
-- which a transaction refuses): each takes a brief exclusive lock on orders.
--
-- Written by the pre-deploy audit (originally /tmp/nmc-audit/E/down_014_to_010.sql);
-- the statements below are that file unchanged.

begin;
drop index if exists orders_recent_done_idx;
alter table orders drop column if exists done_previous_status;
alter table orders drop column if exists done_at;
drop index if exists orders_board_version_idx;
drop table if exists printer_station_status;
alter table print_deliveries drop constraint if exists print_deliveries_station_check;
alter table print_deliveries drop column if exists station;
drop index if exists orders_reprint_pending_idx;
drop index if exists orders_print_station_queue_idx;
alter table orders drop constraint if exists orders_rerouted_from_check;
alter table orders drop column if exists rerouted_from;
alter table orders drop column if exists reprint_delivery_id;
alter table orders drop constraint if exists orders_print_station_check;
alter table orders drop column if exists print_station;
commit;
