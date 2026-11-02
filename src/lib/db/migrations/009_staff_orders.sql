-- ---------------------------------------------------------------------------
-- 009: staff-entered orders (phone / walk-in) share the web order pipeline.
--
-- Run this against a database that already has the 008 shape. A fresh project
-- should just run schema.sql instead, which already includes everything here.
--
-- ⚠️ DEPLOY ORDER: apply this BEFORE deploying the code that reads it. The
-- repository now selects these columns on every read, so code ahead of the
-- schema fails every order query, including the printer's poll.
--
-- WHY. Staff at the counter take phone and walk-in orders on the new
-- /{kitchen}/pos screen. Those orders are NOT a second system: they are rows in
-- `orders`, numbered from the same daily counter, priced by the same server
-- recompute, printed by the same CloudPRNT path. The only thing the row needs
-- to know is where it came from, plus two free-text notes staff asked for.
--
-- WHAT THIS ADDS
--   orders.channel       'web' | 'phone' | 'walk_in'. Defaults to 'web', so
--                        every existing row and every web checkout is
--                        unchanged without a backfill.
--   orders.payment_note  free text, e.g. "paid by phone, card ending 4417".
--                        The POS never takes a card; this only records what
--                        happened on the Clover terminal.
--   orders.staff_note    internal note, never printed ("regular, always extra
--                        spicy"; or why an order was cancelled).
--   orders_customer_phone_idx
--                        repeat-customer lookup on the POS. The phone lives
--                        in the `customer` jsonb (E.164), so this is an
--                        expression index rather than a column index.
--
-- phone_verified_at stays NOT NULL. For a staff channel it is stamped with the
-- moment staff took the order: staff on the phone with the customer, or face
-- to face at the counter, ARE the verification the OTP stands in for online.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

alter table orders add column if not exists channel      text not null default 'web';
alter table orders add column if not exists payment_note text;
alter table orders add column if not exists staff_note   text;

alter table orders drop constraint if exists orders_channel_check;
alter table orders add  constraint orders_channel_check
  check (channel in ('web', 'phone', 'walk_in'));

create index if not exists orders_customer_phone_idx
  on orders (tenant_id, (customer->>'phone'));

-- Order history reads by date range newest-first across every status; the
-- kitchen index leads with status and cannot serve that ordering on its own.
create index if not exists orders_history_idx
  on orders (tenant_id, business_date, created_at desc);

commit;
