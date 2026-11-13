# Staff board follow-up report

Baseline: `209f9b1` on `feat/unified-staff-two-printers`.
No push, deployment, Hyperdrive mutation, or live migration was performed.
Migration checks use disposable embedded PostgreSQL databases only.

## 1. Cache-workaround inventory

These are every `lockedRead` call site at the baseline (line numbers refer to
that revision, before edits):

| File | Line | Function | Replacement |
|---|---:|---|---|
| src/lib/orders/repository.ts | 416 | listOpenTables | Ordinary SELECT; seating is serialized by createOrder's advisory lock |
| src/lib/orders/repository.ts | 692 | currentPrintJob | Single-statement SELECT FOR UPDATE; see below |
| src/lib/orders/repository.ts | 808 | getPrintDelivery | Ordinary SELECT; confirmation rechecks under its write transaction lock |
| src/lib/orders/repository.ts | 1073 | printSegmentState | Ordinary SELECT |
| src/lib/orders/repository.ts | 1190 | countQueuedOrders | Ordinary aggregate SELECT, no locking subquery |
| src/lib/orders/repository.ts | 1369 | findUnprintedForAlert | Ordinary SELECT; conditional markAlerted UPDATE claims the alert |
| src/lib/orders/repository.ts | 1474 | countOrdersForPhone | Ordinary aggregate SELECT, no locking subquery |
| src/lib/orders/repository.ts | 1493 | getOrderByIdempotencyKey | Ordinary SELECT |
| src/lib/orders/repository.ts | 1517 | findRecentOrderByNumber | Ordinary SELECT |
| src/lib/orders/repository.ts | 1533 | getOrderByNumber | Ordinary SELECT |
| src/lib/orders/repository.ts | 1549 | getOrderById | Ordinary SELECT |
| src/lib/print/healthStore.ts | 491 | readAllPrinterStatus, per-station shape | Ordinary SELECT |
| src/lib/print/healthStore.ts | 501 | readAllPrinterStatus, legacy shape | Ordinary SELECT |

Neither route directly called the helper. The printer poll uses currentPrintJob,
printSegmentState and getPrintDelivery; its confirmation also reads getOrderById.
The cron sweep uses countQueuedOrders, findUnprintedForAlert and printer health
reads. Both route files are unchanged.

The helper is deleted. The inline cache-only FOR SHARE clauses in
selectByIdempotencyKey and checkTable are also removed. The unused `now() as
read_at` in readBoardPrinterInputs is deleted. Remaining SQL `now()` calls
supply actual timestamps, printer thresholds, pending-ticket deadlines, the
server clock, or the Recently done window.

currentPrintJob retains FOR UPDATE to wait for a confirmation or re-offer
already writing the job before making its offer/hold/cap decision. It only
locks attempted jobs (`print_attempts > 0`); the printer claim considers
zero-attempt jobs. Its own transaction wrapper is gone. The claim's
FOR UPDATE SKIP LOCKED selection and write transaction are unchanged.

The tripwire remembers recent writes in memory, compares subsequent order
reads and the version read's existing server clock, and logs at most once per
isolate. It adds no SQL and does not alter responses. The stale-read verifier
checks silence with fresh reads, detection with the cache emulator, and the
once-only warning.

## 2. Recently done

The collapsed strip shows at most eight orders finished in the last ten minutes,
newest first, including transitions just across a business-date boundary. Its
compact OrderCard uses the shared StatusPill and Button. New labels show EN,
Traditional Chinese and Spanish together.

Migration 014 persists the prior status and terminal-transition time. The
conditional Undo UPDATE restores that exact status once, within the window.
Undo uses the shared optimistic action path, without a confirmation dialog,
print-field updates, new deliveries, or a reprint request. Restoring QUEUED
resumes that order's existing queue eligibility; it does not create an extra
print attempt. Undo does not undo a separate table-clear operation or retract
an already-sent completion notification.

Completion/cancellation already move the version because an open row leaves
its count and timestamp aggregate. The same version statement additionally
fingerprints the bounded recent window, so changes or expiry there also
invalidate it. Recent rows are fetched with the main list only after a version
change (plus the existing initial-load and explicit-refresh paths).

## 3. Protected-directory diff

`git diff 209f9b1 --stat -- src/lib/print src/lib/ticket src/app/api/print src/app/api/cron`:

```text
 src/lib/print/boardPrinters.ts | 99 ------------------------------------------
 src/lib/print/healthStore.ts   | 15 ++++---
 2 files changed, 8 insertions(+), 106 deletions(-)
```

healthStore contains the item 1 helper call sites. Item 3 deletes only
boardPrinters.ts; all consumers use boardFeed.ts. The parity comparison against
the deleted implementation is removed. No other print-directory file changed.
The ticket pipeline, R2 path, content type, Content-Length, compression policy,
three cut copies, confirmation window and glyph subsetting are unchanged.

## 4. Deploy checklist (prepared only)

1. Apply 011_print_stations.sql.
2. Apply 012_printer_status_per_station.sql.
3. Run 013_board_version_index.sql **on its own, outside a transaction**.
   It uses CREATE INDEX CONCURRENTLY IF NOT EXISTS.
4. Apply 014_recently_done.sql for the prior status, timestamp and recent index.
5. **REQUIRED BEFORE DEPLOY of this branch:**

   ```bash
   npx wrangler hyperdrive update 1011a8a541654fc09428eaa9708eb094 --caching-disabled true
   ```

   Verify with `npx wrangler hyperdrive get 1011a8a541654fc09428eaa9708eb094`:
   `caching.disabled` must be true. Keep caching disabled while this code runs.
6. Only after these prerequisites, build and deploy through the normal process.
   Deployment is not authorized or performed as part of this task.

The local Wrangler help confirms the boolean flag. The migration verifier tests
013 alone in autocommit, reruns it, checks its valid/ready flags, and verifies
that a transaction wrapper is rejected.

## 5. Final validation and poll measurements

- Lint, app typecheck, worker typecheck, and build:cf passed.
- Every npm `verify:*` command passed. The station harness now runs with
  caching disabled, as this branch requires (63/63); stale-read detection is
  still tested separately with caching deliberately enabled (31/31).
- The initial OTP verifier run exposed a pre-existing flaky test: replacing a
  signature's last character with `0` sometimes left it unchanged. Both
  tamper cases now guarantee a different character; the rerun passed. No
  authentication implementation changed.
- The board verifier passed 129 checks after deleting the duplicate-strip
  comparisons. Migration verification passed 29/29.
- Concurrency: current code claimed 200 tickets with **0 skips**, alongside
  14,452 reads. The same verifier on `209f9b1` failed: 381 skipped claims in
  461 attempts. Its explicit FOR SHARE control also produces skips.
- React Doctor: no new issues relative to `209f9b1` (`--scope changed
  --base 209f9b1`). The broader branch-vs-main scan reports existing findings.
- Browser suite: all 33 tests passed across the full run (30 Chrome tests)
  and the focused iPad rerun (3 WebKit tests), including complete/strip/Undo
  and quiet version polls. WebKit first had to be installed. Its HTTP localhost
  sign-in then needed a test-only adaptation: reuse the successful login's
  server-issued session with Secure removed in that local test browser.
  Production cookie settings and server-side authentication are unchanged.
  The helper is restricted to WebKit on the exact localhost test origin.

Poll measurements below are local embedded-PostgreSQL medians, not production
latency estimates. A changed polling cycle costs one version statement plus
four full-list statements. The unchanged cycle stays at one statement. All
measured reads took zero row locks and wrote zero WAL bytes.


| Orders today | Request | Statements | Body | Status | WAL written | Median |
|---|---|---|---|---|---|---|
| 0 orders | unchanged poll: /version, If-None-Match | 1 (0 locking) | 0 B | 304 | 0 B | 0.3 ms |
| 0 orders | changed poll: /version | 1 (0 locking) | 87 B | 200 | 0 B | 0.4 ms |
| 0 orders | full list (version changed) | 4 (0 locking) | 464 B | 200 | 0 B | 0.7 ms |
| 0 orders | full list, If-None-Match | 1 (0 locking) | 0 B | 304 | 0 B | 0.3 ms |
| 10 orders | unchanged poll: /version, If-None-Match | 1 (0 locking) | 0 B | 304 | 0 B | 0.3 ms |
| 10 orders | changed poll: /version | 1 (0 locking) | 110 B | 200 | 0 B | 0.3 ms |
| 10 orders | full list (version changed) | 4 (0 locking) | 17658 B | 200 | 0 B | 0.9 ms |
| 10 orders | full list, If-None-Match | 1 (0 locking) | 0 B | 304 | 0 B | 0.3 ms |
| 40 orders | unchanged poll: /version, If-None-Match | 1 (0 locking) | 0 B | 304 | 0 B | 0.3 ms |
| 40 orders | changed poll: /version | 1 (0 locking) | 110 B | 200 | 0 B | 0.3 ms |
| 40 orders | full list (version changed) | 4 (0 locking) | 69372 B | 200 | 0 B | 1.4 ms |
| 40 orders | full list, If-None-Match | 1 (0 locking) | 0 B | 304 | 0 B | 0.3 ms |
| 40 open + 120 done today | unchanged poll: /version, If-None-Match | 1 (0 locking) | 0 B | 304 | 0 B | 0.3 ms |
| 40 open + 120 done today | changed poll: /version | 1 (0 locking) | 110 B | 200 | 0 B | 0.3 ms |
| 40 open + 120 done today | full list (version changed) | 4 (0 locking) | 69372 B | 200 | 0 B | 1.7 ms |
| 40 open + 120 done today | full list, If-None-Match | 1 (0 locking) | 0 B | 304 | 0 B | 0.3 ms |

### Supplementary wire-check limitation

`scripts/verify-job-wire.sh` was also attempted against the local development
fixture. It could not validate bytes because `/api/ticket/preview` returned
500: Turbopack could not resolve the resvg WASM path, and webpack reported
`createRequire is not a function` in the existing `src/lib/ticket/resvg.ts`
loader (also reproduced under Node 22). That protected rendering code was not
changed. The repository's printer-delivery, recurrence, splitting and glyph
verifiers passed, including their content-type, fixed-length, compression and
copy checks. No live printer/edge wire probe was performed.
