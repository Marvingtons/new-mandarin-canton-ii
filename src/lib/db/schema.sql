-- ---------------------------------------------------------------------------
-- New Mandarin Canton ordering platform — full schema
--
-- This file is the CURRENT desired state, and is idempotent: running it against
-- a fresh Supabase project creates everything. Incremental changes to an
-- already-deployed database live in src/lib/db/migrations/ and are numbered.
--
-- Multi-tenant by design: every row is scoped by tenant_id so a second
-- restaurant is a new row set, not a new database.
--
-- Money is INTEGER CENTS everywhere. No column here is a float, and nothing in
-- the orders path may introduce one.
--
-- NOTHING in this file is payment-related. Customers pay at the counter; a
-- verified phone number, not a card, is what makes an order real.
-- ---------------------------------------------------------------------------

create table if not exists orders (
  id                bigserial   primary key,
  -- Multi-tenant from day one. Tenant #2 is a new row set, not a new table.
  tenant_id         text        not null,
  -- Customer-facing daily number, e.g. 'A-017'.
  order_number      text        not null,
  -- Restaurant-local date that owns the daily sequence. NOT a UTC date: an
  -- 11pm order in Chula Vista must not roll onto tomorrow's ticket run.
  business_date     date        not null,
  status            text        not null,
  idempotency_key   text        not null,
  -- Resolved line items: nameEn, nameZh, size, modifiers (both languages),
  -- special instructions, and integer-cent unit/line totals.
  items             jsonb       not null,
  -- { subtotalCents, taxCents, tipCents, totalCents } — integers, always.
  totals            jsonb       not null,
  -- { name, phone } with phone in E.164.
  customer          jsonb       not null,
  -- NOT NULL on purpose: an unverified order cannot exist. This column is the
  -- schema-level statement of the anti-abuse rule.
  phone_verified_at timestamptz not null,
  pickup_at         timestamptz not null,
  -- The "ready around 6:45–6:50 PM" window, computed ONCE at order creation
  -- and read by the confirmation, the kitchen board, the ticket, and the
  -- order-ready text. Stored rather than recomputed so all four agree and a
  -- customer re-reading their confirmation does not watch the estimate move.
  -- Nullable: orders predating migration 003 have none and fall back to
  -- pickup_at.
  ready_from        timestamptz,
  ready_to          timestamptz,
  print_attempts    int         not null default 0,
  -- Where we are in a ticket the printer cannot take in one piece. A printer
  -- may declare a maximum decodable image height (Star's mono_len); a ticket
  -- taller than it is cut on blank rows and sent as consecutive jobs, and
  -- these two track that sequence across polls. print_segments is 0 until a
  -- job is handed over, then the total; print_segment is the next piece to
  -- send. Both return to 0 once the last piece is confirmed. The common case
  -- is a ticket that fits, where these stay 0 and 1 and nothing splits.
  print_segment     int         not null default 0,
  print_segments    int         not null default 0,
  -- The R2 object holding the body currently on offer, or NULL when none is
  -- published. The name ends in the sha256 of its own bytes, so it can only be
  -- derived by rendering; keeping it here is what stops every poll re-rendering
  -- a ticket that already exists, and is how a confirmation knows which object
  -- to delete. Cleared with the segment counters whenever the sequence resets.
  print_job_key     text,
  -- When a job body was last handed to the printer with jobReady:true.
  --
  -- Written by exactly one thing — an offer leaving the server — and cleared
  -- whenever the printer stops holding a body for this order (confirmed,
  -- revoked, or advanced to the next piece). NULL therefore means "the printer
  -- has nothing of ours in flight", which is the only state in which offering
  -- is free. Everything else waits out the confirmation window.
  --
  -- Deliberately NOT updated_at, which the offer path's own bookkeeping writes
  -- move: measuring patience against that column is what let one order print
  -- its copy-set several times over. See src/lib/print/entitlement.ts.
  --
  -- KEPT, but now INFORMATIONAL. The offer decision no longer reads this — it
  -- reads print_delivery_id / print_delivery_expires_at below. This column
  -- survives only to drive the "elapsed since offer" figure in the poll logs.
  print_offered_at  timestamptz,
  -- IDENTITY of the hand-over the printer is currently holding, or NULL when it
  -- holds nothing of ours. This — not a self-clearing timestamp — is what the
  -- offer path now measures against: offer only if this is NULL, or the
  -- delivery it names has expired. It points at a row in print_deliveries and
  -- is the token echoed on the confirming DELETE and carried in the job URL.
  -- Stamped and cleared in the same statement as the counters it travels with.
  print_delivery_id         uuid,
  -- When the in-flight delivery's confirmation window closes. Written in the
  -- SAME statement as print_delivery_id so the two can never drift apart, which
  -- is the whole point of moving off print_offered_at. NULL when nothing is in
  -- flight.
  print_delivery_expires_at timestamptz,
  -- Set ONLY by a CloudPRNT DELETE, i.e. the printer's own confirmation that
  -- paper came out. Never set optimistically when a job is handed over. On a
  -- split ticket this waits for the LAST piece, so a sequence that stalls
  -- half-printed stays visible to the board and the unprinted-order alert.
  printed_at        timestamptz,
  last_print_error  text,
  -- Stamped when the unprinted-order alert CLAIMS this order, before the SMS
  -- is sent, so two overlapping sweeps cannot both text about it.
  alerted_at        timestamptz,
  -- Owner-alert send attempts. A failed send releases the claim (alerted_at
  -- back to NULL) so the next sweep retries; this counter is what stops that
  -- becoming an infinite retry against a permanently bad number. At the
  -- ceiling the claim is left in place and the order stays visible on the
  -- kitchen board instead.
  alert_attempts    int         not null default 0,
  -- Where the order came from. 'web' is the online checkout; 'phone' and
  -- 'walk_in' are entered by staff on the POS screen. Same pipeline either way:
  -- same counter, same server-side pricing, same printer path.
  channel           text        not null default 'web',
  -- Free text from the POS, e.g. "paid by phone, card ending 4417". The POS
  -- never takes a card; this only records what happened on the terminal.
  payment_note      text,
  -- Internal staff note. Never printed. Also where a cancellation's reason goes.
  staff_note        text,
  -- Dine-in (migration 010). The table as staff call it, "4" or "4+5" for two
  -- pushed together; the labels a room allows live in lib/kitchen/floor-plan.ts.
  table_label       text,
  -- Party size. Guidance on the ticket, never a cap.
  guest_count       int,
  -- A later round of dishes for a party already seated. Prints 加菜 ADD-ON.
  is_addon          boolean     not null default false,
  -- When staff cleared the table. A dine_in row with this NULL is an open
  -- table; occupancy is derived from exactly that.
  table_cleared_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint orders_channel_check check (channel in ('web', 'phone', 'walk_in', 'dine_in')),

  constraint orders_guest_count_check check (guest_count is null or guest_count >= 1),

  constraint orders_status_check check (
    status in (
      'QUEUED',
      'PRINTED',
      'PRINT_FAILED',
      'ACCEPTED',
      'COMPLETED',
      'CANCELLED'
    )
  )
);

comment on table orders is
  'Pickup orders. Unpaid by design — payment happens at the counter. The unique index on (tenant_id, idempotency_key) is what prevents a double submit becoming two tickets.';

-- Idempotency is enforced HERE, not in application code. A duplicate submit
-- loses this insert and is handed the original confirmation.
create unique index if not exists orders_idempotency_uniq
  on orders (tenant_id, idempotency_key);

-- Two customers can never hold the same number on the same day.
create unique index if not exists orders_number_uniq
  on orders (tenant_id, business_date, order_number);

-- Drives the /kitchen board query.
create index if not exists orders_kitchen_idx
  on orders (tenant_id, business_date, status, created_at desc);

-- Order history: a date range, newest first, across every status.
create index if not exists orders_history_idx
  on orders (tenant_id, business_date, created_at desc);

-- Repeat-customer lookup on the POS. The phone lives in the customer jsonb.
create index if not exists orders_customer_phone_idx
  on orders (tenant_id, (customer->>'phone'));

-- Table occupancy on the POS floor plan: open dine-in rows only, so it stays
-- tiny however long the history grows.
create index if not exists orders_open_tables_idx
  on orders (tenant_id, table_label)
  where channel = 'dine_in' and table_cleared_at is null;

-- Drives the CloudPRNT claim and the unprinted-order alert sweep. Partial, so
-- it stays small: only orders that still need something to happen to them.
create index if not exists orders_print_queue_idx
  on orders (tenant_id, created_at)
  where status in ('QUEUED', 'PRINT_FAILED');

-- Atomic daily counter. A plain sequence will not do — it does not reset per
-- day, and a read-then-write in application code races under concurrency.
create table if not exists order_counters (
  tenant_id     text not null,
  business_date date not null,
  seq           int  not null default 0,
  primary key (tenant_id, business_date)
);

comment on table order_counters is
  'One row per tenant per business day. Incremented by a single atomic UPSERT so 50 concurrent submissions get 50 distinct numbers.';

-- ---------------------------------------------------------------------------
-- One row per HAND-OVER of a job body to the printer.
--
-- The record the database could not previously produce. An order printed its
-- copy-set and then printed it again, and nothing said why: the re-offer loop
-- decided from a timestamp it also cleared itself, so it could not tell a dead
-- print from a merely-late confirmation, and a printer that fetched the same
-- body twice on its own wrote nothing at all.
--
-- Each hand-over is now a row here with its own id. That id is the token the
-- printer is handed, echoes back on the confirming DELETE, and carries in the
-- job URL — so a confirmation closes the SPECIFIC delivery it names, a re-fetch
-- is counted, and "how many tickets did this order actually cause, and why?"
-- becomes a question SQL can answer. orders.print_delivery_id points at the row
-- currently in flight.
-- ---------------------------------------------------------------------------
create table if not exists print_deliveries (
  -- App-generated (crypto.randomUUID) so orders.print_delivery_id can be stamped
  -- in the same statement that claims the job, with no round-trip to read a
  -- server-side default back.
  id           uuid        primary key,
  -- Cascade so deleting an order takes its deliveries with it rather than
  -- leaving orphans behind an FK error.
  order_id     bigint      not null references orders (id) on delete cascade,
  tenant_id    text        not null,
  -- When this hand-over went out, and when its confirmation window closes.
  offered_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  -- When the printer first fetched the body, and how many times in total. A
  -- second fetch before confirmation is the silent double-print; it was
  -- invisible before because the GET path wrote nothing. fetch_count > 1 badges
  -- the kitchen card.
  fetched_at   timestamptz,
  fetch_count  int         not null default 0,
  -- Set by the confirming DELETE, with the code it carried. Once confirmed_at
  -- is set the delivery can never print again: its GET answers 410 Gone and a
  -- second confirmation is treated as a stale replay.
  confirmed_at timestamptz,
  confirm_code text,
  -- WHY this hand-over happened. 'manual_reprint' is the ONLY legitimate marker
  -- of a second ticket — an order that produced one without a manual_reprint
  -- delivery is a bug by definition.
  reason       text        not null,
  -- Who caused it: 'printer' for automatic offers, 'kitchen' for a manual 重印.
  -- ⚠️ TODO(confirm): the board is one shared password with no per-person
  -- identity (see src/lib/auth/kitchenSession.ts), so 'kitchen' is as
  -- fine-grained as this gets until real accounts exist.
  actor        text,
  created_at   timestamptz not null default now(),

  constraint print_deliveries_reason_check
    check (reason in ('first-offer', 'retry', 'manual_reprint'))
);

comment on table print_deliveries is
  'One row per hand-over of a job body to the printer. The audit trail behind duplicate-ticket diagnosis: offered/fetched/confirmed timestamps, a fetch count, and the reason. orders.print_delivery_id points at the in-flight row.';

-- The board aggregates deliveries per order on every 10s poll.
create index if not exists print_deliveries_order_idx
  on print_deliveries (tenant_id, order_id);

-- ---------------------------------------------------------------------------
-- What the printer is telling us, remembered between polls.
--
-- The CloudPRNT poll carries the printer's own state, and the server used to
-- read one bit of it. So a printer out of paper looked exactly like a healthy
-- one: it kept being handed jobs it could not print, each hand-over spent part
-- of a retry budget, and paper came back to a queue whose orders had already
-- been condemned. One row per tenant — one printer per restaurant, rewritten
-- every three seconds. Mutable state, not a log; the transitions go to the
-- Workers Logs.
-- ---------------------------------------------------------------------------
create table if not exists printer_status (
  tenant_id          text        primary key,
  -- The poll clock. "Offline" is not a flag the printer sets; it is this
  -- column going stale.
  last_seen_at       timestamptz not null default now(),
  online             boolean     not null default true,
  paper_out          boolean     not null default false,
  cover_open         boolean     not null default false,
  paper_low          boolean     not null default false,
  -- Verbatim, both fields, because the parser in lib/print/printerStatus.ts is
  -- deliberately conservative: when it misses a condition, this is the
  -- evidence needed to teach it.
  status_code        text,
  status_raw         text,
  printer_mac        text,
  -- When the current blocked spell began; cleared when it ends. The window the
  -- paper-restored requeue looks back over.
  blocked_since      timestamptz,
  -- Alert-once stamps, one per condition so an offline alert and a paper alert
  -- cannot silence each other. Cleared when the condition clears.
  offline_alerted_at timestamptz,
  paper_alerted_at   timestamptz,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- More than one printer (migration 011). Who each printer is, which channels it
-- prints and how many copies, which printer each hand-over went to, and who
-- changed any of that. printer_status above is the pre-011 single-printer row:
-- no longer written by the app, kept until a later migration drops it.
--
-- A fresh install has NO printers rows: the first MAC to poll is registered as
-- the active 'takeout' printer with every channel routed to it (see
-- lib/print/printers.ts, bootstrap), which is exactly the one-printer setup.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ printers

create table if not exists printers (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   text        not null,
  -- Normalized: lowercase hex, separators stripped, so "00:11:62:AA:BB:CC",
  -- "00-11-62-aa-bb-cc" and "001162aabbcc" are one printer. The same
  -- normalization printerMacAllowed already applies.
  mac         text        not null,
  -- What staff read on the banner: "外賣機 Takeout printer". NULL for a printer
  -- nobody has named yet; the UI falls back to the last four of the MAC.
  name        text,
  -- What it is FOR. Routing points at a role, never at a printer id, so a dead
  -- unit is replaced by giving the new MAC the old role: no route changes.
  -- NULL = unassigned (an unknown MAC that has polled but nobody has placed).
  role        text,
  -- Only active printers are routed to, failed over to, or offered jobs. An
  -- unknown MAC is inserted inactive and stays that way until assigned.
  active      boolean     not null default false,
  first_seen_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint printers_mac_format check (mac ~ '^[0-9a-f]{12}$'),
  constraint printers_role_check check (role is null or role in ('takeout', 'pos')),
  -- An active printer must know what it is for, or routing cannot reach it and
  -- it would sit polling, "online", and never print.
  constraint printers_active_has_role check (not active or role is not null),
  constraint printers_tenant_mac_key unique (tenant_id, mac)
);

-- One live printer per role. Two active 'pos' printers would make "the home
-- printer for phone orders" ambiguous. Swapping a unit is deactivate-old,
-- activate-new, in one transaction; this index makes a half-swap impossible.
create unique index if not exists printers_one_active_per_role
  on printers (tenant_id, role)
  where active;

comment on table printers is
  'One row per CloudPRNT client that has polled, keyed by MAC. role + active decide what it prints; an unknown MAC is inserted inactive with no role and receives nothing until an owner assigns it.';

-- ------------------------------------------------------------ printer_health

-- printer_status, per printer. Same polled columns, same edge logic in
-- lib/print/printers.ts; only the key changes. Kept apart from `printers`
-- because this row is rewritten every three seconds and `printers` is edited by
-- a person: mixing the two means an owner's rename races the poll's upsert.
create table if not exists printer_health (
  printer_id         uuid        primary key references printers (id) on delete cascade,
  tenant_id          text        not null,
  last_seen_at       timestamptz not null default now(),
  online             boolean     not null default true,
  paper_out          boolean     not null default false,
  cover_open         boolean     not null default false,
  paper_low          boolean     not null default false,
  status_code        text,
  status_raw         text,
  -- When the current paper-out / cover-open spell began, cleared when it ends.
  -- Failover reads it in-statement: blocked for 60s counts as down.
  blocked_since      timestamptz,
  -- When this printer became DOWN (silent 60s, or blocked 60s) and its tickets
  -- started going elsewhere; NULL while it is up. Stamped by the edge, read by
  -- the banner ("since 7:42"), the logs and the owner texts. NOT what decides
  -- routing: that is computed from last_seen_at / blocked_since inside the
  -- claim statement, so a stale value here cannot misroute a ticket.
  down_since         timestamptz,
  -- Alert-once for THIS printer's down spell ("one printer down 5 min, the
  -- other covering"). Cleared when down_since clears, so the next spell texts
  -- again. One stamp, not one per condition: paper-out turning into offline is
  -- the same event, and the owner hears about it once.
  down_alerted_at    timestamptz,
  updated_at         timestamptz not null default now()
);

create index if not exists printer_health_tenant_idx on printer_health (tenant_id);

-- -------------------------------------------------------------- print_routes

create table if not exists print_routes (
  tenant_id  text        not null,
  channel    text        not null,
  role       text        not null,
  -- The copy set for this channel, in print order. NULL = the environment's
  -- TICKET_COPIES / TICKET_COPY_ROLES, i.e. exactly today's tickets. Count is
  -- the array length, so a count and a role list can never disagree.
  copy_roles text[],
  updated_at timestamptz not null default now(),
  primary key (tenant_id, channel),
  constraint print_routes_channel_check
    check (channel in ('web', 'phone', 'walk_in', 'dine_in')),
  constraint print_routes_role_check
    check (role in ('takeout', 'pos')),
  -- 1..5 copies (the same clamp ticketCopies() applies), each a known role.
  constraint print_routes_copy_roles_check
    check (
      copy_roles is null
      or (
        cardinality(copy_roles) between 1 and 5
        and copy_roles <@ array['kitchen', 'register', 'bag', 'all']::text[]
      )
    )
);

comment on table print_routes is
  'Home printer role and copy set for each order channel. Add-ons are dine_in orders and follow the dine_in row. A channel whose home printer is down fails over to any up printer, with a REROUTED header.';

-- --------------------------------------------------------- print_alert_state

create table if not exists print_alert_state (
  tenant_id              text        primary key,
  -- When the urgent "every printer is down" text last went out for the current
  -- spell. Repeats while now() - this >= 10 min and the spell continues; set
  -- back to NULL the moment any printer is up again.
  all_down_alerted_at    timestamptz,
  updated_at             timestamptz not null default now()
);

-- ------------------------------------------------------ printer_config_audit

create table if not exists printer_config_audit (
  id          bigserial   primary key,
  tenant_id   text        not null,
  at          timestamptz not null default now(),
  -- assign | deactivate | rename | route | copies | pin_failed
  action      text        not null,
  -- What it was done to: a printer id, or a channel name. NULL for pin_failed.
  target      text,
  old_value   jsonb,
  new_value   jsonb,
  -- Client IP as the Worker saw it. The kitchen session is a shared password,
  -- so there is no per-person identity to record; the PIN proves "an owner",
  -- not which one.
  ip          text,
  constraint printer_config_audit_action_check
    check (action in ('assign', 'deactivate', 'rename', 'route', 'copies', 'pin_failed'))
);

-- The PIN lockout counts recent failures per tenant.
create index if not exists printer_config_audit_tenant_at_idx
  on printer_config_audit (tenant_id, action, at desc);

comment on table printer_config_audit is
  'Append-only log of printer/route/copy changes (old and new values) and owner-PIN failures. Written by the owner-PIN routes only.';

-- ------------------------------------------------- orders / print_deliveries

alter table orders add column if not exists print_printer_id uuid
  references printers (id) on delete set null;

-- The per-printer head of line: "the oldest order this printer is holding".
-- Partial on QUEUED (PRINTABLE_STATUSES), so it holds only the live queue
-- however many printed orders keep their print_printer_id for the audit.
create index if not exists orders_print_printer_idx
  on orders (tenant_id, print_printer_id, created_at)
  where status = 'QUEUED';

alter table print_deliveries add column if not exists printer_id uuid
  references printers (id) on delete set null;
alter table print_deliveries add column if not exists rerouted_from_printer_id uuid
  references printers (id) on delete set null;
-- The ROLE the hand-over was rerouted away from ('takeout' | 'pos'), which is
-- what the 轉印 REROUTED header prints ("from TAKEOUT"). Kept beside the id
-- because a channel whose role has NO active printer at all is rerouted too,
-- and then there is no printer id to point at.
alter table print_deliveries add column if not exists rerouted_from_role text;
-- The exact copy set this hand-over prints, resolved at claim time from
-- print_routes (or the environment default). Fixed for the life of the
-- delivery and carried to the next piece of a split ticket, so a route edit
-- mid-print cannot change the plan under a ticket that is half out. NULL on
-- rows written before 011: the environment default, as before.
alter table print_deliveries add column if not exists copy_roles text[];

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Defense in depth ONLY. The real boundary is that the browser never talks to
-- this database at all: every write goes through a server route handler using
-- the service-role key, which bypasses RLS anyway. No policy is defined, so a
-- leaked anon key grants nothing here.
-- ---------------------------------------------------------------------------
alter table orders            enable row level security;
alter table order_counters    enable row level security;
alter table printer_status    enable row level security;
alter table print_deliveries  enable row level security;
alter table printers             enable row level security;
alter table printer_health       enable row level security;
alter table print_routes         enable row level security;
alter table print_alert_state    enable row level security;
alter table printer_config_audit enable row level security;
