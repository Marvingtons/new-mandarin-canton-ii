-- ---------------------------------------------------------------------------
-- 013: the staff board's change check, one index. No table changes.
--
-- ⚠️ NOT APPLIED. Written for review.
--
-- DEPLOY ORDER: apply 011, then 012, then this, then deploy once. Safe under
-- the code running today (it only adds an index nothing old reads), and the
-- new code is correct without it, only slower: the version query then reads
-- today's rows through orders_kitchen_idx instead.
--
-- WHAT IT IS FOR. Every staff tablet polls GET /api/kitchen/orders/version
-- every 4 seconds (readBoardVersion in src/lib/orders/repository.ts):
--
--   select count(*), max(updated_at), sum(<updated_at in microseconds>), ...
--     from orders
--    where tenant_id = $1 and business_date = $2::date
--      and status not in ('COMPLETED', 'CANCELLED')
--
-- This index holds exactly those rows (the predicate is the query's, word for
-- word, so the planner can prove it applies) and carries updated_at, so the
-- poll is an index-only scan over today's OPEN orders. Its cost does not grow
-- with the day: a finished order leaves the index when it is completed or
-- cancelled.
--
-- REQUIRED: run this file on its own, outside a transaction, after 011 and 012.
-- CREATE INDEX CONCURRENTLY keeps order writes available during the build.
-- Do not concatenate this file with other migrations in a single query.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

create index concurrently if not exists orders_board_version_idx
  on orders (tenant_id, business_date, updated_at)
  where status not in ('COMPLETED', 'CANCELLED');
