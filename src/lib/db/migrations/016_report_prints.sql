-- 016_report_prints.sql — the 日結 DAILY REPORT as a print kind.
--
-- A report is not an order, but it goes to the same printers through the same
-- CloudPRNT hand-over, so it gets the same audit trail: one print_deliveries
-- row per hand-over, the delivery id as the job token, a confirmed_at that
-- makes a second print of the same hand-over impossible (GET 410, DELETE a
-- stale replay). What it does NOT get is the orders' retry machinery: a report
-- is offered ONCE. If the printer does not confirm it, it is FAILED and a
-- person prints it again from the sheet, which is a new request with the next
-- #sequence. See src/lib/reports/prints.ts and docs/daily-report.md.
--
-- SAFE IN EITHER ORDER with the deploy:
--   - Old code on a database WITH 016: nothing reads report_prints, and every
--     existing print_deliveries row keeps its order_id, so nothing changes.
--   - New code on a database WITHOUT 016: the print route's report calls fail
--     with "relation does not exist", which it catches and treats as "no
--     report queued", so kitchen tickets print exactly as before. Only the
--     日結 Print button fails, with an error on the sheet.
--
-- Idempotent: safe to run twice. Rollback: down_016_to_015.sql.

begin;

create table if not exists report_prints (
  -- App-generated, like print_deliveries.id.
  id                   uuid        primary key,
  tenant_id            text        not null,
  -- Which report. Only the daily one exists; the column is so a weekly view
  -- (out of scope today) is a new value, not a new table.
  kind                 text        not null default 'daily',
  -- The restaurant-local business day reported on (orders.business_date).
  business_date        date        not null,
  -- #1, #2 … per (tenant, business_date): which print of that day this is.
  -- The header prints it; a reprint after orders changed is visible by it.
  sequence             int         not null,
  -- The printer it was sent to.
  station              text        not null,
  -- The optional blocks (trays, top, hours) as the sheet had them.
  blocks               jsonb       not null,
  -- The DailyReport exactly as it was summed when Print was pressed. The job
  -- is rendered from THIS, never re-summed at hand-over, so the paper carries
  -- the numbers and code the person asked for.
  report               jsonb       not null,
  -- Its fingerprint (DailyReport.code), kept as a column for a human query.
  code                 text        not null,
  -- The client's key for the Print press: a retried request with the same key
  -- is the same print, never a second one.
  request_key          text        not null,
  -- QUEUED → OFFERED → PRINTED, or FAILED. No path leads back to QUEUED.
  status               text        not null default 'QUEUED',
  -- The hand-over, as on orders: the delivery in flight and when its
  -- confirmation window closes. Kept after FAILED so a late confirmation can
  -- still be matched to it.
  delivery_id          uuid,
  delivery_expires_at  timestamptz,
  -- The R2 object holding the job body, deleted on confirmation.
  job_key              text,
  printed_at           timestamptz,
  last_error           text,
  requested_at         timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint report_prints_kind_check    check (kind in ('daily')),
  constraint report_prints_station_check check (station in ('online', 'store')),
  constraint report_prints_status_check  check (status in ('QUEUED', 'OFFERED', 'PRINTED', 'FAILED')),
  constraint report_prints_sequence_check check (sequence >= 1)
);

comment on table report_prints is
  'One row per 日結 report print request. Offered to its printer once, never retried; a failure is reprinted by a person as the next #sequence.';

-- #N is unique per day; the print route is idempotent on it.
create unique index if not exists report_prints_sequence_uniq
  on report_prints (tenant_id, kind, business_date, sequence);

-- A retried Print press with the same key is the same print.
create unique index if not exists report_prints_request_uniq
  on report_prints (tenant_id, request_key);

-- Each printer's waiting or in-flight report. Tiny: rows leave it as soon as
-- they print or fail.
create index if not exists report_prints_queue_idx
  on report_prints (tenant_id, station, requested_at)
  where status in ('QUEUED', 'OFFERED');

alter table report_prints enable row level security;

-- A hand-over is now of an order OR a report, exactly one.
alter table print_deliveries alter column order_id drop not null;
alter table print_deliveries
  add column if not exists report_print_id uuid references report_prints (id) on delete cascade;
alter table print_deliveries drop constraint if exists print_deliveries_subject_check;
alter table print_deliveries
  add constraint print_deliveries_subject_check
  check ((order_id is null) <> (report_print_id is null));

alter table print_deliveries drop constraint if exists print_deliveries_reason_check;
alter table print_deliveries
  add constraint print_deliveries_reason_check
  check (reason in ('first-offer', 'retry', 'manual_reprint', 'report'));

commit;
