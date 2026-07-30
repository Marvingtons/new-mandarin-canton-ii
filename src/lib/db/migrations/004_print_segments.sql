-- ---------------------------------------------------------------------------
-- 004 — track position within a ticket sent as several print jobs.
--
-- Run this against a database that already has the 003 shape. A fresh project
-- should just run schema.sql instead, which already includes these columns.
--
-- Context: a Star printer may declare the tallest image it can decode
-- (mono_len, on the job GET). A ticket taller than that cannot be sent at all
-- — the firmware answers 511 Media Decoding Error — so it is cut on blank
-- rows and handed over as consecutive jobs. CloudPRNT has no concept of a
-- multi-part job: each piece is a separate GET, confirmed by its own DELETE,
-- and the printer never tells us which piece it is asking for. The server owns
-- that position, which is what these two columns are.
--
-- print_segments is 0 until the first piece of a ticket is handed over, then
-- the total number of pieces. print_segment is the index of the next piece to
-- send. A ticket that fits — every ticket, until a printer declares a limit —
-- leaves them at 0 and 1 and never splits.
--
-- Both reset to 0 when the LAST piece is confirmed, at the same moment
-- printed_at is set. A sequence that stalls half-way therefore leaves the
-- order unprinted, which is correct: half a ticket is worse than none, because
-- it looks like it worked.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

alter table orders add column if not exists print_segment  int not null default 0;
alter table orders add column if not exists print_segments int not null default 0;

commit;
