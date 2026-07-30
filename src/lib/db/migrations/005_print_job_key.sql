-- ---------------------------------------------------------------------------
-- 005 — remember which R2 object holds the job body currently on offer.
--
-- Run this against a database that already has the 004 shape. A fresh project
-- should just run schema.sql instead, which already includes this column.
--
-- Context: print-job bodies moved out of the Worker response and into R2, and
-- the printer is pointed at the object with CloudPRNT's `jobGetUrl`. The
-- object name ends in the sha256 of its own bytes, so it can only be derived
-- by rendering the ticket — and the printer re-polls every few seconds while a
-- job is outstanding. Without somewhere to keep the name, every one of those
-- polls would re-render a ticket that already exists just to work out where it
-- is. This column is that memory.
--
-- It is also what lets a confirmation clean up: on DELETE we know exactly
-- which object to remove rather than leaving it for the 24h lifecycle rule.
--
-- NULL means no body is published for this order right now — the next poll
-- renders one. Cleared alongside the segment counters whenever the sequence
-- resets, so a requeue starts over rather than pointing at a stale object.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

alter table orders add column if not exists print_job_key text;

commit;
