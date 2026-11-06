-- ---------------------------------------------------------------------------
-- 011: more than one printer. Who each printer is, which channels it prints and
--      how many copies, which printer each hand-over went to, and who changed
--      any of that.
--
-- ⚠️ NOT APPLIED. Written for review alongside docs/SECOND_PRINTER_DESIGN.md.
--
-- Run this against a database that already has the 010 shape. Once approved,
-- schema.sql gets the same objects so a fresh project can run that instead.
--
-- DEPLOY ORDER: apply BEFORE deploying the code that reads it, same rule as
-- 009/010. It is also safe to apply and then NOT deploy: it is additive only.
-- printer_status stays exactly as it is (the running code upserts it
-- `on conflict (tenant_id)` on every poll, so re-keying it here would stop the
-- live printer). It is retired in a later migration, after the new code has run
-- a full service on printer_health.
--
-- ROLES. 'takeout' = printer A (the one in production today): web orders.
--        'pos'     = printer B (not set up yet): phone, walk_in, dine_in and
--                    add-ons. Rule of thumb: web goes to A, anything entered on
--                    the POS goes to B. Add-ons are dine_in orders, so they
--                    follow the dine_in route.
--
-- WHAT THIS ADDS
--   printers                    one row per CloudPRNT client that has polled:
--                               MAC, display name, role, active. An unknown MAC
--                               creates a row here (inactive, no role) and gets
--                               no jobs until an owner assigns it.
--   printer_health              printer_status, per printer instead of per
--                               tenant, plus the down/alert stamps failover and
--                               the owner texts need. Rewritten on every poll.
--   print_routes                channel -> role, and the copy set per channel.
--                               Data, not code: changing either is one UPDATE
--                               through the owner-PIN page, no deploy.
--   print_alert_state           one row per tenant: the "every printer is down"
--                               urgent text, which repeats every 10 minutes and
--                               so needs a last-sent stamp no printer owns.
--   printer_config_audit        every assignment, route and copy change (time,
--                               old and new values), and every owner-PIN
--                               failure, which is also what the PIN lockout
--                               counts.
--   orders.print_printer_id     the printer currently responsible for this
--                               order's ticket. NULL until first claimed. Set at
--                               claim, kept across retries and split pieces,
--                               changed only by a failover reroute, cleared by a
--                               reprint or a paper-restored requeue.
--   print_deliveries.printer_id the printer this hand-over went to.
--   print_deliveries.rerouted_from_printer_id
--                               set when the hand-over went to a printer that is
--                               not the order's home printer because home was
--                               down (offline, or paper-out / cover-open for
--                               60s). Drives the 轉印 REROUTED header, and is the
--                               second legitimate explanation, beside
--                               manual_reprint, for an order printing twice.
--
-- SEED. The printer polling today is the only one we know (its MAC is in
-- printer_status: confirmed 5 Nov 2026, 00:11:62:55:24:d4). It becomes the
-- active 'takeout' printer, and EVERY channel routes to 'takeout' for now, so
-- deploying changes nothing about WHERE tickets print. Printer B is added later
-- by assigning its MAC the 'pos' role and pointing phone / walk_in / dine_in at
-- 'pos' (docs/SECOND_PRINTER_DESIGN.md §4).
--
-- Copies: every channel seeds NULL (= today's TICKET_COPIES / TICKET_COPY_ROLES),
-- so no ticket changes at deploy. Per-channel copy sets are editable later
-- through the owner-PIN page; see the TODO(confirm) on dine_in below.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

begin;

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

-- ---------------------------------------------------------------------- seed

-- The printer that polls today. Becomes 'takeout', active.
insert into printers (tenant_id, mac, name, role, active, first_seen_at)
select ps.tenant_id,
       lower(regexp_replace(ps.printer_mac, '[^0-9A-Fa-f]', '', 'g')),
       '外賣機 Takeout printer',
       'takeout',
       true,
       ps.last_seen_at
  from printer_status ps
 where ps.printer_mac is not null
   and lower(regexp_replace(ps.printer_mac, '[^0-9A-Fa-f]', '', 'g')) ~ '^[0-9a-f]{12}$'
on conflict (tenant_id, mac) do nothing;

-- Its health, carried over so the board does not flip to "unknown" on deploy.
insert into printer_health (
  printer_id, tenant_id, last_seen_at, online, paper_out, cover_open, paper_low,
  status_code, status_raw, blocked_since
)
select p.id, ps.tenant_id, ps.last_seen_at, ps.online, ps.paper_out, ps.cover_open,
       ps.paper_low, ps.status_code, ps.status_raw, ps.blocked_since
  from printer_status ps
  join printers p
    on p.tenant_id = ps.tenant_id
   and p.mac = lower(regexp_replace(ps.printer_mac, '[^0-9A-Fa-f]', '', 'g'))
on conflict (printer_id) do nothing;

-- Every channel to 'takeout' until printer B is assigned, and every channel on
-- today's copy set (NULL = TICKET_COPIES / TICKET_COPY_ROLES). Deploying this
-- changes no ticket anywhere.
--
-- ⚠️ TODO(confirm) with the owner: dine_in (and therefore add-ons) is proposed
-- to print ONE copy, no bag copy, once confirmed:
--     update print_routes set copy_roles = '{kitchen}' where channel = 'dine_in';
-- 'kitchen' is items without prices; '{all}' is one combined ticket with
-- prices, if the register wants the dine-in total on paper. Done through the
-- owner-PIN printers page, it is audited like any other change.
insert into print_routes (tenant_id, channel, role, copy_roles)
select p.tenant_id, c.channel, 'takeout', null::text[]
  from printers p
 cross join (values ('web'), ('phone'), ('walk_in'), ('dine_in')) as c (channel)
 where p.role = 'takeout' and p.active
on conflict (tenant_id, channel) do nothing;

insert into print_alert_state (tenant_id)
select distinct tenant_id from printers
on conflict (tenant_id) do nothing;

-- Orders in flight at the moment of the migration belong to that printer, so
-- the new code's per-printer head of line finds them where the old code left
-- them. Only claimed, still-printable rows; everything else stays NULL.
update orders o
   set print_printer_id = p.id
  from printers p
 where p.tenant_id = o.tenant_id
   and p.role = 'takeout' and p.active
   and o.print_printer_id is null
   and o.print_attempts > 0
   and o.status = 'QUEUED';  -- PRINTABLE_STATUSES

-- ----------------------------------------------------------------------- RLS

alter table printers             enable row level security;
alter table printer_health       enable row level security;
alter table print_routes         enable row level security;
alter table print_alert_state    enable row level security;
alter table printer_config_audit enable row level security;

commit;
