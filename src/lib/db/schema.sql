-- ---------------------------------------------------------------------------
-- New Mandarin Canton ordering platform — schema
--
-- Run this once in the Supabase SQL editor (sandbox project first). The file
-- is idempotent, so re-running it after an edit is safe.
--
-- Multi-tenant by design: every row is scoped by tenant_id so a second
-- restaurant is a new row set, not a new database.
--
-- Money is INTEGER CENTS everywhere. No column in this file is a float, and
-- nothing in the orders path may introduce one.
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

-- ---------------------------------------------------------------------------
-- Orders
--
-- Replaces the .data/orders.json dev store, which was per-instance and
-- ephemeral on serverless: it silently defeated BOTH the idempotency replay
-- and the daily order number, so a double-tap could double-charge and two
-- customers could be handed the same number at the counter.
--
-- The guarantee lives in the unique indexes below, not in application code.
-- ---------------------------------------------------------------------------

create table if not exists orders (
  id                bigserial   primary key,
  -- Multi-tenant from day one. Tenant #2 is a new row set, not a new table.
  tenant_id         text        not null,
  -- Customer-facing daily number, e.g. 'A-017'.
  order_number      text        not null,
  -- Restaurant-local date that owns the daily sequence. NOT a UTC date: an
  -- 11pm order in Chula Vista must not roll onto tomorrow's ticket run.
  business_date     date        not null,
  status            text        not null,
  idempotency_key   text        not null,
  -- Clover charge id. Null while the row is only a PENDING_PAYMENT
  -- reservation; set once the charge succeeds.
  charge_id         text,
  -- Resolved line items: nameEn, nameZh, size, modifiers (both languages),
  -- special instructions, and integer-cent unit/line totals.
  items             jsonb       not null,
  -- { subtotalCents, taxCents, tipCents, totalCents } — integers, always.
  totals            jsonb       not null,
  -- { name, phone }
  customer          jsonb       not null,
  pickup_at         timestamptz not null,
  print_attempts    int         not null default 0,
  last_print_error  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint orders_status_check check (
    status in (
      'PENDING_PAYMENT',
      'PAID',
      'PRINTED',
      'PRINT_FAILED',
      'ACCEPTED',
      'COMPLETED',
      'CANCELLED'
    )
  )
);

comment on table orders is
  'Paid pickup orders, one row per customer order. The unique index on (tenant_id, idempotency_key) is what actually prevents a double charge.';

-- THE constraint that enforces single-charge. Not optional: the checkout route
-- reserves the row BEFORE calling Clover, so a concurrent duplicate submit
-- loses this race and never reaches the charge call at all.
create unique index if not exists orders_idempotency_uniq
  on orders (tenant_id, idempotency_key);

-- Two customers can never hold the same number on the same day.
create unique index if not exists orders_number_uniq
  on orders (tenant_id, business_date, order_number);

-- Drives the /kitchen board query.
create index if not exists orders_kitchen_idx
  on orders (tenant_id, business_date, status, created_at desc);

-- Atomic daily counter. A plain sequence will not do — it does not reset per
-- day, and a read-then-write in application code races under concurrency.
create table if not exists order_counters (
  tenant_id     text not null,
  business_date date not null,
  seq           int  not null default 0,
  primary key (tenant_id, business_date)
);

comment on table order_counters is
  'One row per tenant per business day. Incremented by a single atomic UPSERT so 50 concurrent checkouts get 50 distinct numbers.';

alter table orders          enable row level security;
alter table order_counters  enable row level security;
