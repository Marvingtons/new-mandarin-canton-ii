-- Run after 011, 012 and 013, before deploying the Recently done board.
-- Prepared only; not applied to any live database.
alter table orders add column if not exists done_previous_status text;
alter table orders add column if not exists done_at timestamptz;
create index if not exists orders_recent_done_idx
  on orders (tenant_id, done_at desc, id desc)
  where status in ('COMPLETED', 'CANCELLED');
