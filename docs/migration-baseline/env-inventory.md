# Env inventory — captured at `pre-cloudflare-migration` (6de266f)

Every environment variable the code reads, and where it is read from. This is
the input to Phase 5's secrets split.

Two access paths exist today:

- **`process.env.X` directly** — 8 distinct names, mostly in modules that
  predate `tenant.server.ts`.
- **`env("X")` / `required("X")` / `intEnv("X")` inside
  `src/config/tenant.server.ts`** — everything else, already centralized.

`process.env` is the seam that matters for Workers: `nodejs_compat` bridges
much of it, but the adapter's sanctioned access is `getCloudflareContext().env`.
Phase 3 centralizes.

## Direct `process.env` reads

| Variable | Read at | Notes |
|---|---|---|
| `DATABASE_URL` | [postgres.ts:29,35](../../src/lib/db/postgres.ts#L29) | **Becomes Hyperdrive** in Phase 3 |
| `DATABASE_POOL_MAX` | [postgres.ts:47](../../src/lib/db/postgres.ts#L47) | default 4; must shrink for per-isolate use |
| `ADMIN_DASH_PASSWORD` | [kitchenSession.ts:32](../../src/lib/auth/kitchenSession.ts#L32) | secret |
| `CLOUDPRNT_SECRET` | [status.ts:11](../../src/lib/print/status.ts#L11) | secret; presence check only |
| `NODE_ENV` | kitchenSession.ts:114, session.ts:102, ticket/preview:84 | framework-provided |
| `TENANT_ID` | scripts/dev-orders-db.ts:25 | script only |
| `TENANT_TIMEZONE` | scripts/dev-orders-db.ts:26 | script only; **undocumented alias** of `RESTAURANT_TIMEZONE` |
| `ORDER_NUMBER_PREFIX` | scripts/dev-orders-db.ts:199 | script only |

## Read through `src/config/tenant.server.ts`

Secrets (→ `wrangler secret put`):

`ADMIN_DASH_PASSWORD`, `OTP_SIGNING_SECRET`, `CLOUDPRNT_SECRET`, `CRON_SECRET`,
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`,
`TWILIO_MESSAGING_FROM`, `OWNER_ALERT_PHONE`

Public config (→ plain `vars` in wrangler config):

`TENANT_ID`, `RESTAURANT_TIMEZONE` (+ `TENANT_TIMEZONE` alias),
`TENANT_TAX_RATE_BPS`, `TAX_RATE`, `ORDER_NUMBER_PREFIX`,
`PICKUP_LEAD_MINUTES`, `PICKUP_SLOT_INTERVAL_MINUTES`,
`ONLINE_ORDERING_CUTOFF_MINUTES`, `ONLINE_ORDERING_HOURS`,
`MAX_ORDERS_PER_PHONE_PER_DAY`, `MAX_PICKUP_HOURS`, `TIP_PRESETS`,
`CLOUDPRNT_BUZZER`, `CLOUDPRNT_PRINTER_MAC`

Documented in `.env.example` but read by **no code** (operator convenience
only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Vercel-specific reads

**None.** `rg "VERCEL_"` over `src/` and `scripts/` returns nothing, so Phase
1.5's "replace `VERCEL_*` reads" has no work to do. The only Vercel coupling is
`vercel.json` (cron) and `outputFileTracingIncludes` in `next.config.ts`.

## Already-known gaps carried in from before this migration

- `TENANT_TIMEZONE` is accepted as an alias at
  [tenant.server.ts:160](../../src/config/tenant.server.ts#L160) but is absent
  from `.env.example`.
- `TENANT_TAX_RATE_BPS=775` is a ⚠️ TODO(confirm) — the Chula Vista rate has
  never been verified with the owner.

## Baseline state — nothing broken

`npx tsc --noEmit` clean (0 lines of output), `next build` clean, 21 routes,
`ticket:sample` renders all three fixtures. No pre-existing failures to
disentangle from migration regressions.

Ticket baselines (md5, for the Phase 2 parity comparison):

```
16f3087c8d75a16e0930fb4d91fa3a37  ticket-sample.png          576x1623
5cc74f081a135e9dac1afb8562af156a  ticket-sample-reprint.png  576x1623
697efcd23e83cc9f9dfd721a8c263290  ticket-sample-long.png     576x2350
```
