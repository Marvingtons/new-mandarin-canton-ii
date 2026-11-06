# Second printer: design (for review, no code yet)

Status: **approved 5 Nov 2026 and built** on `feat/second-printer`, stacked on PR #7's branch. The PR opens after #7 is
deployed and verified and this branch is rebased onto main. Schema in [011_printers.sql](../src/lib/db/migrations/011_printers.sql), written and syntax-checked on a throwaway
embedded Postgres (applies cleanly, applies twice, constraints reject what they should). **Not applied anywhere.**

Goal: printer A (外賣機, role `takeout`, in production today) prints **web** only. Printer B (role `pos`, not set up
yet) prints **phone, walk_in, dine_in and add-ons**. Rule of thumb: web goes to A, anything entered on the POS goes to B.

---

## 1. What the code does today

### How a printer is identified

| Request | What identifies the caller | Where |
|---|---|---|
| POST poll | `printerMAC` in the JSON body (Star also sends `uniqueID`, unused) | [route.ts:148](../src/app/api/print/[secret]/route.ts#L148), [cloudprnt.ts:156](../src/lib/print/cloudprnt.ts#L156) |
| GET with `?token=` | the delivery id. No MAC needed: the token *is* the authorization | [route.ts:553](../src/app/api/print/[secret]/route.ts#L553) |
| bare GET (firmware ignoring `jobGetUrl`) | `?mac=` query param | [route.ts:583](../src/app/api/print/[secret]/route.ts#L583) |
| DELETE / `?delete` confirm | `?mac=` query param plus the `jobToken` echoed back | [route.ts:791](../src/app/api/print/[secret]/route.ts#L791) |
| R2-direct GET (the default path) | nothing. The Worker never sees it | |

The MAC is only used as a **gate**. `printerMacAllowed` compares it to one env var, `CLOUDPRNT_PRINTER_MAC`, and
returns true when the var is unset ([cloudprnt.ts:302](../src/lib/print/cloudprnt.ts#L302)). Nothing downstream
knows which printer is calling. A second printer today would either be refused (MAC pinned) or share one queue with
the first (MAC unset). Polls would never print anything twice, because the queue serializes, but they would trample
the shared health row.

**Confirmed 5 Nov 2026** (read-only query on production): `printer_status` holds tenant `nmc`,
`printer_mac = 00:11:62:55:24:d4`, last seen 0.01 s before the query, status `200 OK`. The live printer sends its MAC
on every poll, so the 011 seed registers it (checked against a scratch database: it normalizes to `0011625524d4`).

### Everything that assumes one printer

| # | Assumption | Where | Breaks how with two |
|---|---|---|---|
| 1 | One allowed MAC, from env | `printerMacAllowed`, [tenant.server.ts:328](../src/config/tenant.server.ts#L328) | B is refused, or both are anonymous |
| 2 | **One job in flight per tenant.** The head of line is "oldest QUEUED order with `print_attempts > 0`" | `currentPrintJob` [repository.ts:552](../src/lib/orders/repository.ts#L552) | B's poll sees A's in-flight job, gets `hold`, and prints nothing until A finishes. Two printers would run at the speed of one |
| 3 | Claim takes the oldest unclaimed order, any channel | `claimNextPrintJob` [repository.ts:504](../src/lib/orders/repository.ts#L504) | No routing at all |
| 4 | Re-offer CAS checks status and delivery id, not the printer | `reofferPrintDelivery` [repository.ts:585](../src/lib/orders/repository.ts#L585) | After a reroute, the old printer could re-offer an order the new one owns |
| 5 | `printer_status` has one row per tenant (PK `tenant_id`) | migration 007, `recordPoll` [healthStore.ts:97](../src/lib/print/healthStore.ts#L97) | A and B overwrite each other every 3 s. A paper-out on A followed by an OK poll from B reads as a **paper-is-back edge** and fires the requeue. Silence edges also become meaningless |
| 6 | The paper-restored requeue covers every `PRINT_FAILED` order of the tenant | `requeueAfterPrinterRestored` [repository.ts:979](../src/lib/orders/repository.ts#L979) | Paper back on A would revive orders that B condemned |
| 7 | One health payload for the board | `printerHealth` [kitchen/orders/route.ts:50](../src/app/api/kitchen/orders/route.ts#L50), `PrinterStrip` [KitchenBoard.tsx:73](../src/components/kitchen/KitchenBoard.tsx#L73) | One chip, flapping between two printers |
| 8 | Unnamed copy: "打印機離線", "Printer offline", "Sent to the printer" | [i18n.ts:85-94, 359-368](../src/lib/kitchen/i18n.ts#L85) | Staff can't tell which one |
| 9 | One alert pair (`offline_alerted_at`, `paper_alerted_at`), one queued count, "the printer is …" | `alertOnPrinter` [unprinted-alert/route.ts:131](../src/app/api/cron/unprinted-alert/route.ts#L131) | One printer's alert silences the other's |
| 10 | Bare GET serves "the" current job | [route.ts:586](../src/app/api/print/[secret]/route.ts#L586) | Could serve A's job to B |
| 11 | `print_deliveries` has no printer column | migration 008 | The audit can't say which printer a ticket came out of |
| 12 | 重印 resets the order with no notion of a target | `requeueForPrint` [repository.ts:1066](../src/lib/orders/repository.ts#L1066) | OK as-is if routing re-decides at claim (see below) |
| 13 | Rate limit of 120/min **per IP**, shared | [rateLimit.ts:67](../src/lib/http/rateLimit.ts#L67) | Both printers sit behind one restaurant IP. Two pollers plus GETs come to about 50/min, half the old headroom. **Built:** raised to 240/min |
| 14 | `ticketCopies()` / `ticketCopyRoles()` global | tenant.server.ts | One copy set for every channel. Now per channel (§2.1) |

These are already per-order and need no change: `print_segment(s)`, `print_job_key`, R2 keys (they carry the delivery
id), `decideOffer`, `confirmPrintDelivery`, the render and offer caps.

---

## 2. Design

### 2.1 Data model ([011](../src/lib/db/migrations/011_printers.sql))

- **`printers`** (id, tenant_id, mac, name, role, active, first_seen_at). The MAC is stored normalized as 12
  lowercase hex characters. `role` is `takeout | pos | NULL`. Constraints: an active printer must have a role,
  only one active printer per role, MAC format checked. An unknown MAC is inserted `active=false, role=NULL`.
- **`printer_health`**: `printer_status` re-keyed by `printer_id`, plus `failover_since`. It is kept apart from
  `printers` because one is rewritten every 3 s and the other is edited by a person.
- **`print_routes`** (tenant_id, channel) → role, **copy_roles**. These are the routing and copy rules. They live as
  data, so changing either is one owner-PIN edit with no deploy. Routes point at a **role**, not at a printer, so
  replacing a dead unit means giving the new MAC the old role. `copy_roles` is the copy set in print order. NULL means
  the environment's `TICKET_COPIES` / `TICKET_COPY_ROLES`, which is today's set. Add-ons are dine_in orders and follow
  the dine_in row. Seeded defaults:
  - every channel → NULL, today's copies. **No ticket changes at deploy.**
  - **TODO(confirm) with the owner:** dine_in and add-ons go to one copy with no bag copy, `{kitchen}` (no prices) or
    `{all}`. It's one edit on the printers page once confirmed.
  - The copy count is the array length, so a count and a role list can never disagree.
- **`print_alert_state`** (tenant): the last time the "every printer is down" text went out, for the 10-minute repeat.
- **`printer_config_audit`**: every assignment, rename, route and copy change, with time, old and new values, and IP.
  It also records every failed owner PIN, which is what the PIN lockout counts.
- **`orders.print_printer_id`**: the printer currently responsible for the ticket. NULL until first claimed. It
  survives retries and split pieces, changes only on a reroute, and is cleared by 重印 and by the paper-restored
  requeue.
- **`print_deliveries.printer_id`** and **`rerouted_from_printer_id`**.

011 is **additive only**, and that is deliberate. The running code upserts `printer_status ... on conflict
(tenant_id)` on every poll, so re-keying that table would stop the live printer the moment the migration landed.
`printer_status` is retired in a later migration (012), after a full service on the new code.

**Seed.** Today's printer comes from `printer_status.printer_mac`. It becomes `takeout`, active, and **every channel
routes to `takeout` until B is assigned**, with today's copies. Deploying the new code with one printer therefore
prints the same tickets in the same place as today. The only new output is the REROUTED header, and only during a
failover. B is added later by data changes alone (§4): `phone`, `walk_in` and `dine_in` move to `pos`.

**Bootstrap.** If a tenant has *no assigned printer* (the seed found no MAC, or it's a fresh install), the first MAC
that polls is registered as the active `takeout` printer, with every channel routed to it and today's copies. That is
exactly the one-printer setup, so a missing seed costs nothing on deploy night and the kitchen can't go dark because
of a migration.
- `CLOUDPRNT_PRINTER_MAC`, when set, is honoured here and only here: a different MAC is stored as unassigned, never
  bootstrapped.
- Unassigned MACs don't count as "a printer exists", so a stray client polling first can't block the real printer.
  `verify:printers` L1 caught exactly that in the first build.

### 2.2 Poll flow, per printer

```
POST from MAC m
  1. recordPoll(tenant, m, condition)     ← ONE upsert into printers + printer_health, RETURNING the
                                            printer row and the before/after (same CTE trick as today)
     unknown m → row inserted inactive → NO_JOB (cap: 10 unassigned rows per tenant, then just log)
     inactive / no role → NO_JOB
  2. blocked (paper-out / cover-open) → NO_JOB, no budget spent       (unchanged, now per printer)
  3. unblocked edge → requeueAfterPrinterRestored(tenant, printer P)  (scoped: print_printer_id = P)
  4. head of line for P: currentPrintJob(tenant, P)                    (lockedRead, FOR UPDATE)
       → decideOffer exactly as today → hold / retry / capped
       → reofferPrintDelivery CAS gains `and print_printer_id = P`
  5. nothing in flight → claimForPrinter(tenant, P)                    (one UPDATE, below)
```

The point of keying the head of line by `(tenant, printer)` is that A and B each have their own single job in flight.
"One delivery at a time" still holds **per printer**, which is where it matters for duplicates.

### 2.3 Routing and failover, decided in one write statement

Definitions, evaluated **inside** the claim UPDATE's subselect, so they are always fresh:

```
available(X) := X.active
            and ( X.health.last_seen_at >= now() - 60s          -- polling
               or X holds a live delivery (expires_at > now()) ) -- busy printing, not dead
            and not ( X.health.blocked_since <= now() - 60s )    -- paper-out / cover-open for 60s = down
home(order)  := the active printer whose role = print_routes[order.channel].role   (may be none)
```

`claimForPrinter(tenant, P)` takes the **oldest** QUEUED row (`for update of o skip locked`) that matches one of these:

| Case | Condition | Effect |
|---|---|---|
| **normal** | `attempts = 0` and `home = P` | first-offer, `print_printer_id = P` |
| **failover, fresh** | `attempts = 0` and `home ≠ P` and `home` is not available (offline or missing) | first-offer on P, `rerouted_from = home` |
| **failover, stranded** | `attempts > 0`, `print_printer_id = X ≠ P`, X not available, and X's delivery is null or expired | **reroute**: `print_printer_id = P`, `print_attempts = 1`, `print_segment(s) = 0`, `print_job_key = null`, new delivery with `rerouted_from = home`. The whole ticket again from piece 1, because half a ticket on each printer is worse than either |

All three cases run in one statement, with CAS predicates re-checked under the row lock: the same pattern
`claimNextPrintJob` uses now. When two printers poll at the same moment, `skip locked` hands each one a different
order or nothing.

**Paper-out and cover-open count too** (decision 1). Blocked for less than 60 s, the printer keeps its jobs. They wait,
no budget is spent, and the gate works as it does today. Blocked for 60 s or more, it is down: new jobs go to the other
printer with the same `轉印 REROUTED` header. Its in-flight job is rerouted once that job's window expires, because a
blocked printer never confirms. The paper-restored requeue still runs on the unblocked edge, scoped to
`print_printer_id = P`. After failover, it usually finds nothing to revive.

**Why the "live delivery" clause.** A printer may not poll while it prints a 3-copy ticket, and 3 × 30 s is longer
than the 60 s offline threshold. Without the clause, every long print would look like an outage and push the next web
order to B. With it, a printer that died mid-job still fails over, just once its delivery window ends (90 s worst
case). **To confirm on the bench:** the poll gap while printing. If the printer keeps polling, the clause is harmless.

**REROUTED header.** `publishJobBody` already loads the delivery. When `rerouted_from_printer_id` is set, the render
gets one extra banner row, in the same style as the 加菜 ADD-ON banner ([render.ts:530](../src/lib/ticket/render.ts#L530)):
`轉印 REROUTED`, and under it `from 外賣機 Takeout`. This is the visible marker for the one duplicate we accept: A
printed, A's confirmation was lost, then B printed again. A late confirmation from A for a superseded delivery is
logged as a stale-confirm, exactly as today.

**Return to normal is automatic.** Routing is decided at claim time. Once A polls again, the next web order matches
**normal** on A. Orders already rerouted to B **stay on B** and finish there, because bouncing them back is how you get
a duplicate. No hysteresis is needed. A flapping printer just spreads new tickets across both, each one labelled, and
none lost or doubled.

**Both offline:** nothing matches, orders wait QUEUED (today's behaviour), the banner shows both, and the owner gets
one text.

**Edges, for the logs and the banner.** On each poll, after `recordPoll`, one UPDATE stamps
`failover_since = now()` on any *other* printer that has become unavailable and returns the rows it stamped. That
gives one `[printer] 外賣機 OFFLINE 60s — its tickets now go to POS機` line per outage. The printer's own next
`recordPoll` clears the stamp and reports `BACK after Ns; K ticket(s) printed on POS機 meanwhile`. These stamps are
display and logging only. Routing never reads them.

### 2.4 Confirmations and GETs

- Token GET and DELETE resolve the printer from `print_deliveries.printer_id`. If the caller's `?mac=` disagrees,
  log a warning but **still honour** the request. The token is unguessable, and refusing a real confirmation turns into
  a duplicate.
- Bare GET resolves the MAC to a printer and serves `currentPrintJob(tenant, P)`. An unknown MAC gets 404.
- `CLOUDPRNT_PRINTER_MAC` stops being the gate once `printers` has rows; the table is the allowlist. The env var
  stays only for legacy mode.

### 2.5 Health, banner, alerts

- `/api/kitchen/orders` returns `printers: [{ id, name, role, health, secondsSinceSeen, statusCode, failoverTo,
  waiting }]` and `unassigned: [{ mac, firstSeenAt, lastSeenAt }]`. Every value comes from a lockedRead with
  `FOR SHARE`, as today.
- The strip shows one chip per active printer. The urgent banner names the printer and says where its tickets go:
  - `外賣機 Takeout printer 離線，外賣單改由 POS機 列印（標示「轉印」）`
  - `Takeout printer offline. Its tickets are printing on POS printer, marked REROUTED.`
  - When both are offline, one red banner names both, keeping the existing "waiting, not lost" note.
- When an unknown MAC has polled in the last 10 minutes, the board shows a quiet chip: `1 new printer waiting to be
  set up`.
- **Owner texts** (decision 4), from the existing minute cron. "Down" means the same thing as in `available()`:
  silent for 60 s, or blocked for 60 s.
  - **One printer down 5 min with the other up and covering → one text naming it.** For example: *"New Mandarin
    Canton: 外賣機 Takeout printer has been down (out of paper) for 5 min. Its tickets are printing on the POS printer,
    marked 轉印 REROUTED."* It is claimed once per down spell (`printer_health.down_alerted_at`) and cleared when the
    printer comes back. A paper-out that turns into offline is the same event and is not texted twice.
  - **Every active printer down 2 min → urgent text, repeated every 10 min until one recovers.** For example:
    *"URGENT New Mandarin Canton: ALL printers down for 2 min, 3 orders waiting. …"* This uses the
    `print_alert_state.all_down_alerted_at` claim (a conditional UPDATE: `is null or <= now() - 10 min`), cleared when
    any printer is up. With only A configured (before B is added), A going down is this case. That replaces today's
    single text at 5 minutes.
  - **Gates kept from today**, so a printer switched off at closing time doesn't text anyone. The all-down text needs
    orders waiting (`QUEUED > 0`, as now). The one-down text needs at least one order rerouted away from that printer
    during this spell. Without that gate, switching B off at night while A is still on would text every night.
  - A failed send gives the claim back, as today.
- The card badge for a rerouted order reads `轉印 → POS機`.

### 2.6 Printers page, owner PIN, audit (decision 3)

A new page, `/[kitchenSlug]/printers`. **Viewing** needs only the kitchen session. **Every change needs the owner
PIN.**

- every printer row (name, role, active, MAC, last seen, health)
- **unassigned** MACs, newest first: *Assign as Takeout / Kitchen*, with name prefilled. A transaction deactivates
  whichever printer held the role and activates this one. The unique index makes a half-swap impossible.
- the route table (four dropdowns)

- the copy set per channel

**Owner PIN**
- A new secret, `OWNER_PIN`, set with `wrangler secret put`. It is compared as SHA-256 digests with
  `timingSafeEqual`, so a wrong length leaks nothing.
- The PIN is sent with each change request and never stored client-side. Each request carries the PIN and the
  change, so there is no elevated session to steal.
- **Rate limiting** has two layers:
  - The in-memory `owner_pin` limiter (5 per 15 min per IP) is the cheap first layer.
  - The real lockout counts `pin_failed` rows in `printer_config_audit` for the tenant over the last 15 minutes, using
    lockedRead, because the in-memory limiter is per isolate on Workers. Five failures lock changes for 15 minutes.
    The page says so, and a log line flags it.
- If `OWNER_PIN` is unset, changes are refused with a clear message. They never fail open.

**Audit.** Each change is written in the same transaction as the change: `action`, `target`, `old_value`,
`new_value` (JSON), `at`, and `ip`. The page shows the last 50 entries.

### 2.7 Stale-read inventory (every read that decides routing)

| Decision | How it stays fresh |
|---|---|
| Which printer is calling, and is it active | `recordPoll` upsert `RETURNING`, a write |
| What P has in flight | `currentPrintJob(tenant, P)`: lockedRead, `FOR UPDATE` |
| Which order P claims, failover, reroute | inside the claim `UPDATE` (write transaction; `for update of o skip locked`) |
| Re-offer | CAS UPDATE with `print_printer_id = P` added |
| Token → delivery → printer, confirm | `getPrintDelivery` / `getOrderById` (lockedRead since f4ffc07) |
| Paper-restored requeue scope | UPDATE, scoped by `print_printer_id` |
| Board / alerts health | lockedRead, `FOR SHARE` |
| Admin list | display only, plain read. Its writes are guarded by constraints |

No routing decision reads `failover_since` or any other cached projection.

### 2.8 What doesn't change

Entitlement windows, the delivery cap, split tickets, R2 publishing, `PRINT_FETCH_VIA_WORKER`, late-confirmation
grace, and the unprinted-order sweep (it is per order, so it already covers both printers).

---

## 3. Local test: `npm run verify:printers` (new)

This uses the same harness as `verify:print-stale-reads`: embedded Postgres, real `schema.sql` plus 011, the real
repository and real route handlers, and the **Hyperdrive cache emulator on for every case**. Two simulated printers,
`MAC_A` (takeout: web) and `MAC_B` (pos: phone, walk_in, dine_in), each POST polls, GET by token, and DELETE to
confirm. Time is simulated the existing way, by back-dating `last_seen_at`, `blocked_since` and `expires_at`, and
calling `cache.clear()` past 60 s.

The first draft said 18 cases, but its list actually had 19. Your decisions add 5, so there are **24**.

**Routing and copies**
1. **R1.** One order per channel. A gets only `web`; B gets `phone`, `walk_in`, `dine_in` and a dine-in add-on. The
   other printer's poll returns `NO_JOB` for each. Each delivery has the right `printer_id` and no `rerouted_from`.
2. **R2.** A and B each hold a live delivery **at the same time**. Both confirm. Both orders end PRINTED. No
   cross-confirmation.
3. **R3.** Race: 40 mixed orders, A and B polling concurrently (`Promise.all`) until drained. Every order gets exactly
   one confirmed delivery, on its home printer. Zero orphans, zero duplicates.
4. **R4.** A route change mid-queue (`phone` → takeout). Unclaimed phone orders go to A; the one in flight finishes on
   B.
5. **C1.** Copies: with the seed, every channel (including dine-in and an add-on) renders today's env copy set,
   byte-identical to the pre-change render. Setting dine_in to `{kitchen}` gives one copy on the next claim, with no
   restart. The confirmation window is computed from the per-channel count.

**Failover**

6. **F1.** A silent 61 s with nothing in flight. A web order goes to B with `rerouted_from = A`, and the ticket render
   carries the 轉印 REROUTED banner.
7. **F2.** A silent 61 s **while holding a live delivery**. B gets nothing for that order until the delivery expires
   ("busy, not dead"). After expiry it is rerouted to B with attempts=1, segment 0 and a new key. A's late DELETE of the
   old token is a stale-confirm and writes nothing.
8. **F3.** A split ticket where A dies after piece 1 of 2. B prints both pieces from piece 1, with the header.
9. **F4.** **Paper-out on A**: blocked for 30 s, web orders wait on A and no budget is spent. Blocked for 61 s, they
   go to B with the header. Same again with cover-open.
10. **F5.** Both down. Nothing is offered to anyone and the board shows both down.
11. **F6.** The `down_since` edge produces one log line per outage across 20 polls from B, never one per poll.
12. **F7.** Paper back on A: the restore requeue revives only `print_printer_id = A` orders. An order condemned on B
    stays PRINT_FAILED.

**Recovery**

13. **Rec1.** A polls again. The next web order goes to A with no header. The order rerouted earlier stays on B and
    completes there. `down_since` is cleared, and the BACK line reports the count.
14. **Rec2.** Flap: A alternates 30 s up and 70 s down for 10 cycles while orders arrive. Every order prints exactly
    once, and the rerouted ones carry the header.
15. **Rec3.** 重印 on a rerouted order re-decides by current routes: it goes home if home is back.

**Unknown printer, owner PIN, audit**

16. **U1.** MAC_C polls 5 times. It gets `NO_JOB` every time and creates one inactive, role-less row. No order is
    touched. It appears in `unassigned` on the kitchen API.
17. **U2.** 11 distinct unknown MACs. The 11th is not inserted (cap) and is logged.
18. **U3.** With the PIN, assign C as `pos`. B is deactivated in the same transaction. B's next poll gets `NO_JOB` and
    C gets the POS orders. B's in-flight delivery is rerouted to C once it expires. The audit has `assign` and
    `deactivate` rows with old and new values.
19. **U4.** The database rejects C active without a role, a second active `pos`, and copy_roles that are `{}` or
    contain an unknown role.
20. **P1.** Owner PIN:
    - With the kitchen session, the page can be viewed but not changed without the PIN.
    - A wrong PIN changes nothing and writes `pin_failed`.
    - After 5 failures in 15 min, even the right PIN is refused until the window passes.
    - With `OWNER_PIN` unset, every change is refused.
    - A route or copy change writes one audit row in the same transaction. Forcing a rollback leaves neither the
      change nor the audit row.

**Owner texts** (SMS stubbed, sends counted)

21. **A1.** A down 5 min while B covers, with orders rerouted: one text naming A. Further sweeps send nothing. A
    recovers, goes down again: one more text. A paper-out that becomes offline in the same spell gives no second text.
    A down at night with nothing rerouted gives no text.
22. **A2.** Both down 2 min with orders waiting: an urgent text at 2 min.
    - A sweep at 3 min sends nothing.
    - A sweep 9 min after the first text sends nothing.
    - A sweep 10 min after it sends exactly one more, so the repeats come at 2, 12, 22 min.
    - B recovers: no more texts, and the stamp is cleared.
    - Both down with nothing waiting: no text.

**Legacy and regression**

23. **L1.** No assigned printer: behaves as today. A non-pinned MAC polling first is stored unassigned. The pinned MAC is
    then auto-registered as `takeout` with all routes and today's copies, and prints a phone order with no header.
24. **L2.** Every existing check passes: `verify:print-deliveries`, `-recurrence`, `-split`, `-codes`,
    `-stale-reads`, `printer-health`, `staff-orders`, `dine-in`, `orders`, and the rest of `verify:*`, plus `tsc`, lint,
    the build and the Playwright e2e.
    - One existing check needed a one-line edit: `verify:printer-health` back-dated the old `printer_status` row
      directly, and now back-dates `printer_health`.
    - Its paper-restored case condemns an order no printer ever claimed. That case led to the rule that a restore also
      revives condemned orders with no printer.

As built, `verify:printers` runs cases 1 to 23 in one script, with the cache emulator on for all of them. L2 is the
rest of the suite.

---

## 4. Live test: adding printer B during closed hours

**Before (any day, during service):**
1. ~~Confirm the live printer sends its MAC.~~ Done 5 Nov: `00:11:62:55:24:d4`.
2. PR #7 is deployed and verified first.
3. Set `OWNER_PIN` (`wrangler secret put OWNER_PIN`).
4. Apply 011. Then run `select mac, role, active from printers; select channel, role, copy_roles from print_routes;`.
   You should see A as `takeout` and four routes to `takeout`, all with `copy_roles` NULL.
5. Deploy. Run **one full service on one printer.** In `wrangler tail`, every hand-over should show `printer=外賣機`
   and no `rerouted`. Every ticket comes out exactly as before.

**Closed hours, B on site:**

6. Configure B the way A was set up: same CloudPRNT URL, same poll interval. Print B's self-test and note its MAC.
7. Power B on. The board shows **"1 new printer waiting"**, and `/printers` lists the MAC, which should match the
   self-test. B's polls get `NO_JOB` in the tail.
8. With the PIN, assign B: name it, set role `pos`. Routes still all point to `takeout`, so **B still prints
   nothing.** This step proves assignment is separate from routing. Check the audit row.
9. With the PIN, set routes `phone`, `walk_in` and `dine_in` to `pos`. Check the audit rows.
10. Test orders: a POS phone order, a walk-in, a dine-in table, a dine-in add-on, and a web order (test-mode). Check:
    - each comes out of the expected printer
    - every channel prints today's copies (unless the owner has confirmed the dine-in single copy by then)
    - in SQL, `print_deliveries.printer_id` matches
11. **Failover drill, B offline.** Unplug B's network. After about 60 s the banner reads "POS printer down, printing
    on 外賣機". Place a phone order: it prints on A with `轉印 REROUTED`. Plug B back in: the banner clears, and the
    next phone order prints on B with no header.
12. **Failover drill, A paper.** Open A's cover. After 60 s, a web order prints on B with the header. Close the cover
    and the next web order prints on A.
13. **Mid-print drill.** Place an order on B and pull B's power partway through. Within about 90 s the whole ticket
    reprints on A with the header.
14. **Texts.**
    - Leave B unplugged for 5 minutes with one phone order rerouted: one text naming B.
    - Unplug both with an order waiting: an urgent text at 2 minutes and another at 12.
    - Plug one back in: no more texts.
15. Cancel every test order.

**Rollback at any point:** with the PIN, set all routes to `takeout` and everything goes back to A. Deactivating B
takes it out entirely. A code rollback is also safe, because 011 is additive: the old code ignores the new tables, and
dine-in returns to the env copy set. The only side effect is that the board shows the old `printer_status` row as
stale until A's next poll writes it.

---

## 5. Decisions (5 Nov 2026)

1. **Routing:** web → A (`takeout`). phone, walk_in, dine_in and add-ons → B (`pos`).
2. **Failover** also on paper-out and cover-open after 60 s, with the same `轉印 REROUTED` header.
3. **Copies per channel** live in `print_routes.copy_roles` and can be edited without a deploy. web, phone and walk_in
   keep today's copies. dine_in and add-ons **also keep today's copies until the owner confirms** the proposed single
   copy, `kitchen` or `all`, with no bag copy.
4. **Printers page:** anyone with the kitchen session can view status. Assigning, routes and copies need `OWNER_PIN`,
   compared as hashes and rate-limited. Every change is logged with time and old and new values.
5. **Owner texts:** one printer down 5 min with the other covering → one text naming it. Every printer down 2 min →
   urgent text, repeated every 10 min until one recovers. Otherwise never more than one text per event.
