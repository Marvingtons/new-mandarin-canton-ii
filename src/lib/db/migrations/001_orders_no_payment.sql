-- ---------------------------------------------------------------------------
-- 001 — drop the prepaid-checkout shape, adopt the verified-phone shape.
--
-- Run this ONLY against a database that already has the earlier Clover-era
-- `orders` table. A fresh project should just run schema.sql instead.
--
-- Context: online payment is cancelled. Customers pay at the counter, and a
-- Twilio-verified phone number replaces the card as the anti-abuse control.
-- That removes two payment states and the charge id, and adds the columns the
-- print pipeline and the unprinted-order alert need.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

-- Was a Clover charge id. Nothing charges any longer.
alter table orders drop column if exists charge_id;

alter table orders add column if not exists phone_verified_at timestamptz;
alter table orders add column if not exists printed_at        timestamptz;
alter table orders add column if not exists alerted_at        timestamptz;

-- Retire the payment states.
--   PENDING_PAYMENT — a reservation taken before charging a card. Such a row
--                     was never a real order, so it is cancelled, not queued.
--   PAID            — the old "money taken, needs cooking" state, which is
--                     exactly what QUEUED now means.
update orders set status = 'CANCELLED' where status = 'PENDING_PAYMENT';
update orders set status = 'QUEUED'    where status = 'PAID';

-- Backfill before the NOT NULL. Pre-migration orders were proved by a card
-- rather than a phone; created_at is the closest honest stand-in, and every
-- one of them is historical.
update orders set phone_verified_at = created_at where phone_verified_at is null;
alter table orders alter column phone_verified_at set not null;

-- Historical PRINTED rows really did print; we just never recorded when.
update orders set printed_at = updated_at
  where printed_at is null and status = 'PRINTED';

alter table orders drop constraint if exists orders_status_check;
alter table orders add  constraint orders_status_check check (
  status in (
    'QUEUED',
    'PRINTED',
    'PRINT_FAILED',
    'ACCEPTED',
    'COMPLETED',
    'CANCELLED'
  )
);

create index if not exists orders_print_queue_idx
  on orders (tenant_id, created_at)
  where status in ('QUEUED', 'PRINT_FAILED');

-- The menu now ships inside the app, so there is no remote menu to snapshot.
drop table if exists menu_snapshots;

commit;
