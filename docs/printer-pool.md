# 印表機 Printer pool: either printer prints any ticket

Status: **design, for review. Nothing here is built yet.** Part D of the
2026-11-27 brief. The precondition is confirmed: both printers sit side by
side and one person tears off from both (owner, 2026-11-27). If that ever
changes, the right version is the smaller one in "Not chosen" below.

## What changes, in one paragraph

Today a ticket's printer is fixed when the order is created: web orders go
to the online printer and phone or walk-in orders to the store printer
(`orders.print_station`, from the channel). Each printer claims only its own
station's tickets, and the other printer takes over only after 90 s of
silence (timed failover). In the pool there is **one queue**. Any printer
that polls with **nothing in flight** claims the **oldest** queued ticket,
whatever its channel. When both printers are idle, the one that did **not**
print the last ticket gets the next one, so the rolls wear evenly. This is a
soft preference, never a lock. `print_station` stops being a routing key and
becomes **which printer printed it**. Channel still decides everything a
channel decides: the A- / B- order number, the 日結 Online / Store split, the
ticket's 電話訂單 / 到店 line and the customer name line.

## 1. Routing

**The claim.** `claimNextPrintJob` keeps its single UPDATE ... `where id =
(select ... for update skip locked limit 1)` with the same conditions checked
again under the row lock. Only the station test changes:

| Arm (needsPaperFrom) | Today | Pool |
| --- | --- | --- |
| FIRST ticket (QUEUED) | `print_station = any(serves)` | **any printer in the pool** |
| 改單 CHANGE ticket | `print_station = any(serves)` | the printer that printed the original, **unless it is unhealthy**, then any (section 4) |
| 重印 REPRINT | the manual_reprint row's station | unchanged: staff's pick, defaulting to the printer that printed it (section 4) |

The claim writes `print_station = <claiming printer>` in the same statement
that stamps the attempt and the delivery. From then on, `print_station` means
"the printer this ticket is on, or was printed on". Every in-flight read
(`currentPrintJob`, the hold/retry/capped decision, the GET and the DELETE)
already looks for the printer's own in-flight job by
`print_station = any(serves)`, so after the claim they keep working
unchanged. They now find the job this printer claimed.

**Before the claim**, `print_station` still holds the channel's station, as
written at insert. Nothing routes on it any more, and the board does not show
a printer for an unclaimed ticket (section 8). I chose not to null it, which
would need a migration and would break every old reader. Old rows read the
same as new ones.

**What stays by channel, never by printer:**
- order numbers (A- web, B- store: per-station counters keyed at insert, migration 015);
- the 日結 Online / Store split and its 範圍 Scope (Part C, already by channel);
- the board's Online / Store lane filter and the chime for a new web order. These read `order.station` today and move to a channel-derived `order.lane` (section 8);
- the ticket's own lines: 電話訂單 / 到店 and the 客人 name line are already chosen by channel (`stationForChannel`), not by printer.

## 2. Alternation

**State.** "Who printed last" is the station on the newest **first-offer**
delivery of an order for this tenant (`print_deliveries`, `reason =
'first-offer'`, newest `offered_at`). This needs no new column; it is one
indexed read, and it is part of the same transaction as the claim.

**Rule.** A printer P may claim the oldest ticket T at once when **any** of
these holds:

1. P is the preferred printer (the other one printed last, or nothing has printed yet today);
2. the other printer is **busy** (section 3);
3. the other printer has **not polled within the last poll interval** (`PRINT_POOL_INTERVAL_MS`, default 3000 ms, the TSP143's setting). It is not going to pick T up in time, so P takes it;
4. T has been claimable for **at least one poll interval** (its `queued_at`, below).

Otherwise P answers "no job" for this poll, and the preferred printer takes T
on its own next poll.

**Why this never delays a ticket by more than one poll interval.** P defers
only while the other printer (a) is idle, (b) is healthy, and (c) polled
within the last interval. That printer's next poll therefore comes within one
interval of T becoming claimable, and it claims T then. If it does not (it
went busy, or it died in that instant), rule 4 lets P take T on P's first
poll after T is one interval old. The delay attributable to alternation is
measured as: claim time minus the first poll, by any idle and healthy
printer, after T became claimable. That figure is bounded by
`PRINT_POOL_INTERVAL_MS`. verify:printer-pool measures it for every ticket.

**`queued_at`** is when T became claimable: `orders.created_at` for a first
ticket, the change ticket's `created_at` for 改單, and the manual_reprint
row's `offered_at` for 重印. For a PRINT_FAILED order put back by the
paper-restore requeue, it is the time of the requeue (`updated_at` of that
write). No new column is needed.

**Two queued tickets, both printers idle:** A (preferred) claims #1. "Last"
is now A, so B is preferred for #2 and claims it on its very next poll. The
two still print in parallel, exactly as the two stations do today.

**One printer busy:** the other takes everything with no delay (rule 2).
The busy one rejoins when it is idle.

## 3. Busy and unhealthy

A printer is **busy** when **either** of these is true:
- it has a delivery offered and not yet confirmed: an order with
  `print_attempts > 0` on its station, or a 日結 report `OFFERED` to it.
  This is the same "in flight" the poll already computes;
- its health row is **unhealthy** (`printer_station_status`): paper out, cover
  open, or offline (no poll for 60 s, the board's own threshold,
  `printerStatus.ts`).

**Unhealthy** is the second bullet alone. It decides change tickets and
reprints (section 4) and takeovers (section 6).

Both are read from the health row that the poll writes in the same request
(`recordPoll` already returns `othersSilentSeconds`; it will also return the
other printer's blocked flag and its last poll time), so the claim decides
from the database clock, not from the Worker's clock.

## 4. 重印 Reprint and 改單 change tickets

- **重印** keeps the existing station picker. The default selection becomes
  "the printer that printed it" (`print_station` once claimed). If that
  printer is unhealthy when staff press 重印, the picker defaults to the other
  one, with a note saying why. At claim time, a reprint aimed at a printer that
  has since gone unhealthy is taken by the other printer through the takeover
  path (section 6).
- **改單 change tickets** go to the printer that printed the original, **when
  it is healthy**. Being busy is not a reason to switch: it prints the change
  ticket after its current job. When that printer is unhealthy, the other
  printer takes the change ticket. The change-ticket arm of the claim reads
  `print_station = me OR print_station's printer is unhealthy`.

## 5. Reports through the pool

A 日結 report is queued with **no printer** and claimed like a ticket: any
idle printer, with the same alternation, claims the oldest QUEUED report
**after** any ticket it could claim (tickets first, which is today's rule).
`report_prints.station` becomes "printed by", set when the report is claimed.
**Migration 020** drops `not null` on `report_prints.station`. Old rows keep
their station.

The sheet loses **送往哪部打印機？ Which printer?**, and with it Part C's
"printed fewer today" suggestion. Print is disabled only when **both**
printers are unhealthy, with the reason. A report is still offered once and
never retried (prints.ts, unchanged).

## 6. Failure modes

| Situation | What happens | Path |
| --- | --- | --- |
| **One printer dead** (silent past 60 s, or paper out, or cover open) | The other printer prints every new ticket. Alternation does not apply, because the dead printer is not idle and healthy (rule 2). | claim |
| ...plus tickets the dead one **claimed but never fetched** | The other printer takes them over **as soon as their delivery window expires**, without waiting for the 90 s failover. A body that was never fetched cannot be on paper, so there is no double-print risk. | the existing re-offer path (`reofferPrintDelivery`), with the claimer moved over, as `applyFailover` does today |
| ...plus tickets it **fetched but never confirmed** | These may be on paper already, so the existing **timed failover** rule applies unchanged: after `PRINT_FAILOVER_AFTER_SECONDS` (90) the other printer re-offers them, and the ticket prints the existing **轉自 REROUTED FROM** line. That line now names the **printer** that went silent, which is what staff need in order to check that printer's tray for a half-printed copy. This is no new layout: the line exists today, and in the pool it appears only for this case. | `failoverStations` + re-offer |
| **Both dead** | Tickets wait. The unprinted-order alert, the owner's texts and the board banner are unchanged. | unchanged |
| **A printer comes back** | It holds nothing: its in-flight tickets were taken over. It claims at most one job per poll, as every printer does, by the same alternation. There is no flood. The paper-restore requeue (PRINT_FAILED → QUEUED for the outage window) puts tickets back into the **pool**, so both printers drain them, still one job per poll each. | unchanged |
| **Two polls in the same millisecond** | The claim is one UPDATE with `for update skip locked` and the conditions checked again under the row lock, so only one of them can win a given ticket. The loser either claims the next ticket or answers no job. | unchanged mechanism (verify:claim-no-skip) |

## 7. What is NOT touched

- The plain-HTTP job body, the one-shot job URLs, the R2 body path, the prerender, StarPRNT encoding, copies, buzzer and confirmation windows.
- The ticket layout. The only conditional line involved, 轉自 REROUTED FROM, already exists. It now prints only for a fetched-and-abandoned takeover.
- `print_deliveries` semantics: one row per hand-over, `station` = the printer it went to.
- Exactly-once: an order is PRINTED only by a confirming DELETE.

## 8. Board

- **Card:** a small printer icon with 網上 / 店內 once the ticket has been
  claimed ("printed on"). An unclaimed card shows none. The channel badge
  (web / phone / walk-in) is unchanged and still says whose order it is.
- **Lanes and filter:** the Online / Store filter, the counts and the
  new-web-order chime switch from `order.station` (now "printer") to
  `order.lane`, which is `stationForChannel(order.channel)`. Today the two
  are always equal, so without this change the filter would start sorting
  orders by printer.
- **Header:** the two pills become one **印表機 Printers** pill showing both
  statuses (for example `印表機 ● ●`, with each dot's colour and label from
  today's per-printer health). It opens the same detail strip as today.

## 9. Rollout

`PRINTER_POOL=on|off`, default **off**. With it off, every code path is
today's. The deploy is inert. Turn it on after a bench test with both real
printers, and turn it off again to roll back instantly. Migration 020 is safe
in either order with the deploy: old code always writes a station.

## 10. Tests

- **verify:printer-pool (new).** Embedded Postgres, the real repository and
  claim, two simulated pollers on a compressed clock
  (`PRINT_POOL_INTERVAL_MS=200`, each printer polling every 200 ms with
  jitter), and 200 queued tickets arriving in bursts.
  - **Both healthy:** every ticket printed exactly once (one confirmed
    first-offer delivery per order, none double-claimed); the split within
    **45/55**; delay attributable to preference ≤ one interval for every
    ticket.
  - **One unhealthy** (paper out from the start): **100/0**, and no ticket
    waits on the dead one.
  - **One dies mid-run with a claimed, unfetched ticket:** the survivor
    prints it after its window, exactly once.
  - **One dies with a fetched ticket:** taken over after the failover
    window, with 轉自; no other ticket waits.
  - **Recovery:** the returning printer claims at most one job per poll.
  - **改單 / 重印:** they go to the original printer when it is healthy, and
    to the other when it is not.
- **Extended:** verify:claim-no-skip (two printers claiming one pool, no skip,
  no double claim), verify:print-deliveries (a takeover is a new delivery and
  the old token is dead), verify:print-recurrence (a pooled ticket never
  recurs), verify:print-split (a split ticket stays on one printer:
  continuation pieces go to the claimer only).
- **Playwright kitchen-tablet:** the card's printer icon after printing, the
  single 印表機 pill, and the 日結 sheet without the printer picker.

## Decisions I would like confirmed

1. **Rollout flag, default off** (section 9), rather than switching the pool on at deploy.
2. **轉自 REROUTED FROM stays**, only for a fetched-but-unconfirmed takeover. The alternative is to drop it entirely in the pool.
3. **Board lanes stay Online / Store by channel**, with the printer shown only as an icon (section 8).
4. **The poll interval constant** is 3000 ms, matching the printers' setting (docs/print-latency.md). If the printers are moved to 1 s polling, the constant should follow.

## Not chosen

**Keep routing by channel and fall back only when busy or down.** This is the
right design if the printers were in different places, so that a web ticket
must come out where web bags are packed. They are side by side, so it would
leave the even-wear goal unmet and keep the 90 s wait before a dead printer's
tickets move.
