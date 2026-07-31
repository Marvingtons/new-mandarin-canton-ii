# Cloudflare + printer readiness — evidence-based diagnostic

Read-only audit of `main` @ `567364a`, 2026-07-29. Every claim below was checked
by opening the code or running the command. Docs were treated as claims and
checked against reality; disagreements are listed.

---

## VERDICT

1. **This tree is in the Cloudflare world (b), not half-migrated.** The
   migration ran: `wrangler.jsonc`, `open-next.config.ts`, `custom-worker.ts`,
   `@opennextjs/cloudflare`, `@resvg/resvg-wasm`, no `vercel.json`, no
   `outputFileTracingIncludes`. Both `next build` and `build:cf` **pass**.
2. **It will deploy. It will not serve a ticket.** The Hyperdrive binding is
   commented out ([wrangler.jsonc:90-97](../wrangler.jsonc#L90)), so on Workers
   there is **no database at all** — every order/print route 503s or 500s.
3. ~~**Two additional Workers-breakers are live**, both filesystem reads that
   only fail on workerd: the three `next/og` icon routes (`icon.tsx`,
   `apple-icon`, `opengraph-image`). Confirmed 500 under `wrangler dev`.~~
   **FIXED.** Those three routes are gone. The images never depended on the
   request, so they are pre-rendered to committed PNGs
   (`src/app/icon.png`, `apple-icon.png`, `opengraph-image.png`) by
   `npm run build:app-icons` and served by Next's static metadata
   conventions. No `fs` call and no `next/og` render remains on any request
   path; the built worker no longer references the seal SVG at all, and
   `@vercel/og`'s `yoga.wasm` has left the bundle with it. Verified 200 +
   `image/png` under `wrangler dev`.
4. **Ticket rendering on Workers is UNVERIFIED**, not proven broken. An earlier
   failure was against a since-replaced implementation. See Phase 1.
5. **From this tree, a printed ticket is blocked on the Hyperdrive binding**,
   which is a runbook step, not a code fix.

---

## PHASE 0 — Which world

| Item | Status | Evidence |
|---|---|---|
| Migration ran | `READY` | 8 commits `c700a80`…`567364a`; tag `pre-cloudflare-migration` exists |
| Working tree clean | `READY` | only `docs/DESIGN_AUDIT.md`, `docs/GAP_REPORT.md` untracked; no stashes; on `main` |
| `wrangler.jsonc` | `READY` | present; `main: ./custom-worker.ts`, both compat flags, ASSETS/IMAGES/WORKER_SELF_REFERENCE |
| `open-next.config.ts` | `READY` | `defineCloudflareConfig()`, no overrides (no ISR in app) |
| `vercel.json` | `READY` (absent by design) | deleted in `cbea704` |
| `outputFileTracingIncludes` | `READY` (absent) | only a do-not-restore comment, [next.config.ts:15](../next.config.ts#L15) |
| Native resvg | `READY` (none) | `rg "@resvg/resvg-js"` → comments and one stale doc line only |
| `tsc --noEmit` | `READY` | exit 0, no output |
| `tsc -p tsconfig.worker.json` | `READY` | exit 0 |
| `next build` | `READY` | `✓ Compiled successfully in 1907ms`, 16/16 static pages |
| `build:cf` | `READY` | `Worker saved in .open-next\worker.js` / `OpenNext build complete.` |

**Not half-migrated.** No Vercel remnants, no dual-target config.

---

## PHASE 1 — Renderer under Workers constraints

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Native resvg imports | `READY` | none; `@resvg/resvg-wasm` only, [resvg.ts:1](../src/lib/ticket/resvg.ts#L1) |
| 2 | `initWasm` singleton | `READY` | promise cached, not a boolean — see quote below, [resvg.ts:90-98](../src/lib/ticket/resvg.ts#L90) |
| 3 | wasm load mechanism | `PARTIAL` | build-time import in `custom-worker.ts` (wrangler-bundled), handed over on `globalThis`. Not a CDN fetch. Unusual but deliberate |
| 4 | Font loading | `READY` | embedded base64, decoded once at module scope, [font.ts:43-52](../src/lib/ticket/font.ts#L43). No `fs`, not per-render |
| 5 | Subset freshness | **`PARTIAL` — real gap** | see "combo 中文 never prints" below |
| 6 | `ticket-sample.ts` | `READY` (Node world) | 3 PNGs, all 576px wide: 576x1623, 576x1623, 576x2350 |
| 7 | `runtime = 'edge'` | `READY` (none) | `rg` over `src` → no matches |
| 7 | Node-only APIs in render path | `READY` | `readFile` in [resvg.ts:81](../src/lib/ticket/resvg.ts#L81) is behind the `onWorkers` branch; unreachable on workerd |

**The singleton (correct):**
```ts
initPromise ??= (async () => {
  await initWasm(await loadWasm());
})().catch((err: unknown) => {
  initPromise = null; // let the next request retry
  throw err;
});
```
Caching the promise (not a flag) is right: `initWasm`'s own guard is set after
an internal await, so two cold-start requests would both pass a boolean check.

### FINDING — combo 中文 can never print (~~`PARTIAL`~~ **FIXED**)

> **Fixed.** `collectTicketGlyphs()` now walks `menu.ts` and `comboCategories()`
> directly — item names both languages, size labels, modifier groups and every
> entrée choice — so all five strings below are in the subset. And the circular
> audit this finding called out is gone: `npm run verify:ticket-glyphs`
> enumerates the reachable strings **independently**, from `catalogMenu()`, and
> checks them against the real cmap. It reports `reachable but never collected:
> 0`, which is the number this finding is about. Everything below is the record.

`collectTicketGlyphs()` ([glyphs.ts:72-92](../src/lib/ticket/glyphs.ts#L72))
reads only `itemOverridesById`, `itemOverridesByName`, `categoryZhByName`,
`sizeZhByLabel`, `modifierZhByName`. It **never reads
`src/data/combo-items.ts`**, where the takeout work hardcoded 中文:

| String | In collector | In subset |
|---|---|---|
| 午市套餐 (Lunch Special) | NO | NO — missing 午市套 |
| 家庭套餐一/二 (Family Dinner) | NO | NO — missing 家庭套一 |
| 大家庭套餐 (Big Family) | NO | NO — missing 家庭套 |
| 選主菜 (Choose your entrée) | NO | NO — missing 選主 |
| 二人…六人 (head counts) | yes | yes |

**No tofu will print** — `pick()` → `isPrintable()`
([render.tsx:85](../src/lib/ticket/render.tsx#L85)) falls back to English with
`⚠ EN`. But those five strings are dead: they can never appear on a ticket.
The font-audit tooling reports "current" because it compares the collector
against the font and both agree — **the collector is the incomplete half.**

Embedded font vs committed TTFs: **IDENTICAL** for both weights, 219
codepoints each. No drift.

### Ticket render on Workers — `NOT-VERIFIABLE-LOCALLY`

Honest status: **unproven either way.** What was actually observed today under
`wrangler dev`:

- `/` → 200
- ~~`/icon`, `/opengraph-image` → 500, `no such file or directory, readAll
  '/bundle/public/brand/fu-yuan-seal.svg'`~~ — since fixed; they are static
  files now, and `/icon.png`, `/apple-icon.png` and `/opengraph-image.png`
  each return 200 `image/png` under `wrangler dev`
- `/api/print/localtest` → 500, `No Postgres connection available` — the
  renderer was **never reached**

A previous session saw `CompileError: WebAssembly.instantiate(): Wasm code
generation disallowed by embedder` on the GET. That observation was against an
implementation that fetched the wasm from the ASSETS binding and compiled it at
runtime — which workerd legitimately forbids, and which has since been replaced
by the build-time import. It is **not evidence about the current code.**

One unresolved signal worth carrying forward: that error's phrasing was
`Aborted(...). Build with -sASSERTIONS`, which is **Emscripten**.
`@resvg/resvg-wasm` is wasm-bindgen (`rg "sASSERTIONS"` → 0 hits); Next's
bundled `@vercel/og` **is** Emscripten (hits in `index.node.js`,
`index.edge.js`), and `handler.mjs` imports `@vercel/og/resvg.wasm?module` and
`yoga.wasm?module`. So the abort was og's wasm, not ours — but whether the
ticket path pulls og in (via a `satori` dedupe) is unconfirmed.

**To verify:** with Hyperdrive bound and one QUEUED order,
```
curl -sS -D - -o /tmp/t.png "https://<worker>/api/print/<CLOUDPRNT_SECRET>?type=image/png"
```
Expect `content-type: image/png` and a non-zero body. `file /tmp/t.png` → `PNG image data, 576 x …`.

---

## PHASE 2 — CloudPRNT route

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Three verbs present | `READY` | POST/GET/DELETE in [route.ts](../src/app/api/print/[secret]/route.ts) |
| 1 | POST shape incl. `mediaTypes` | `READY` | `jobReady:true`, `mediaTypes:[JOB_MEDIA_TYPE]`, `jobToken`, `deleteMethod:"DELETE"` — [route.ts:126-132](../src/app/api/print/[secret]/route.ts#L126); `JOB_MEDIA_TYPE = "image/png"` [cloudprnt.ts:47](../src/lib/print/cloudprnt.ts#L47). **Verified live on workerd:** `{"jobReady":true,"mediaTypes":["image/png"],"jobToken":"A-001","deleteMethod":"DELETE"}` |
| 2 | GET content-type + `no-store` | `READY` | [route.ts:189-191](../src/app/api/print/[secret]/route.ts#L189) |
| 3 | Only DELETE marks PRINTED | `READY` | single `markPrinted` call site, [route.ts:262](../src/app/api/print/[secret]/route.ts#L262), inside `confirmPrinted` |
| 4 | Claim concurrency-safe | `READY` | `for update skip locked` + `print_attempts = 0` re-checked under the row lock, [repository.ts:238-246](../src/lib/orders/repository.ts#L238); re-poll returns the same job via `currentPrintJob` |
| 5 | Secret path segment | `READY` | `params.secret` → `secretMatches`, 404 not 401; never logged |
| 5 | `CLOUDPRNT_PRINTER_MAC` | `PARTIAL` — **permissive when unset** | [cloudprnt.ts:156-162](../src/lib/print/cloudprnt.ts#L156): `if (!expected) return true`. Implemented, not enforced until the var is set |
| 6 | Render-failure retry | `READY` | `MAX_RENDER_ATTEMPTS = 3` [cloudprnt.ts:68](../src/lib/print/cloudprnt.ts#L68); `recordRenderFailure` keeps QUEUED below 3 |
| 7 | Paper-out behavior | `PARTIAL` — known, deliberate | traced below |

### Paper-out, traced

`readPoll` parses the body; `printerReportsHealthy` inspects `statusCode`
([cloudprnt.ts:135](../src/lib/print/cloudprnt.ts#L135)). At
[route.ts:89-92](../src/app/api/print/[secret]/route.ts#L89) the result is
**advisory only** — logged as a warning, and the job is still offered:

> `// Advisory only. A printer reporting trouble still gets offered the job —`
> `// it may be a recoverable cover-open, and withholding work from the only`
> `// printer is never the safer choice.`

Actual behavior on paper-out: printer POSTs → gets `jobReady:true` → GETs the
PNG → **cannot print, so sends no DELETE**. The order stays `QUEUED` with
`print_attempts` climbing on each re-offer. At `MAX_PRINT_ATTEMPTS = 10`
(~1 min of polling) it flips to `PRINT_FAILED` and sorts to the top of
`/kitchen`. Independently, the unprinted-order alert fires at 120s.

This is the acceptable outcome named in the prompt: loop GET-without-DELETE,
order stays unconfirmed, alert fires. The ASB hex field is deliberately not
decoded ([cloudprnt.ts:99](../src/lib/print/cloudprnt.ts#L99)).

---

## PHASE 3 — Database and time rules

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Connection path | **`BROKEN` on Workers** | code reads `env.HYPERDRIVE.connectionString` then falls back to `DATABASE_URL` ([connectionString.ts](../src/lib/db/connectionString.ts)) — but the binding is **commented out**, [wrangler.jsonc:90-97](../wrangler.jsonc#L90). No DB on Workers |
| 1 | Hyperdrive string guidance | `PARTIAL` | code comment says DIRECT/session, correct. **Runbook says pooled 6543** — see disagreements |
| 2 | Driver settings | `READY` | `max: 1` behind Hyperdrive, else `DATABASE_POOL_MAX ?? 4` ([postgres.ts](../src/lib/db/postgres.ts)) |
| 3 | `verify:orders` | `NOT-VERIFIABLE-LOCALLY` | Docker daemon down in this environment; `embedded-postgres` refuses to run as Administrator on Windows. **Last known: 53/53 PASS** at `dfdbe3e` against Postgres 16 |
| 4 | Hours gate + cutoff | `READY` | [orders/route.ts:127](../src/app/api/orders/route.ts#L127) `isAcceptingOrders(now, …)`; 20-min cutoff in `ORDER_CUTOFF_MINUTES` |
| 4 | Lunch window | `READY` | [orders/route.ts:188](../src/app/api/orders/route.ts#L188) `isLunchService(now, …)`, server-side |
| 4 | Pickup window computed + stored | `READY` | [orders/route.ts:225](../src/app/api/orders/route.ts#L225); stored as `ready_from`/`ready_to` |
| 4 | All consumers read stored value | `READY` | `orderReadyLabel` in render.tsx, KitchenOrderCard.tsx, confirmation/page.tsx, Checkout.tsx |
| 4 | No browser clock for enforcement | `READY` | all three gates take `now = new Date()` server-side in `America/Los_Angeles`; client checks are UX hints only |

**`verify:orders` command that would verify:**
```
DATABASE_URL="<supabase pooled 6543 url>" npm run verify:orders
```

---

## PHASE 4 — Cron, secrets, env

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | `scheduled()` handler | `READY` | [custom-worker.ts](../custom-worker.ts) exports `scheduled`, calls `handler.fetch()` in-process (not a public URL) |
| 1 | Cron trigger configured | `READY` | `triggers.crons: ["* * * * *"]`, [wrangler.jsonc:45](../wrangler.jsonc#L45) |
| 1 | HTTP trigger protected | `READY` | `CRON_SECRET` now **required**; unset → refuse + log ([cron route](../src/app/api/cron/unprinted-alert/route.ts)) |
| 2 | A3 semantics | `READY` | claim-first `markAlerted`, `releaseAlertClaim` clears on failure, cap 5 |
| 2 | `alert_attempts` three-way | `PARTIAL` | schema ✓ ([schema.sql](../src/lib/db/schema.sql)), migration ✓ (`002_alert_attempts.sql`), repository ✓ — **absent from the TS `Order` type**. Harmless (the repo returns the count directly, nothing reads it off `Order`) but not the three-way agreement the prompt asked for |
| 4 | Secret in build output | `READY` | no secret values set locally; `CLOUDPRNT_SECRET` is never logged (compared via `secretMatches`, 404 on mismatch) |

### Env table

| Var | Read at | Documented | Class |
|---|---|---|---|
| `DATABASE_URL` | `connectionString.ts` (indexed read) | `.env.example`, `.dev.vars.example` | secret |
| `HYPERDRIVE` (binding) | `connectionString.ts` | wrangler.jsonc **commented** | binding |
| `DATABASE_POOL_MAX` | `postgres.ts` | `.env.example` | public |
| `OTP_SIGNING_SECRET` | `tenant.server.ts` → `otp/session.ts` | both | secret |
| `ADMIN_DASH_PASSWORD` | `kitchenSession.ts:32` | both | secret |
| `CLOUDPRNT_SECRET` | `print/status.ts:11` | both | secret |
| `CRON_SECRET` | cron route | both | secret |
| `TWILIO_*` ×4 | `tenant.server.ts` | both | secret |
| `OWNER_ALERT_PHONE` | `tenant.server.ts` | both | secret |
| `TENANT_ID`, `RESTAURANT_TIMEZONE`, `TENANT_TAX_RATE_BPS`, `ORDER_NUMBER_PREFIX`, `PICKUP_*`, `ONLINE_ORDERING_*`, `MAX_*`, `TIP_PRESETS`, `CLOUDPRNT_BUZZER` | `tenant.server.ts` | both + `wrangler.jsonc` `vars` | public |
| `CLOUDPRNT_PRINTER_MAC` | `cloudprnt.ts:157` | `.env.example` | public |
| `TENANT_TIMEZONE` | `tenant.server.ts:160` alias, `scripts/dev-orders-db.ts` | **undocumented** | public |
| `NODE_ENV` | 3 sites | framework | public |

**No secret is in `wrangler.jsonc` `vars`** — the committed block holds only
public config. Correct.

⚠️ One live trap: a dotted `process.env.SECRET_NAME` gets inlined to
`undefined` at build time on this stack. `connectionString.ts` documents this
and uses an indexed read; anything new must do the same.

---

## PHASE 5 — Production surface

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Security headers | **`MISSING`** | **no `headers()` in `next.config.ts` at all.** Not "dropped by the adapter" — never existed. No nosniff, frame-DENY, referrer, permissions, or CSP anywhere |
| 2 | `no-store` on sensitive routes | `PARTIAL` | present in `print/[secret]`, `ticket/preview`, `kitchen/orders`, `kitchen/orders/[id]/ticket`. **Not found** in `api/orders`, `api/otp/*` |
| 3 | Icons / OG | `PARTIAL` | `icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx` exist but **500 on Workers** (fs read) |
| 3 | `robots.ts` | `MISSING` | `/kitchen` and `/api` are not disallowed anywhere |
| 3 | `sitemap.ts` | `MISSING` | — |
| 3 | `manifest.ts` | `MISSING` | — |
| 3 | JSON-LD | `MISSING` | no `application/ld+json` in `src` |
| 4 | Kitchen auth | `READY` | httpOnly + sameSite=lax + secure-in-prod ([kitchenSession.ts:112](../src/lib/auth/kitchenSession.ts#L112)); `timingSafeEqual` |
| 5 | Takeout messaging | `READY` | "Pickup only" ×7, "no delivery" ×6, second number ×3, "15–20" ×6, "20–30" ×5, "feeds 15–20" ×2 |

---

## Doc-vs-code disagreements

| Doc claim | Reality | Verdict |
|---|---|---|
| `DEPLOY_RUNBOOK.md:31,50` — `DATABASE_URL` must be **pooled 6543** | Vercel-era guidance. On Workers, Hyperdrive supplies the string and must be given the **direct 5432** string. The runbook never mentions Hyperdrive | **Runbook is stale.** Code wins |
| `DEPLOY_RUNBOOK.md` curl smoke test targets a Vercel domain shape | Deploy target is now `*.workers.dev` / a Workers custom domain | Stale |
| `PRINTER_READINESS.md` A1 — font tracing is "BLOCKING, production-only" | Disproven during the migration; `outputFileTracingIncludes` is gone entirely and irrelevant on Workers | Superseded |
| `PRINTER_READINESS.md` D2 — "font subset is CURRENT, no tofu" | ~~**incomplete**: the collector never sees `combo-items.ts`~~ — fixed; the collector walks the combos and `verify:ticket-glyphs` checks reachability independently | Resolved |
| `GAP_REPORT.md:95` — "satori + @resvg/resvg-js DONE … externalized in next.config.ts:15" | Native resvg is gone; that line no longer exists | Stale (untracked doc) |
| `env-inventory.md` — "nothing broken at baseline" | True at `c700a80`. Not true now on Workers | Point-in-time |

---

## BRING-UP TONIGHT

### Step 1 — the smallest set that must change first

**One config edit, no code:** uncomment the Hyperdrive block in
[wrangler.jsonc:90-97](../wrangler.jsonc#L90) after creating the binding. Until
then Workers has no database and nothing prints.

```bash
# Use Supabase's DIRECT/session string (port 5432) — NOT the 6543 pooler.
# Hyperdrive IS the pool; pooler-behind-pooler breaks pg's prepared statements.
npx wrangler hyperdrive create nmc-db --connection-string="postgresql://postgres.<ref>:<pw>@aws-0-<region>.supabase.com:5432/postgres"
```
Paste the returned id into the `hyperdrive` block and uncomment it.

**Optional but recommended before customers see the site** (neither blocks a
ticket): the three icon/og routes 500 on Workers because they read
`public/brand/fu-yuan-seal.svg` off disk. Either inline the SVG or drop the
routes. Tickets are unaffected.

### Step 2 — secrets, then deploy

```bash
npx wrangler secret put OTP_SIGNING_SECRET
npx wrangler secret put ADMIN_DASH_PASSWORD
npx wrangler secret put CLOUDPRNT_SECRET
npx wrangler secret put CRON_SECRET
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_VERIFY_SERVICE_SID
npx wrangler secret put TWILIO_MESSAGING_FROM
npx wrangler secret put OWNER_ALERT_PHONE
```

Apply the schema once (Supabase SQL Editor → paste
[`src/lib/db/schema.sql`](../src/lib/db/schema.sql), **not** the migrations),
then:

```bash
npm run deploy:cf
```

### Step 3 — three-verb smoke test

Substitute only `<SECRET>` and your worker host. **Place one real order first**
so something is `QUEUED`.

```bash
curl -sS -X POST "https://nmc-web.<subdomain>.workers.dev/api/print/<SECRET>" -H "Content-Type: application/json" -d '{"statusCode":"200%20OK","printerMAC":"00:11:62:00:00:01"}'
```
Expect: `{"jobReady":true,"mediaTypes":["image/png"],"jobToken":"A-001","deleteMethod":"DELETE"}`
(`{"jobReady":false}` = nothing queued.)

```bash
curl -sS -D - -o /tmp/t.png "https://nmc-web.<subdomain>.workers.dev/api/print/<SECRET>?type=image/png" && file /tmp/t.png
```
Expect: `content-type: image/png`, `cache-control: no-store`, and
`PNG image data, 576 x 1623`. **This is the step that proves the wasm renderer
works on Workers — the one thing this audit could not verify locally.** A 500
here means check `npx wrangler tail` for a `CompileError`.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE "https://nmc-web.<subdomain>.workers.dev/api/print/<SECRET>?code=200"
```
Expect: `200`, and the order flips to `PRINTED`.

### Step 4 — printer

1. Hold **FEED** while powering on → self-test prints the **IP**, **MAC**, and
   **firmware version**. Write all three down.
2. Browse to `http://<printer-ip>/` → **CloudPRNT** settings.
3. Paste exactly (secret is a **path segment**, not a query param):
   ```
   https://nmc-web.<subdomain>.workers.dev/api/print/<CLOUDPRNT_SECRET>
   ```
   Poll interval 3–5s. Leave CloudPRNT username/password empty.

### Step 5 — first real ticket

1. Place a real order (OTP will text you).
2. `npx wrangler tail` — watch POST → GET → DELETE.
3. Paper in, ticket out. Check order number, pickup window, 中文, `COLLECT PAYMENT`.
4. Pin the MAC: `npx wrangler secret put CLOUDPRNT_PRINTER_MAC` (or add to
   `vars`), redeploy, re-run Step 3 command 1 with `&mac=<MAC>` to confirm you
   have not locked out your own printer.
5. Buzzer is `off` by default — nothing sounds until `CLOUDPRNT_BUZZER=drawer`.

### The honest answer

> **From this tree, a printed ticket is ~45 minutes away, blocked by the
> commented-out Hyperdrive binding — a config step, not a code fix. The one
> genuine unknown is whether the wasm renderer survives workerd, and Step 3's
> GET is the command that settles it.**

If that GET returns a PNG, tonight works. If it returns 500 with a
`CompileError`, the fallback is to keep Vercel serving `/api/print/*` until the
wasm path is fixed — the tag `pre-cloudflare-migration` is the revert point.
