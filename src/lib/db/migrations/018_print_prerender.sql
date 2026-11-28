-- 018_print_prerender.sql — the kitchen ticket rendered when the order is
-- created, so the poll that hands it to the printer does not render it.
--
-- One nullable jsonb column on orders: {"key", "segments", "fingerprint"}.
-- `key` is an R2 object already uploaded under print-jobs/, `fingerprint` the
-- sha256 of everything the render read. The hand-over takes it (and clears it)
-- in one statement only when its own fingerprint matches; otherwise it renders
-- as before. See src/lib/print/prerender.ts.
--
-- Safe in either order with the deploy: the code that reads it treats a
-- missing column as "nothing staged" and renders, and old code never reads it.
--
-- Idempotent: safe to run twice. Rollback: down_018_to_017.sql.

begin;
alter table orders add column if not exists print_prerender jsonb;
commit;
