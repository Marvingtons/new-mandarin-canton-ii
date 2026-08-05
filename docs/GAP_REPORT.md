# Gap Report — New Mandarin Canton II vs. the new architecture

Read-only audit of `main` @ `f8fb804`, 2026-07-27. Working tree clean, no stashes.

Repo identity confirmed: [restaurant.ts:72-82](../src/data/restaurant.ts#L72) —
"New Mandarin Canton II", 富源, 543 Telegraph Canyon Rd, Chula Vista CA 91910,
(619) 656-6888. Right directory.

---

## 1. Verdict

**The migration has already been run. This is not a build job, it is a
one-line fix plus credentials.** Roughly **95%** of the new architecture
exists as working code — payment removed, Twilio Verify OTP gating orders,
Supabase Postgres behind a repository, 576px satori/resvg tickets with the
subset font committed, CloudPRNT with all three verbs, `/kitchen`, and the
unprinted-order cron.

**One critical defect blocks the first real printed ticket, and it fails only
in production**: the CloudPRNT route is missing from the font-tracing map in
`next.config.ts`, so on Vercel every ticket render throws and every order goes
`PRINT_FAILED`. Locally it works fine. Everything else outstanding is a
credential, an owner decision, or content.

---

## 2. Status table

### Phase 1 — Clover removal

| Item | Status | Evidence |
|---|---|---|
| Clover code removed | `DONE` | Zero live references. Only historical comments: [order.ts:6](../src/data/order.ts#L6), [party-trays.ts:8](../src/data/party-trays.ts#L8), [001_orders_no_payment.sql:4](../src/lib/db/migrations/001_orders_no_payment.sql#L4), [catalog.ts:20](../src/lib/menu/catalog.ts#L20), [source.ts:10](../src/lib/menu/source.ts#L10) |
| Card-collection UI | `MISSING` (correct) | No card/CVV/tokenizer/iframe anywhere. `CloverPayment.tsx` deleted. **No CRITICAL card finding.** |
| Stripe / payment_intent | `MISSING` (correct) | No hits outside docs |
| PrintNode | `MISSING` (correct) | No hits outside one doc line |
| Clover/Stripe env vars | `MISSING` (correct) | `.env.example` carries none |
| Menu item count | `DONE` | **138 orderable items**, 11 categories, [menu.ts:50-580](../src/data/menu.ts#L50). Intact — not below ~126 |
| Party-tray pricing | `PARTIAL` | [party-trays.ts:37-54](../src/data/party-trays.ts#L37) — **12 entries** (the file header says "ten"), all flagged unverified estimates |
| `nameZh` | `PARTIAL` | 34 of 138 items (~25%). 30 name-keyed + 4 id-keyed, [menu-overrides.ts:57-118](../src/data/menu-overrides.ts#L57). `menu.ts` itself carries zero |
| Lunch "no soup to-go" rule | `PARTIAL` (display only) | [menu.ts:626](../src/data/menu.ts#L626). Combos are not orderable online, so the rule never reaches an order |
| Committed Clover token | **None found** | `git log -p --all -S 'CLOVER_PRIVATE_TOKEN'` shows every `CLOVER_*=` was blank in `.env.example`. No `.env`/`.env.local` was ever committed. **Nothing to rotate.** |

### Phase 2 — Database

| Item | Status | Evidence |
|---|---|---|
| `orders` DDL | `DONE` | [schema.sql:18-60](../src/lib/db/schema.sql#L18) |
| **Unique `(tenant_id, idempotency_key)`** | `DONE` | [schema.sql:67-68](../src/lib/db/schema.sql#L67) `orders_idempotency_uniq` |
| Unique `(tenant_id, business_date, order_number)` | `DONE` | [schema.sql:71-72](../src/lib/db/schema.sql#L71) |
| `order_counters` atomic upsert | `DONE` | [repository.ts:114-122](../src/lib/orders/repository.ts#L114) — single `INSERT … ON CONFLICT DO UPDATE RETURNING`. No read-then-write |
| Business date in `America/Los_Angeles` | `DONE` | [businessDate.ts:50-57](../src/lib/orders/businessDate.ts#L50) via `Intl` `en-CA` on tenant timezone. Not UTC |
| Integer cents throughout | `DONE` | Dollars→cents once at [catalog.ts:38-40](../src/lib/menu/catalog.ts#L38). No float below that boundary |
| Payment states removed | `DONE` | [types.ts:31-38](../src/lib/orders/types.ts#L31) + check constraint [schema.sql:50-59](../src/lib/db/schema.sql#L50). `PENDING_PAYMENT`/`PAID` gone |
| **Supabase access boundary** | `DONE` | **Zero** DB imports, keys, or `process.env` in any of the 21 `"use client"` files. Only hit is the literal string `DATABASE_URL` in an error message, [KitchenBoard.tsx:260](../src/components/kitchen/KitchenBoard.tsx#L260). No anon key client-side. RLS enabled with no policies, [schema.sql:104-105](../src/lib/db/schema.sql#L104) |
| `.data/orders.json` | `MISSING` (correct) | Directory absent; gitignored; only referenced in a historical comment at [dev-orders-db.ts:7](../scripts/dev-orders-db.ts#L7) |
| Pooling / leaks | `DONE` | [postgres.ts:44-63](../src/lib/db/postgres.ts#L44) — module-scoped pool, `max: 4`, `client.release()` in `finally` at [:85](../src/lib/db/postgres.ts#L85) |
| `repository.ts` seam | `DONE` | All callers import it; no route contains SQL |

### Phase 3 — OTP

| Item | Status | Evidence |
|---|---|---|
| `/api/otp/start`, `/api/otp/check` | `DONE` | [start/route.ts](../src/app/api/otp/start/route.ts), [check/route.ts](../src/app/api/otp/check/route.ts) |
| E.164 normalization | `DONE` | [phone.ts:142](../src/lib/phone.ts#L142). NANP-only by design; toll-free/premium/N11/malformed rejected before Twilio bills |
| **Order requires proof, phone must match** | `DONE` | [orders/route.ts:76-101](../src/app/api/orders/route.ts#L76). Quoted below |
| Rate limits | `DONE` (in-memory) | [rateLimit.ts:51-63](../src/lib/http/rateLimit.ts#L51) — `otp_start_phone` 3/15min, `otp_start_phone_daily` **8/24h**, `otp_start_ip` 10/15min, `otp_check_phone` 10/15min, `otp_check_ip` 30/15min, `order_ip` 10/5min, `cloudprnt_ip` 120/min |
| Orders per phone per day | `DONE` | 5, counted in Postgres — [tenant.server.ts:201](../src/config/tenant.server.ts#L201), [repository.ts:366-380](../src/lib/orders/repository.ts#L366) |
| `pickup_at` cap | `DONE` | 48h — [orders/route.ts:137-142](../src/app/api/orders/route.ts#L137) |
| Twilio credentials server-only | `DONE` | [twilio.ts:1](../src/lib/otp/twilio.ts#L1) `import "server-only"`; read only via [tenant.server.ts:240-251](../src/config/tenant.server.ts#L240) |
| OTP signing key | `PARTIAL` | Reuses `ADMIN_DASH_PASSWORD` — [session.ts:38-40](../src/lib/otp/session.ts#L38). See finding **H-1** |

The check the prompt asked me to quote — there is **no** client-supplied
`phoneVerified` boolean, and there cannot be, because `.strict()` hard-rejects
any unknown field and the number is re-derived from the signed cookie:

```ts
// src/app/api/orders/route.ts:76-101
const verified = readVerifiedPhoneFromRequest(request);
if (!verified) { return bad("Please verify your phone number…", 401); }
…
const submitted = normalizePhone(body.pickup.phone);
if (!submitted.ok || submitted.e164 !== verified.e164) {
  return bad("That phone number doesn't match the one you verified…", 403);
}
const phoneE164 = verified.e164;   // ← the order is filed under the TOKEN's number
```

### Phase 4 — Ticket renderer

| Item | Status | Evidence |
|---|---|---|
| `renderTicket()` returns a real PNG | `DONE` | [render.tsx:439](../src/lib/ticket/render.tsx#L439) `Buffer.from(rendered.asPng())` |
| satori + @resvg/resvg-js | `DONE` | [render.tsx:3-4](../src/lib/ticket/render.tsx#L3). No node-canvas. Externalized in [next.config.ts:15](../next.config.ts#L15) |
| `runtime = 'nodejs'` on render routes | `DONE` | All 9 API routes declare it. Zero edge routes in the repo |
| 576px output | `DONE` | [render.tsx:30](../src/lib/ticket/render.tsx#L30), applied at satori `width` and resvg `fitTo` [:424,:433](../src/lib/ticket/render.tsx#L424) |
| **Noto Sans TC present** | `DONE` | `public/fonts/NotoSansTC-Ticket-Regular.ttf` **96,988 B**, `-Bold.ttf` **97,936 B**, `ticket-font-coverage.json` 2,490 B. **195 KB total**, all three git-tracked. Subset, not the 11 MB original — comfortably inside the bundle budget |
| Missing `nameZh` marker | `DONE` | `⚠ EN` at [render.tsx:41](../src/lib/ticket/render.tsx#L41), emitted at [:134, :166, :187](../src/lib/ticket/render.tsx#L134). Also fires when a glyph is outside the subset, [font.ts:54-61](../src/lib/ticket/font.ts#L54) |
| Preview route / sample script | `DONE` | [preview/route.ts](../src/app/api/ticket/preview/route.ts), 404s in production at [:82-83](../src/app/api/ticket/preview/route.ts#L82); [scripts/ticket-sample.ts](../scripts/ticket-sample.ts) writes real PNGs |
| **Font reachable in production** | `SCAFFOLD` | **See C-1. The one route that feeds the printer is not in the tracing map.** |

### Phase 5 — CloudPRNT

| Item | Status | Evidence |
|---|---|---|
| All three verbs | `DONE` | POST [:71](../src/app/api/print/[secret]/route.ts#L71), GET [:145](../src/app/api/print/[secret]/route.ts#L145), DELETE [:206](../src/app/api/print/[secret]/route.ts#L206) |
| **Only DELETE marks printed** | `DONE` | [route.ts:246](../src/app/api/print/[secret]/route.ts#L246) → [repository.ts:285-303](../src/lib/orders/repository.ts#L285). GET renders and returns; it never sets `PRINTED`. The `?delete` GET firmware variant routes to the same confirmation [:158-160](../src/app/api/print/[secret]/route.ts#L158) |
| Secret path segment | `DONE` | Constant-time compare [cloudprnt.ts:60-76](../src/lib/print/cloudprnt.ts#L60); returns **404 not 401** [:49-51](../src/app/api/print/[secret]/route.ts#L49); never logged |
| Printer MAC validation | `DONE` | [cloudprnt.ts:145-151](../src/lib/print/cloudprnt.ts#L145) — separator/case-insensitive; unset = accept any (pre-hardware default) |
| Rate limited | `DONE` | `cloudprnt_ip` 120/min [:61-62](../src/app/api/print/[secret]/route.ts#L61) |
| Concurrency-safe claiming | `DONE` | [repository.ts:220-244](../src/lib/orders/repository.ts#L220) — `FOR UPDATE SKIP LOCKED` subselect **plus** the `print_attempts = 0` guard re-evaluated by the outer UPDATE. Two rapid polls cannot get the same job |
| Out of band from submission | `DONE` | `/api/orders` never touches the printer; the row is stored `QUEUED` and the printer pulls. A dead printer cannot fail a customer's order |
| PrintNode remnants | `MISSING` (correct) | None |
| Buzzer | `PARTIAL` | Implemented as response headers [cloudprnt.ts:209-222](../src/lib/print/cloudprnt.ts#L209) — `X-Star-CashDrawer` / `X-Star-Buzzerendpattern`, mode-selected. **Never bench-tested**; an unsupported printer ignores an unknown header rather than failing the job |

Worth recording because it reads like a bug and is not: `PRINTABLE_STATUSES`
is `['QUEUED']` only ([types.ts:59](../src/lib/orders/types.ts#L59)). A job
that trips `PRINT_FAILED` therefore drops out of the claim queue entirely
rather than blocking the head of the line. I traced the stuck-job path
specifically — there is no deadlock.

### Phase 6 — Kitchen screen and alerting

| Item | Status | Evidence |
|---|---|---|
| `/kitchen` exists, server-gated | `DONE` | [page.tsx:20-42](../src/app/kitchen/page.tsx#L20) — auth checked server-side on every request; the client board never decides whether it may render |
| httpOnly + constant-time | `DONE` | [kitchenSession.ts:41-51](../src/lib/auth/kitchenSession.ts#L41) `timingSafeEqual` on both password and HMAC; cookie httpOnly/sameSite=lax/secure-in-prod [:109-118](../src/lib/auth/kitchenSession.ts#L109). Password never in the cookie |
| `noindex` | `DONE` | [layout.tsx:8-16](../src/app/kitchen/layout.tsx#L8) — `index:false, follow:false, nocache:true` + googleBot |
| Polling | `DONE` | **10s** — [KitchenBoard.tsx:22,176](../src/components/kitchen/KitchenBoard.tsx#L22) |
| 接單 / 完成 / 重印 | `DONE` | [api/kitchen/orders/[id]/route.ts:59,84](../src/app/api/kitchen/orders/[id]/route.ts#L59) → `requeueForPrint` / `updateStatus`, both repository calls. Session re-checked at [:29](../src/app/api/kitchen/orders/[id]/route.ts#L29) |
| `PRINT_FAILED` + stale `QUEUED` prominent | `DONE` | [repository.ts:439-441](../src/lib/orders/repository.ts#L439) — `ORDER BY (status='PRINT_FAILED') DESC, (status='QUEUED') DESC, created_at ASC` |
| **Works with no printer at all** | `DONE` — **yes** | Traced: the board's data path is `/api/kitchen/orders` → `listActiveOrders`, which touches nothing print-related. `cloudPrntConfigured()` is passed only as a display prop ([page.tsx:39](../src/app/kitchen/page.tsx#L39)). With `CLOUDPRNT_SECRET` unset, orders still arrive and are still actionable |
| Unprinted-order SMS alert | `DONE` | [cron/unprinted-alert/route.ts](../src/app/api/cron/unprinted-alert/route.ts) |
| Cron entry | `DONE` | [vercel.json](../vercel.json) — `/api/cron/unprinted-alert`, `* * * * *`. See **M-3** |
| `alerted_at` fires once | `DONE` | [repository.ts:353-363](../src/lib/orders/repository.ts#L353) — conditional `UPDATE … WHERE alerted_at IS NULL`, claimed before sending |
| Threshold | `DONE` | **120 seconds** — [route.ts:31](../src/app/api/cron/unprinted-alert/route.ts#L31) |

### Phase 7 — Config, multi-tenancy, deploy

| Item | Status | Evidence |
|---|---|---|
| Env vars documented | `PARTIAL` | See mismatch list below |
| `.env*` gitignored | `DONE` | [.gitignore:29](../.gitignore#L29). No env file was ever committed except `.env.example` |
| Ordering-engine hardcodes | `DONE` (clean) | Everything flows from env or `restaurant.ts` |
| Marketing-site hardcodes | `PARTIAL` | Listed below |
| Vercel compatibility | `DONE` | No edge routes, no runtime filesystem writes (only build scripts write), native modules externalized [next.config.ts:15](../next.config.ts#L15) |
| `vercel.json` cron | `DONE` | Present |

**Env mismatch, both directions.**

In `.env.example` but **never read by any code** — both misleading, because
they imply a Supabase-client access path that does not exist:

- `SUPABASE_URL` — [.env.example:63](../.env.example#L63)
- `SUPABASE_SERVICE_ROLE_KEY` — [.env.example:64](../.env.example#L64)

Read by code but **not in `.env.example`**:

- `TENANT_TIMEZONE` — accepted as an alias at [tenant.server.ts:160](../src/config/tenant.server.ts#L160), undocumented

(`TAX_RATE`, `ONLINE_ORDERING_HOURS`, `DATABASE_POOL_MAX` are all present as
commented-out lines at `.env.example:29, 45, 59` — correctly documented.)

Also stale: `.env.local` carries `REVALIDATE_SECRET` for `/api/revalidate-menu`,
a route that no longer exists.

**Hardcodes.** The ordering engine is genuinely clean. The marketing site is not:

| Value | Location |
|---|---|
| Name, address, phone | [layout.tsx:32-36](../src/app/layout.tsx#L32) |
| Name + 富源 | [opengraph-image.tsx:8](../src/app/opengraph-image.tsx#L8) |
| Name | [order/page.tsx:9](../src/app/order/page.tsx#L9) |
| Name + "Telegraph Canyon" prose | [page.tsx:182, 236](../src/app/page.tsx#L182) |
| Address | [images.ts:52-53](../src/data/images.ts#L52) |
| ~~Tax 775 bps~~ + `America/Los_Angeles` | [ticket/preview/route.ts](../src/app/api/ticket/preview/route.ts) — the hardcoded rate is GONE; the fixture now takes `tenant.taxRateBps`. The timezone default remains, dev-only, acceptable |
| Timezone default | [tenant.server.ts:160](../src/config/tenant.server.ts#L160) — a fallback, not a hardcode |
| Hours | [restaurant.ts:84](../src/data/restaurant.ts#L84) — read by `tenant.server.ts` and `pickup.ts`, not env-overridable |

**How much work is tenant #2?** About a day for the ordering engine (new env
set, new `menu.ts`, lift `restaurant.ts` hours into tenant config); a week or
more for the marketing site, which is built around this restaurant's brand,
seal, and choreography.

---

## 3. Critical findings

### C-1 — CRITICAL: the printer route cannot load its font in production

[next.config.ts:20-26](../next.config.ts#L20) traces `public/fonts/**` into
four routes. Three calls to `renderTicket()` exist in the app:

| Route | Renders? | Traced? |
|---|---|---|
| `/api/kitchen/orders/[id]/ticket` | yes | ✅ |
| `/api/ticket/preview` | yes | ✅ |
| **`/api/print/[secret]`** | **yes** ([:184](../src/app/api/print/[secret]/route.ts#L184)) | ❌ **missing** |
| `/api/checkout` | route does not exist | listed anyway (dead) |
| `/api/kitchen/orders/[id]` | no | listed anyway (unnecessary) |

The tracing map was written for the Clover-era route layout and never updated
when CloudPRNT was added. The one route whose entire purpose is to feed the
printer is the one route whose font is not traced.

**Failure mode.** On Vercel, `loadTicketFonts()` throws `ENOENT`
([font.ts:32-34](../src/lib/ticket/font.ts#L32)). The GET handler catches it at
[:194-201](../src/app/api/print/[secret]/route.ts#L194), calls
`recordPrintAttempt({ ok: false })`, and returns 500. **Every order becomes
`PRINT_FAILED`. No ticket ever prints.** It works perfectly in local dev, so
this surfaces for the first time in production — exactly the scenario the
comment at [next.config.ts:18-24](../next.config.ts#L18) warns about.

Mitigating: the kitchen board and the SMS alert both still work, so orders are
not lost — they are just never printed. **Fix is one line.**

### H-1 — HIGH: the OTP token is signed with the kitchen password

[session.ts:38-40](../src/lib/otp/session.ts#L38) uses `ADMIN_DASH_PASSWORD`
as the HMAC key for the proof-of-phone token. That password is also the
`/kitchen` login credential — a human-typed, human-memorable, staff-shared
value.

Anyone who learns it (a staff member who leaves, a shoulder-surfed tablet, a
successful guess against [kitchenSession.ts:69-76](../src/lib/auth/kitchenSession.ts#L69),
whose only brute-force defence is a ~400 ms delay) can forge
`nmc_phone` cookies for arbitrary numbers and bypass OTP entirely — placing
unlimited orders against phone numbers they do not control, which is precisely
the abuse the OTP exists to stop.

The file's own TODO flags the rotation coupling but not the entropy problem.
Fix: a dedicated `OTP_SIGNING_SECRET` (long random value). Nothing else changes.

### M-2 — MEDIUM: a failed alert SMS is consumed, not retried

[cron/unprinted-alert/route.ts:106-121](../src/app/api/cron/unprinted-alert/route.ts#L106)
claims the alert with `markAlerted()` **before** calling `sendSms()`. If the
send then fails — Twilio outage, bad `OWNER_ALERT_PHONE`, carrier rejection —
`alerted_at` is already stamped, so `findUnprintedForAlert` never returns that
order again. The error is logged and the owner is never told.

The claim-before-send ordering is correct for preventing duplicate texts across
overlapping cron runs; the gap is that there is no compensating clear. Clearing
`alerted_at` when `result.sent` is false restores the retry without
reintroducing duplicates. Note this is a *different* case from the
unconfigured-SMS path, which the code already handles correctly by returning
early at [:92-99](../src/app/api/cron/unprinted-alert/route.ts#L92).

### M-3 — MEDIUM: the cron schedule may require a paid Vercel plan

[vercel.json](../vercel.json) requests `* * * * *` (every minute). Vercel's
Hobby tier permits cron invocations at most **once per day**. On Hobby the
deploy either rejects the schedule or silently degrades it, and the 2-minute
unprinted-order threshold becomes meaningless — the highest-value safety net in
the system would quietly not exist. Confirm the account tier before go-live.

### L-4 — LOW: dead dependency and a stale pointer

`@supabase/supabase-js` is in `package.json` but **imported nowhere**. Database
access is `pg` against `DATABASE_URL` throughout.
[postgres.ts:8](../src/lib/db/postgres.ts#L8) points at
`src/lib/db/supabase.ts`, which does not exist, and lines 15-17 describe a menu
snapshot that no longer exists either. Harmless at runtime; actively misleading
to the next reader, and the source of the two orphan `SUPABASE_*` env entries.

**No other critical findings.** Specifically checked and clean: no card
collection anywhere; no client-supplied verification flag; no client-side
database or key access; no silent-loss path in the print pipeline (GET never
marks printed); no duplicate-order path (unique index, not an if-statement); no
read-then-write on the order counter; no UTC business date; no floats in the
orders path; no committed secrets.

---

## 4. Ordered work plan

Each step leaves the app working. 🖨️ marks what blocks a first real printed ticket.

**Before the printer arrives**

| # | Work | Est. | |
|---|---|---|---|
| 1 | Add `"/api/print/[secret]": ["./public/fonts/**"]` to `outputFileTracingIncludes`; delete the dead `/api/checkout` entry and the unnecessary `/api/kitchen/orders/[id]` one | 5 min | 🖨️ **C-1** |
| 2 | Apply `schema.sql` to the Supabase project | 15 min | 🖨️ |
| 3 | Set `DATABASE_URL` (**pooler endpoint, port 6543**), `ADMIN_DASH_PASSWORD`, `CLOUDPRNT_SECRET`, `TENANT_TAX_RATE_BPS` in Vercel | 20 min | 🖨️ |
| 4 | Confirm the Vercel plan allows minute-level cron; if Hobby, upgrade or move the sweep elsewhere | 15 min | **M-3** |
| 5 | Introduce `OTP_SIGNING_SECRET`, document it, stop reusing the kitchen password | 30 min | **H-1** |
| 6 | Clear `alerted_at` when the alert SMS fails to send | 30 min | **M-2** |
| 7 | Remove `@supabase/supabase-js`; delete the two orphan `SUPABASE_*` lines from `.env.example`; document `TENANT_TIMEZONE`; fix the stale comment at `postgres.ts:8-17`; drop the dead `REVALIDATE_SECRET` from `.env.local` | 30 min | **L-4** |
| 8 | Twilio: create the Verify service, set the four `TWILIO_*` vars, place one real end-to-end test order | 1 h | 🖨️ |
| 9 | Deploy and run `/api/ticket/preview` against production… it 404s by design, so instead place a test order and confirm the PNG renders via `/api/kitchen/orders/[id]/ticket` — **this is what proves C-1 is fixed** | 30 min | 🖨️ |

**When the printer arrives**

| # | Work | Est. | |
|---|---|---|---|
| 10 | Configure the printer's CloudPRNT URL; confirm a real ticket | 1 h | 🖨️ |
| 11 | Pin `CLOUDPRNT_PRINTER_MAC` once the MAC is known | 10 min | |
| 12 | Bench-test the buzzer: `CLOUDPRNT_BUZZER=drawer` first, then `buzzer` | 30 min | |

**Content and data — owner-dependent, not code-blocked**

| # | Work | Est. |
|---|---|---|
| 13 | Verify the 12 party-tray prices against the printed menu, or remove the file so everything sells single-size | 1 h |
| 14 | Replace the three `[PASTE REAL GOOGLE REVIEW]` placeholders — **these ship visible today** | 30 min |
| 15 | Add menu photography — 12 of 12 slots are currently `src: null` | ongoing |
| 16 | Family review of size/modifier 中文 (`menu-overrides.ts:168-207`) before first service | 1 h |
| 17 | Expand 中文 from 34 to 138 items, re-running `npm run build:ticket-font` after each batch | ongoing |
| 18 | Add `Restaurant` + `Menu` JSON-LD | 2 h |

---

## 5. Blocked on you

**Needed to develop**

- Nothing. The app builds and runs against the embedded dev database today
  (`npm run dev:db`). Every item in §4 steps 1, 5, 6, 7 is code I can do now.

**Needed to go live**

| Item | Why |
|---|---|
| Supabase project URL + pooler connection string | `DATABASE_URL`. Must be the **pooler** (6543), not direct 5432 |
| Twilio Account SID, Auth Token, Verify Service SID | OTP is mandatory to place an order |
| Twilio sending number or Messaging Service SID | `TWILIO_MESSAGING_FROM` — order-ready and owner-alert texts |
| Owner's mobile number | `OWNER_ALERT_PHONE` — the unprinted-order safety net |
| **Chula Vista sales-tax rate** | `TENANT_TAX_RATE_BPS`. Currently null, and the order route **refuses to quote** rather than guess ([orders/route.ts:107-110](../src/app/api/orders/route.ts#L107)) |
| Kitchen board password | `ADMIN_DASH_PASSWORD` |
| Vercel plan confirmation | Minute-level cron — see **M-3** |
| **Decision:** online-ordering cutoff before close | Defaults to 30 min on a guess ([tenant.server.ts:110](../src/config/tenant.server.ts#L110)) |
| **Decision:** orders per phone per day | Defaults to 5 on a guess ([tenant.server.ts:201](../src/config/tenant.server.ts#L201)) |
| **Decision:** is the buzzer on the cash-drawer port or a dedicated terminal? | Picks `drawer` vs `buzzer` |
| **Decision:** do you need to know *which* staff member tapped 完成? | If yes, the shared password needs to become real accounts |
| Party-tray prices from the printed menu | 12 unverified estimates ([party-trays.ts:37](../src/data/party-trays.ts#L37)) |
| Three real Google review quotes | Placeholders are live on the homepage |

---

## 6. Hardware readiness

Shortest path from a boxed Star TSP143IVUE to a Chinese ticket:

1. **Fix C-1 first.** Without it the printer will poll a healthy-looking server
   forever and every order will land in `PRINT_FAILED`. Five-minute edit;
   everything below assumes it is done and deployed.
2. Unbox, load paper, connect Ethernet, power on. Hold FEED while powering on
   to print the self-test — record the **IP**, **MAC**, and **firmware version**
   (the buzzer headers need TSP100IV 1.0+).
3. Browse to the printer's IP → CloudPRNT settings. Set the server URL to
   `https://<your-domain>/api/print/<CLOUDPRNT_SECRET>`, polling interval 5–10 s.
   Leave the CloudPRNT account fields blank — this server authenticates by the
   secret path segment, not HTTP auth.
4. Save and reboot the printer. Watch the Vercel function log: POSTs to
   `/api/print/...` should appear at the polling interval, each answering
   `{"jobReady":false}`.
5. Set `CLOUDPRNT_PRINTER_MAC` to the MAC from step 2 and redeploy. Confirm the
   polls still succeed — a typo shows up here as a silent `NO_JOB`, so verify
   before moving on.
6. Place a real order through the site (this needs Twilio live). Expect within
   one poll: paper out, 中文 primary with English underneath, order number,
   pickup time, `⚠ EN` on items lacking a translation, and **COLLECT PAYMENT**
   at the foot.
7. Confirm the order flips to `PRINTED` on `/kitchen`. If it stays `QUEUED`,
   the printer is fetching but not confirming — check that DELETE is reaching
   the server.
8. Buzzer: set `CLOUDPRNT_BUZZER=drawer`, redeploy, print again. No sound → try
   `buzzer`. Still nothing → the firmware predates header support.
9. Failure drill, and do not skip it: pull the printer's network cable, place an
   order, confirm it appears on `/kitchen` within 10 s and that the owner's
   phone buzzes about 2 minutes later. That is the safety net the whole design
   rests on, and it is the one thing you cannot test after go-live.

---

## 7. Site data integrity

| Check | Result |
|---|---|
| Placeholder address/phone | **Clean.** Real values throughout, single source at [restaurant.ts:72-82](../src/data/restaurant.ts#L72) |
| `[PASTE REAL GOOGLE REVIEW]` | **Still present — 3 of 3**, [reviews.ts:19, 24, 29](../src/data/reviews.ts#L19). Ship visible by design ([:4-6](../src/data/reviews.ts#L4)) |
| Menu photos | **12 of 12 are `src: null`.** Zero real images ([images.ts](../src/data/images.ts)). The designed placeholder panel renders instead, so this degrades gracefully |
| 富源 consistency | **Consistent.** Used uniformly across seal, OG image, favicon, hero. `chineseName` defined once at [restaurant.ts:73](../src/data/restaurant.ts#L73) and marked verified |
| `Restaurant` / `Menu` JSON-LD | **ABSENT.** No `application/ld+json`, no `schema.org` reference anywhere in `src/app/` or `src/components/`. A local restaurant with no `Restaurant` schema is leaving the knowledge panel, hours, and address on the table |
| Hours single source of truth | **Yes.** [restaurant.ts:84](../src/data/restaurant.ts#L84) `restaurant.hours`, consumed by `HoursTable`, `Footer`, `lib/hours.ts` (`OpenNowChip`), and derived into ordering windows by [tenant.server.ts:112-121](../src/config/tenant.server.ts#L112). No second copy |

---

## 8. Where the prompt was wrong

The brief was written expecting an audit that might find the migration
un-run. It has been run, and the resulting code is in better shape than the
prompt anticipates — the questions about card-collection UI, `PENDING_PAYMENT`
states, filesystem order stores, client-supplied `phoneVerified` booleans, and
`GET`-marks-printed all come back clean.

The brief also asks for a menu count and warns about anything "meaningfully
below ~126". It is 138 and intact. Note the shape of the file if you count it
yourself: 70 items are written as multi-line objects and 68 as single-line
ones, so grepping `^\s+id:` finds only 70 and understates it by half. I made
exactly that mistake mid-audit before catching it.

`docs/BUILD_STATUS.md` held up well against the code. Its two inaccuracies are
minor: it says party-trays covers "10 dishes" where the file has 12
([party-trays.ts:11 vs :37-54](../src/data/party-trays.ts#L11)), and it lists
the buzzer as `SHIPPED — needs bench test`, which is fairer read as `PARTIAL`.
Its claim of "40/40 assertions passing" I did not re-run — this audit was
read-only, and that number is the one thing here still resting on the document
rather than on the code.
