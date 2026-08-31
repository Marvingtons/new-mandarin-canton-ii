-- ---------------------------------------------------------------------------
-- 008 — give every hand-over an IDENTITY, and an audit trail the database
--       could not previously provide.
--
-- Run this against a database that already has the 007 shape. A fresh project
-- should just run schema.sql instead, which already includes everything here.
--
-- WHY. An order printed its copy-set and then printed it again. The re-offer
-- loop decided whether to hand a job over a second time from a timestamp it
-- also cleared itself (`print_offered_at`) — so it could not tell "this print
-- died, re-offer it" apart from "this print succeeded and the confirmation is
-- merely late". Both produced a second ticket. And when the printer fetched the
-- same body twice on its own, nothing was written at all, so the duplicate was
-- invisible to every column.
--
-- The fix is identity. Each hand-over is now a row in `print_deliveries` with
-- its own id; that id is the token handed to the printer, echoed back on the
-- confirmation, and carried in the job URL. The re-offer predicate becomes
-- "offer only if no delivery is in flight, OR the one in flight has expired",
-- and a confirmation closes the SPECIFIC delivery it names rather than
-- "whatever is in flight for this order right now". A lost confirmation now
-- costs a delayed ticket (after the window), never a duplicate.
--
-- WHAT THIS ADDS
--   orders.print_delivery_id          — the delivery the printer is holding,
--                                        or NULL when it holds nothing of ours.
--                                        This, not print_offered_at, is what the
--                                        offer path now measures against.
--   orders.print_delivery_expires_at  — when that delivery's confirmation window
--                                        ends. Stamped in the SAME statement as
--                                        the pointer, so the two can never drift.
--   print_deliveries                  — one row per hand-over. The audit trail:
--                                        when it went out, when (and how often)
--                                        it was fetched, when it was confirmed,
--                                        with what code, and WHY it was offered
--                                        (first-offer | retry | manual_reprint).
--
-- print_offered_at is KEPT and still stamped, but it is now informational only
-- (it drives the "elapsed since offer" figure in the logs). The decision is
-- made from print_delivery_id / print_delivery_expires_at.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

-- The pointer to the in-flight delivery, and its confirmation deadline. Both
-- NULL at rest: NULL print_delivery_id means the printer holds nothing of ours,
-- which is the only state in which a fresh offer is free.
alter table orders add column if not exists print_delivery_id         uuid;
alter table orders add column if not exists print_delivery_expires_at timestamptz;

-- One row per hand-over of a body to the printer. This is the record the
-- database could not previously produce: it makes "how many tickets did this
-- order actually cause, and why?" a question SQL can answer.
create table if not exists print_deliveries (
  -- App-generated (crypto.randomUUID) so the pointer on `orders` can be stamped
  -- in the same statement that claims the job, without a round-trip to read a
  -- server-generated default back.
  id           uuid        primary key,
  -- Cascade so deleting an order (test cleanup, GDPR erasure) takes its
  -- deliveries with it rather than leaving orphans behind an FK error.
  order_id     bigint      not null references orders (id) on delete cascade,
  tenant_id    text        not null,
  -- When this hand-over went out, and when its confirmation window closes.
  offered_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  -- When the printer first fetched the body, and how many times in total. A
  -- second fetch before confirmation is the silent double-print (A-004): it was
  -- invisible before because the GET path wrote nothing. fetch_count > 1 is now
  -- a badge on the kitchen card.
  fetched_at   timestamptz,
  fetch_count  int         not null default 0,
  -- Set by the confirming DELETE, with the result code it carried. A delivery
  -- with confirmed_at set can never print again: its GET answers 410 Gone and
  -- its confirmation is treated as a stale replay.
  confirmed_at timestamptz,
  confirm_code text,
  -- WHY this hand-over happened. 'first-offer' the first time; 'retry' after a
  -- window expired unconfirmed; 'manual_reprint' when staff pressed 重印. A
  -- manual_reprint row is the ONLY legitimate marker of a second ticket — any
  -- order that produced a second ticket without one is a bug by definition.
  reason       text        not null,
  -- Who caused it. 'printer' for automatic offers, 'kitchen' for a manual 重印.
  -- ⚠️ TODO(confirm): the kitchen board is a single shared password with no
  -- per-person identity (see src/lib/auth/kitchenSession.ts), so 'kitchen' is
  -- as fine-grained as this can get today. If the owner ever wants to know
  -- WHICH staff member reprinted, that needs real accounts first.
  actor        text,
  created_at   timestamptz not null default now(),

  constraint print_deliveries_reason_check
    check (reason in ('first-offer', 'retry', 'manual_reprint'))
);

comment on table print_deliveries is
  'One row per hand-over of a job body to the printer. The audit trail behind duplicate-ticket diagnosis: offered/fetched/confirmed timestamps, a fetch count, and the reason (first-offer | retry | manual_reprint). orders.print_delivery_id points at the in-flight row.';

-- The board aggregates deliveries per order (count, total fetches, reprint
-- count) on every 10s poll, so this join wants to be an index seek.
create index if not exists print_deliveries_order_idx
  on print_deliveries (tenant_id, order_id);

-- Defense in depth only, matching orders/order_counters/printer_status: the
-- browser never reaches this database, and every write goes through a
-- service-role route handler that bypasses RLS. No policy = a leaked anon key
-- grants nothing.
alter table print_deliveries enable row level security;

commit;
