-- ---------------------------------------------------------------------------
-- New Mandarin Canton ordering platform — full schema
--
-- This file is the CURRENT desired state, and is idempotent: running it against
-- a fresh Supabase project creates everything. Incremental changes to an
-- already-deployed database live in src/lib/db/migrations/ and are numbered.
--
-- Multi-tenant by design: every row is scoped by tenant_id so a second
-- restaurant is a new row set, not a new database.
--
-- Money is INTEGER CENTS everywhere. No column here is a float, and nothing in
-- the orders path may introduce one.
--
-- NOTHING in this file is payment-related. Customers pay at the counter; a
-- verified phone number, not a card, is what makes an order real.
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
  -- Resolved line items: nameEn, nameZh, size, modifiers (both languages),
  -- special instructions, and integer-cent unit/line totals.
  items             jsonb       not null,
  -- { subtotalCents, taxCents, tipCents, totalCents } — integers, always.
  totals            jsonb       not null,
  -- { name, phone } with phone in E.164.
  customer          jsonb       not null,
  -- NOT NULL on purpose: an unverified order cannot exist. This column is the
  -- schema-level statement of the anti-abuse rule.
  phone_verified_at timestamptz not null,
  pickup_at         timestamptz not null,
  -- The "ready around 6:45–6:50 PM" window, computed ONCE at order creation
  -- and read by the confirmation, the kitchen board, the ticket, and the
  -- order-ready text. Stored rather than recomputed so all four agree and a
  -- customer re-reading their confirmation does not watch the estimate move.
  -- Nullable: orders predating migration 003 have none and fall back to
  -- pickup_at.
  ready_from        timestamptz,
  ready_to          timestamptz,
  print_attempts    int         not null default 0,
  -- Where we are in a ticket the printer cannot take in one piece. A printer
  -- may declare a maximum decodable image height (Star's mono_len); a ticket
  -- taller than it is cut on blank rows and sent as consecutive jobs, and
  -- these two track that sequence across polls. print_segments is 0 until a
  -- job is handed over, then the total; print_segment is the next piece to
  -- send. Both return to 0 once the last piece is confirmed. The common case
  -- is a ticket that fits, where these stay 0 and 1 and nothing splits.
  print_segment     int         not null default 0,
  print_segments    int         not null default 0,
  -- The R2 object holding the body currently on offer, or NULL when none is
  -- published. The name ends in the sha256 of its own bytes, so it can only be
  -- derived by rendering; keeping it here is what stops every poll re-rendering
  -- a ticket that already exists, and is how a confirmation knows which object
  -- to delete. Cleared with the segment counters whenever the sequence resets.
  print_job_key     text,
  -- Set ONLY by a CloudPRNT DELETE, i.e. the printer's own confirmation that
  -- paper came out. Never set optimistically when a job is handed over. On a
  -- split ticket this waits for the LAST piece, so a sequence that stalls
  -- half-printed stays visible to the board and the unprinted-order alert.
  printed_at        timestamptz,
  last_print_error  text,
  -- Stamped when the unprinted-order alert CLAIMS this order, before the SMS
  -- is sent, so two overlapping sweeps cannot both text about it.
  alerted_at        timestamptz,
  -- Owner-alert send attempts. A failed send releases the claim (alerted_at
  -- back to NULL) so the next sweep retries; this counter is what stops that
  -- becoming an infinite retry against a permanently bad number. At the
  -- ceiling the claim is left in place and the order stays visible on the
  -- kitchen board instead.
  alert_attempts    int         not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint orders_status_check check (
    status in (
      'QUEUED',
      'PRINTED',
      'PRINT_FAILED',
      'ACCEPTED',
      'COMPLETED',
      'CANCELLED'
    )
  )
);

comment on table orders is
  'Pickup orders. Unpaid by design — payment happens at the counter. The unique index on (tenant_id, idempotency_key) is what prevents a double submit becoming two tickets.';

-- Idempotency is enforced HERE, not in application code. A duplicate submit
-- loses this insert and is handed the original confirmation.
create unique index if not exists orders_idempotency_uniq
  on orders (tenant_id, idempotency_key);

-- Two customers can never hold the same number on the same day.
create unique index if not exists orders_number_uniq
  on orders (tenant_id, business_date, order_number);

-- Drives the /kitchen board query.
create index if not exists orders_kitchen_idx
  on orders (tenant_id, business_date, status, created_at desc);

-- Drives the CloudPRNT claim and the unprinted-order alert sweep. Partial, so
-- it stays small: only orders that still need something to happen to them.
create index if not exists orders_print_queue_idx
  on orders (tenant_id, created_at)
  where status in ('QUEUED', 'PRINT_FAILED');

-- Atomic daily counter. A plain sequence will not do — it does not reset per
-- day, and a read-then-write in application code races under concurrency.
create table if not exists order_counters (
  tenant_id     text not null,
  business_date date not null,
  seq           int  not null default 0,
  primary key (tenant_id, business_date)
);

comment on table order_counters is
  'One row per tenant per business day. Incremented by a single atomic UPSERT so 50 concurrent submissions get 50 distinct numbers.';

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Defense in depth ONLY. The real boundary is that the browser never talks to
-- this database at all: every write goes through a server route handler using
-- the service-role key, which bypasses RLS anyway. No policy is defined, so a
-- leaked anon key grants nothing here.
-- ---------------------------------------------------------------------------
alter table orders         enable row level security;
alter table order_counters enable row level security;
