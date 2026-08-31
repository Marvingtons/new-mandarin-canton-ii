# Duplicate kitchen tickets — diagnosis

**Date:** 2026-08-30 · **Scope:** read-only. No source file other than this one was modified; no migration was run; nothing was written to the database.

> **Three premises in the assignment are wrong and are corrected below.** The app does not run on Vercel (it is a Cloudflare Worker, `nmc-web`), there is no regression commit on or around 2026-08-19, and the NULL `print_job_key` / `print_offered_at` columns are the designed resting state rather than evidence of a removed write. Sections 2, 5 and 7 give the evidence.

---

## 1. One-paragraph answer

When a customer orders, the printer asks our server every few seconds "do you have anything for me?" We hand over the ticket once and then wait for the printer to say "printed." Because the ticket prints three copies, we allow a generous **90 seconds** for that confirmation to come back. If 90 seconds pass with no confirmation, the server assumes the print died and hands the **same ticket over again** — which is the right thing to do when a print really has failed, and the wrong thing to do when the confirmation was merely lost or arrived by a route the server did not count. That is what produces a second ticket. The behaviour has been in the code since **2026-08-01**, not since last week: the last change to any printing code was deployed on **2026-08-16 at 20:45 UTC**, and nothing has been deployed since, so the 08-19 date is the first time the fault *occurred*, not the day it was *introduced*. It got worse last week because the trigger is not a bug that fires every time — it needs a confirmation to go missing — and the printer had a visibly bad run on 08-29 (one order failed outright with `520 Download failed` after 11 attempts and 117 seconds). A second, independent path also produces duplicates that the server cannot even see: when the printer fetches the same ticket twice on its own, our download endpoint records nothing at all, so the order still reads `print_attempts = 1` while two pieces of paper have come out. Order A-004 on 08-30 is exactly that case.

**Confidence:** high on the mechanism and on the defective lines. **Medium** on the precise trigger for each individual duplicate, and this is stated honestly in §6 and §10 — the one piece of evidence that would close it (Cloudflare Workers request logs) is not reachable from here.

---

## 2. The regression commit(s)

**There is no regression commit in the 2026-08-15 → 2026-08-21 window.** This is the assignment's central premise and it does not survive contact with the repository.

| Fact | Evidence |
|---|---|
| Only two commits exist after 2026-08-12 | `git log --all --since=2026-08-12` → `f559572` (08-15, "s") and `a2b5505` (08-16, "f") |
| Neither touches the print state machine | `f559572` = a CI skill + lockfile. `a2b5505` = ticket **layout** and menu preparation only |
| Last change to any CloudPRNT file | `7a0f5d1`, **2026-08-01 02:26:15 -0700**, "Send a tall ticket as consecutive jobs instead of refusing it" |
| Deployed code = `a2b5505` | Cloudflare `workers_list`: `nmc-web` `modified_on = 2026-08-16T20:45:48Z`, matching the commit's author date of 13:43 PT. **No deploy since.** |
| Local `main` is behind production | `git log main..origin/main` → `a2b5505`, `f559572`. The working tree is at `f7effef` (08-12) |

`a2b5505` is the only deploy in the vicinity, and its print-path diff is confined to ticket layout — it moves the steamed/fried choice onto the item line:

```diff
-  for (const [i, mod] of line.modifiers.entries()) {
+  for (const [i, mod] of sideModifiers.entries()) {
```
<sub>`src/lib/ticket/render.ts`, commit `a2b5505`</sub>

This changes how a ticket *looks*, not when it is offered. It is also **not** correlated with the duplicates: of the 9 orders carrying the duplicate signature, only 2 contain a preparation modifier, and one order that carries one (08-25 A-002) printed cleanly.

### (a) The resend path was introduced on 2026-08-01

`7a0f5d1` added the split/resend machinery, including `print_segments` and the per-piece window:

```js
export function pieceDeliveryCap(deliveryCap: number, segmentIndex: number): number {
  return segmentIndex > 0 ? deliveryCap + 1 : deliveryCap;
}
```
<sub>[src/lib/print/entitlement.ts:129](src/lib/print/entitlement.ts:129)</sub>

The **re-offer itself** is older still — `133171c`, 2026-07-31, "Stop re-offering a job the printer is still printing", which added `print_offered_at` and the confirmation window. That commit *narrowed* an unconditional re-offer into a windowed one. It did not remove it.

### (b) Nothing removed the job-key write

The write is present and reached on every first hand-over:

```js
await recordPrintJobKey(tenant.tenantId, job.id, key);
```
<sub>[src/app/api/print/[secret]/route.ts:419](src/app/api/print/[secret]/route.ts:419)</sub>

See §5/H5 for why the column is NULL anyway.

---

## 3. The exact defective predicate / lines

### 3.1 The `jobReady` predicate has no lease — CONFIRMED

```sql
select ... from orders
 where tenant_id = $1
   and status = any($2::text[])
   and print_attempts > 0
 order by created_at asc
 limit 1
```
<sub>[src/lib/orders/repository.ts:274](src/lib/orders/repository.ts:274)–285, `currentPrintJob`. `PRINTABLE_STATUSES = ["QUEUED"]` — [src/lib/orders/types.ts:59](src/lib/orders/types.ts:59)</sub>

There is **no per-delivery token, lease, or claim**. "The job in flight" is inferred from `status = QUEUED AND print_attempts > 0`. Whether to hand it over *again* is then decided entirely by a timestamp comparison, not by anything identifying the delivery the printer is actually holding.

### 3.2 The resend trigger — THIS IS THE DEFECT

```js
if (!inFlight) {
  return {
    verdict: input.printAttempts > 0 ? "retry" : "first-offer",
    ...
```
<sub>[src/lib/print/entitlement.ts:155](src/lib/print/entitlement.ts:155)–169</sub>

```js
if (elapsedSeconds < windowSeconds) { ... verdict: "hold" ... }
...
return { verdict: "retry", ... };
```
<sub>[src/lib/print/entitlement.ts:174](src/lib/print/entitlement.ts:174) and [:201](src/lib/print/entitlement.ts:201)</sub>

Two distinct ways to reach `"retry"`, and **both re-offer a ticket that may already be on paper**:

1. **Window expiry** (line 201) — `print_offered_at` is older than the window.
2. **No stamp at all** (line 160) — `print_offered_at IS NULL` with `print_attempts > 0` re-offers **immediately, on the very next poll (~3s)**, with no delay whatsoever.

The window:

```js
return Math.max(floor, perPiece * perCopy);
```
<sub>[src/lib/print/entitlement.ts:116](src/lib/print/entitlement.ts:116)</sub>

With `TICKET_COPIES = 3` ([wrangler.jsonc:104](wrangler.jsonc:104)), floor 60 ([src/config/tenant.server.ts:437](src/config/tenant.server.ts:437)) and 30s/copy ([:461](src/config/tenant.server.ts:461)) → **window = max(60, 3×30) = 90 seconds.**

### 3.3 The `print_attempts` increment — server-side only

```js
await bumpPrintAttempt(tenant.tenantId, job.id);
```
<sub>[src/app/api/print/[secret]/route.ts:298](src/app/api/print/[secret]/route.ts:298) — the only increment on a re-offer; `claimNextPrintJob` ([repository.ts:242](src/lib/orders/repository.ts:242)) does the first</sub>

**The GET handler increments nothing.** Across [route.ts:445–593](src/app/api/print/[secret]/route.ts:445) the only order write is `recordPrintSegments` (line 544). A printer that fetches the same body twice is therefore **completely invisible** to `print_attempts`.

### 3.4 The lease is cleared 72 lines before the order is closed

```js
await revokePrintOffer(tenant.tenantId, order.id);   // print_offered_at = NULL
if (jobKey) await deletePrintJob(jobKey);            // ← R2 network round-trip
...
const printed = await markPrinted(tenant.tenantId, order.id);
```
<sub>[route.ts:699](src/app/api/print/[secret]/route.ts:699), [:700](src/app/api/print/[secret]/route.ts:700), [:771](src/app/api/print/[secret]/route.ts:771)</sub>

Between line 699 and line 771 the row is `QUEUED` + `print_attempts > 0` + `print_offered_at IS NULL` — **precisely the state that §3.2 case 2 re-offers with zero delay** — and the gap contains a network call to R2.

### 3.5 `print_segments` is a post-mortem marker, not a cause

```sql
print_segment = 0,
print_segments = 0,
```
<sub>[src/lib/orders/repository.ts:534](src/lib/orders/repository.ts:534)–535, inside `markPrinted`</sub>

`markPrinted` zeroes both counters. So a resting value of `print_segments = 1` **proves a `recordPrintSegments` write landed after the order was closed** — it is a symptom of a second render, never the cause of a second ticket. This is why the column correlates ~perfectly with `print_attempts > 1` and not at all with ticket length.

---

## 4. Two annotated sequence traces

Common baseline — a clean order, **2026-08-30 A-001** (`print_attempts=1`, `print_segments=0`, 28s, `updated_at = printed_at` exactly):

| t | Actor | Code path | DB effect |
|---|---|---|---|
| +0s | customer | `POST /api/orders` | row inserted `QUEUED`, attempts 0 |
| ~+2s | printer POST | [route.ts:301](src/app/api/print/[secret]/route.ts:301) `claimNextPrintJob` | attempts **0→1**, `print_offered_at = now()` |
| ~+2s | server | [route.ts:412](src/app/api/print/[secret]/route.ts:412) `recordPrintSegments(1)`, [:419](src/app/api/print/[secret]/route.ts:419) `recordPrintJobKey` | segments 1, key set |
| ~+3s | printer GET | R2 object via `jobGetUrl` ([route.ts:333](src/app/api/print/[secret]/route.ts:333)) | *no write* |
| +3→+28s | printer | prints 3 copies | — |
| +28s | printer DELETE | [route.ts:699](src/app/api/print/[secret]/route.ts:699) revoke → [:771](src/app/api/print/[secret]/route.ts:771) `markPrinted` | `PRINTED`, `printed_at`, **segments→0**, key→NULL |

`updated_at − printed_at = 0` for every clean order. That is the fingerprint of a print that closed cleanly.

### 4.1 A-002 on 2026-08-30 — attempts 3, segments 1, **two tickets**

`created 15:38:34 · printed 15:39:03 (+29s) · updated 15:40:16 (+102s)`

| t | Step | Evidence |
|---|---|---|
| +0s | Created, `QUEUED` | A4 |
| ~+2s | `claimNextPrintJob` → attempts **1**, `print_offered_at ≈ 15:38:36` | [repository.ts:246](src/lib/orders/repository.ts:246)–249 |
| ~+2s | Body rendered + published; `recordPrintSegments(1)` | [route.ts:412](src/app/api/print/[secret]/route.ts:412) |
| +29s | A confirmation closes it: `revoke` → `markPrinted` → `printed_at = 15:39:03`, **segments reset to 0** | [route.ts:771](src/app/api/print/[secret]/route.ts:771), [repository.ts:534](src/lib/orders/repository.ts:534) |
| **+92s** | `print_offered_at + 90s` elapses — the window is measured **from the offer, not from the print** | [entitlement.ts:174](src/lib/print/entitlement.ts:174) |
| **~+95s** | A poll reaches `decideOffer` and returns **`retry`**; `bumpPrintAttempt` runs (attempts → 2, → 3) | [entitlement.ts:201](src/lib/print/entitlement.ts:201), [route.ts:298](src/app/api/print/[secret]/route.ts:298) |
| **~+100s** | Body re-rendered and re-advertised; `recordPrintSegments(1)` lands **after** `markPrinted` zeroed it → **segments = 1** | [route.ts:412](src/app/api/print/[secret]/route.ts:412)/[:544](src/app/api/print/[secret]/route.ts:544) |
| ~+102s | Last write. **`updated_at = created_at + 102s`** | A3 |
| — | Printer fetches the re-advertised body → **second ticket** | — |

**Why 2 tickets and not 3 despite `attempts=3`:** `print_attempts` counts *hand-overs offered*, not paper. The first offer printed; the extra offers within one poll cycle re-advertise the **same** R2 object (`publishJobBody` early-returns on an existing key, [route.ts:389](src/app/api/print/[secret]/route.ts:389)), so consecutive offers collapse into a single additional fetch.

**The load-bearing number.** Across all eight orders with this signature, the last write lands at `created_at + 100–104s` — 100, 101, 102, 102, 102, 102, 102, 104 — while `printed_at` varies between +25s and +40s. A constant anchored to **`created_at`** and not to `printed_at` is a **timer**, and 90s (window) + ~2s (claim) + poll interval + render is exactly that timer. This is the strongest single piece of evidence in the report.

> **Residual uncertainty, stated plainly.** `markPrinted` sets `status = 'PRINTED'`, and `currentPrintJob` selects `QUEUED` only — so a strict reading says the +95s poll should not have been able to select this row at all. Either the confirmation at +29s did not close the row when the timestamp suggests, or the +100s write comes from a request that selected the row *before* +29s and completed late. Both produce the identical duplicate and the identical row state; distinguishing them requires request logs (§10). The defect in §3 is the same either way.

### 4.2 A-004 on 2026-08-30 — attempts 1, segments 0, **two tickets**

`created 19:24:28 · printed 19:24:56 (+27s) · updated = printed_at (tail 0s)`

The server's row is **indistinguishable from a clean order**. It offered exactly once and recorded exactly one hand-over.

| t | Step | Evidence |
|---|---|---|
| ~+2s | `claimNextPrintJob` → attempts 1, offered stamped | [repository.ts:242](src/lib/orders/repository.ts:242) |
| ~+3s | Printer fetches the body | R2, or [route.ts:470](src/app/api/print/[secret]/route.ts:470) |
| **~+?s** | **Printer fetches the same body a second time** — a firmware re-fetch after an incomplete download, the failure mode this printer has a documented history of (`520 Download failed` ×6 on 07-30, and again on 08-29) | — |
| — | **No write of any kind.** The GET path never calls `bumpPrintAttempt` and never sets `print_offered_at` | [route.ts:445](src/app/api/print/[secret]/route.ts:445)–593 |
| +27s | Confirmation → `markPrinted` | [route.ts:771](src/app/api/print/[secret]/route.ts:771) |

**This is the more dangerous of the two**, because it is silent: the R2 object stays live until the confirming DELETE removes it ([route.ts:700](src/app/api/print/[secret]/route.ts:700)) and the URL is a plain static GET the printer may repeat at will. Any duplicate-ticket count taken from the database **undercounts by exactly this class**.

### 4.3 A-007 on 2026-08-29 — attempts 11, `520 Download failed`, 117s

Retrying here is **correct**. A 520 means the printer never successfully downloaded the body, so no paper came out and re-offering is the only way the order prints. The failure verdict is handled at [route.ts:707](src/app/api/print/[secret]/route.ts:707)–717, which revokes the offer and records the error; the next poll finds no body in flight and re-offers. The order ended `PRINT_FAILED` with `print_segments = 0`, and its tail is 18s, not ~72s — it does not carry the duplicate signature.

---

## 5. Hypothesis table

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| **H1** | A commit ~2026-08-19 added a resend path | **REFUTED** | No commit to any print file between `7a0f5d1` (08-01) and `a2b5505` (08-16); `a2b5505` touches ticket layout only. Worker `modified_on = 2026-08-16T20:45:48Z`, no deploy since. The resend path dates to `7a0f5d1`, 08-01 |
| **H2** | Poll answers `jobReady` for any unprinted order, no claim/lease | **CONFIRMED (predicate corrected)** | Not `printed_at IS NULL` — it is `status='QUEUED' AND print_attempts>0`, [repository.ts:274](src/lib/orders/repository.ts:274)–285. No token, no lease. The only guard is a self-clearing timestamp |
| **H3** | `print_attempts` moves on server resends, not printer GETs, so re-fetches are invisible | **CONFIRMED** | GET path [route.ts:445](src/app/api/print/[secret]/route.ts:445)–593 writes only `recordPrintSegments`. Explains A-004 exactly |
| **H4** | DELETE matches confirmations by something other than a per-job token | **REFUTED** | Resolves by token first ([route.ts:654](src/app/api/print/[secret]/route.ts:654)–661); `jobToken` is the order number ([:329](src/app/api/print/[secret]/route.ts:329)). `currentPrintJob` is only the no-token fallback |
| **H5** | A commit 07-31→08-02 removed the job-key / offered-at write | **REFUTED** | Both writes are present and reached ([route.ts:419](src/app/api/print/[secret]/route.ts:419), [repository.ts:248](src/lib/orders/repository.ts:248)/[:304](src/lib/orders/repository.ts:304)). They are NULL at rest **by design** — `revokePrintOffer` ([repository.ts:335](src/lib/orders/repository.ts:335)–336) and `markPrinted` ([:536](src/lib/orders/repository.ts:536)–537) null them on every confirmation. Confirmed by A5: the only rows that retain a key are ones that never confirmed (`CANCELLED`/`PRINT_FAILED`) |
| **H6** | Time-based trigger with a threshold shorter than normal confirm latency | **CONFIRMED as shape; REFUTED as "too short"** | Trigger is time-based ([entitlement.ts:174](src/lib/print/entitlement.ts:174)/[:201](src/lib/print/entitlement.ts:201)). But window = 90s vs normal confirm 25–42s (A2), so it does **not** fire on a normal print. Yet the duplicate signature lands at a hard `created_at + 100–104s` = one 90s window + overhead. The window is reached; **why** it is reached is §10 Q1 |
| **H7** | Error-based trigger (failed write, Supavisor pool, exception) | **REFUTED for the database** | `postgres_logs` for 2026-08-30T22:37–22:42Z and 2026-08-31T02:24–02:27Z contain only `checkpoint starting/complete`. No errors, no statement timeouts, no lock waits, no pool exhaustion. A client-side exception in the Worker remains unexcluded (§10 Q1) |
| **H8** | Two consumers (second tab/device, or the alerting path) | **REFUTED for alerting** | The alert path writes only `alerted_at` / `alert_attempts` ([repository.ts:632](src/lib/orders/repository.ts:632)–691); both are `0`/`NULL` on **every** doubled order (A3). The cron ([custom-worker.ts:79](custom-worker.ts:79)) calls only that route. Not excluded for a second *printer* — but `printer_status` holds one MAC, `00:11:62:55:24:d4` |
| **H9** | The 08-28/29 spike was degraded connectivity amplifying H1–H7, not new code | **UNDETERMINED, partly supported** | Supported: no code change is possible (H1), and 08-29 shows real trouble — A-007 with `520 Download failed`, 11 attempts, 117s. Unsupported: 08-19 A-004 doubled on an otherwise clean day. `printer_status` keeps only the current row, so there is no history to test against |
| **H10** | Manual 重印 reprints account for some duplicates | **UNDETERMINED — and cannot be ruled out from data alone** | `requeueForPrint` ([repository.ts:569](src/lib/orders/repository.ts:569)–587) resets `print_attempts`, `print_segment`, `print_segments`, `print_job_key`, `print_offered_at`, `alerted_at`, `alert_attempts` and **leaves no marker**; it does not touch `printed_at`. A staff reprint is therefore invisible in the final row. **Stated explicitly as required: this cannot be excluded without request logs for `PATCH /api/kitchen/orders/[id]`.** |

---

## 6. Why 2026-08-02 → 2026-08-18 was clean

Stated precisely: **the code in that window is byte-identical to the code running now**, so nothing about the window is explained by code.

- The last print-path commit before the incident is `7a0f5d1`, 2026-08-01 02:26 PT — *before* the clean window opens.
- The only deploy after it is `a2b5505`, 2026-08-16 20:45 UTC, which changes ticket layout only, and the clean window continues through 08-17 and 08-18 after that deploy.
- 51 orders, `max(print_attempts) = 1`, `sum(print_segments) = 0` (A2).

So the correct statement is **not** "the Aug 19 change added something." It is: **the defect in §3 is latent and requires a missing or late confirmation to fire.** Between 08-02 and 08-18 every confirmation arrived and was attributed, so the 90-second window was never reached and the row never entered the `print_offered_at IS NULL` + `QUEUED` state. From 08-19 that stopped being universally true.

What the data does show about the trigger, without settling it:

- The clean window averaged 31–42s to print, and the daily averages barely move afterwards (A2) — so this is **not** a general slowdown crossing a threshold.
- The 08-29 cluster (6 of 10) is the day with a hard printer failure (A-007, `520`), which is consistent with confirmations being lost rather than merely slow.
- Volume is not it either: 08-16 ran 7 orders clean; 08-30 ran 4 and doubled 2.

**Honest conclusion: the code that permits the duplicate is fully identified (§3); the environmental change that started exercising it on 08-19 is not, and §10 Q1 names the evidence that would settle it.** I am not going to dress a plausible story up as a finding.

---

## 7. What is NOT the cause

Only items actually ruled out with evidence:

1. **Ticket length / a ticket too tall to print.** A 301-byte, 1-item ticket (08-30 A-002) doubled; a 1194-byte, 4-item ticket printed once on 08-25. `print_segments` never exceeded 1 on any doubled order, and `advancePrintSegment` — the only genuine split path — never ran ([route.ts:750](src/app/api/print/[secret]/route.ts:750) requires `segments > 1`). **Segments here mean (b), a re-render during resend, not (a), a long ticket split** (Phase B5 answered).
2. **The alerting path.** `alert_attempts = 0` and `alerted_at = NULL` on every doubled order (A3); the alert code writes no print column (H8).
3. **A removed `print_job_key` / `print_offered_at` write.** Present and reached; NULL is the designed post-confirmation state (H5).
4. **Database faults — statement timeouts, lock waits, Supavisor pool exhaustion.** `postgres_logs` across both incident windows contain only checkpoint lines (H7).
5. **The 2026-08-16 deploy's content change** (`a2b5505`, preparation modifier). No correlation: 2 of 9 signature orders carry a prep modifier, and clean order 08-25 A-002 carries one too.
6. **Vercel.** There are no Vercel logs to chase — the app is a Cloudflare Worker (`wrangler.jsonc`, `custom-worker.ts`, `nmc-web`). Anyone sent to look for them will lose a day.
7. **A printer that was out of paper or had its cover open.** That path returns before any attempt is counted ([route.ts:237](src/app/api/print/[secret]/route.ts:237)–239), and `printer_status` shows `paper_out = false`, `cover_open = false`, `status_code = '200 OK'`.

*Not* ruled out and deliberately left off this list: the 21:38 offline event on 08-30 (no `printer_status` history exists to test it) and manual 重印 (leaves no marker — H10).

---

## 8. Blast radius

**Confirmed duplicate signature** (`print_segments = 1` + `print_attempts > 1` + a last write at `created_at + 100–104s`) — **8 orders since 08-19**:

| Date | Order | Attempts |
|---|---|---|
| 2026-08-19 | A-004 | 4 |
| 2026-08-28 | A-001 | 2 |
| 2026-08-29 | A-001, A-006, A-008, A-009, A-010 | 2 each |
| 2026-08-30 | A-002 | 3 |

**The true figure is higher.** 2026-08-30 A-004 physically produced two tickets and carries **no signature at all** (`attempts=1`, `segments=0`, tail 0s) because the GET path records nothing (§4.2). Every silent printer re-fetch is invisible, so **8 is a floor, not an estimate**. Out of 40 orders since 08-19 that is ≥20%, against 0 of 51 in the preceding window.

**Could an order have been LOST (never printed) by the same mechanism?** Query for `printed_at IS NULL AND status NOT IN ('CANCELLED','COMPLETED')` returns **exactly one row, and it predates the incident**:

> 2026-07-31 A-004 · `PRINT_FAILED` · 7 attempts · `no print confirmation after 7 hand-overs`

**No order has been lost since 08-19.** This is structural rather than lucky: the defect is biased toward printing *too much*, and the design deliberately makes only a DELETE mark an order printed ([cloudprnt.ts:20](src/lib/print/cloudprnt.ts:20)), with the kitchen board and the unprinted-order alert behind it. The customer-facing risk is duplicated cooking, not a missed order.

---

## 9. Recommended fix, in principle only

**The minimum change that closes the defect.** Give every hand-over an identity and make the confirmation close *that identity*, rather than closing "whatever is currently in flight for this order." Today the server re-offers on the basis of a timestamp it also clears itself, so it cannot distinguish "this print died" from "this print succeeded and I have not been told yet" — and both the window-expiry path and the `print_offered_at IS NULL` path re-offer a ticket that may already be on paper. Concretely, in principle: issue a delivery token per hand-over, carry it in `jobToken`, require a matching token to confirm, and never re-offer while an *unexpired, unconfirmed* delivery exists for that order — so a lost confirmation costs a delayed ticket rather than a duplicate one. Alongside that, close the ordering hazard at [route.ts:699](src/app/api/print/[secret]/route.ts:699)–771 by making revocation and closure a single atomic statement, so the row never sits in the `QUEUED` + `attempts>0` + no-stamp state that grants an immediate re-offer.

**The change that prevents this class of bug recurring.** Make the download itself a counted, single-use event. The system's blind spot is not the timing constant — it is that the server has no idea how many times the printer actually took the body: the GET path writes nothing, and the R2 object stays fetchable at a stable URL until the confirming DELETE deletes it, so a firmware re-fetch prints a second ticket that never appears in any column (this is A-004 on 08-30, and it is why the count in §8 is a floor). Every hand-over should be observable and idempotent — one-time-use job URLs and a recorded fetch count — so that "how many tickets did this order actually produce?" becomes a question the database can answer. That single property would have made this a five-minute diagnosis instead of a three-round one, and it is worth more than any particular tuning of the 90-second window.

---

## 10. Open questions, and the evidence that resolves each

**Q1 — What made the 90-second window start being reached on 08-19, when it was never reached in the preceding 51 orders?**
This is the one genuinely unresolved question, and everything in §6 turns on it. Three candidates remain live: confirmations being lost in transit; a Worker-side exception between `revokePrintOffer` and `markPrinted` leaving the row in the immediately-re-offerable state of §3.4; and staff 重印 presses (H10).
*Resolves it:* **Cloudflare Workers request logs for `nmc-web` on the `/api/print/[secret]` routes** for 2026-08-30 22:38–22:41Z (A-002) and 2026-08-31 02:24–02:27Z (A-004) — not Vercel logs, which do not exist for this app. The code already logs a verdict line per poll (`[cloudprnt] verdict=… attempts=… window=…s`, [route.ts:280](src/app/api/print/[secret]/route.ts:280)–284) and one line per confirmation ([:675](src/app/api/print/[secret]/route.ts:675)). Those two lines answer it outright. Reachable via `wrangler tail` going forward, or the Workers Logs UI if observability was enabled — the Cloudflare MCP available here exposes no logs tool.

**Q2 — How many GETs did the printer actually issue per order?**
Decides how much of the duplication is server re-offer (A-002 class) versus silent printer re-fetch (A-004 class), and therefore how much §8 undercounts.
*Resolves it:* **R2 access logs for the `nmc-print-jobs` bucket**, or Workers logs for the fallback GET, counting fetches per `print-jobs/<order>-s0-<sha>.bin` key.

**Q3 — Did staff press 重印 on any of the 8 orders?**
Cannot be answered from the database at all: `requeueForPrint` erases every trace (H10).
*Resolves it:* Workers request logs for `PATCH /api/kitchen/orders/[id]` with `action: "reprint"` in the same windows — or simply asking the kitchen whether they reprinted on 08-29.

**Q4 — Is `PRINT_OFFER_CAP` set as a Worker secret?**
It is absent from `wrangler.jsonc` (so it defaults to 4), but `.dev.vars.example:107` still ships `PRINT_OFFER_CAP=40` under a stale comment describing the **old poll-counting unit**, and the config file carries an explicit warning that a leftover 40 "now means forty copy-sets over an hour" ([src/config/tenant.server.ts:413](src/config/tenant.server.ts:413)). If a 40 was ever set in production this is a loaded gun independent of everything above.
*Resolves it:* `wrangler secret list --name nmc-web`, or the Workers dashboard variables pane.

**Q5 — Was the printer's connectivity actually degraded on 08-28/29 (H9)?**
`printer_status` holds one row of current state, so there is no history to test.
*Resolves it:* Workers logs for the `[printer] BACK after Ns of silence` and `[printer] RECOVERED` edge lines ([route.ts:177](src/app/api/print/[secret]/route.ts:177)–196), which are emitted on exactly those transitions.
