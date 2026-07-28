# Printer readiness — what stands between this tree and a real ticket

**Scope:** one question only — what must change or be added before a Star
TSP143IVUE at 543 Telegraph Canyon Rd prints a Chinese kitchen ticket.

**Written against:** `chore/purge-clover-remnants` @ `1f6d4aa`, after the Clover
purge. Verified by reading the tree, not by trusting earlier audits.

**This document changes no code.** Several items below are one-line fixes; they
are reported, not made, on purpose.

Each list is ordered by **dependency** — do the earlier items first — not by
importance.

---

## List A — Code changes still required

### A1. `/api/print/[secret]` is missing from `outputFileTracingIncludes` — **BLOCKING, production-only**

**What.** The ticket renderer reads its font subset off the filesystem at
request time ([font.ts](../src/lib/ticket/font.ts), served from
`public/fonts/`). Next's trace analyzer cannot see a path built at runtime, so
each route that renders a ticket must be named explicitly. The route the
**printer itself fetches from** is not named.

**Where.** [next.config.ts:21-25](../next.config.ts#L21) — exact current state
after the Job 1 purge:

| Key present | Route exists? | Renders a ticket? |
|---|---|---|
| `/api/ticket/preview` | yes | yes |
| `/api/kitchen/orders/[id]` | yes | yes |
| `/api/kitchen/orders/[id]/ticket` | yes | yes |
| **`/api/print/[secret]`** | **yes** | **yes — this is the printer's route** | ❌ **ABSENT** |

One stale entry, `"/api/checkout"`, pointed at the Clover prepaid route deleted
in `74c64ba`; it was removed in `0bb921e` (Job 1). No other stale entries remain
— every remaining key resolves to a route in the build output.

**Why it is the worst kind of defect.** It cannot reproduce in dev, where the
font is on disk anyway. In production the render throws ENOENT, and
[route.ts:194-200](../src/app/api/print/[secret]/route.ts#L194) treats a render
failure as *our* bug that will not fix itself — it calls
`recordPrintAttempt(ok:false)` and returns 500 **immediately, without retrying**.
So the failure mode is not "slow tickets", it is *every order lands in
`PRINT_FAILED`* while the printer sits there looking healthy.

**Fix.** Add one line:
```ts
"/api/print/[secret]": ["./public/fonts/**"],
```

**Who / how long.** Code · 2 minutes to edit, plus a deploy. **Do this before
the printer is plugged in**, because the curl smoke test in List C will pass
against a broken build only if you test the preview route instead of the print
route.

---

### A2. The OTP token is still signed with `ADMIN_DASH_PASSWORD` — open

**What.** The phone-verification cookie — the thing that stands in for a card as
the anti-abuse control — is HMAC-signed with the shared kitchen password.

**Where.** [session.ts:38-40](../src/lib/otp/session.ts#L38):
```ts
function signingKey(): string {
  return requireAdminPassword();
}
```
The trade is already documented honestly in the `⚠️ TODO(confirm)` at
[session.ts:31-36](../src/lib/otp/session.ts#L31).

**Consequence.** Rotating the kitchen password silently invalidates every
in-flight verification — a customer mid-order has to re-verify. It also couples
a password staff will read aloud to each other to a signing key.

**Fix.** Introduce `OTP_SIGNING_SECRET`, fall back to `requireAdminPassword()`
when unset so no deploy breaks, and document it in `.env.example`.

**Who / how long.** Code · ~20 minutes. **Not blocking the first ticket.**

---

### A3. A failed alert SMS never retries — **confirmed bug**

**What.** The unprinted-order cron claims the order *before* it sends, and a
send failure only logs.

**Where.** [route.ts:101-122](../src/app/api/cron/unprinted-alert/route.ts#L101):
```ts
const claimed = await markAlerted(tenant.tenantId, order.id);   // line 106 — claim
if (!claimed) continue;
...
const result = await sendSms(owner, body);                       // line 115 — send
if (result.sent) alerted++;
else { console.error(...) }                                      // line 117 — no rollback
```

`markAlerted` stamps `alerted_at`, and `findUnprintedForAlert` only returns rows
where it is null. So a **transient** Twilio failure — a timeout, a 500, a
momentarily-expired token — permanently silences the alert for that order. The
owner is never told, and this is the one safety net the whole no-prepayment
design leans on.

The claim-first ordering is deliberate and correct for concurrency (the comment
at lines 103-105 explains it: better a missed duplicate than two texts). The bug
is the missing compensating action, not the ordering.

**Fix.** On `!result.sent`, clear `alerted_at` so the next sweep retries — or
treat the stamp as a short lease and re-claim after N minutes. The first is
~5 lines in the repository plus a call here.

**Who / how long.** Code · ~30 minutes including a `verify:orders` assertion.
Not blocking the first ticket, but it should be fixed before the restaurant
relies on the alert.

---

### A4. Exposed by Job 1 — judgment calls, not defects

- **Tip surface survives from the prepaid era.** `tipCents`
  ([types.ts:98](../src/lib/orders/types.ts#L98), persisted in the `totals`
  jsonb), the conditional TIP line on the ticket
  ([render.tsx:367](../src/lib/ticket/render.tsx#L367)), and `TIP_PRESETS` →
  `tipPresets` in the browser-visible tenant config. Every writer hardcodes
  `tipCents: 0` and `TIP_PRESETS` ships empty, so it is inert. **I did not
  delete it** — a counter tip is a real thing a register may want, removing a
  required field touches the whole orders path, and 38 adversarial checks all
  refuted it as payment code. Flagging it as yours to decide.
- **No schema fix was required.** `schema.sql`, the migration, the TypeScript
  union, and `repository.ts` were checked against each other on all eight points
  and agree; all 17 columns `repository.ts` touches exist in `schema.sql`. A
  fresh Supabase project running only `schema.sql` will not break at runtime.
  Detail in the Job 1 report.
- **Cosmetic, not worth a commit:** the migration does not refresh
  `comment on table orders`, so a database upgraded via `001` keeps the old
  "Paid pickup orders… prevents a double charge" comment text while a fresh one
  gets "Unpaid by design". Zero runtime effect. Since the real Supabase project
  will run `schema.sql` (not the migration), this never manifests.

---

## List B — External setup (no code)

**I cannot see the Vercel project, the Supabase project, or the Twilio console
from here.** Per the rule that an env var referenced in code but absent from the
deployment is NOT DONE, everything below that depends on those systems is marked
**UNVERIFIABLE — assume NOT DONE until you confirm**. What I *can* verify is
what the code demands, which is what makes the checklist trustworthy.

### B1. Supabase project + `schema.sql` applied — UNVERIFIABLE / assume NOT DONE

`DATABASE_URL` is empty in [.env.example](../.env.example), and the only
`.env.local` in the tree was deleted in Job 1 (it contained a single orphan
`REVALIDATE_SECRET` and no database URL). So nothing in this working tree has
ever pointed at a real Supabase instance.

Apply **`src/lib/db/schema.sql`** — *not* `migrations/001_*.sql`. The migration
upgrades a Clover-era database that never existed in production; running it on a
fresh project does nothing useful and its `drop column`/`drop table` statements
are meaningless there.

Use the **pooled** connection string (port **6543**, PgBouncer transaction
mode). Port 5432 will exhaust connections from serverless functions.

*Owner/Marvin · ~30 min.*

### B2. Vercel environment variables

Every variable the code actually reads, enumerated from
[tenant.server.ts](../src/config/tenant.server.ts) and direct `process.env`
reads. "Documented" = present in `.env.example`.

| Variable | Required? | Documented | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** — ordering dead without it | ✓ | pooled, **port 6543** |
| `DATABASE_POOL_MAX` | no (default 4) | ✓ | keep small on serverless |
| `TENANT_ID` | yes | ✓ | `nmc` |
| `RESTAURANT_TIMEZONE` | yes | ✓ | `America/Los_Angeles` |
| `TENANT_TIMEZONE` | no | **✗ undocumented** | accepted alias, [tenant.server.ts:160](../src/config/tenant.server.ts#L160) |
| `TENANT_TAX_RATE_BPS` | yes | ✓ | `775`; ⚠️ rate itself unconfirmed with owner |
| `TAX_RATE` | no | ✓ | decimal fallback if bps unset |
| `ORDER_NUMBER_PREFIX` | no | ✓ | `A` |
| `PICKUP_LEAD_MINUTES` | no | ✓ | |
| `PICKUP_SLOT_INTERVAL_MINUTES` | no | ✓ | |
| `ONLINE_ORDERING_CUTOFF_MINUTES` | no | ✓ | |
| `ONLINE_ORDERING_HOURS` | no | ✓ | derived from dine-in hours when unset |
| `MAX_ORDERS_PER_PHONE_PER_DAY` | no | ✓ | ⚠️ 5/day is a guess |
| `MAX_PICKUP_HOURS` | no | ✓ | |
| `TIP_PRESETS` | no | ✓ | ships empty; see A4 |
| `TWILIO_ACCOUNT_SID` | **yes** | ✓ | order flow refuses without Twilio |
| `TWILIO_AUTH_TOKEN` | **yes** | ✓ | |
| `TWILIO_VERIFY_SERVICE_SID` | **yes** | ✓ | |
| `TWILIO_MESSAGING_FROM` | for alerts | ✓ | OTP works without it; **the owner alert does not** |
| `CLOUDPRNT_SECRET` | **yes** | ✓ | the print endpoint's only credential |
| `CLOUDPRNT_PRINTER_MAC` | no | ✓ | see C5 — pin after bring-up |
| `CLOUDPRNT_BUZZER` | no (default `off`) | ✓ | see C6 |
| `ADMIN_DASH_PASSWORD` | **yes** | ✓ | `/kitchen` **and** the OTP HMAC (A2) |
| `OWNER_ALERT_PHONE` | **yes in practice** | ✓ | without it the safety net silently no-ops |
| `CRON_SECRET` | no | ✓ | unset = endpoint open (returns counts only) |
| `SUPABASE_URL` | **no — read by zero code** | ✓ | operator convenience only |
| `SUPABASE_SERVICE_ROLE_KEY` | **no — read by zero code** | ✓ | operator convenience only |

Two documentation gaps, neither blocking: `TENANT_TIMEZONE` is accepted but
undocumented, and the two `SUPABASE_*` slots are documented as unused (accurate
— nothing reads them; `@supabase/supabase-js` was removed in Job 1).

*Marvin · ~30 min.*

### B3. Twilio account + Verify service — UNVERIFIABLE / assume NOT DONE

Create the Verify service at console.twilio.com → Verify → Services. Note that
`TWILIO_MESSAGING_FROM` is separate: Verify uses its own sender for OTP, but the
**owner alert and order-ready texts need an outbound number or Messaging Service
SID**. Configuring Verify alone leaves the safety net mute.

*Owner/Marvin · ~30-45 min including A2P registration if the number is new.*

### B4. Vercel plan must allow minute-level cron — UNVERIFIABLE, **likely blocking the alert**

[vercel.json](../vercel.json) declares `"schedule": "* * * * *"` for
`/api/cron/unprinted-alert`. Vercel's **Hobby plan restricts cron to once per
day**; minute-level requires Pro. On Hobby this either fails to deploy or
silently runs daily, which makes a 2-minute unprinted threshold meaningless.

**Check this before trusting the alert.** *Marvin · 5 min to check.*

### B5. `verify:orders` against the real database — **NOT DONE**

[BUILD_STATUS.md:101](./BUILD_STATUS.md#L101) records **40/40 passing**, but
[verify-orders.ts:7-8](../scripts/verify-orders.ts#L7) shows those ran against
`embedded-postgres` — a real Postgres binary, but a throwaway local one. The
script honours an existing `DATABASE_URL` and scopes itself to a unique tenant
id, so it is safe to point at Supabase.

**There is no record anywhere in the repo of it having been run against
Supabase.** The concurrency and idempotency proofs are therefore proofs about
local Postgres, not about PgBouncer transaction-mode pooling — which is exactly
where a 50-way concurrent allocation is most likely to behave differently.

*Marvin · 10 min once B1 and B2 are done. Worth doing.*

---

## List C — Printer bring-up sequence

### C1. Curl smoke test — **before the printer arrives**

Copy-paste; substitute only `<SECRET>` (your `CLOUDPRNT_SECRET`) and your
domain. Requires A1 deployed, B1 and B2 done, and **at least one order sitting
in `QUEUED`** (place one through the site, or seed one).

`CLOUDPRNT_PRINTER_MAC` unset means the `mac` parameter is optional
([cloudprnt.ts:145-151](../src/lib/print/cloudprnt.ts#L145) returns true when no
MAC is pinned), so these work before you know the printer's MAC.

**1 — Poll. Expect `{"jobReady":true,...}`; `{"jobReady":false}` means no queued order.**
```bash
curl -sS -X POST "https://<your-domain>/api/print/<SECRET>" -H "Content-Type: application/json" -d '{"statusCode":"200%20OK","printerMAC":"00:11:62:00:00:01"}'
```

**2 — Fetch the job. Expect PNG bytes (`image/png`, non-zero length). This is the step A1 breaks.**
```bash
curl -sS -D - -o /tmp/ticket.png "https://<your-domain>/api/print/<SECRET>?type=image/png" && file /tmp/ticket.png
```

**3 — Confirm the print. Expect HTTP 200; the order moves to `PRINTED`.**
```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE "https://<your-domain>/api/print/<SECRET>?code=200"
```

If step 2 returns **500** with an ENOENT in the Vercel logs, A1 is not deployed.
If it returns **404**, no job is in flight — re-run step 1.

*Marvin · 15 min.*

### C2. Printer on the network

Power up on Ethernet with DHCP. Hold **FEED** while powering on to print the
self-test: it reports the **IP address**, the **MAC address** (needed for C5),
and the **firmware version** (needed for C6). Record all three.

*Marvin · 10 min.*

### C3. Point the printer at us

Browse to `http://<printer-ip>/` → **CloudPRNT** configuration. Set:

```
https://<your-domain>/api/print/<CLOUDPRNT_SECRET>
```

The secret is a **path segment, not a query parameter** — the route is
`/api/print/[secret]`. Set the poll interval to 3-5 seconds. Leave the
CloudPRNT username/password empty; the URL secret is the credential.

*Marvin · 15 min.*

### C4. First real order end-to-end

Place a genuine order through the site with a real phone number (OTP will text
you). Watch it go `QUEUED` → printer polls → paper → `PRINTED` on `/kitchen`.
Confirm the ticket shows the order number, pickup time, 中文 where available,
and `COLLECT PAYMENT`.

*Marvin · 20 min.*

### C5. Pin the printer MAC

Once C2 gives you the MAC, set `CLOUDPRNT_PRINTER_MAC` in Vercel (any separator
style). After this a leaked URL alone cannot drain the queue — polls from any
other MAC are ignored. Redeploy and re-run C1 **with** `&mac=<MAC>` to confirm
you did not lock out your own printer.

*Marvin · 10 min.*

### C6. Buzzer bench test — **and what the code does today**

**What the code does now:** `CLOUDPRNT_BUZZER` defaults to **`off`**, so
[peripheralHeaders()](../src/lib/print/cloudprnt.ts#L211) returns an **empty
object** and **no audible alert is sent at all**. Nothing buzzes until you set
the env var.

**How it works when enabled:** the peripheral command travels in the **HTTP
response headers of the job GET**, not in the job body — which is why it works
with PNG, a format that cannot carry device commands. Two modes:

- `drawer` → `X-Star-CashDrawer: end`. **Correct for this restaurant**, whose
  buzzer is wired into the cash-drawer (DK) port. **Do not use it if a real cash
  drawer is ever attached** — the till would pop on every ticket.
- `buzzer` → `X-Star-Buzzerendpattern: 1`. For a dedicated buzzer terminal.
- `both` → sends both headers.

**The honest uncertainty**, carried over from the earlier investigation and
still unresolved: Star's guides do not state which byte sequence the buzzer
headers emit, and the two guides disagree on the minimum IFBD firmware
(1.1.0 vs 1.3). Requirements are TSP100IV 1.0+, mC-Print2/3 1.2+, or
IFBD-HI01X/HI02X. An unsupported printer **ignores an unknown header rather than
failing the job**, so enabling this can waste a buzz but never a ticket.

**Bench test before service.** Set `CLOUDPRNT_BUZZER=drawer`, run C1 step 2, and
listen. If silent, check firmware from the C2 self-test, then try `buzzer`.

*Marvin · 20 min.*

---

## List D — Content that gates ticket quality (not printing)

Nothing in this list stops paper coming out. All of it changes what the paper
says.

### D1. 中文 coverage — **34 of 138 items (24.6%)**

Measured by building the real catalogue via `catalogMenu()`, and independently
confirmed by `npm run ticket:sample`, which reports the same figure.

- **104 items (75.4%) have no `nameZh`** and print the English name with the
  `⚠ EN` marker ([render.tsx:41](../src/lib/ticket/render.tsx#L41)).
- **2 of 11 categories** have no 中文: *Specials*, *Sizzling Hot Pot*.
- Whole sections are bare — **all 9 Soups, all 8 Appetizers**, and every
  *Specials* item including the ones the homepage spotlights (Honey Walnut
  Shrimp, Orange Flavored Chicken, Upside Down Pan Fried Noodles).

**By catalogue** three quarters of tickets print the fallback. By **sales mix**
it will be worse than that number suggests, because the un-translated set
includes the house specials.

This is not a blocker — a `⚠ EN` ticket is readable and correct — but it is the
gap between a working ticket and a good one.

*Owner (the family must supply the names; nothing here may invent a translation)
· the long pole in this document.*

### D2. Font subset — **CURRENT, verified programmatically**

Checked properly rather than assumed: I extracted the glyph set the ticket can
actually emit via the app's own `collectTicketGlyphs()`, then parsed the **real
cmap** out of both committed TTFs (formats 4 and 12) rather than trusting
`ticket-font-coverage.json`.

| | count |
|---|---|
| glyphs the ticket can emit | 215 |
| cmap codepoints, `NotoSansTC-Ticket-Regular.ttf` | 215 |
| cmap codepoints, `NotoSansTC-Ticket-Bold.ttf` | 215 |
| codepoints in `ticket-font-coverage.json` | 215 |
| **missing from either weight** | **0** |

**No tofu (□) will print.** `build-ticket-font.ts` has been run since the last
`nameZh` addition, and `subset-font` is installed, so it can be re-run.

⚠️ **Re-run `npm run build:ticket-font` after any D1 work** — every new 中文
name is a new glyph, and a missing one prints as tofu on real paper.

### D3. Party-tray prices — **NOT VERIFIED, and the file says so**

[party-trays.ts](../src/data/party-trays.ts) carries **12 tray prices for 138
items**. Its own provenance header is blunt: the values were carried over from
the deleted `seed-menu.ts`, where they were **flagged as estimates rather than
transcriptions**. The *individual* prices were verified against `menu.ts`
(15 of 16), which makes the id mapping trustworthy — but that says nothing about
the tray prices themselves.

Items absent from the map are sold single-size, which is the safe default: an
item with no tray option cannot be mispriced. **The 12 that are present can be.**

*Owner · check all 12 against the printed menu (rev. 9/25) before any tray is
sold. ~20 min with the menu in hand.*

---

## Closing

> **If the printer arrived today, the first real ticket is ~4 hours of work
> away, and the blocking item is the external setup that has never been done —
> Supabase, the Vercel environment, and Twilio — with the one-line
> `/api/print/[secret]` font-tracing fix as the thing most likely to be
> forgotten, because it is the only defect that cannot fail anywhere except
> production.**

Breakdown of that ~4 hours, assuming nothing goes wrong: A1 fix and deploy
(15 min) → Supabase project and `schema.sql` (30 min) → Vercel env vars
(30 min) → Twilio account and Verify service (45 min) → curl smoke test
(15 min) → printer network and CloudPRNT URL (25 min) → first real order
(20 min) → MAC pin and buzzer test (30 min).

Two honesty notes on that estimate. It assumes Twilio A2P registration is not
required or already done — if a new number needs 10DLC registration, add
**days**, not hours, and that becomes the blocking item outright. And it counts
only work to the *first* ticket: it excludes A2, A3, D1, and D3 entirely.

The ticket that comes out at the end of those four hours will be correct,
printable, and will show English names with `⚠ EN` for about three quarters of
the menu.
