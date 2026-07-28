-- ---------------------------------------------------------------------------
-- 002 — count owner-alert send attempts so a failed alert can retry.
--
-- Run this against a database that already has the 001 shape. A fresh project
-- should just run schema.sql instead, which already includes this column.
--
-- Context: the unprinted-order cron claims an order by stamping `alerted_at`
-- BEFORE it sends the SMS, which is correct — it is what stops two overlapping
-- sweeps texting twice. But a send FAILURE left the claim in place, so one
-- transient Twilio error silenced that order's alert permanently. The fix
-- releases the claim on failure, and this column is what stops that release
-- from becoming an infinite retry against a permanently bad phone number.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

alter table orders add column if not exists alert_attempts int not null default 0;

commit;
