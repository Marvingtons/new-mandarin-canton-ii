# Clover Path B — Build Audit

Originally a read-only audit of `main` @ `783491a` (2026-07-27).
**Updated 2026-07-27 after the durable-orders / kitchen-ticket / `/kitchen`
build.** Rows changed by that work are marked ✅ **NEW**.

Repo identity confirmed: `src/data/restaurant.ts:71-92` —
"New Mandarin Canton II", 富源, 543 Telegraph Canyon Rd, Chula Vista CA 91910,
(619) 656-6888. This is the right directory.

---

## 1. Verdict

**Shippable the moment a Clover sandbox token exists. Everything that is not
a credential is now built and verified.**

The original audit found three real gaps: ephemeral JSON order storage, no
Phase 3 at all, and no rate limiting. All three are closed. Orders live in
Postgres behind a unique index that makes a double-charge structurally
impossible; the kitchen ticket renders as a Chinese-primary 80mm bitmap with an
embedded subset font; `/kitchen` is a password-protected polling board that
works with no printer attached; `/api/checkout` is throttled per IP.

The correctness claims are not assertions — `npm run verify:orders` proves them
against a real Postgres (24/24 checks, including 50 concurrent allocations
yielding `A-001…A-050` with no gaps and no duplicates).

What still blocks a live transaction is exactly what blocked it before and
nothing else: **the four Clover env values are still blank**. No code change
stands between here and a sandbox charge.

---

## 2. Status table

### Phase 1 — Clover integration layer

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Typed fetch wrapper | `SHIPPED` | [client.ts:103](../src/lib/clover/client.ts#L103) `cloverFetch<T>` |
| 1a | `CLOVER_ENV` sandbox/production switch | `SHIPPED` | [env.ts:26-39](../src/lib/clover/env.ts#L26); `cloverEnv()` [tenant.server.ts:181](../src/config/tenant.server.ts#L181) |
| 1b | Auth headers | `SHIPPED` | [client.ts:117-124](../src/lib/clover/client.ts#L117) — bearer only in headers, never URL/log |
| 1c | Typed errors | `SHIPPED` | `CloverApiError` [client.ts:27-57](../src/lib/clover/client.ts#L27), incl. the 401-means-two-things note |
| 1d | Retry/backoff on 429/5xx | `SHIPPED` | [client.ts:79](../src/lib/clover/client.ts#L79), [:183-193](../src/lib/clover/client.ts#L183) — honors `Retry-After`; charges opt out with `maxAttempts: 1` ([charges.ts:54](../src/lib/clover/charges.ts#L54)) |
| 2 | `GET /v3/…/categories\|items\|modifier_groups` | `SHIPPED` (never executed) | [inventory.ts:75-95](../src/lib/clover/inventory.ts#L75) |
| 2a | Pagination | `SHIPPED` | [inventory.ts:39-63](../src/lib/clover/inventory.ts#L39) — offset/limit walk, 1000/page, top-level modifier_groups to dodge Clover's 100-element nested cap |
| 2b | Clover → local `MenuItem` mapper | `SHIPPED` | [normalize.ts:92-181](../src/lib/menu/normalize.ts#L92); drops VARIABLE/PER_UNIT so nothing unpriceable is orderable ([:75-83](../src/lib/menu/normalize.ts#L75)) |
| 2c | Caching / revalidate | `SHIPPED` | `unstable_cache`, 300s, tag `menu` [source.ts:98-101](../src/lib/menu/source.ts#L98); bust route [api/revalidate-menu/route.ts:33](../src/app/api/revalidate-menu/route.ts#L33) with `timingSafeEqual` |
| 2d | Size/party-tray variants on the Clover path | `PARTIAL` | Blocking TODO [source.ts:51-56](../src/lib/menu/source.ts#L51) — Clover path emits ONE price per item; every party tray is lost the moment `MENU_SOURCE=clover` |
| 3 | `getMenu()` seam | `SHIPPED` | [source.ts:98](../src/lib/menu/source.ts#L98). Live→snapshot→seed fallback chain [:44-85](../src/lib/menu/source.ts#L44). `/order` reads it ([order/page.tsx:18](../src/app/order/page.tsx#L18)) |
| 3a | What the **marketing** `/menu` page reads | `PARTIAL` (divergent) | [menu/page.tsx:6](../src/app/menu/page.tsx#L6) reads the static `src/data/menu.ts` (68 items), NOT `getMenu()`. Two menus, two price sets, and a `// TODO: current items are examples` at [menu/page.tsx:20](../src/app/menu/page.tsx#L20) |
| 4 | Seed menu file | `SHIPPED` (thin) | [seed-menu.ts:82-184](../src/data/seed-menu.ts#L82) — **16 items** across 6 categories |
| 4a | Individual + party-tray prices | `SHIPPED` | `tiers()` [seed-menu.ts:65-75](../src/data/seed-menu.ts#L65); 10 of 16 items carry both tiers. Serving counts flagged `TODO(confirm)` [:72](../src/data/seed-menu.ts#L72) |
| 4b | `nameZh` in the seed menu | `MISSING` | Hardcoded `nameZh: null` [seed-menu.ts:34](../src/data/seed-menu.ts#L34). The seed path never touches `menu-overrides.ts`, so the ordering menu is 100% English today |
| 4c | Lunch-special "no soup for to-go" rule | `MISSING` from the ordering path | The rule exists **only** as marketing prose: [menu.ts:619](../src/data/menu.ts#L619). No lunch specials exist in `seed-menu.ts` and no code enforces it |
| 5 | `menu-overrides` ID map | `SCAFFOLD` | [menu-overrides.ts:55](../src/data/menu-overrides.ts#L55) — `= {}`, empty, with an example ID in the comment. Fills in only after a first real sync |
| 5a | `menu-overrides` name-keyed map | `SHIPPED` (unreachable today) | 40 real 中文 entries [menu-overrides.ts:58-104](../src/data/menu-overrides.ts#L58) + 10 category names [:116-127](../src/data/menu-overrides.ts#L116). Consumed only by `normalize.ts:121` — i.e. only on the Clover path, which has never run |

### Phase 2 — Cart and checkout

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Cart state | `SHIPPED` | React context + `useReducer`, [CartContext.tsx:122-211](../src/lib/cart/CartContext.tsx#L122). Persisted to **sessionStorage** (`nmc-cart-v1`, [:41](../src/lib/cart/CartContext.tsx#L41)), hydration-safe rehydrate at [:134-150](../src/lib/cart/CartContext.tsx#L134) |
| 1a | Quantities / modifiers / notes | `SHIPPED` | Lines store IDs only, never prices ([:21-28](../src/lib/cart/CartContext.tsx#L21)); identical configs merge via `lineSignature` [:44-53](../src/lib/cart/CartContext.tsx#L44). UI: [ItemSheet.tsx](../src/components/order/ItemSheet.tsx) — size radio, min/max-enforced modifier groups [:70-88](../src/components/order/ItemSheet.tsx#L70), 200-char instructions [:227-240](../src/components/order/ItemSheet.tsx#L227) |
| 1b | Pickup-time selection | `SHIPPED` (lives at checkout, not in cart) | [Checkout.tsx:61-70](../src/components/order/Checkout.tsx#L61), slots recomputed every 60s |
| 2 | `/order` today | `SHIPPED` — a real cart | [order/page.tsx](../src/app/order/page.tsx) → [OrderMenu.tsx](../src/components/order/OrderMenu.tsx): category nav, item grid, item sheet, drawer, mobile sticky bar. The site-wide CTA routes here via `orderTarget()` ([data/order.ts:38-43](../src/data/order.ts#L38)). `tel:` survives only as a *secondary* button ([StickyOrderBar.tsx:16](../src/components/StickyOrderBar.tsx#L16)) and as the payment-unavailable fallback ([CloverPayment.tsx:182](../src/components/order/CloverPayment.tsx#L182)) |
| 3 | `POST /api/checkout` exists | `SHIPPED` | [api/checkout/route.ts:71](../src/app/api/checkout/route.ts#L71), `runtime = "nodejs"` |
| 3a | Payload validated | `SHIPPED` | zod `.strict()` on both line and body schemas [route.ts:35-59](../src/app/api/checkout/route.ts#L35) — a stray `price`/`total` is a hard 400 |
| 3b | Server-side price recompute | `SHIPPED` — **client total is never trusted** | [route.ts:103-138](../src/app/api/checkout/route.ts#L103) rebuilds every line from `getMenu()` via the shared pure `resolveLinePrice` ([pricing.ts:20](../src/lib/cart/pricing.ts#L20)); unknown size/modifier throws. Client sends IDs + quantities only ([Checkout.tsx:111-117](../src/components/order/Checkout.tsx#L111)). **No security finding here.** |
| 3c | Tax | `SHIPPED`, value `UNCONFIRMED` | [route.ts:137](../src/app/api/checkout/route.ts#L137) `taxCents()`; refuses to charge (503) when unset [:83-86](../src/app/api/checkout/route.ts#L83). Rate is `775` bps (7.75%) in `.env.local` and `.env.example:48`, both carrying `TODO(confirm): verify the Chula Vista rate` |
| 3d | Idempotency key | `SHIPPED` | Client mints & reuses a UUID across retries [Checkout.tsx:99-104](../src/components/order/Checkout.tsx#L99); server replays the original result [route.ts:144-154](../src/app/api/checkout/route.ts#L144); re-checked inside the store lock [store.ts:95](../src/lib/order/store.ts#L95); also forwarded to Clover [charges.ts:44](../src/lib/clover/charges.ts#L44) |
| 3e | Rate limiting | ✅ **NEW** `SHIPPED` | Per-IP sliding window, [rateLimit.ts:63](../src/lib/http/rateLimit.ts#L63), applied as the FIRST statement of the route ([route.ts:78](../src/app/api/checkout/route.ts#L78)) so a blocked request never reaches Clover. Checkout 10/5min, tokenize 20/min ([:43-46](../src/lib/http/rateLimit.ts#L43)). Verified live: requests 1–10 → 400, 11–12 → 429 with `retry-after: 300` and a bilingual body |
| 4 | Clover hosted iframe SDK | `SHIPPED` | [CloverPayment.tsx:74-102](../src/components/order/CloverPayment.tsx#L74) loads `sdk.js`, [:126-134](../src/components/order/CloverPayment.tsx#L126) mounts CARD_NUMBER / CARD_DATE / CARD_CVV / CARD_POSTAL_CODE, [:150-165](../src/components/order/CloverPayment.tsx#L150) `createToken()`. SDK URL is env-switched [tenant.server.ts:212-216](../src/config/tenant.server.ts#L212) |
| 4a | Hand-rolled card form | **NOT PRESENT — no critical finding** | The only `<input>`s in the checkout flow are name, phone, and pickup time ([Checkout.tsx:194-231](../src/components/order/Checkout.tsx#L194)). No PAN/CVV/expiry input exists in our DOM |
| 5 | `POST /v1/charges` | `SHIPPED` | [charges.ts:31-55](../src/lib/clover/charges.ts#L31) — cents, `clv_` source, `ecomind: "ecom"`, `X-Forwarded-For`, metadata (order #, name, phone, pickup time) |
| 6 | **Has a sandbox transaction ever succeeded?** | **NO** | Three independent proofs: (a) `CLOVER_MERCHANT_ID`, `CLOVER_PRIVATE_TOKEN`, `NEXT_PUBLIC_CLOVER_PUBLIC_TOKEN`, `CLOVER_INVENTORY_TOKEN` are all **empty** in `.env.local`; (b) with a null public token or MID, `CloverPayment` short-circuits to its error branch and never mounts a field ([:112-118](../src/components/order/CloverPayment.tsx#L112)) — `tokenize()` is unreachable; (c) `.data/orders.json` does not exist, so `store.create()` has never run |
| 7 | Order persistence | ✅ **NEW** `SHIPPED` | Postgres via [repository.ts](../src/lib/orders/repository.ts). `src/lib/order/store.ts` is **deleted**. Reservation happens BEFORE the charge ([repository.ts:141](../src/lib/orders/repository.ts#L141)), so the unique index protects the charge call rather than merely recording it afterwards |
| 7a | Orders table in the DB | ✅ **NEW** `SHIPPED` | `orders` + `order_counters` in [schema.sql:34-129](../src/lib/db/schema.sql#L34), with a status check constraint, `orders_idempotency_uniq`, `orders_number_uniq`, and `orders_kitchen_idx`. Every row is `tenant_id`-scoped. Uses a direct `pg` pool ([postgres.ts](../src/lib/db/postgres.ts)) because `ON CONFLICT … RETURNING` and a transaction whose ROLLBACK un-burns a counter cannot be expressed through PostgREST; `supabase.ts` still owns the menu snapshot, unchanged |
| 7b | Daily `A-017` sequence | ✅ **NEW** `SHIPPED` | One atomic UPSERT against `order_counters` ([repository.ts:110](../src/lib/orders/repository.ts#L110)); its row lock serializes concurrent checkouts. Business date resolved in the tenant timezone ([businessDate.ts:57](../src/lib/orders/businessDate.ts#L57)), so a 23:30 order stays on today's sequence. Verified: 50 concurrent → `A-001…A-050`, no gaps, no duplicates |
| 8 | Confirmation screen | `SHIPPED` — real data | [order/confirmation/page.tsx](../src/app/order/confirmation/page.tsx) renders the actual order number, pickup label, total and Clover charge id handed over via sessionStorage ([Checkout.tsx:137-149](../src/components/order/Checkout.tsx#L137)). No placeholders |

### Phase 3 — Kitchen ticket and order screen

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | 80mm ticket renderer (PNG) | ✅ **NEW** `SHIPPED` | satori → resvg, 576px (80mm @ 203dpi), variable height: [render.tsx:243](../src/lib/ticket/render.tsx#L243). **Image, not raw text** — the CJK code-page lottery is why ([:12-27](../src/lib/ticket/render.tsx#L12)). Chinese-primary: 中文 at 40px, English cross-check at 21px, pure black on white, every rule ≥3px. Verified rendering at 576×1623px |
| 2 | Noto Sans TC embedded as a font buffer | ✅ **NEW** `SHIPPED` | `public/fonts/NotoSansTC-Ticket-{Regular,Bold}.ttf`, subset by [build-ticket-font.ts](../scripts/build-ticket-font.ts) from 11.39 MB to **189.7 KB total** (214 glyphs, two static weight instances — variable axes pinned, since satori renders only a variable font's default instance). Traced into the lambda via `outputFileTracingIncludes` ([next.config.ts:19](../next.config.ts#L19)) — being under `public/` makes a file *served*, not *readable* |
| 3 | PrintNode integration | ✅ **NEW** `SHIPPED` | [printnode.ts:73](../src/lib/print/printnode.ts#L73), behind `PRINTNODE_API_KEY` + `PRINTNODE_PRINTER_ID`; unset = a no-op that logs. 3 attempts, exponential backoff, retry only on 429/5xx. On final failure the order becomes `PRINT_FAILED` with `last_print_error` and an incremented `print_attempts` ([dispatch.ts:60](../src/lib/print/dispatch.ts#L60)). PrintNode has no PNG content type, so the bitmap is encoded as ESC/POS `GS v 0` raster ([escpos.ts:71](../src/lib/print/escpos.ts#L71)) — still a bitmap, still no code page involved |
| 4 | `/kitchen` screen | ✅ **NEW** `SHIPPED` | [page.tsx](../src/app/kitchen/page.tsx) + [KitchenBoard.tsx](../src/components/kitchen/KitchenBoard.tsx). httpOnly cookie session, HMAC-signed, constant-time compare, password never in the cookie or a URL ([kitchenSession.ts](../src/lib/auth/kitchenSession.ts)); `noindex` ([layout.tsx:10](../src/app/kitchen/layout.tsx#L10)). Polls every 10s; 接單 / 完成 / 重印 plus an inline view of the exact printer bitmap; `PRINT_FAILED` sorts to the top under an unmissable banner; today-by-default with a 全部 toggle; chime + mute persisted to localStorage. Verified end to end against a live database |

### Phase 4 — Config, security, multi-tenancy

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Env vars **referenced but undocumented** in `.env.example` | ✅ **NEW** `SHIPPED` | All four gaps documented: `TIP_PRESETS`, `ONLINE_ORDERING_HOURS`, `NEXT_PUBLIC_ORDER_MODE`, `NEXT_PUBLIC_CLOVER_ORDERING_URL`. Added alongside them: `DATABASE_URL`, `DATABASE_POOL_MAX`, `PRINTNODE_API_KEY`, `PRINTNODE_PRINTER_ID`, `ADMIN_DASH_PASSWORD` |
| 1a | Env vars documented but unused | none | Every var in `.env.example` is read by `tenant.server.ts`, `source.ts`, `supabase.ts`, `postgres.ts`, `printnode.ts`, or `kitchenSession.ts` |
| 2 | Private token reachable from the client | **NO — clean** | `requirePrivateToken()` is called from exactly two server modules ([charges.ts:34](../src/lib/clover/charges.ts#L34), [route.ts:159](../src/app/api/checkout/route.ts#L159)). `tenant.server.ts:1` is `import "server-only"`, so a client import would fail the build. Its only page-level importers are server components |
| 2a | Wrongly-`NEXT_PUBLIC_` secrets | **NO — clean** | Only `NEXT_PUBLIC_CLOVER_PUBLIC_TOKEN` (the PAKMS key, correct) plus the two non-secret ordering-mode vars. Nothing added by this build is public: `DATABASE_URL`, `PRINTNODE_API_KEY` and `ADMIN_DASH_PASSWORD` are all read only from `server-only` modules |
| 2b | Secret ever committed to git | **NO — clean** | A full-history scan for `sk_*`/`pk_*`/13-char Clover ids surfaced exactly one string, `9J1F7WW503CZW`, the illustrative item ID in a comment ([menu-overrides.ts:53](../src/data/menu-overrides.ts#L53)). **No rotation needed.** |
| 2c | `.env*` gitignored | `SHIPPED` | [.gitignore:32](../.gitignore#L32). `.data/` is also still ignored, and now holds the local dev Postgres cluster |
| 3 | Token **type** (Hosted iFrame + API/SDK vs plain API) | `UNKNOWN` — repo cannot tell you | Documented as a requirement ([.env.example:16-18](../.env.example#L16)) but no token was ever issued, so nothing records which type you hold. **Check the Clover dashboard.** |
| 4 | Pointed at production Clover? | **NO** | `CLOVER_ENV=sandbox`. Production hosts exist in the map ([env.ts:31-34](../src/lib/clover/env.ts#L31)) but need an explicit `CLOVER_ENV=production`. Untouched by this build |
| 5 | Multi-tenancy — config layer | `SHIPPED`, extended | [tenant.server.ts](../src/config/tenant.server.ts) unchanged. ✅ **NEW**: `orders` and `order_counters` are `tenant_id`-scoped, every repository function takes `tenantId` as its first argument, and the kitchen action route scopes by tenant so a guessed order id cannot cross tenants ([[id]/route.ts:46](../src/app/api/kitchen/orders/[id]/route.ts#L46)). Printer id is per-tenant env |
| 5a | Multi-tenancy — hardcodes in business logic | `PARTIAL` (unchanged) | **Hours are still not tenant-config**: [pickup.ts:80](../src/lib/order/pickup.ts#L80) and [tenant.server.ts:114](../src/config/tenant.server.ts#L114) import `restaurant.ts` directly. Nothing new was added — no restaurant name, phone, address, tax rate, timezone or printer id appears in the schema, the repository, the ticket renderer, or the print path |
| 5b | Multi-tenancy — hardcodes in components/pages | `PARTIAL`, two fixed | ✅ **NEW**: the two ordering-UI address literals now read from the data file — [Checkout.tsx:182](../src/components/order/Checkout.tsx#L182) and [OrderMenu.tsx:46](../src/components/order/OrderMenu.tsx#L46) use `restaurant.address.street`. Still hardcoded (marketing surfaces, out of scope here): [layout.tsx:32-36](../src/app/layout.tsx#L32), [opengraph-image.tsx:8](../src/app/opengraph-image.tsx#L8), [page.tsx:182](../src/app/page.tsx#L182), [page.tsx:236](../src/app/page.tsx#L236), [HeroVideo.tsx:245](../src/components/HeroVideo.tsx#L245), [order/page.tsx:9](../src/app/order/page.tsx#L9), plus the 富源 visual identity |

**Blunt answer on tenant #2:** the *ordering engine* is now genuinely portable —
schema, repository, ticket, printing and the board are all tenant-scoped, so it
is about **1 day**: a new env set, new seed data, and lifting hours out of
`restaurant.ts` into `PublicTenantConfig`. The *site* is still not: brand, seal,
copy and the GSAP choreography are built around 富源, so a visually distinct
tenant #2 remains **1 week+**.

---

## 3. Critical findings

**No CRITICAL security findings.** Specifically checked and clean:

- No hand-rolled card collection. Card data is entered only in Clover's
  cross-origin iframes ([CloverPayment.tsx:126-134](../src/components/order/CloverPayment.tsx#L126)).
- No client-supplied prices. Verified live: a line carrying `"price": 1` is
  rejected 400 by `.strict()`.
- No leaked secret, in the bundle or in git history.
- Nothing points at production Clover.
- `/kitchen` and all three kitchen APIs reject unauthenticated and
  forged-cookie requests (verified: 401 on all four).

### Resolved by this build

1. ~~**HIGH — order storage cannot survive deployment.**~~ **FIXED.** Postgres,
   with `orders_idempotency_uniq` as the guarantee. The reservation is written
   *before* the charge, so a duplicate submit loses the insert and never
   reaches Clover.
2. ~~**MEDIUM — order-number race.**~~ **FIXED.** One atomic UPSERT; verified
   with 50 concurrent allocations producing `A-001…A-050`.
3. ~~**MEDIUM — `/api/checkout` unthrottled.**~~ **FIXED.** 10 requests per IP
   per 5 minutes, returning 429 + `Retry-After`.

### Still open

4. **MEDIUM — checkout never asserts the menu is live.** [snapshot.ts:11-13](../src/lib/menu/snapshot.ts#L11)
   claims "checkout requires `source: clover`", but [route.ts:104](../src/app/api/checkout/route.ts#L104)
   accepts whatever `getMenu()` returns — today the 16-item seed. Deliberately
   left alone: it sits inside the pricing path this build was told not to touch,
   and forcing it now would disable checkout entirely until Clover is synced.
5. **LOW — no failed-charge audit trail.** A declined charge deletes its
   reservation ([route.ts:213](../src/app/api/checkout/route.ts#L213)) rather than
   retaining a CANCELLED row. That is required for retry-after-decline to work
   — the client reuses one idempotency key across retries — but it means a
   dispute has no server-side record. Fixing it needs a separate
   `payment_attempts` table.
6. **LOW — rate limiting is per-instance.** In-memory by design
   ([rateLimit.ts:8-22](../src/lib/http/rateLimit.ts#L8)); on serverless the effective
   limit is (10 × warm instances). Adequate as an abuse speed bump, not a quota.
7. **LOW — a background print can be lost on serverless.** `printOrderInBackground`
   is deliberately not awaited ([dispatch.ts:88](../src/lib/print/dispatch.ts#L88)), so it
   races the function freeze. This is why `PRINT_FAILED`, the reprint button and
   the board exist; move to `waitUntil()` if it proves common.

---

## 4. Shortest path to a working sandbox transaction

Everything that is not a credential is done. The remaining gate is items 1–4.

| # | Task | Est. |
|---|------|------|
| 1 | Create a Clover **sandbox** Ecommerce API token of type **Hosted iFrame + API/SDK**; paste MID, private token, public/PAKMS token into `.env.local`. No code. | 0.5 h |
| 2 | Provision a Postgres (Supabase project or Neon) and run `src/lib/db/schema.sql` against it; set `DATABASE_URL` to the **pooler** endpoint. Locally, `npm run dev:db` does this for you. | 0.5 h |
| 3 | `npm run dev`, load `/order/checkout`, confirm the four iframe fields mount (i.e. `CloverPayment` leaves its error branch). If they don't, the token is the plain "API" type — reissue. | 0.5 h |
| 4 | Place a test order with Clover's test PAN. Expect `A-001` on `/order/confirmation`, a `chargeId`, and the order appearing on `/kitchen` within 10s. | 0.5 h |
| 5 | Replay-test idempotency against the live path: resubmit with the same key, assert ONE charge in the Clover sandbox dashboard. | 0.5 h |
| 6 | Confirm the Chula Vista tax rate and set `TENANT_TAX_RATE_BPS` for real. | 0.25 h |
| 7 | Set `ADMIN_DASH_PASSWORD` to a long random value for the deployed environment. | 0.1 h |
| 8 | Register the thermal printer in PrintNode, set `PRINTNODE_API_KEY` + `PRINTNODE_PRINTER_ID`, and print one real ticket. Verify the ESC/POS raster and the cut land correctly on YOUR printer model. | 1–2 h |
| 9 | Have the family review the two new 中文 maps (sizes, modifiers) in `menu-overrides.ts`, then re-run `npm run build:ticket-font`. | 0.5 h |
| 10 | Enforce `menu.source === "clover"` (or explicitly allow seed) before charging. | 0.5 h |
| 11 | Populate real Clover inventory, flip `MENU_SOURCE=clover`, read the dev normalize report, fill `itemOverridesByCloverId` with the printed IDs, re-run the font build. | 3–4 h |
| 12 | Resolve the party-tray TODO ([source.ts:51](../src/lib/menu/source.ts#L51)) — decide variants vs. a size modifier group in Clover, then map to `MenuItem.sizes[]`. Needs a populated merchant to inspect. | 4–8 h |

**A sandbox transaction is ~2 hours away, all of it credential and database
setup.** Production-safe is items 1–10, roughly **1 day**.

---

## 5. Blocked on me (owner decisions / values needed)

1. **Clover sandbox credentials** — MID, private token, public/PAKMS token.
   Must be integration type **Hosted iFrame + API/SDK**; the plain API type will
   not tokenize. Nothing downstream can be tested without these.
2. **Clover Dashboard API token with `Inventory:Read`** — separate credential,
   required only for `MENU_SOURCE=clover` ([.env.example:31-35](../.env.example#L31)).
3. **Chula Vista sales tax rate.** `775` bps is a placeholder carrying a
   `TODO(confirm)` at [.env.example:47](../.env.example#L47). Checkout refuses to charge
   without it, so a wrong value silently overcharges every customer.
4. **Online-ordering cutoff.** Defaults to dine-in close minus 30 min — the
   comment at [tenant.server.ts:85-87](../src/config/tenant.server.ts#L85) says outright this
   number is a guess.
5. **Tips on pickup — yes or no?** `TIP_PRESETS` is unset, so tipping is off and
   there is no tip UI at all ([tenant.types.ts:38](../src/config/tenant.types.ts#L38)).
6. **ASAP quote.** "~20–30 min" is a `TODO(confirm)` ([pickup.ts:109-110](../src/lib/order/pickup.ts#L109)).
7. **Party-tray serving counts.** "feeds 8–10" is an estimate ([seed-menu.ts:72](../src/data/seed-menu.ts#L72)).
8. **How are sizes modeled in your Clover?** Item variants or a size modifier
   group? Blocks item 12 above; wrong choice loses every tray price.
9. **A Postgres database** — `DATABASE_URL` for the deployed environment.
   A Supabase project covers this and the menu snapshot at once; use the
   **pooler** endpoint (port 6543), not the direct one.
10. **Printer + PrintNode account** — printer model and paper width (80mm
    assumed), plus whether a PrintNode subscription is acceptable. The ESC/POS
    cut command (`GS V 66`) is the widely supported variant but is worth one
    real-hardware check.
11. **Review the two new 中文 maps.** `sizeZhByLabel` and `modifierZhByName`
    ([menu-overrides.ts:143-200](../src/data/menu-overrides.ts#L143)) are standard trade
    terms, but unlike every other 中文 string in this repo they have **not**
    been verified by the family. They print on the kitchen ticket. Confirm
    before first service, then re-run `npm run build:ticket-font`.
12. **`ADMIN_DASH_PASSWORD` for production** — and whether one shared password
    is acceptable, or whether you need to know which staff member tapped 完成
    (that would need real accounts).
13. **Real Google reviews** (3) — see below.
14. **Health-inspection score and the four amenity flags** ([restaurant.ts:97-101](../src/data/restaurant.ts#L97)).
15. **Do you actually want the `/menu` page and `/order` to show different
    menus?** Today they do — 68 static items vs 16 orderable.

---

## 6. Site data integrity (Phase 5)

| # | Item | Status |
|---|------|--------|
| 1 | Placeholder address / phone | **FIXED.** No `123 Placeholder Ave` and no `(619) 555-0123` anywhere in `src/`. Real values at [restaurant.ts:76-82](../src/data/restaurant.ts#L76) |
| 2 | Chinese name conflict | **NO CONFLICT.** `新滿福樓` / `新满福楼` appear **zero** times in the repo. 富源 is used consistently and is marked verified at [restaurant.ts:73](../src/data/restaurant.ts#L73). Other occurrences (all consistent): [icon.tsx:23](../src/app/icon.tsx#L23), [opengraph-image.tsx:8](../src/app/opengraph-image.tsx#L8), [FavoritesSpotlight.tsx:120](../src/components/FavoritesSpotlight.tsx#L120), [Seal.tsx:4](../src/components/Seal.tsx#L4), [MandarinMark.tsx:11](../src/components/MandarinMark.tsx#L11), [menu.ts:10](../src/data/menu.ts#L10), plus prose in `README.md` / `DESIGN.md` |
| 3 | Hours | **SINGLE SOURCE, no disagreement.** [restaurant.ts:84-92](../src/data/restaurant.ts#L84) — Mon–Fri 11:00 AM–9:00 PM, Sat 11:00 AM–9:30 PM, Sun 11:00 AM–8:30 PM. Every consumer reads that record: [HoursTable.tsx:58](../src/components/HoursTable.tsx#L58), [Footer.tsx:64](../src/components/Footer.tsx#L64), [hours.ts:50](../src/lib/hours.ts#L50), [pickup.ts:80](../src/lib/order/pickup.ts#L80), [tenant.server.ts:114](../src/config/tenant.server.ts#L114). Caveat: the *online-ordering* window is derived as close-minus-30 and is unconfirmed (see Blocked #4) |
| 4 | Testimonials | **STILL PLACEHOLDERS — launch blocker.** [reviews.ts:19](../src/data/reviews.ts#L19), [:24](../src/data/reviews.ts#L24), [:29](../src/data/reviews.ts#L29) all read `[PASTE REAL GOOGLE REVIEW — …]` and ship visible by design |
| 5 | Salt & Pepper Wings → `crispy-game-hen.jpg` | **NOT PRESENT.** `dishPhotoByItemId` ([FavoritesSpotlight.tsx:38-43](../src/components/FavoritesSpotlight.tsx#L38)) maps only 4 dishes, wings is not among them, and `photos.dishCrispyGameHen` is defined ([images.ts:90](../src/data/images.ts#L90)) but referenced nowhere. Moot regardless: **every** entry in `images.ts` has `src: null` — there are no photos on the site at all, only designed placeholder panels. `public/` holds one hero video, one poster, two backgrounds, and the brand SVGs |
| 6 | `Restaurant` / `Menu` JSON-LD | **MISSING.** Zero hits for `application/ld+json`, `schema.org`, `jsonLd`, or `@type` across `src/`. [layout.tsx](../src/app/layout.tsx) sets only title/description metadata. This is a real local-SEO gap — hours, address, phone, and price range are all already structured in `restaurant.ts` and just need emitting |

---

## 7. Running and verifying it locally

No Docker, no Clover credential, and no printer are needed for any of this.

```bash
npm run dev:db        # embedded Postgres on :55432, schema applied, 3 orders seeded
npm run dev           # in a second terminal
npm run verify:orders # 24 assertions against a throwaway Postgres
npm run ticket:sample # renders sample tickets to /tmp, incl. a missing-中文 case
```

Then open `/kitchen` (password from `ADMIN_DASH_PASSWORD`) and
`/api/ticket/preview` (dev-only; 404s in production).

`npm run build:ticket-font -- <path to NotoSansTC[wght].ttf>` regenerates the
subset font. **Re-run it whenever 中文 is added anywhere that reaches a
ticket.** Forgetting is not silent — the renderer checks the committed
coverage manifest and falls back to English with a `⚠ EN` marker rather than
printing an empty box.

### What was verified, and how

| Claim | Evidence |
|---|---|
| Same idempotency key twice → one row, same number | `verify:orders` §1, incl. a raw duplicate INSERT rejected by the index |
| 50 concurrent allocations → 50 distinct sequential numbers | `verify:orders` §2 — `A-001…A-050`, counter lands on exactly 50 |
| 23:30 local stays on today's business date | `verify:orders` §3 — PDT and PST both, plus the sequence resetting across local midnight |
| A lost idempotency race does not burn a number | `verify:orders` §4 — 10 concurrent retries, next real order is still `A-002` |
| Integer cents survive the jsonb round trip | `verify:orders` §5 |
| Ticket renders at 576px with 中文 and a loud `⚠ EN` | `ticket:sample` → 576×1623px PNG |
| Kitchen APIs reject unauthenticated and forged cookies | 401 on all four routes (list, action, ticket, forged cookie) |
| Checkout is throttled | requests 1–10 → 400, 11+ → 429 with `retry-after: 300` |
| A client-supplied price is rejected | `{"price": 1}` on a line → 400 |
| The token guard runs before the reservation | Two failed-credential checkouts created **0** rows |
| Full lifecycle on the board | PAID → 接單 → 完成, drops off Active, reappears under 全部 |
