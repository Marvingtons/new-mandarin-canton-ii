-- ---------------------------------------------------------------------------
-- 003 — store the pickup-ready window on the order.
--
-- Run this against a database that already has the 002 shape. A fresh project
-- should just run schema.sql instead, which already includes these columns.
--
-- Context: the confirmation screen, the kitchen board, the ticket, and the
-- order-ready text all need to say the same thing about when food will be
-- ready. Computing it at render time made each surface answer a slightly
-- different question depending on when it was looked at — a customer
-- re-reading their confirmation would watch the estimate slide. So it is
-- computed once at order creation and stored.
--
-- Nullable: orders placed before this migration have no window, and every
-- reader falls back to pickup_at rather than inventing one.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

alter table orders add column if not exists ready_from timestamptz;
alter table orders add column if not exists ready_to   timestamptz;

commit;
