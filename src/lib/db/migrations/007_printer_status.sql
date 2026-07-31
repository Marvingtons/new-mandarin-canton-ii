-- ---------------------------------------------------------------------------
-- 007 — what the printer is telling us, remembered between polls.
--
-- Run this against a database that already has the 006 shape. A fresh project
-- should just run schema.sql instead, which already includes this table.
--
-- Context: the CloudPRNT poll carries the printer's own state, and the server
-- read one bit of it (statusCode begins with "2") to write a warning line. So
-- a printer out of paper was indistinguishable from a healthy one: it kept
-- being handed jobs it could not print, every hand-over spent part of a retry
-- budget, and the budget ran out. Paper came back to a queue whose orders had
-- already been condemned to PRINT_FAILED.
--
-- One row per tenant. There is one printer per restaurant, and the row is
-- rewritten every three seconds, so this is a piece of MUTABLE STATE and not a
-- log — history belongs in the Workers Logs, which is where the transitions
-- are written.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

create table if not exists printer_status (
  tenant_id          text        primary key,
  -- The poll clock. Everything about "is it there" derives from this;
  -- offline is not a flag the printer sets, it is this column going stale.
  last_seen_at       timestamptz not null default now(),
  -- What the printer said, parsed. See lib/print/printerStatus.ts for why
  -- these are read from the status REASON PHRASE rather than its number.
  online             boolean     not null default true,
  paper_out          boolean     not null default false,
  cover_open         boolean     not null default false,
  paper_low          boolean     not null default false,
  -- What it said, verbatim, both fields. Kept because the parser above is
  -- deliberately conservative: when a condition is missed, THIS is the
  -- evidence needed to teach it, and a status nobody stored is a status
  -- nobody can learn from.
  status_code        text,
  status_raw         text,
  printer_mac        text,
  -- When the current blocked spell began, cleared when it ends. The window
  -- the paper-restored requeue looks back over, and what the owner alert
  -- measures "paper out for over five minutes" against.
  blocked_since      timestamptz,
  -- Alert-once stamps, one per condition so an offline alert and a paper
  -- alert cannot silence each other. Cleared when the condition clears, so
  -- the next outage alerts again.
  offline_alerted_at timestamptz,
  paper_alerted_at   timestamptz,
  updated_at         timestamptz not null default now()
);

commit;
