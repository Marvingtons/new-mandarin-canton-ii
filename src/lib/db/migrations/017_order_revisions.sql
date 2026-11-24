-- 017_order_revisions.sql — 改單 EDIT ORDER (docs/edit-order.md).
--
-- Staff reopen an order, change it, and the kitchen gets a CHANGE TICKET that
-- lists only the differences under the original number. The orders row keeps
-- the CURRENT items and totals; every save first copies the previous version
-- into order_revisions, so nothing is ever changed without history.
--
-- RUN BEFORE DEPLOYING the code that reads these columns (every order read
-- selects orders.revision). Old code on a database WITH 017 is unaffected:
-- every new column is nullable or defaulted, every existing print_deliveries
-- row keeps meaning "the kitchen ticket", and nothing old reads the new tables.
--
-- Comes after 016 (016_report_prints.sql, the 日結 daily report, PR #14).
-- Nothing here depends on 016; the number is only the order they are applied.
--
-- Idempotent: safe to run twice. Rollback: down_017_to_016.sql.

begin;

-- The version the row holds now. 0 = as placed; each saved edit adds 1.
alter table orders add column if not exists revision int not null default 0;
-- When the last edit was saved. NULL = never edited.
alter table orders add column if not exists edited_at timestamptz;
-- The revision the FIRST kitchen ticket was handed to a printer at, stamped by
-- the claim in the same statement that creates the first delivery. NULL means
-- no body was ever offered, which is the only state in which the kitchen
-- certainly has no paper (the printer fetches bodies from R2 directly, so a
-- delivery's fetched_at cannot say it). While it is NULL an edit simply
-- replaces the contents; once set, retries of that ticket render THAT
-- revision and an edit prints a change ticket instead.
alter table orders add column if not exists ticket_revision int;
-- A change ticket waiting for, or being printed by, a printer: the id of its
-- order_change_tickets row. Set by the save, cleared when it prints or gives up.
alter table orders add column if not exists change_ticket_id uuid;

create table if not exists order_revisions (
  id          bigserial   primary key,
  order_id    bigint      not null references orders (id) on delete cascade,
  tenant_id   text        not null,
  -- The version this row holds: a snapshot of version `revision`, written by
  -- the save that produced revision + 1. Revision 0 is the order as placed.
  revision    int         not null,
  items       jsonb       not null,
  totals      jsonb       not null,
  staff_note  text,
  -- The edit that superseded this version: when, by whom, and what it changed
  -- (OrderLinesDiff, revision -> revision + 1). History reads these.
  created_at  timestamptz not null default now(),
  actor       text        not null,
  diff        jsonb       not null,
  -- The POS's key for one Save press: a retried or double-tapped Save with the
  -- same key is the same edit, never a second revision or a second ticket.
  edit_token  text        not null,
  constraint order_revisions_revision_check check (revision >= 0)
);

comment on table order_revisions is
  'Every previous version of an edited order. orders holds the current one; each 改單 save copies the version it replaces here, with the diff and who saved it.';

create unique index if not exists order_revisions_order_rev_uniq
  on order_revisions (tenant_id, order_id, revision);
create unique index if not exists order_revisions_token_uniq
  on order_revisions (tenant_id, edit_token);

-- What a change ticket prints, frozen when it is saved, so every print of it
-- (the first, a retry, a 重印) is the same bytes.
create table if not exists order_change_tickets (
  id               uuid        primary key,
  order_id         bigint      not null references orders (id) on delete cascade,
  tenant_id        text        not null,
  -- The kitchen's paper was at from_revision; this ticket brings it to
  -- to_revision. Widened (to_revision moved up, payload recomputed) by a
  -- further edit while the ticket has never been handed to a printer.
  from_revision    int         not null,
  to_revision      int         not null,
  -- OrderChangeTicket (lib/orders/revisionDiff.ts).
  payload          jsonb       not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- First hand-over. NULL = never offered, so a further edit may widen it.
  first_offered_at timestamptz,
  -- Set by the printer's confirmation.
  printed_at       timestamptz,
  -- The offer cap was reached without a confirmation. The card turns red and
  -- the unprinted-order alert texts the owner (alerted_at, once).
  failed_at        timestamptz,
  alerted_at       timestamptz,
  constraint order_change_tickets_range_check check (to_revision > from_revision)
);

comment on table order_change_tickets is
  'One row per 改單 change ticket: the diff the kitchen gets after an edit, under the original order number.';

create index if not exists order_change_tickets_order_idx
  on order_change_tickets (tenant_id, order_id);

-- Which body a hand-over carried. Both NULL on every existing row, which keeps
-- meaning "the kitchen ticket, as the order stood".
--   change_ticket_id: this hand-over (or this 重印 request) is that change ticket.
--   ticket_revision:  the revision of the full ticket this hand-over rendered.
alter table print_deliveries add column if not exists change_ticket_id uuid;
alter table print_deliveries add column if not exists ticket_revision int;

-- Pending change tickets, whatever the order's status. Tiny: rows leave it as
-- soon as their ticket prints or gives up.
create index if not exists orders_change_pending_idx
  on orders (tenant_id, created_at)
  where change_ticket_id is not null;

alter table order_revisions      enable row level security;
alter table order_change_tickets enable row level security;

commit;
