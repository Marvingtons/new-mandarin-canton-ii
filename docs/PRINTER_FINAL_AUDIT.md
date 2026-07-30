# Printer path — final audit

Read-only. Tree at `3f0fdfb`, working tree clean. Docs and commit messages are
claims; only code and run output below are treated as evidence.

**Two places where the code contradicts the prompt's history of the night are
called out explicitly. The code wins.**

---

## PHASE 1 — the 511 fix

### 1.1 Did it land? — `VERIFIED-FIXED`

`b1ad3a8` "Send the printer a PNG it can decode: 24-bit, no alpha".

The encode path no longer uses resvg's own encoder. `rendered.asPng()` is gone;
[render.ts:438](../src/lib/ticket/render.ts#L438) now calls
`encodeOpaqueRgbPng(rendered.pixels, rendered.width, rendered.height)`, a
hand-written encoder at [png.ts:74](../src/lib/ticket/png.ts#L74) that composites
RGBA over opaque white and emits colour type 2
([png.ts:120](../src/lib/ticket/png.ts#L120)). Pure JS — deflate comes from
`CompressionStream`, so no native module and no new wasm.

`d35ae07` ("sd"), the only foreign commit between the renderer work and here,
touches `t.png` only. Nothing was reverted.

### 1.2 What the renderer emits right now — `VERIFIED-FIXED`

Ran `npm run ticket:sample` this session and parsed the output with a chunk
walker (not ffprobe's summary, not assumptions):

| property | short ticket | 12-line party tray |
|---|---|---|
| dimensions | 576 × 1524 | 576 × 2161 |
| bit depth | 8 | 8 |
| colour type | **2 = truecolour (RGB)** | **2** |
| alpha | **no channel** | **no channel** |
| interlace | **0 = none** | **0** |
| chunks | `IHDR(13) IDAT(76490) IEND(0)` | `IHDR(13) IDAT(99352) IEND(0)` |
| bytes | 76,547 | 99,409 |

`ffprobe` independently decodes both as `rgb24`. Before the fix these were
colour type 6 (RGBA) at 131,151 / 165,836 bytes — the alpha channel was the only
off-spec property, and dropping it also cut ~42% of the file.

### 1.3 Star's documented constraints — and the honest limit of them

Source: Star CloudPRNT Protocol Guide 2.5.0 —
[Image Printing](https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/protocol-reference/common-spec-reference/content-mediatypes/image-printing.html),
[Extra parameter for image/vnd.star.png](https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/protocol-reference/common-spec-reference/content-mediatypes/image-vnd-star-png.html),
[Content Media Types](https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/protocol-reference/common-spec-reference/content-mediatypes/index.html).

What they actually state:

- **576 pixels wide on 80mm models** (832 on 112mm) — we match exactly.
- Images are dithered to monochrome when printed.
- `image/png` is a supported media type; we advertise plain `image/png`
  ([cloudprnt.ts:47](../src/lib/print/cloudprnt.ts#L47)).
- The `vnd.star.png` variant names **"1 bit per pixel"** and **"24/32bit per
  pixel"** formats, and exposes `mono_len` / `24bpp_len` as **printer-declared
  maximum pixel heights**.

**What they do NOT state, anywhere I could find: colour type, alpha, or
interlacing rules for plain `image/png`, and no documented meaning for code
511.** So the alpha diagnosis is a reasoned inference — alpha was the single
property of our file that deviated from anything Star names, and 24-bit
truecolour is the colour variant they name — **not a quoted requirement**. If
511 persists on hardware, the next suspect is bit depth: Star names "1 bit per
pixel" first, and the ticket is already pure black on white with no midtones.
`png.ts` is structured so that is a small change (colour type 0, `bitDepth: 1`,
a threshold in the scanline loop).

Status of the 511 defect itself: **`CLAIMED-FIXED`.** The file now conforms to
everything Star documents; whether the printer accepts it is untested on
hardware.

### 1.4 Two copies per ticket — `OPEN` (and the prompt's history is wrong)

**Not implemented. No config key, no copies logic, no separator, nothing.**
Searched `src/lib/ticket/`, `src/lib/print/`, `src/config/` — the only `cut`/
`copies` hits are unrelated prose in a comment.

**This was never requested.** The 511 prompt actually issued specified, as its
item 4, *height-splitting behind a config max-height* — not a two-copies
feature. Nothing about copies, mid-job cuts, or tear lines appeared in it. The
prompt's summary of the night is mistaken on this point.

Consequently I have no findings on "what the Star docs say about cuts with image
media" — that question was never researched because the feature was never asked
for.

### 1.5 Worst-case height — `OPEN`

Measured this session: **12-line party tray = 576 × 2161 px**, single copy. With
a (non-existent) second copy concatenated it would be ~4322 px; as two separate
CloudPRNT jobs it stays 2161.

No split logic exists. That was a deliberate non-implementation, recorded at the
time: the only documented height limit is **printer-declared** via `mono_len` /
`24bpp_len` in the poll body, and `readPoll`
([cloudprnt.ts:96](../src/lib/print/cloudprnt.ts#L96)) does **not capture those
fields**. Choosing a max-height constant without that number would be a guess.

**Open action:** capture `mono_len`/`24bpp_len` from the poll, then gate on the
printer's own declared limit. Until then the tallest realistic job is 2161 px
against an unknown ceiling.

---

## PHASE 2 — regression sweep

| # | Item | Status |
|---|---|---|
| 1 | resvg seam + satori absence | `VERIFIED-FIXED` / `CLAIMED` (see note) |
| 2 | Order-shape normalization | `VERIFIED-FIXED` |
| 3 | DELETE code handling | `VERIFIED-FIXED` with one deviation |
| 4 | Print-route connections | `VERIFIED-FIXED` in code, `CLAIMED` at runtime |
| 5 | Retry/offer accounting | `VERIFIED` — documented, not rebalanced |
| 6 | pg-cloudflare in bundle | `CLAIMED-FIXED` |
| 7 | Gate bypass server-only | `VERIFIED-FIXED` |

### 2.1 resvg seam

Intact. `custom-worker.ts:4` imports `@resvg/resvg-wasm/index_bg.wasm`;
[resvg.ts:63](../src/lib/ticket/resvg.ts#L63) declares `__RESVG_WASM__`;
[resvg.ts:84](../src/lib/ticket/resvg.ts#L84) reads it;
[resvg.ts:91](../src/lib/ticket/resvg.ts#L91) asserts `instanceof
WebAssembly.Module`; the `initPromise ??=` singleton is unchanged. Platform
detection is `WebSocketPair` ([resvg.ts:77](../src/lib/ticket/resvg.ts#L77)), not
a user-agent string.

`satori` is absent from `package.json` **and** from `node_modules`. Verified now.

**Nuance the prompt gets slightly wrong:** the built worker still contains a
`yoga.wasm` CompiledWasm module — but it is `@vercel/og`'s copy, byte-identical
to `next/dist/compiled/@vercel/og/yoga.wasm`, pulled in by the `/icon` and
`/opengraph-image` routes. Satori's own is gone. Expected module list is *ours +
@vercel/og's two*. This was verified against a build in the previous session;
**I could not re-run `build:cf` this session** (see Caveats), so for the current
tree it is `CLAIMED`.

### 2.2 Order-shape normalization — `VERIFIED-FIXED`

`normalizeOrder` at [render.ts:158](../src/lib/ticket/render.ts#L158), applied at
[render.ts:295](../src/lib/ticket/render.ts#L295) before any measurement.
Fixtures `sqlShapedOrder` ([ticket-sample.ts:275](../scripts/ticket-sample.ts#L275))
and `malformedOrder` ([ticket-sample.ts:319](../scripts/ticket-sample.ts#L319))
exist and **both rendered this session** (576×850 and 576×760), with the wrapping
assertions passing on all six fixtures.

### 2.3 DELETE handler — one real deviation

[route.ts:253](../src/app/api/print/[secret]/route.ts#L253):
`if (code && !/^(200|0|ok)$/i.test(code))` → `recordPrintAttempt({ok:false})`,
which stamps `last_print_error` and sets `PRINT_FAILED`
([repository.ts:538](../src/lib/orders/repository.ts#L538)), then returns before
`markPrinted`. So 511/520 → error stamped, never PRINTED. Garbage code → same
path. Success code → `markPrinted` sets `PRINTED` + `printed_at`.

**Deviation: an ABSENT code is treated as SUCCESS, not failure.** `code` is null
→ the guard is false → falls through to `markPrinted`. The prompt asserts
absent should be failure. The code's reasoning is stated in its own comment —
Star sends a result code *when the job did not complete*, so silence means it
did — and that matches Star's semantics. I read this as correct-by-design and
the prompt as mistaken, but flagging it because it is a real behavioural
difference and it is the exact path a healthy print takes.

On "order stays claimable": a `PRINT_FAILED` order **is** still offered —
`PRINTABLE_STATUSES` includes it and `currentPrintJob` matches on
`print_attempts > 0`. Confirmed.

### 2.4 Connection handling — code `VERIFIED`, runtime `CLAIMED`

[postgres.ts:85](../src/lib/db/postgres.ts#L85) keys pools by request context in
a `WeakMap`; [postgres.ts:116](../src/lib/db/postgres.ts#L116) returns a
per-request pool on Workers and the process pool on Node
([postgres.ts:144](../src/lib/db/postgres.ts#L144)). Every repository function
uses `pool.query()` (acquire+release in one call); the only `connect()` is in
`withTransaction`, which releases in a `finally`. No acquisition path lacks a
release, error paths included.

**Not proven at runtime.** `scripts/print-torture.ts` exists but has never run —
no Postgres is reachable in this environment (embedded-postgres refuses to run
as administrator, no `psql`, Docker daemon down). The socket-lifetime *mechanism*
was proven on workerd; the driver behaviour against a real database was not.

### 2.5 Retry accounting — documented, not rebalanced

`MAX_PRINT_ATTEMPTS = 10` ([cloudprnt.ts:57](../src/lib/print/cloudprnt.ts#L57)),
`MAX_RENDER_ATTEMPTS = 3` ([cloudprnt.ts:68](../src/lib/print/cloudprnt.ts#L68)).

The double-increment is real and **deliberate, documented rather than
rebalanced** — `recordRenderFailure`'s own comment states that `print_attempts`
ticks once per offer *and* once per render failure, that this works out to
roughly two render attempts before an order is condemned, and that it is one
counter on purpose because a second would have to be kept in lockstep. Behaviour
unchanged tonight.

### 2.6 pg-cloudflare — `CLAIMED-FIXED`

`682a3a9`. It is a direct dependency in `package.json` (no longer optional-only)
and listed in `serverExternalPackages`, which is what makes the adapter's
`copyWorkerdPackages` copy the full package with its `workerd` condition
resolved. `CloudflareSocket` was greppable ×7 in the shipped worker **in the
previous session's build**; not re-verified for the current tree.

### 2.7 Gate bypass — `VERIFIED-FIXED`

[bypass.ts:1](../src/lib/order/bypass.ts#L1) is `import "server-only"`, so a
client import fails the build. The client-bundle grep returned zero for
`x-gate-bypass`, `ORDER_GATE_BYPASS` and every related symbol when last run; a
fresh `.next/static` audit this session (144 files) likewise found zero secrets,
cookie names or server-crypto symbols.

---

## PHASE 3 — loose ends

### 3.1 Alert re-fires on T-997 — **not what it looks like; one real bug behind it**

The lifecycle, traced against the code:

- `findUnprintedForAlert` ([repository.ts:341](../src/lib/orders/repository.ts#L341))
  selects `status in ('QUEUED','PRINT_FAILED') AND alerted_at IS NULL`.
- `markAlerted` ([repository.ts:374](../src/lib/orders/repository.ts#L374)) stamps
  `alerted_at` conditionally on it being NULL — the claim.
- `updateStatus` does **not** touch `alerted_at` (grep: 0 hits in that function).
- `requeueForPrint` ([repository.ts:317](../src/lib/orders/repository.ts#L317))
  resets `print_attempts` and `last_print_error` — but **not** `alerted_at`.

**So no state transition re-arms the alert.** QUEUED→PRINT_FAILED→CANCELLED→
requeued cannot cause a re-fire; `alerted_at` stays stamped throughout.

The only thing that sets `alerted_at` back to NULL is `releaseAlertClaim`
([repository.ts:413](../src/lib/orders/repository.ts#L413)), which fires **when
the SMS send failed** — deliberately giving the claim back so the next sweep
retries, capped at `MAX_ALERT_ATTEMPTS = 5`.

**Verdict: three alerts on T-997 means three failed SMS sends, not three
re-arms. That is designed behaviour and acceptable** — the cap is doing its job,
and the alternative (one failed send silencing the order forever) is worse.
Check the cron logs for the Twilio error; the alert text itself was probably
never delivered.

**The real bug is the opposite one, and it is `OPEN`:** because
`requeueForPrint` leaves `alerted_at` stamped, a requeued order that fails to
print *again* will **never alert**. A staff reprint silently disarms the safety
net for that order. `requeueForPrint` should reset `alerted_at = null` and
`alert_attempts = 0` alongside the counters it already clears.

### 3.2 Attempt counters after requeue — `VERIFIED-FIXED`

`requeueForPrint` sets `status='QUEUED'`, `print_attempts = 0`,
`last_print_error = null`. A reprinted order does **not** start life
half-condemned; it gets a full budget of offers and render attempts. Only the
alert counters survive, which is 3.1's bug.

### 3.3 Cron with no `OWNER_ALERT_PHONE` — `VERIFIED-FIXED`, clean

[route.ts:123](../src/app/api/cron/unprinted-alert/route.ts#L123) returns
`{ok:true, found:N, alerted:0, skipped:"OWNER_ALERT_PHONE is not set"}` before
any claim is taken — no error, no exception, no Twilio call, and no `alerted_at`
written. A `console.warn` listing the unprinted order numbers is emitted just
above it, deliberately, so an operator reading logs learns the kitchen is
missing tickets without needing a phone. Clean no-op, not noise.

### 3.4 Truncation readiness — `VERIFIED`, with one refinement

The schema defines exactly **two tables**: `orders`
([schema.sql:18](../src/lib/db/schema.sql#L18)) and `order_counters`
([schema.sql:101](../src/lib/db/schema.sql#L101)). No migration adds another.

All print and alert bookkeeping lives in columns **on `orders`** —
`print_attempts`, `printed_at`, `last_print_error`, `alerted_at`,
`alert_attempts`, `ready_from`, `ready_to`. Nothing is in a side table.

So `truncate orders, order_counters;` is complete for test-order residue. One
refinement: `orders.id` is `bigserial`, so plain `TRUNCATE` leaves the sequence
where it is and the first real order gets a high `id`. Harmless — the
customer-facing number comes from `order_counters` — but if you want a clean
slate use:

```sql
truncate orders, order_counters restart identity;
```

---

## Caveats on this audit's own evidence

- **`build:cf` was not re-run for the current tree.** `.open-next/assets` is held
  by another session's `next dev` on :3000 (via `initOpenNextCloudflareForDev`),
  which I declined to kill. `next build` passed. Items 2.1 and 2.6 are therefore
  `CLAIMED` for `3f0fdfb`, verified for the tree as of the previous build.
- **Nothing in this audit was tested against a live database or the physical
  printer.** No Postgres is reachable here; the printer is not mine to poll.
- **Deployment state unknown.** The last successful `build:cf` predates
  `b1ad3a8` (the 511 fix) and the three phone commits. Assume the fix is *not*
  live until you deploy.

---

## NEXT PHYSICAL TEST

**0. Deploy.** The 511 fix (`b1ad3a8`) and the phone/verification commits are
almost certainly not live. Stop the stray `next dev` on :3000 first — it holds
`.open-next` and will fail the build.

```bash
npm run build:cf && npm run deploy:cf
```

**1. Reset.** Against the production database:

```sql
truncate orders, order_counters restart identity;
```

**2. Insert one test order.** Column list derived from
[schema.sql:18-48](../src/lib/db/schema.sql#L18) — every NOT NULL column, jsonb
payloads shaped as `resolveOrderLine` produces them. `print_attempts` defaults
to 0, so the order is claimable immediately:

```sql
insert into orders (
  tenant_id, order_number, business_date, status, idempotency_key,
  items, totals, customer, phone_verified_at, pickup_at, ready_from, ready_to
) values (
  'nmc', 'T-001', current_date, 'QUEUED', 'manual-t001',
  '[{"itemId":"kung-pao-chicken","nameEn":"Kung Pao Chicken","nameZh":"宮保雞丁",
     "sizeId":"regular","sizeLabel":"Regular","sizeLabelZh":null,
     "modifiers":[],"specialInstructions":null,
     "quantity":2,"unitCents":1495,"lineCents":2990}]'::jsonb,
  '{"subtotalCents":2990,"taxCents":232,"tipCents":0,"totalCents":3222}'::jsonb,
  '{"name":"Bring-up Test","phone":"+16195550148"}'::jsonb,
  now(), now() + interval '20 minutes', now() + interval '20 minutes',
  now() + interval '25 minutes'
);
```

**3. Fetch the ticket by curl BEFORE letting the printer near it.** Phase 1
found the PNG conforms to everything Star documents, but the alpha diagnosis is
inference, not a quoted rule — so confirm the bytes yourself first. This costs
one minute and tells you whether to expect 511 again:

```bash
curl -s -o /tmp/t.png -D - "https://<host>/api/print/$CLOUDPRNT_SECRET?mac=00:11:62:55:24:d4&type=image/png"
```

Expect `content-type: image/png`, ~75–100 KB, and:

```bash
node -e "const b=require('fs').readFileSync('/tmp/t.png');console.log('w',b.readUInt32BE(16),'h',b.readUInt32BE(20),'depth',b[24],'colorType',b[25],'interlace',b[28])"
```

Must print `w 576 … depth 8 colorType 2 interlace 0`. Anything else and stop —
the deploy is stale.

Note this GET **counts an offer**, so re-insert or `requeueForPrint` before
step 4 if you want a clean attempt count.

**4. Let the printer poll.** It is pinned to MAC `00:11:62:55:24:d4` and polls
every 10s. Watch:

```bash
npx wrangler tail --format pretty
```

**Expected success signature:**

```
POST /api/print/<secret>   200   {"jobReady":true,"mediaTypes":["image/png"],
                                  "jobToken":"T-001","deleteMethod":"DELETE"}
GET  /api/print/<secret>   200   content-type: image/png   (no [cloudprnt] render failed)
DELETE /api/print/<secret> 200   (no "reported result code" warning)
                                 [cloudprnt] T-001 printed
```

Then:

```sql
select order_number, status, printed_at, print_attempts, last_print_error
  from orders where order_number = 'T-001';
```

Expect `PRINTED`, a non-null `printed_at`, and `last_print_error` null.

**Failure signatures to distinguish:**
- `[cloudprnt] T-001 reported result code 511` → PNG still rejected. Next move
  is 1-bit greyscale (colour type 0, `bitDepth: 1`) in `png.ts` — see §1.3.
- `[cloudprnt] poll failed: timeout exceeded when trying to connect` → the
  connection fix regressed or never deployed; run `npm run torture:print`.
- `[cloudprnt] render failed for T-001` → renderer, not format; the message
  carries the real error.

---

## VERDICT

**A printed ticket is one deploy and one printer poll away, blocked by nothing
known in code — but the 511 fix has never been seen by the hardware, and the
current tree has never been through `build:cf`.**

Ranked residual risk:

1. **511 recurs** — the alpha diagnosis is inference, not documented rule.
   Mitigation is written and small (1-bit).
2. **Nothing is deployed** — the last successful Cloudflare build predates the
   PNG fix entirely.
3. **Requeued orders never re-alert** (§3.1) — a live safety-net gap, unrelated
   to first print but real before launch.
