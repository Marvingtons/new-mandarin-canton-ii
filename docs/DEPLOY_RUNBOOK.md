# Deploy runbook — tonight's external setup

Copy-paste order. Steps 1-3 can be done in any order, but **start step 3's A2P
registration first** — it is the only thing here measured in days.

Companion to [PRINTER_READINESS.md](./PRINTER_READINESS.md), which explains
*why*. This is just the *how*.

---

## 0. Do this first, then come back

**Twilio A2P / 10DLC campaign registration.** It gates the **owner-alert and
order-ready texts** — not the OTP, which goes through Verify and needs no
campaign. Approval takes **days**, and it runs in the background while you do
everything else. If you do nothing else tonight, do this.

console.twilio.com → Messaging → Regulatory Compliance → A2P 10DLC.

---

## 1. Supabase

1. Create the project. Any region; `us-west-1` is closest.
2. **SQL Editor → paste all of [`src/lib/db/schema.sql`](../src/lib/db/schema.sql) → Run.**
   - **Not** the files in `src/lib/db/migrations/`. Those upgrade an existing
     older database. This project is fresh, so `schema.sql` already contains
     everything they would add — including `alert_attempts` from `002`.

   ⚠️ **An ALREADY-DEPLOYED database needs `004_print_segments.sql` and
   `005_print_job_key.sql` before the next deploy, not after.** The print path
   selects `print_segment`, `print_segments` and `print_job_key` on every poll,
   job GET and DELETE confirmation; without those columns the poll publishes no
   body and the DELETE cannot mark an order PRINTED. Migrations are
   `add column if not exists` and safe to re-run.
3. Copy the **pooled** connection string:
   Project Settings → Database → Connection string → **Transaction pooler**.
   - It must contain **port `6543`**, not `5432`. The direct port exhausts
     connections from serverless functions.
   - Shape: `postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres`
4. Sanity check — expect `orders` and `order_counters`:
   ```sql
   select table_name from information_schema.tables where table_schema = 'public';
   ```

---

## 2. Vercel environment variables

Enumerated from source (`src/config/tenant.server.ts` plus every direct
`process.env` read), not from memory. Set for **Production**.

### Required — the app does not work without these

| Variable | What it is | How to get it |
|---|---|---|
| `DATABASE_URL` | Supabase Postgres, **pooled, port 6543** | step 1.3 |
| `OTP_SIGNING_SECRET` | HMAC key for the phone-verification cookie. Its own secret — never reuse the kitchen password | `openssl rand -hex 32` |
| `ADMIN_DASH_PASSWORD` | Shared password for the `/kitchen` board | pick something staff can type |
| `CLOUDPRNT_SECRET` | The print endpoint's only credential; travels in the URL | `openssl rand -hex 32` |
| `TWILIO_ACCOUNT_SID` | Twilio account | step 3 |
| `TWILIO_AUTH_TOKEN` | Twilio account | step 3 |
| `TWILIO_VERIFY_SERVICE_SID` | The Verify service (`VA…`) | step 3 |
| `OWNER_ALERT_PHONE` | Owner's mobile, E.164 (`+1619…`). Unset = the unprinted-order alert silently no-ops | — |
| `TENANT_TAX_RATE_BPS` | Sales tax in basis points. `875` = 8.75% | ✓ Chula Vista rate, confirmed with the owner |

### Needed for outbound SMS

| Variable | What it is |
|---|---|
| `TWILIO_MESSAGING_FROM` | Sending number (`+1…`) or Messaging Service SID (`MG…`). **OTP works without it** — Verify uses its own sender — but the owner alert and order-ready texts do not. Gated by step 0. |

### Optional — sensible defaults if unset

| Variable | Default | Notes |
|---|---|---|
| `TENANT_ID` | `nmc` | every row is scoped by it |
| `RESTAURANT_TIMEZONE` | `America/Los_Angeles` | `TENANT_TIMEZONE` is an accepted alias |
| `ORDER_NUMBER_PREFIX` | `A` | → `A-017` |
| `PICKUP_LEAD_MINUTES` | `20` | prep time before the earliest slot |
| `PICKUP_SLOT_INTERVAL_MINUTES` | `15` | slot granularity |
| `ONLINE_ORDERING_CUTOFF_MINUTES` | `30` | ⚠️ confirm with the owner |
| `ONLINE_ORDERING_HOURS` | derived from dine-in hours | JSON, all seven days if set |
| `MAX_ORDERS_PER_PHONE_PER_DAY` | `5` | ⚠️ a guess; it is the abuse ceiling |
| `MAX_PICKUP_HOURS` | `48` | how far ahead an order may be placed |
| `TAX_RATE` | — | decimal fallback, used only if `TENANT_TAX_RATE_BPS` is unset |
| `TIP_PRESETS` | empty | leave empty; tipping is the register's job |
| `DATABASE_POOL_MAX` | `4` | keep small on serverless |
| `CRON_SECRET` | — | unset leaves the cron endpoint open; it returns counts only, never order data |
| `CLOUDPRNT_PRINTER_MAC` | — | set in step 5, after the printer's MAC is known |
| `CLOUDPRNT_BUZZER` | `off` | `drawer` for this restaurant's DK-port buzzer; see step 6 |

**Read by no code** (documentation-only, safe to skip): `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`.

---

## 3. Twilio

1. Create the account; copy **Account SID** and **Auth Token** from the console
   home → `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
2. Verify → Services → **Create a Verify service**. Copy its SID (`VA…`) →
   `TWILIO_VERIFY_SERVICE_SID`.
3. Buy or pick a sending number, or create a Messaging Service (`MG…`) →
   `TWILIO_MESSAGING_FROM`.
4. Confirm step 0's A2P campaign is submitted.

---

## 4. Deploy, then the curl smoke test

Deploy to Vercel with the variables from step 2 in place.

**Place one real order first** so something is sitting in `QUEUED` — these
commands read the live queue.

Substitute only `<SECRET>` (your `CLOUDPRNT_SECRET`) and your domain. The `mac`
parameter is optional until step 5 pins one.

**1 — Poll for work.** Expect `{"jobReady":true,"mediaTypes":["image/png"],…}`.
`{"jobReady":false}` means nothing is queued.
```bash
curl -sS -X POST "https://<your-domain>/api/print/<SECRET>" -H "Content-Type: application/json" -d '{"statusCode":"200%20OK","printerMAC":"00:11:62:00:00:01"}'
```

**2 — Fetch the ticket.** Expect `content-type: image/png` and a non-zero body.
```bash
curl -sS -D - -o /tmp/ticket.png "https://<your-domain>/api/print/<SECRET>?type=image/png" && file /tmp/ticket.png
```

**3 — Confirm it printed.** Expect `200`. The order moves to `PRINTED`.
```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE "https://<your-domain>/api/print/<SECRET>?code=200"
```

**If step 2 returns 500:** check the Vercel logs. The order is *not* lost — a
render failure now keeps it `QUEUED` and the next poll retries, giving up only
at the third attempt. Re-run step 1 to see it re-offered.

**If step 2 returns 404:** no job is in flight. Re-run step 1.

---

## 4b. R2 bucket for print-job bodies — REQUIRED before printing

Four production cycles ended in `520 Download failed` on the job GET. The bytes
were fine; the way they left the Worker was not — OpenNext rebuilds a route's
`Response` as a stream, so it went out chunked, without a `Content-Length` the
firmware could rely on. The body is now an R2 object the printer fetches
directly, and the poll points at it with CloudPRNT's `jobGetUrl`.

1. Create the bucket and its expiry rule:
   ```bash
   wrangler r2 bucket create nmc-print-jobs
   wrangler r2 bucket lifecycle add nmc-print-jobs --name expire-print-jobs --prefix print-jobs/ --expire-days 1
   ```
   The lifecycle rule is the backstop, not the mechanism — a confirmed job
   deletes its own object within seconds. It matters because a ticket carries a
   customer's name and phone number.
2. **Connect a custom domain to the bucket.** Dashboard → R2 → `nmc-print-jobs`
   → Settings → Public access → Custom Domains → Connect Domain →
   `print-jobs.newmandarincantonii.com`. Cloudflare adds the DNS record.
   - **Do not enable the `r2.dev` domain.** It is rate-limited and not on our
     zone.
   - **It has to be a subdomain, not a path.** An R2 custom domain attaches a
     whole hostname; Cloudflare documents no way to bind a bucket to
     `newmandarincantonii.com/print-jobs/*`. Serving that path would require a
     Worker route, which is the thing being taken out of the download.
3. Set `PRINT_JOBS_PUBLIC_BASE` in `wrangler.jsonc` to that origin if you used a
   different hostname. Empty disables R2 entirely and the Worker serves job
   bodies itself — which is the configuration that produced the 520s.
4. Verify object delivery before involving the printer:
   ```bash
   scripts/verify-job-wire.sh 'https://print-jobs.newmandarincantonii.com/print-jobs/<key>.bin'
   ```
   Expect `content-length` present, no `content-encoding`, no `chunked`.

### If the printer still fails to download

Fall back by clearing `PRINT_JOBS_PUBLIC_BASE`, which sends job bodies back
through the Worker route — and then turn compression off for that path, since
the printer advertises `br` in `Accept-Encoding` and cannot decode it:

> Dashboard → your zone → **Rules → Compression Rules → Create rule**
> - Rule name: `print jobs uncompressed`
> - If: **URI Path** *starts with* `/api/print/`
> - Then: **Compression options** → set to **off** (remove all algorithms)
> - Deploy

Cloudflare honours `cache-control: no-transform` from the origin for this too,
and the job route already sends it — but a rule is the explicit belt to that
braces, and it is visible in the dashboard where the next person will look.

---

## 4c. R2 bucket for the hero footage — REQUIRED before the homepage has a hero

The hero video used to be served from `pub-364f647b29874b09922e1889f267c323.r2.dev`,
the bucket's development URL: 5,525,614 bytes with **no `Cache-Control` header at
all**, re-downloaded in full on every visit, and the largest single thing on the
page. Section 4b already says not to enable `r2.dev`; this was the same mistake in
a second bucket.

It is now a content-hashed object on our own zone. `src/lib/heroMedia.ts` names the
two files and will not fall back to anything if they are missing — the hero
degrades to the poster still, which is a designed state but not the intended one.

**A SEPARATE BUCKET FROM `nmc-print-jobs`, deliberately.** That bucket holds ticket
bodies carrying a customer's name and phone under a 24h expiry rule. Pointing a
second public hostname at it to save creating a bucket would put public marketing
media and customer PII behind one origin, and the expiry rule is prefix-scoped so
the two would need to stay carefully out of each other's way forever.

1. Create the bucket:
   ```bash
   wrangler r2 bucket create nmc-media
   ```
2. **Connect a custom domain.** Dashboard → R2 → `nmc-media` → Settings → Public
   access → Custom Domains → Connect Domain → `media.newmandarincantonii.com`.
   Cloudflare adds the DNS record. Do **not** enable the `r2.dev` domain — that is
   the thing being removed here.
3. Upload both encodes. **The `--cache-control` flag is not optional and is not
   `public/_headers`'s job**: R2 serves the `cacheControl` an object was written
   with, and a `_headers` rule cannot reach an object on a custom domain.
   ```bash
   wrangler r2 object put nmc-media/newmandarin-hero.46c01c36.webm \
     --file newmandarin-hero.46c01c36.webm \
     --content-type video/webm \
     --cache-control "public, max-age=31536000, immutable" --remote
   wrangler r2 object put nmc-media/newmandarin-hero.b11879a5.mp4 \
     --file newmandarin-hero.b11879a5.mp4 \
     --content-type video/mp4 \
     --cache-control "public, max-age=31536000, immutable" --remote
   ```
4. Verify before relying on it. Both must answer `200` with the immutable header
   and a `content-length` matching the table below:
   ```bash
   curl -sSI https://media.newmandarincantonii.com/newmandarin-hero.46c01c36.webm
   curl -sSI https://media.newmandarincantonii.com/newmandarin-hero.b11879a5.mp4
   ```

| file | bytes |
| --- | --- |
| `newmandarin-hero.46c01c36.webm` | 1,898,611 |
| `newmandarin-hero.b11879a5.mp4` | 2,553,620 |

### Re-encoding the footage

From the 1920x1080 24fps master. **Re-hash and rename after encoding** — the hash
in the filename is what makes `immutable` honest, so an encode that reuses a name
is a year-long stale cache with no way to tell from the page.

```bash
ffmpeg -i master.mp4 -c:v libvpx-vp9 -crf 40 -b:v 0 -deadline good -cpu-used 1 \
  -row-mt 1 -auto-alt-ref 1 -lag-in-frames 25 -pix_fmt yuv420p -an hero.webm
ffmpeg -i master.mp4 -c:v libx264 -crf 30 -preset slow -movflags +faststart -an hero.mp4
sha256sum hero.webm hero.mp4   # first 8 hex become the filename
```

`+faststart` on the mp4 is load-bearing: it moves the moov atom to the head so the
preloader's `preload="metadata"` fetch is a small read off the front of the file
rather than a seek to the end of it.

---

## 5. Printer

1. Power up on Ethernet with DHCP. Hold **FEED** while powering on for the
   self-test — it prints the **IP address**, **MAC address**, and **firmware
   version**. Write all three down.
2. Browse to `http://<printer-ip>/` → CloudPRNT. Set the server URL to exactly:
   ```
   https://<your-domain>/api/print/<CLOUDPRNT_SECRET>
   ```
   The secret is a **path segment, not a query parameter**. Poll interval 3-5s.
   Leave the CloudPRNT username/password empty — the URL secret is the credential.
3. Place a real order and watch it print. `/kitchen` should show it reach
   `PRINTED`.
4. Set `CLOUDPRNT_PRINTER_MAC` to the MAC from step 5.1 and redeploy. After
   this a leaked URL alone cannot drain the queue. Re-run step 4's command 1
   with `&mac=<MAC>` to confirm you have not locked out your own printer.

---

## 6. Buzzer (optional, bench test before service)

**Nothing buzzes by default** — `CLOUDPRNT_BUZZER` defaults to `off` and the
code sends no peripheral header at all.

Set `CLOUDPRNT_BUZZER=drawer` for this restaurant, whose buzzer is wired into
the cash-drawer (DK) port. **Do not use `drawer` if a real cash drawer is ever
attached** — the till would pop on every ticket. Use `buzzer` for a dedicated
buzzer terminal, or `both` to send both headers.

Requires firmware TSP100IV 1.0+, mC-Print2/3 1.2+, or IFBD-HI01X/HI02X. An
unsupported printer **ignores an unknown header rather than failing the job**,
so a wrong guess costs a buzz, never a ticket. Bench-test it: set the variable,
run step 4 command 2, and listen.

---

## 7. Post-deploy checks

1. **`verify:orders` against the real database — first run ever against
   non-local Postgres.** It scopes itself to a unique tenant id per run, so it
   is safe against Supabase, but it does write rows.
   ```bash
   DATABASE_URL="<your pooled 6543 url>" npm run verify:orders
   ```
   Expect **ALL CHECKS PASSED**. This is the only thing that proves the
   50-way concurrent number allocation and the idempotency guarantee hold under
   **PgBouncer transaction-mode pooling**, which is exactly where they are most
   likely to behave differently from local Postgres.

2. **One end-to-end OTP order** on the real site with a real phone: code
   arrives → order submits → appears on `/kitchen` → prints.

3. **Confirm the cron actually fires.** `vercel.json` asks for
   `* * * * *` (every minute) on `/api/cron/unprinted-alert`. **Vercel's Hobby
   plan caps cron at once per day**, which would make the 2-minute unprinted
   threshold meaningless. Check the plan, then check Vercel → your project →
   Cron Jobs for real execution timestamps.

4. **Prove the alert end-to-end**: place an order with the printer powered off,
   wait two minutes, confirm the owner's phone buzzes. A failed send now
   retries on the next sweep, up to five attempts, then stops and leaves
   `/kitchen` as the net.
