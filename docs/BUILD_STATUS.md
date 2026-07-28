# Build Status — New Mandarin Canton II ordering platform

Last updated 2026-07-27. Replaces `CLOVER_BUILD_AUDIT.md`, which described a
prepaid Clover checkout that has been **cancelled and deleted**.

---

## 1. The architecture, in one page

| Concern | How it works |
|---|---|
| **Payment** | **None online.** Cash or card at the counter. Nothing in this repo talks to a payment processor. |
| **Anti-abuse** | **Twilio Verify SMS OTP.** A verified phone number is what a card used to be: the cost an abuser has to pay. |
| **Menu** | `src/data/menu.ts` — 138 items transcribed from the printed menu (rev. 9/25), compiled into the app. No remote menu source. |
| **Orders** | Supabase Postgres, pooled connection, behind `src/lib/orders/repository.ts`. |
| **Printing** | **Star CloudPRNT.** The printer polls us; nothing reaches into the restaurant's network. |
| **Backstop** | `/kitchen`, a password-gated polling board that works with zero printer hardware. |
| **Safety net** | A Vercel cron texts the owner when an order has not printed within 2 minutes. |
| **Hosting** | Vercel, Node runtime (satori + resvg are native). |

**Clover is out of scope entirely.** The restaurant keeps it as their in-store
register; this system never talks to it and staff re-key orders there.

### The order lifecycle

```
customer verifies phone  ->  POST /api/orders  ->  QUEUED
                                                     |
                        CloudPRNT POST (claim)  <----+
                                   |
                        CloudPRNT GET (ticket PNG + buzzer header)
                                   |
                        CloudPRNT DELETE (confirm)  ->  PRINTED
                                   |
                              接單  ->  ACCEPTED
                                   |
                              完成  ->  COMPLETED  (+ "ready" SMS)
```

Anything that stalls in `QUEUED` or `PRINT_FAILED` for two minutes triggers the
owner alert. That is the whole point: with nothing prepaid, an order the
kitchen never saw is the worst outcome in the system.

---

## 2. Status by phase

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 0 | Clover removed | `SHIPPED` | No `clover`/`clv_`/`PAKMS`/`PrintNode`/Stripe reference in `src/`, `scripts/`, or `.env.example` |
| 0 | Menu preserved and enlarged | `SHIPPED` | **138 → 138 items.** `menu.ts` was and is the source; the order flow now reads it instead of a 16-item seed. [catalog.ts](../src/lib/menu/catalog.ts) |
| 0 | Party-tray pricing preserved | `PARTIAL — unverified data` | [party-trays.ts](../src/data/party-trays.ts) — 10 dishes, carried over from the deleted seed file where they were flagged as estimates. **Never transcribed from the printed menu.** |
| 0 | Lunch "no soup on pickup" rule | `SHIPPED` (display only) | [menu.ts](../src/data/menu.ts) combos `note`. Combos are not individually orderable online. |
| 1 | Orders table + indexes | `SHIPPED` | [schema.sql](../src/lib/db/schema.sql) |
| 1 | Status enum, no payment states | `SHIPPED` | `QUEUED \| PRINTED \| PRINT_FAILED \| ACCEPTED \| COMPLETED \| CANCELLED`, TS union + check constraint |
| 1 | Integer cents throughout | `SHIPPED` | Dollars→cents converted once, in `catalog.ts`. Verified through the jsonb round trip |
| 1 | Atomic daily order number | `SHIPPED` | Single UPSERT; 50 concurrent → `A-001…A-050`, no gaps |
| 1 | Idempotency by unique index | `SHIPPED` | Proven by a raw duplicate INSERT being rejected, not just the app fast path |
| 1 | Business date in tenant timezone | `SHIPPED` | PDT and PST both verified at 23:30 local |
| 1 | Repository seam | `SHIPPED` | [repository.ts](../src/lib/orders/repository.ts) — callers never see SQL |
| 1 | Supabase server-only | `SHIPPED` | **Zero** database imports in any `"use client"` file; RLS enabled with no policies |
| 1 | Migration for existing data | `SHIPPED` | [001_orders_no_payment.sql](../src/lib/db/migrations/001_orders_no_payment.sql) |
| 2 | `/api/otp/start` + `/api/otp/check` | `SHIPPED` | E.164 normalization, Twilio Verify |
| 2 | Signed 15-min proof-of-phone | `SHIPPED` | [session.ts](../src/lib/otp/session.ts) — httpOnly, HMAC, phone bound inside the payload |
| 2 | Order requires the token, phone must match | `SHIPPED` | Verified: 401 without, 403 on mismatch, 401 on tampered HMAC |
| 2 | Rate limits (phone burst + daily, IP) | `SHIPPED` | [rateLimit.ts](../src/lib/http/rateLimit.ts), bilingual 429 |
| 2 | Reject non-mobile before spending | `PARTIAL by design` | Toll-free / premium / N11 / malformed rejected free. True mobile detection needs paid Twilio Lookup — see below |
| 2 | Orders-per-phone-per-day cap | `SHIPPED` | Counted in Postgres, not in-memory |
| 2 | `pickup_at` ≤ 48h | `SHIPPED` | `MAX_PICKUP_HOURS`; the slot generator only offers today, so this is a backstop |
| 2 | Order-ready SMS | `SHIPPED` | [orderReady.ts](../src/lib/notify/orderReady.ts), fire-and-forget, no-ops if unset |
| 3 | 576px Chinese-primary PNG ticket | `SHIPPED` | satori + resvg, Node runtime. 3-line = 576×1623, 12-line = 576×2350 |
| 3 | Subset Noto Sans TC embedded | `SHIPPED` | **190.4 KB** for two weights (from 11.39 MB) |
| 3 | Missing 中文 is loud | `SHIPPED` | `⚠ EN` marker; also fires when a glyph is outside the subset |
| 3 | Dev-only preview route | `SHIPPED` | [preview/route.ts](../src/app/api/ticket/preview/route.ts) — 404 in production |
| 4 | CloudPRNT POST / GET / DELETE | `SHIPPED` | All three verified against the running server |
| 4 | Only DELETE marks printed | `SHIPPED` | An unconfirmed GET leaves the order `QUEUED` by design |
| 4 | Concurrency-safe claim | `SHIPPED` | 10 concurrent polls → exactly 2 distinct jobs for 2 orders |
| 4 | MAC pinning, rate limit, secret never logged | `SHIPPED` | Wrong secret → 404 |
| 4 | Retry → `PRINT_FAILED` | `SHIPPED` | 10 unconfirmed offers, then fail loudly |
| 4 | **Buzzer** | `SHIPPED — needs bench test` | `X-Star-CashDrawer` / `X-Star-Buzzerendpattern` response headers. See §4 |
| 5 | `/kitchen` password gate | `SHIPPED` | httpOnly cookie, HMAC, constant-time, `noindex` |
| 5 | 10s polling, chime, mute | `SHIPPED` | No websockets |
| 5 | 接單 / 完成 / 重印 + ticket view | `SHIPPED` | 重印 re-queues for the next poll |
| 5 | Failed + stale sort to top | `SHIPPED` | `PRINT_FAILED`, then unconfirmed `QUEUED`, each with its own banner |
| 5 | Works with no printer | `SHIPPED` | Verified with `CLOUDPRNT_SECRET` unset |
| 6 | Cron alert every minute | `SHIPPED` | [vercel.json](../vercel.json) + [route](../src/app/api/cron/unprinted-alert/route.ts) |
| 6 | Fires once per order | `SHIPPED` | `alerted_at` claimed by conditional UPDATE before sending |
| 6 | No-ops cleanly when unset | `SHIPPED` | Verified: reports `skipped`, logs the warning |

---

## 3. Verification

```bash
npm run dev:db        # embedded Postgres, schema applied, 3 orders seeded
npm run dev           # second terminal
npm run verify:orders # 40 assertions against a real throwaway Postgres
npm run ticket:sample # renders 3 fixtures to /tmp, reports 中文 coverage
```

`npm run verify:orders` — **40/40 pass**, covering idempotency, 50-way
concurrent number allocation, business dates in PDT and PST, race hygiene,
repository transitions, concurrent CloudPRNT claims, alert-once semantics, and
the per-phone daily cap.

Verified live against the running server: the complete CloudPRNT cycle
(claim → fetch → confirm) including the `?delete` firmware variant and the
`X-Star-CashDrawer` header; 重印 re-queueing; order submission with a valid
verification cookie; and rejection of a missing cookie (401), mismatched phone
(403), tampered HMAC (401) and client-supplied price (400).

`npm run build:ticket-font -- <NotoSansTC[wght].ttf>` regenerates the subset.
**Re-run it whenever 中文 is added anywhere that reaches a ticket** — forgetting
is not silent, the renderer falls back to English with `⚠ EN`.

---

## 4. The CloudPRNT buzzer

**Answer: yes, it works with `image/png`.** The peripheral command travels in
the **GET response headers**, not the job body — which is exactly why Star
documents it for the formats that cannot carry device commands.

```
X-Star-CashDrawer: end            # buzzer wired to the cash-drawer (DK) port
X-Star-Buzzerendpattern: 1        # dedicated buzzer terminal
```

No media-type change, no Star Document Markup, no raw StarPRNT. `CLOUDPRNT_BUZZER`
is a **mode** (`off` | `drawer` | `buzzer` | `both`), not a boolean, because the
right header depends on the wiring.

⚠️ **Bench-test before service.** Star documents these headers and the underlying
StarPRNT commands separately and never states which byte sequence the buzzer
headers emit — and a DK-port buzzer responds to the drawer pulse, not the
dedicated buzzer terminal. Try `drawer` first. Firmware minimums: TSP100IV 1.0+,
mC-Print2/3 1.2+, IFBD-HI01X/HI02X (Star's own guides disagree, 1.1.0 vs 1.3).
An unsupported printer ignores an unknown header rather than failing the job, so
enabling this can waste a buzz, never a ticket.

**Do not use `drawer` on a printer with a real cash drawer attached** — the till
would pop on every ticket.

---

## 5. Multi-tenancy

Every restaurant-specific value flows from env or `src/data/restaurant.ts`,
keyed by `tenant_id`. Two literals found in the ordering UI during this work
were moved to the data file.

**Tenant #2 is about a day for the ordering engine** — a new env set, a new
`menu.ts`, and lifting hours out of `restaurant.ts` into tenant config (they
are still read directly by `pickup.ts` and `tenant.server.ts`). **The marketing
site is a week+**, because the brand, the 富源 seal, and the GSAP choreography
are built around this restaurant.

---

## 6. Known gaps and open questions

1. **中文 covers 25% of the menu.** 34 of 138 items. The rest print English with
   `⚠ EN`. The marker is working as designed; the backlog is real.
2. **Party-tray prices are unverified** and only exist for 10 dishes. Any item
   without an entry is sold single-size, which is the safe failure.
3. **Size and modifier 中文 are unreviewed.** Standard trade terms, not verified
   by the family, and they print on a kitchen ticket.
4. **Combos are not orderable online.** Lunch specials and family dinners are
   display-only; the "no soup on pickup" rule is prose on the menu page.
5. **The rate limiter is per-instance.** On serverless the effective limit is
   (limit × warm instances). Twilio's own per-number ceiling and the Postgres
   daily order cap are the real backstops.
6. **No landline detection.** Only paid Twilio Lookup can do it; Twilio's 60205
   catches SMS-incapable numbers after one attempt.
7. **The alert repeats in logs when SMS is unconfigured.** Deliberate — stamping
   `alerted_at` without sending would consume the alert and lose it.
