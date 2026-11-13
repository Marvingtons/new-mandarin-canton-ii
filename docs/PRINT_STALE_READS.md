# Stale print reads: diagnosis, fix, deploy plan

## What happened

Since 31 Aug, five orders show the same pattern in `print_deliveries`. After a
legitimate retry, more retries arrive 3 to 17 seconds apart, inside a 90-second
window that should have held them. Every kitchen reprint (重印) ended without a
confirmation. Two orders reached "9 hand-overs" even though the cap is 4.

## Root cause (confirmed)

Production reads Postgres through Hyperdrive, config `nmc-db`
(`1011a8a541654fc09428eaa9708eb094`), and that config had query caching on. A
plain SELECT can be answered from a 60-second cache that our own writes never
clear.

A read-only probe Worker ran against `nmc-db` on 5 Nov 2026, 21:40 to 21:43
UTC: 90 samples, one every 2 seconds. The Worker was deleted right after.

| Query | Result |
|---|---|
| `select last_seen_at from printer_status ...` (plain) | Same value for 60 s at a time: lag behind the printer grew 4.4 s → 62.5 s, then reset. 88 of 90 samples stale |
| Same query with `to_char(...)` (as in `ORDER_COLUMNS`) | Identical: cached. Hyperdrive does not treat `to_char` as uncacheable |
| Same query `... for share` inside a transaction | Fresh on all 90 samples, lag ≤ 3.0 s |
| Exact `currentPrintJob` text | 1 to 10 ms on every sample (cache speed). A real round trip is 12 to 48 ms |
| Exact `getOrderById` text | 31 ms on the first sample, then ≤ 10 ms (cache hits) |

How that produced the incidents:

- **Retry bursts.** The poll's `currentPrintJob` returned a cached row showing a
  delivery that had already expired and been replaced. The poll re-offered on
  every 3-second poll until the cache entry aged out. The cap check used the
  cached `print_attempts`, so it fell behind the real count, which is how an
  order reached 9 hand-overs under a cap of 4.
- **Lost reprint confirmations.** The confirming DELETE checks
  `order.printDeliveryId === token` using `getOrderById`. The board and the 重印
  route had just read that row, so the cached copy predated the reprint and
  every confirmation looked superseded and was dropped.

`scripts/verify-print-stale-reads.ts` checks the delivery incidents with caching
 disabled, then deliberately enables the cache emulator to check the warning.
`verify:claim-no-skip` races 20 board/cron readers against 200 claims. It fails
on baseline `209f9b1` and passes with the ordinary reads.

## The fix

1. **Disable Hyperdrive query caching before deploying this branch.** Reads
   are ordinary SELECTs. The old `lockedRead` helper and cache-only `now()`
   projection are removed: FOR SHARE on queue rows caused SKIP LOCKED claims
   to skip waiting tickets. `currentPrintJob` retains its single-statement
   FOR UPDATE to wait for an in-progress confirmation/re-offer; it only locks
   attempted jobs, outside the claim's zero-attempt candidate set. Write
   transaction locks and the printer claim itself are unchanged.
   A bounded, in-memory tripwire warns once per isolate when a read predates
   a write that isolate observed. It adds no query and changes no response.
2. **Re-offers check the delivery before replacing it.** `reofferPrintDelivery`
   now takes the delivery id the decision was based on and writes nothing
   unless that is still the current delivery and it has expired. A stale
   decision can no longer create an extra offer.
3. **重印 is refused while the printer holds a live copy** (409, code
   `printing`). Before, a reprint pressed right after an offer threw that
   delivery away (A-001, 15 Oct: 重印 1 second after the offer).
4. **"Did not print" banner on the board.** A red banner per ticket reads
   "Ticket A-xxx did not print. Reprint?" (中文: "A-xxx 單未印出。要重印嗎？")
   with a 56px Reprint button. It shows when the current attempt (the order
   arriving, or the last 重印) has gone 2 minutes with no confirmed delivery.
   That includes a ticket never offered at all, such as a printer that stopped
   polling. Computed on the server from a fresh read.

## REQUIRED BEFORE DEPLOY of this branch (not applied)

```bash
npx wrangler hyperdrive update 1011a8a541654fc09428eaa9708eb094 --caching-disabled true
```

Rollback:

```bash
npx wrangler hyperdrive update 1011a8a541654fc09428eaa9708eb094 --caching-disabled false
```

This branch requires caching disabled BEFORE deployment. With caching off, the printer's 3-second poll costs a few direct
queries; Hyperdrive still pools the connections.

## Deploy plan (after close, 8:30 PM or later)

1. Confirm nothing is waiting to print:
   ```sql
   select order_number, status, print_attempts from orders
    where tenant_id = 'nmc' and status = 'QUEUED';
   ```
   It should return no rows. If it returns any, wait for them to print.
2. Note the live version for rollback: `npx wrangler deployments status --name nmc-web`
   (on 5 Nov this was `a4d56d0b-f7c1-4427-b64d-25d875919bea`).
3. Turn off caching (command above). Confirm with
   `npx wrangler hyperdrive get 1011a8a541654fc09428eaa9708eb094`
   (`"caching": {"disabled": true}`).
4. Merge the PR, then from `main`: `npm run build:cf && npm run deploy:cf`.
5. Watch two minutes of polls: `npx wrangler tail nmc-web --format pretty`.
   Expect a POST every ~3 s with no `verdict=` lines (nothing queued) and no errors.
6. Open `/kitchen` and check that the board loads and shows no red banner.

### Rollback

- Code: `npx wrangler rollback <version id from step 2>`
- Keep caching disabled while this branch is deployed. Only consider restoring
  caching after rolling back to code that does not rely on ordinary fresh reads.

## Next-day test (during open hours)

Watch the deliveries live while you test:

```sql
select o.order_number, o.status, o.print_attempts,
       d.reason, d.offered_at at time zone 'America/Los_Angeles' as offered,
       d.expires_at at time zone 'America/Los_Angeles' as expires,
       d.confirmed_at at time zone 'America/Los_Angeles' as confirmed, d.confirm_code
  from orders o join print_deliveries d on d.order_id = o.id
 where o.tenant_id = 'nmc' and o.customer->>'name' = 'TEST IGNORE'
 order by d.offered_at;
```

1. Place a web order named **TEST IGNORE**.
   Expect: one `first-offer`, confirmed `200 OK` within about 30 s, and the
   order PRINTED. One set of copies.
2. Once it prints, press 重印 on the board.
   Expect: one `manual_reprint` marker, then exactly one `first-offer`
   confirmed within about 30 s. Order back to PRINTED. One more set of copies.
   No `retry` rows.
3. Optional: press 重印 again and immediately once more.
   Expect: the second tap says the printer is printing it now, and no second
   delivery is created.
4. Cancel the test order on the board.

Any `retry` row less than 90 s after the previous offer, or any delivery that
stays unconfirmed with paper out, is a failure: roll back and send me the rows.

## Not covered here

- `OWNER_ALERT_PHONE` is not set on `nmc-web`, so the unprinted-order SMS and
  the printer-offline SMS have never been sent (the sweep logs "OWNER_ALERT_PHONE
  is not set"). Setting it is `npx wrangler secret put OWNER_ALERT_PHONE --name nmc-web`.
- `PRINT_OFFER_CAP` is not set in production, so it uses the code default of 4.
