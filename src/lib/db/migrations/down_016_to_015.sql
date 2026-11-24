-- down_016_to_015.sql — remove the 日結 report print kind.
--
-- Deletes every report hand-over (they cascade with report_prints) BEFORE
-- order_id becomes NOT NULL again, since those rows have none. Order
-- deliveries are untouched. Deploy the pre-016 code first or together: the
-- 016 code tolerates a missing report_prints table (see 016's header).
--
-- Idempotent: safe to run twice.

begin;

alter table print_deliveries drop constraint if exists print_deliveries_reason_check;
-- Guarded so a second run (the column already gone) is a no-op, not an error.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'print_deliveries' and column_name = 'report_print_id') then
    delete from print_deliveries where report_print_id is not null;
  end if;
end $$;
alter table print_deliveries
  add constraint print_deliveries_reason_check
  check (reason in ('first-offer', 'retry', 'manual_reprint'));

alter table print_deliveries drop constraint if exists print_deliveries_subject_check;
alter table print_deliveries drop column if exists report_print_id;
alter table print_deliveries alter column order_id set not null;

drop table if exists report_prints;

commit;
