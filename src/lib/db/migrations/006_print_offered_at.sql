-- ---------------------------------------------------------------------------
-- 006 — remember WHEN a job body was last handed to the printer.
--
-- Run this against a database that already has the 005 shape. A fresh project
-- should just run schema.sql instead, which already includes this column.
--
-- Context: an order printed its three cut copies and then kept printing more.
-- The offer loop decided whether to re-hand-over a job by counting offers and
-- measuring `updated_at`, and neither of those means what the decision needs:
--
--   * `print_attempts` counts hand-overs, so "two offers before the cooldown
--     starts" allowed the SECOND hand-over to happen on the very next poll —
--     about three seconds later, while the printer was still on copy 1 of 3.
--     Every job printed twice, with no lost confirmation required.
--
--   * `updated_at` moves on every write to the row, including the bookkeeping
--     writes the offer path itself makes (print_job_key, print_segments). So
--     the quiet period measured "time since we last touched this row", not
--     "time since the printer was given work", and any write restarted it.
--
-- This column is written by exactly one thing: an offer leaving the server
-- with jobReady:true. It is NULL when the printer holds no body for this order
-- — never offered, offer consumed by a confirmation, or revoked. That makes
-- "may this be offered again?" answerable from state rather than inferred from
-- a counter. See src/lib/print/entitlement.ts.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

alter table orders add column if not exists print_offered_at timestamptz;

commit;
