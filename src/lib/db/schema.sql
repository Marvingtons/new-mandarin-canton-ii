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
  -- When a job body was last handed to the printer with jobReady:true.
  --
  -- Written by exactly one thing — an offer leaving the server — and cleared
  -- whenever the printer stops holding a body for this order (confirmed,
  -- revoked, or advanced to the next piece). NULL therefore means "the printer
  -- has nothing of ours in flight", which is the only state in which offering
  -- is free. Everything else waits out the confirmation window.
  --
  -- Deliberately NOT updated_at, which the offer path's own bookkeeping writes
  -- move: measuring patience against that column is what let one order print
  -- its copy-set several times over. See src/lib/print/entitlement.ts.
  --
  -- KEPT, but now INFORMATIONAL. The offer decision no longer reads this — it
  -- reads print_delivery_id / print_delivery_expires_at below. This column
  -- survives only to drive the "elapsed since offer" figure in the poll logs.
  print_offered_at  timestamptz,
  -- IDENTITY of the hand-over the printer is currently holding, or NULL when it
  -- holds nothing of ours. This — not a self-clearing timestamp — is what the
  -- offer path now measures against: offer only if this is NULL, or the
  -- delivery it names has expired. It points at a row in print_deliveries and
  -- is the token echoed on the confirming DELETE and carried in the job URL.
  -- Stamped and cleared in the same statement as the counters it travels with.
  print_delivery_id         uuid,
  -- When the in-flight delivery's confirmation window closes. Written in the
  -- SAME statement as print_delivery_id so the two can never drift apart, which
  -- is the whole point of moving off print_offered_at. NULL when nothing is in
  -- flight.
  print_delivery_expires_at timestamptz,
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
-- One row per HAND-OVER of a job body to the printer.
--
-- The record the database could not previously produce. An order printed its
-- copy-set and then printed it again, and nothing said why: the re-offer loop
-- decided from a timestamp it also cleared itself, so it could not tell a dead
-- print from a merely-late confirmation, and a printer that fetched the same
-- body twice on its own wrote nothing at all.
--
-- Each hand-over is now a row here with its own id. That id is the token the
-- printer is handed, echoes back on the confirming DELETE, and carries in the
-- job URL — so a confirmation closes the SPECIFIC delivery it names, a re-fetch
-- is counted, and "how many tickets did this order actually cause, and why?"
-- becomes a question SQL can answer. orders.print_delivery_id points at the row
-- currently in flight.
-- ---------------------------------------------------------------------------
create table if not exists print_deliveries (
  -- App-generated (crypto.randomUUID) so orders.print_delivery_id can be stamped
  -- in the same statement that claims the job, with no round-trip to read a
  -- server-side default back.
  id           uuid        primary key,
  -- Cascade so deleting an order takes its deliveries with it rather than
  -- leaving orphans behind an FK error.
  order_id     bigint      not null references orders (id) on delete cascade,
  tenant_id    text        not null,
  -- When this hand-over went out, and when its confirmation window closes.
  offered_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  -- When the printer first fetched the body, and how many times in total. A
  -- second fetch before confirmation is the silent double-print; it was
  -- invisible before because the GET path wrote nothing. fetch_count > 1 badges
  -- the kitchen card.
  fetched_at   timestamptz,
  fetch_count  int         not null default 0,
  -- Set by the confirming DELETE, with the code it carried. Once confirmed_at
  -- is set the delivery can never print again: its GET answers 410 Gone and a
  -- second confirmation is treated as a stale replay.
  confirmed_at timestamptz,
  confirm_code text,
  -- WHY this hand-over happened. 'manual_reprint' is the ONLY legitimate marker
  -- of a second ticket — an order that produced one without a manual_reprint
  -- delivery is a bug by definition.
  reason       text        not null,
  -- Who caused it: 'printer' for automatic offers, 'kitchen' for a manual 重印.
  -- ⚠️ TODO(confirm): the board is one shared password with no per-person
  -- identity (see src/lib/auth/kitchenSession.ts), so 'kitchen' is as
  -- fine-grained as this gets until real accounts exist.
  actor        text,
  created_at   timestamptz not null default now(),

  constraint print_deliveries_reason_check
    check (reason in ('first-offer', 'retry', 'manual_reprint'))
);

comment on table print_deliveries is
  'One row per hand-over of a job body to the printer. The audit trail behind duplicate-ticket diagnosis: offered/fetched/confirmed timestamps, a fetch count, and the reason. orders.print_delivery_id points at the in-flight row.';

-- The board aggregates deliveries per order on every 10s poll.
create index if not exists print_deliveries_order_idx
  on print_deliveries (tenant_id, order_id);

-- ---------------------------------------------------------------------------
-- What the printer is telling us, remembered between polls.
--
-- The CloudPRNT poll carries the printer's own state, and the server used to
-- read one bit of it. So a printer out of paper looked exactly like a healthy
-- one: it kept being handed jobs it could not print, each hand-over spent part
-- of a retry budget, and paper came back to a queue whose orders had already
-- been condemned. One row per tenant — one printer per restaurant, rewritten
-- every three seconds. Mutable state, not a log; the transitions go to the
-- Workers Logs.
-- ---------------------------------------------------------------------------
create table if not exists printer_status (
  tenant_id          text        primary key,
  -- The poll clock. "Offline" is not a flag the printer sets; it is this
  -- column going stale.
  last_seen_at       timestamptz not null default now(),
  online             boolean     not null default true,
  paper_out          boolean     not null default false,
  cover_open         boolean     not null default false,
  paper_low          boolean     not null default false,
  -- Verbatim, both fields, because the parser in lib/print/printerStatus.ts is
  -- deliberately conservative: when it misses a condition, this is the
  -- evidence needed to teach it.
  status_code        text,
  status_raw         text,
  printer_mac        text,
  -- When the current blocked spell began; cleared when it ends. The window the
  -- paper-restored requeue looks back over.
  blocked_since      timestamptz,
  -- Alert-once stamps, one per condition so an offline alert and a paper alert
  -- cannot silence each other. Cleared when the condition clears.
  offline_alerted_at timestamptz,
  paper_alerted_at   timestamptz,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Defense in depth ONLY. The real boundary is that the browser never talks to
-- this database at all: every write goes through a server route handler using
-- the service-role key, which bypasses RLS anyway. No policy is defined, so a
-- leaked anon key grants nothing here.
-- ---------------------------------------------------------------------------
alter table orders            enable row level security;
alter table order_counters    enable row level security;
alter table printer_status    enable row level security;
alter table print_deliveries  enable row level security;
