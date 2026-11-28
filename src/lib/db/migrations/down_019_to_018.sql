-- down_019_to_018.sql — ROLLBACK of 019_cancel_pin.
--
-- Deploy the previous code FIRST (it does not read cancelled_by), then run
-- this. Loses who authorised past cancels and the failure log; the cancels
-- themselves (status CANCELLED) are untouched.

begin;
drop table if exists cancel_pin_failures;
alter table orders drop column if exists cancelled_by;
commit;
