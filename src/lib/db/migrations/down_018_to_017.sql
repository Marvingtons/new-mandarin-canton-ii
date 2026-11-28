-- down_018_to_017.sql — ROLLBACK of 018_print_prerender.
--
-- Nothing is lost: a staged body is a cache. Orders in flight simply render at
-- hand-over again. Any staged R2 objects are collected by the bucket's 24h
-- lifecycle rule.

begin;
alter table orders drop column if exists print_prerender;
commit;
