# Print latency: where the 20 seconds go

**Measured:** 27 Nov 2026, against production (Supabase `jdsdboirgbldcqltqjfu`,
Worker `nmc-web`). Read-only: SELECTs and `wrangler tail`. Nothing deployed.

**Status:** Step 1 (measure) only. No change to the print path yet.

## Answer

| Hop | What it is | p50 | Owner |
|---|---|---:|---|
| a | order created → claimed by a poll | **1.7 s** | poll interval (3.0 s) + server |
| server | claim + render + R2 publish, inside the claiming POST | **≈0.3 s** extra over an empty poll | our code |
| b+c | claimed → printer confirms (DELETE) | **21.7 s** store, **25.9 s** online | **the printer fetching the body from R2** |
| d | total | 24.1 s store, 27.9 s online | |

**Hop b+c owns the time: about 90% of it.** Inside that hop, one captured
order (below) shows the printer silent for **15 s** while it fetches a 110 KB
job from `print-jobs.newmandarincantonii.com`, then about 6 s of printing and
waiting for its next poll tick to send the DELETE. Our render is about 20 ms and
the whole server side of a hand-over is under half a second.

**The two printers behave the same way.** The online printer is about 3 s slower
at the same line count (one-line ticket: 22.8 s online vs 19.3 s store). Web
tickets may simply be taller, or that printer's WiFi may be weaker; this data
cannot tell those apart. Both poll at exactly 3.0 s and both have the same
idle penalty.

## Data source caveat: b and c cannot be split from the database

`print_deliveries.fetched_at` is NULL on **every** row. The printers fetch the
job body straight from R2 (`PRINT_FETCH_VIA_WORKER` is off), so the Worker never
sees the GET. The database can only measure b+c together. The split below comes
from a live `wrangler tail` of a real order.

## One order, end to end (live tail, B-006, store printer, 27 Nov 21:15 UTC)

2 lines, 2 copies, 1530 px total, **110,231-byte** StarPRNT job.

| t (s) | Event |
|---:|---|
| −0.42 | order stored QUEUED (`orders.created_at`) |
| 0.00 | printer's regular poll arrives; claim, render, R2 put; answers `jobReady` (Worker wall **489 ms**, CPU 65 ms) |
| 0.00 → 15.41 | **printer silent: no polls.** It is fetching the body from R2 over HTTPS |
| 15.41 | poll resumes with `printingInProgress: true` |
| 18.66 | poll, still printing (server: `verdict=hold`) |
| 21.59 | DELETE `200 OK`, order PRINTED |
| 21.97 | poll, `printingInProgress: false` |

The DELETE arrives on the printer's 3 s poll cadence (15.4 → 18.7 → 21.6), so
paper is out somewhat before the confirmation. Staff-perceived tap-to-paper for
this order was roughly 16 to 19 s, against a recorded 21.6 s.

## What the hop depends on

### Ticket size: about +1.3 s per extra line

All confirmed deliveries, both printers:

| Lines | n | b+c p50 (s) | b+c min (s) |
|---:|---:|---:|---:|
| 1 | 34 | 22.7 | 18.3 |
| 2 | 28 | 25.4 | 19.8 |
| 3 | 14 | 25.7 | 22.1 |
| 4 | 4 | 27.7 | 23.6 |
| 5 | 8 | 29.1 | 24.9 |
| 6 | 4 | 32.8 | 25.6 |
| 7 | 3 | 37.7 | 25.9 |

A line adds roughly 120 px per copy. Two copies at 72 bytes per row is about
16 KB of uncompressed raster, and about 30 mm of paper. Paper at the
TSP143IV's rated speed costs well under a second for that. **The slope looks
like download, about 12 KB/s.** The roughly 18 s floor for a one-line ticket
(about 100 KB) is more than its bytes at that rate, so a fixed cost (DNS + TLS
handshake to a host the printer does not otherwise talk to) sits on top.

### Idle time: +10 s when the printer has not printed for an hour

| Printer idle before this job | station | n | b+c p50 (s) | jobs over 30 s |
|---|---|---:|---:|---:|
| < 5 min | online | 2 | 21.3 | 0 |
| 5 to 20 min | online | 10 | 24.8 | 0 |
| 20 to 60 min | online | 12 | 25.8 | 1 |
| > 60 min | online | 52 | 26.7 | 17 |
| < 5 min | store | 6 | 19.2 | 0 |
| 5 to 20 min | store | 3 | 21.6 | 0 |
| 20 to 60 min | store | 3 | 22.1 | 0 |
| > 60 min | store | 5 | 33.3 | 4 |

The 33 to 42 s outliers are almost all the first job after an hour or more
of quiet. That fits a TLS session (or DNS entry) for the job host expiring,
so the printer does a full handshake, which Star's own FAQ warns is slow on
these units. It may also be WiFi power save. It is not our code: the server
side of those hand-overs is the same.

### Hour of day: no rush-hour spread

The by-hour table below shows no hop growing at lunch or dinner. Note the
volume is low (95 deliveries over 20 days), so congestion at real rush would
not have been exercised yet.

## Server cost of one poll (live tail, 70 s and 25 min windows)

| Poll | Worker wall | Worker CPU |
|---|---:|---:|
| empty (`jobReady:false`), both printers | 173 ms p50, 185 ms p90, 254 ms max | 9 ms p50 |
| hand-over (claim + render + R2 publish), B-006 | 489 ms | 65 ms |
| DELETE confirmation | 326 ms | 18 ms |

Render alone, measured locally (`renderTicketJob`, StarPRNT, 2 copies, warm,
fixtures): 9 to 48 ms, 100 to 412 KB.

| Fixture | Height (2 copies) | Job bytes | Render (warm) |
|---|---:|---:|---:|
| two rices (side + entrée) | 1389 px | 100,079 | 9 ms |
| typical (A-001 shape) | 1897 px | 136,673 | 15 ms |
| mixed sizes | 2591 px | 186,659 | 18 ms |
| baseline sample | 2771 px | 199,619 | 21 ms |
| 12-line party tray | 4213 px | 303,497 | 32 ms |
| full-menu breadth | 5723 px | 412,271 | 46 ms |

The per-statement `console.time` breakdown of the POST handler was **not**
taken: it needs a production deploy, and the whole server side of a hand-over
is about 0.3 s more than an empty poll. Cold-isolate cost was not captured
either: no cold hand-over happened during the tail.

## Poll interval (Star manual)

The setting is **"Polling time"**: "an interval in seconds for the client to
execute a server poll (POST request)". Default 5 s on TSP100IV / TSP100IV SK.
**The manual does not document a minimum.** Source: Star CloudPRNT client
manual, https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/client.html.
Both printers currently poll at **3.0 s** (measured: 3.016 to 3.049 s between
polls).

The printers' `X-Star-Support-Protocols` header is `HTTP,MQTT`. Star's
**CloudPRNT Version MQTT** (TSP100IV firmware 2.2 or later) lets the server
*trigger* a poll immediately, or push the job itself ("Full MQTT"), instead
of waiting for the interval. Source:
https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/protocol-guide.html.
That removes hop a, not the download.

## Full tables (`npm run measure:print-latency`)

Seconds, p50 / p90 / max. 95 confirmed deliveries (last 300 per station; all
there are). No 改單 change tickets and no 重印 reprint hand-overs exist yet, so
those rows are absent.

### By station

| station | n | a: created→offered | b: offered→fetched | c: fetched→confirmed | b+c: offered→confirmed | d: total |
|---|---:|---|---|---|---|---|
| online | 77 | 1.7 / 2.7 / 20.6 | n/a | n/a | 25.9 / 37.0 / 41.8 | 27.9 / 38.1 / 43.7 |
| store | 18 | 1.7 / 2.7 / 63.2 | n/a | n/a | 21.7 / 37.5 / 62.5 | 24.1 / 48.7 / 82.9 |

### By station × kind × reason

| station · kind · reason | n | a | b | c | b+c | d |
|---|---:|---|---|---|---|---|
| online · full · first-offer | 77 | 1.7 / 2.7 / 20.6 | n/a | n/a | 25.9 / 37.0 / 41.8 | 27.9 / 38.1 / 43.7 |
| store · full · first-offer | 17 | 1.3 / 2.6 / 2.7 | n/a | n/a | 21.7 / 37.9 / 62.5 | 23.8 / 39.6 / 62.8 |
| store · full · retry | 1 | 63.2 / 63.2 / 63.2 | n/a | n/a | 19.8 / 19.8 / 19.8 | 82.9 / 82.9 / 82.9 |

### Last 7 days, by station

| station | n | a | b | c | b+c | d |
|---|---:|---|---|---|---|---|
| online | 32 | 1.8 / 2.8 / 20.6 | n/a | n/a | 23.2 / 35.4 / 37.3 | 24.9 / 37.1 / 40.3 |
| store | 16 | 1.2 / 2.6 / 63.2 | n/a | n/a | 21.7 / 34.9 / 62.5 | 23.4 / 50.2 / 82.9 |

### By hour (America/Los_Angeles), both stations

| hour | n | a | b+c | d |
|---|---:|---|---|---|
| 11 | 11 | 2.3 / 2.9 / 2.9 | 26.7 / 36.8 / 37.3 | 29.6 / 38.0 / 39.0 |
| 12 | 15 | 2.2 / 2.8 / 63.2 | 26.7 / 39.6 / 62.5 | 33.4 / 55.1 / 82.9 |
| 13 | 7 | 1.1 / 2.6 / 2.8 | 23.6 / 30.5 / 37.3 | 24.8 / 31.3 / 37.5 |
| 14 | 5 | 1.8 / 2.2 / 2.4 | 26.4 / 32.1 / 35.5 | 28.4 / 33.6 / 36.3 |
| 15 | 9 | 2.1 / 2.4 / 2.7 | 22.6 / 30.9 / 37.7 | 24.9 / 32.5 / 39.9 |
| 16 | 15 | 1.3 / 2.8 / 20.6 | 23.7 / 32.4 / 38.0 | 26.2 / 38.5 / 40.3 |
| 17 | 16 | 1.5 / 2.6 / 2.7 | 26.6 / 38.9 / 41.2 | 28.0 / 40.4 / 43.7 |
| 18 | 8 | 1.7 / 2.4 / 2.4 | 25.5 / 34.0 / 34.2 | 25.9 / 36.0 / 36.6 |
| 19 | 6 | 1.2 / 3.0 / 3.1 | 26.4 / 36.8 / 37.7 | 28.3 / 39.0 / 40.8 |
| 20 | 3 | 1.1 / 1.2 / 1.2 | 19.9 / 30.6 / 33.3 | 21.0 / 31.8 / 34.5 |

### Failures

- store, first-offer: `520 Download failed` after 62.5 s, then a retry that
  printed in 19.8 s (an 83 s order). The same download is what fails.

## What this means for Step 2

The planned fixes, against these numbers:

| Fix | Saves at most | Why |
|---|---:|---|
| 1. Pre-render at creation | ≈0.3 s | the server side of the hand-over is ~0.3 s over an empty poll |
| 2. Render cost | ≈0.05 s of CPU | render is 9 to 48 ms; **but the raster size is the lever for the download** |
| 3. Poll interval 3 s → 1 s | ≈1 s on hop a, and ≈1 s on the DELETE tick | a is 1.7 s p50 |
| 4. Bytes and the job host | **most of the 15 s** | the printer is silent for 15 s fetching 110 KB |

**Under 5 s p50 is not reachable by fixes 1 to 3.** Together they remove
about 2 s of 24. The remaining software levers are all about the download:

- **Fewer bytes.** Today's job is uncompressed 1-bit raster (72 bytes per row).
  A 1-bit PNG of the same ticket is likely around a tenth of that size. The PNG
  path was dropped earlier because of the printer's `511` memory failure on
  tall images, so it needs a bench test on the real printer before anything
  else.
- **No second TLS host.** Every job is fetched from `print-jobs.…`, a host the
  printer otherwise never talks to, so every job pays DNS + a handshake, and the
  first one after an hour pays a full one (the +10 s). Options: serve the body
  from the same host the printer already polls, or plain HTTP for the
  unguessable per-delivery object (a privacy trade: the ticket carries the
  customer's phone).
- **MQTT trigger / Full MQTT** removes hop a entirely and, in Full mode, the
  separate GET. It needs firmware 2.2+ and a broker.

Before choosing, one production measurement would help separate TLS, bytes and
WiFi: turn on `PRINT_FETCH_VIA_WORKER` for an hour. That records `fetched_at`
on every delivery (b = printer reaches our GET; c = 302 to R2, fetch, print,
DELETE). The bytes printed don't change. The risk, as `printFetchViaWorker()`
warns, is firmware that does not follow the 302, in which case tickets stop
until the flag is turned off again. Watch the first ticket.

## Step 2, fix 1: pre-render at creation (not yet measured in production)

Both order routes (`/api/orders`, `/api/kitchen/orders`) now render and upload
the first kitchen ticket inside `ctx.waitUntil`, after their response, and
record it in `orders.print_prerender` (migration 018). The hand-over takes it
in one statement only when the sha256 of its own render inputs matches;
otherwise it renders exactly as before. Code: `src/lib/print/prerender.ts`.

What the hand-over poll no longer does on a hit: the render (9 to 48 ms CPU),
the R2 put, and two of its four database round trips. Expected saving is
**≈0.2 to 0.3 s** of hop b+c, per the server-cost table above.

Proved locally by `npm run verify:print-prerender` (26 checks): the staged
bytes equal a render at hand-over; an edit, the printer winning the race, a
retry, and a database without 018 all fall back to rendering with unchanged
output, deliveries and confirmations.

To measure: apply `018_print_prerender.sql`, deploy, then compare a
`wrangler tail` of hand-over polls (`pre-rendered` in the log line) against the
489 ms above, and re-run `npm run measure:print-latency` once a few dozen
orders have printed. Until then there is no after-number for this fix.

## Step 2, fix 2: render cost and bytes (flag off until one live ticket)

**Render cost.** After fix 1 the render no longer sits on the hand-over
(9 to 48 ms, now inside `waitUntil`), so a render cache would save nothing on
hop b+c. Not built.

**Bytes.** About a quarter of every ticket's raster rows are blank, and each
went over the wire as 72 zero bytes. With `PRINT_COMPACT_BLANK_ROWS=1`, every
run of blank rows becomes its own `ESC GS S` block 1 byte wide: the same
command, the same one dot line per row, and no ink, so where the printer places
a narrow block cannot matter. Ink rows are untouched.

| Fixture (2 copies) | Full width | Compact | Less |
|---|---:|---:|---:|
| two rices (side + entrée) | 100,079 | 68,677 | 31% |
| typical (A-001 shape) | 136,673 | 99,238 | 27% |
| mixed sizes | 186,659 | 139,498 | 25% |
| baseline sample | 199,619 | 157,961 | 21% |
| 12-line party tray | 303,497 | 233,178 | 23% |
| full-menu breadth | 412,271 | 311,643 | 24% |
| all fixtures, 2 and 3 copies | 4,196,414 | 3,139,513 | **25.2%** |

`npm run verify:starprnt-compact` (45 checks) decodes both encodings of every
piece back to pixels and requires them identical, with the same pieces, the
same cuts and the same segment plan. The full-width size model stays an upper
bound, so no order splits differently.

Expected effect, if the download really is byte-bound at the ~12 KB/s measured
above: a 110 KB ticket loses about 28 KB, so **≈2 s** off hop b+c. That is an
estimate until it is measured.

**Why it is off by default.** Star's Rev. 4.01 gives `ESC GS S` a 1 to 128
byte range, but nothing confirms this firmware's handling of a 1-byte block,
and the Star manual PDF is encrypted, so the placement and feed text could not
be quoted here. Turn it on, print ONE ticket, and check it against a ticket
printed with it off: same length, no gaps, no blank-row stripes.

**Not done, and bigger: right-trimming ink rows.** Giving each text line its
own block, only as wide as its rightmost ink, would make tickets about 45%
smaller than today. It depends on a narrower raster printing at the left
margin, which this repo has no citation for. It needs that page of the manual,
or a bench test, before it is built.

## Step 2, fix 3: poll interval and a cheap no-job path

**The cheap no-job path.** Right after the health write, every poll now makes
one lock-free read, `printerHasWork`. Is any order queued or in flight for this
printer's stations (failover included), or any 日結 report queued or offered?
If not, the poll answers `jobReady:false` at once. Before, an empty poll ran
the report settle, the locking in-flight read (`for update`), the claim
transaction and the report claim transaction just to say the same thing. Now
it is **2 statements** (health write + has-work read), counted through the
real route.

The read is a superset of what the full path can act on, built from the same
`needsPaperFrom` arms, so "false" never hides a ticket. Anything time-based
(an expiring delivery, a report window) is in flight and therefore "true". It
fails open: any error does the full poll.

It takes **no row locks**, which is the property that matters: the claim's
`for update skip locked` skips any locked row. `verify:claim-no-skip` now runs
five has-work readers in the stress mix (20 readers, 200 claims, about 14,700
reads, 0 skips), keeps its control (a `for share` reader does cause skips),
and checks the answer for queued, in-flight, printed, change-ticket, 重印,
report and other-station states (19 checks).

**Poll interval.** The setting lives on the printer, not the server: Star's
"Polling time" (web configuration, CloudPRNT settings), default 5 s; both
printers are measured at 3.0 s. Star documents no minimum. Hop a (1.7 s p50) is
about half the interval plus the claim, and the confirming DELETE waits for a
tick too, so each second off the interval is worth about one second of tap to
paper.

| Polling time | Hop a p50 (est.) | Polls per day, 2 printers |
|---:|---:|---:|
| 3 s (today) | 1.7 s | 57,600 |
| 2 s | ≈1.2 s | 86,400 |
| 1 s | ≈0.7 s | 172,800 |

Advice: **2 s**, which saves ≈1 s (≈0.5 s on hop a, ≈0.5 s on the DELETE
tick) and stays under the Workers free plan's 100,000 requests a day. **1 s** only
on a paid Workers plan. Not measured until the printers' setting is changed.

## Step 2, fix 4: WiFi

Nothing here is code. The numbers above point at the network for most of the
time: the printer sits silent for ~15 s fetching ~110 KB, which is ~12 KB/s,
far below what any working WiFi link carries. The first job after an hour idle
takes ~10 s longer, and the online printer is ~3 s slower than the store printer
on the same size of ticket. In order, cheapest test first:

1. **Find out whether it is the WiFi at all.** If the printer model has a LAN
   port, plug one printer into the router with a cable for one service, then
   re-run `npm run measure:print-latency`. If b+c drops to a few seconds, the
   radio link is the problem; if it does not, it is TLS or the printer itself,
   and the levers are the ones under fix 2 and "What this means for Step 2".
2. **Signal.** Print the printer's network configuration (the self-test print;
   Star's TSP100IV hardware manual gives the button sequence) and note the
   signal level and the band. Move the router or add an access point so the
   printers are close and in line of sight. A microwave or a steel hood
   between them is the usual kitchen culprit on 2.4 GHz.
3. **Swap the two printers' places for a day.** If the slowness follows the
   spot, it is the radio path at the online printer's position. If it follows
   the printer, it is that unit.
4. **Router settings** (all on the router, none on our side):
   - a DHCP reservation for both printers, so their address never changes
     after an idle hour;
   - a fixed 2.4 GHz channel (1, 6 or 11) rather than auto, and no band
     steering for these two devices;
   - longer DNS caching, or a public resolver such as 1.1.1.1 for the
     printers, because a cold DNS lookup is part of the +10 s after idle.
5. **Measure after each change**, one change at a time, with the same script.
   Without a before and after, a WiFi change is a guess.

## Step 2, fix 5: POS status line

After Print, the POS shows the order's progress from the board poll it
already runs (every 4 s): **已送出** (Sent) until the printer is handed it,
**列印中** (Printing) until the printer confirms, **已列印** (Printed) once it
has. A seconds count runs from the tap and, once printed, shows the server's
own order to confirmation time. **未印出** (Not printed) replaces it if the
ticket gave up or passed the board's "did not print" threshold, so the line
never says "sent" about a lost ticket. Covered by
`tests/e2e/kitchen-pos-print-status.spec.ts`, which plays the store printer.
It changes no print timing; it makes the wait visible, and every staff tap
from now on doubles as a measurement.

## After deploying fixes 1, 3 and 5 (2026-11-27, 18:09 to 18:19 PT)

Deployed as Worker version `f9baf3b4` (rollback: `9ec8ebbd`), migration 018
already applied. `PRINT_COMPACT_BLANK_ROWS` is still off and both printers are
still at a 3 s Polling time, so fixes 2 and 4 are not in these numbers.
Ten minutes of `wrangler tail`, both printers:

| Request | Before | After |
|---|---:|---|
| empty poll, Worker wall | 173 ms p50, 185 ms p90 | **46 ms p50, 56 ms p90** (394 polls) |
| empty poll, Worker CPU | 9 ms p50 | 6 ms p50 |
| hand-over poll, Worker wall | 489 ms (B-006) | **245 ms** (B-044, pre-rendered hit) |
| POS order POST, Worker wall / CPU | 110 ms / 24 ms | 980 ms / 411 ms (includes the pre-render in `waitUntil`) |
| DELETE confirmation | 326 ms | 481 ms (n = 1) |

One ticket went through the new path during the window, B-044 (phone, store
printer). Its pre-render finished 581 ms after the order and the printer's
first poll used it:

| Ticket | a: created→offered | b+c: offered→confirmed | d: total |
|---|---:|---:|---:|
| store p50 before (7 days) | 1.7 s | 21.7 s | 24.1 s |
| B-043 (old code, minutes before the deploy) | 0.5 s | 23.1 s | 23.7 s |
| B-044 (new code) | 1.4 s | 22.4 s | 23.8 s |

**No visible change to tap-to-paper, as predicted.** The server got about
0.25 s faster per hand-over and empty polls got 4x cheaper, but the printer
still spends ~22 s between being handed the ticket and confirming it. That hop
is the download plus printing, and only fix 2 (bytes) and fix 4 (WiFi) act on it.

**Does the pre-render slow the POS down? No.** In production the order
request reports 411 ms of CPU, up from 24 ms, but its wall and CPU times
include the `waitUntil` work, so the tail cannot say what staff waited for. Tested
locally instead, on the same build under workerd (`wrangler dev --local`, local
R2 and Postgres, nothing printed), with 12 or more POS orders each way:

| POS order request, client-measured | p50 | range |
|---|---:|---:|
| pre-render on | 25 ms | 20 to 29 ms |
| pre-render off | 24 ms | 19 to 30 ms (first request 170 ms, cold) |

The pre-render ran after each response, in 10 to 14 ms warm and 54 ms on the
isolate's first ticket, and the next local printer poll took the staged copy.
The 411 ms in production is the render's cold start (fonts and the
rasterizer) landing on the order's request instead of the printer's poll; the
POS has its answer before it starts.

**Still untested: `PRINT_COMPACT_BLANK_ROWS` on the real printer.** Every
software check passes, but only the TSP143IV can say whether it accepts a
1-byte `ESC GS S` block. It stays off until someone can watch one ticket print.

Per-station before/after tables need dozens of tickets: re-run
`npm run measure:print-latency` after a full service.
