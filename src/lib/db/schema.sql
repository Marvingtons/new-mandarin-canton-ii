-- ---------------------------------------------------------------------------
-- New Mandarin Canton ordering platform — Phase 1 schema
--
-- Run this once in the Supabase SQL editor (sandbox project first).
-- Phase 3 adds the orders / idempotency / order-number tables; this file
-- currently covers only what the menu sync needs.
--
-- Multi-tenant by design: every row is scoped by tenant_id so a second
-- restaurant is a new row set, not a new database.
-- ---------------------------------------------------------------------------

-- Last-good menu snapshot. Written on every successful Clover read and served
-- when Clover is unreachable, so an API outage degrades to a slightly stale
-- menu instead of an empty page.
create table if not exists menu_snapshots (
  tenant_id    text        not null,
  -- The normalized Menu object (categories -> items -> modifier groups).
  payload      jsonb       not null,
  -- Epoch ms the data was read from Clover.
  fetched_at   bigint      not null,
  updated_at   timestamptz not null default now(),
  primary key (tenant_id)
);

comment on table menu_snapshots is
  'Last-good normalized menu per tenant. Read-only fallback when Clover is down. Never used as a basis for taking payment.';

-- RLS is enabled purely as a safety net: the app reaches this table only via
-- the service-role key from server code, and no anon/authenticated policy is
-- defined, so a leaked anon key grants nothing here.
alter table menu_snapshots enable row level security;
