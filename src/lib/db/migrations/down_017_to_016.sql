-- down_017_to_016.sql — ROLLBACK of 017_order_revisions.
--
-- Drops the edit history and the change tickets. The orders rows keep their
-- CURRENT (edited) items and totals, which is what the kitchen last printed
-- and the customer will pay; only the record of earlier versions goes.
--
-- Roll the Worker back FIRST: the 017 code selects orders.revision on every
-- read and fails without it.

begin;
drop index if exists orders_change_pending_idx;
alter table print_deliveries drop column if exists ticket_revision;
alter table print_deliveries drop column if exists change_ticket_id;
drop table if exists order_change_tickets;
drop table if exists order_revisions;
alter table orders drop column if exists change_ticket_id;
alter table orders drop column if exists ticket_revision;
alter table orders drop column if exists edited_at;
alter table orders drop column if exists revision;
commit;
