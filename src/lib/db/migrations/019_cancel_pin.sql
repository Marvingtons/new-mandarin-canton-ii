-- 019_cancel_pin.sql — 取消 Cancel needs a manager PIN (CANCEL_PIN).
--
-- orders.cancelled_by: who authorised a cancel ('manager-pin'), shown in
-- History; cleared by an undo. cancel_pin_failures: wrong PIN attempts per
-- board session, so the rate limit (5 wrong in 10 minutes -> 60s cooldown)
-- holds across Worker isolates.
--
-- Run BEFORE deploying the code: the order reads select cancelled_by.
-- Idempotent: safe to run twice. Rollback: down_019_to_018.sql.

begin;
alter table orders add column if not exists cancelled_by text;
create table if not exists cancel_pin_failures (
  id           bigserial   primary key,
  tenant_id    text        not null,
  session_key  text        not null,
  failed_at    timestamptz not null default now()
);
create index if not exists cancel_pin_failures_session_idx
  on cancel_pin_failures (tenant_id, session_key, failed_at);
alter table cancel_pin_failures enable row level security;
commit;
