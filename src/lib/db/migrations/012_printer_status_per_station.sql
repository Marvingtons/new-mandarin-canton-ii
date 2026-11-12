-- ---------------------------------------------------------------------------
-- 012: printer_status becomes one row per printer, keyed (tenant_id, station).
--
-- ⚠️ NOT APPLIED. Written for review.
--
-- DEPLOY ORDER: AFTER 011 AND AFTER the two-printer code is deployed. See 011
-- for why. Until this runs, the old (tenant_id) primary key lets only one
-- printer have a health row, so the store printer's polls are refused.
--
-- ROLLBACK NOTE: code from before the two-printer change upserts
-- `on conflict (tenant_id)` and fails against this key. Rolling that code back
-- means reversing this file first:
--     delete from printer_status where station <> 'online';
--     alter table printer_status drop constraint printer_status_pkey;
--     alter table printer_status add constraint printer_status_pkey primary key (tenant_id);
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

do $$
begin
  -- Only when the key is still the single-printer one.
  if exists (
    select 1
      from pg_constraint c
     where c.conname = 'printer_status_pkey'
       and array_length(c.conkey, 1) = 1
  ) then
    alter table printer_status drop constraint printer_status_pkey;
    alter table printer_status add constraint printer_status_pkey
      primary key (tenant_id, station);
  end if;
end $$;

-- The primary key is now the arbiter for `on conflict (tenant_id, station)`;
-- the interim unique index from 011 is redundant.
drop index if exists printer_status_tenant_station_key;

comment on table printer_status is
  'One row per printer, keyed (tenant_id, station), rewritten on every CloudPRNT poll. Health is derived from last_seen_at against the clock; alert-once stamps clear when their condition clears.';

commit;
