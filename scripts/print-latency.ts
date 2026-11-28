/**
 * Tap-to-paper latency, per hop, from production data. READ-ONLY.
 *
 *   DATABASE_URL=postgres://… npm run measure:print-latency [-- --days 7 --per-station 300]
 *
 * Hops, per print_deliveries row:
 *   a  t0 → offered_at            poll wait + claim (the printer's poll interval lives here)
 *   b  offered_at → fetched_at    printer comes back for the body (our render + R2 publish
 *                                 happen inside the claiming POST, so they sit here too)
 *   c  fetched_at → confirmed_at  download over WiFi + physical print + DELETE
 *   bc offered_at → confirmed_at  b + c together
 *   d  t0 → confirmed_at          total
 *
 * t0 is orders.created_at for a kitchen ticket, order_change_tickets.created_at
 * for a 改單 change ticket, and the manual_reprint marker's created_at for a
 * 重印. fetched_at is only written when the printer fetches THROUGH the Worker
 * (PRINT_FETCH_VIA_WORKER, or the no-R2 fallback). On the default R2-direct
 * path the Worker never sees the fetch, so b and c are reported as "n/a" and
 * only bc is measurable. The script says so rather than inventing a split.
 *
 * Every statement is a SELECT inside a READ ONLY transaction.
 */

import { Client } from "pg";

interface Args {
  days: number;
  perStation: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { days: 7, perStation: 300 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days") out.days = Number(argv[++i]);
    else if (argv[i] === "--per-station") out.perStation = Number(argv[++i]);
  }
  return out;
}

/**
 * The last N deliveries per station, each with its hops in seconds. Report
 * hand-overs (report_print_id) are left out: they are not tickets anyone tapped.
 */
const BASE = `
with marker as (
  -- A 重印 is requested by a manual_reprint row; the printer's hand-over of it
  -- is a later row for the same order. Its t0 is the request, not the order.
  select order_id, created_at from print_deliveries where reason = 'manual_reprint'
),
d as (
  select d.id,
         coalesce(d.station, o.print_station) as station,
         o.channel,
         case when d.change_ticket_id is not null then 'change'
              when exists (select 1 from marker m where m.order_id = d.order_id and m.created_at <= d.offered_at)
                then 'reprint'
              else 'full' end as kind,
         d.reason,
         case when d.change_ticket_id is not null then ct.created_at
              else coalesce((select max(m.created_at) from marker m
                              where m.order_id = d.order_id and m.created_at <= d.offered_at),
                            o.created_at) end as t0,
         d.offered_at, d.fetched_at, d.confirmed_at, d.confirm_code,
         row_number() over (partition by coalesce(d.station, o.print_station) order by d.offered_at desc) as rn
    from print_deliveries d
    join orders o on o.id = d.order_id
    left join order_change_tickets ct on ct.id = d.change_ticket_id
   where d.order_id is not null
     and d.reason <> 'manual_reprint'
)
select id, station, channel, kind, reason, confirm_code,
       extract(hour from offered_at at time zone 'America/Los_Angeles')::int as hour,
       offered_at > now() - make_interval(days => $2) as recent,
       extract(epoch from offered_at - t0)            as a,
       extract(epoch from fetched_at - offered_at)    as b,
       extract(epoch from confirmed_at - fetched_at)  as c,
       extract(epoch from confirmed_at - offered_at)  as bc,
       extract(epoch from confirmed_at - t0)          as d
  from d
 where rn <= $1
 order by offered_at`;

interface Row {
  station: string;
  channel: string;
  kind: string;
  reason: string;
  confirm_code: string | null;
  hour: number;
  recent: boolean;
  a: number | null;
  b: number | null;
  c: number | null;
  bc: number | null;
  d: number | null;
}

const HOPS = ["a", "b", "c", "bc", "d"] as const;
type Hop = (typeof HOPS)[number];

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stat(rows: Row[], hop: Hop): string {
  const v = rows
    .map((r) => r[hop])
    .filter((x): x is number => x !== null && Number.isFinite(Number(x)))
    .map(Number)
    .sort((x, y) => x - y);
  if (v.length === 0) return "n/a";
  const f = (x: number) => x.toFixed(1);
  return `${f(quantile(v, 0.5))} / ${f(quantile(v, 0.9))} / ${f(v[v.length - 1])}`;
}

function table(title: string, groups: Map<string, Row[]>, keyLabel: string): string {
  const head =
    `| ${keyLabel} | n | a: created→offered | b: offered→fetched | c: fetched→confirmed | b+c: offered→confirmed | d: total |\n` +
    "|---|---:|---|---|---|---|---|\n";
  const body = [...groups.entries()]
    .map(([k, rs]) => `| ${k} | ${rs.length} | ${HOPS.map((h) => stat(rs, h)).join(" | ")} |`)
    .join("\n");
  return `### ${title}\n\nSeconds, p50 / p90 / max.\n\n${head}${body}\n`;
}

function groupBy(rows: Row[], key: (r: Row) => string): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return new Map([...m.entries()].sort(([x], [y]) => x.localeCompare(y)));
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const args = parseArgs(process.argv.slice(2));
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const client = new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin read only");
    const { rows } = await client.query<Row>(BASE, [args.perStation, args.days]);
    await client.query("rollback");

    const confirmed = rows.filter((r) => r.d !== null);
    const recent = confirmed.filter((r) => r.recent);
    const fetchedSeen = rows.some((r) => r.b !== null);

    const out: string[] = [];
    out.push(
      `Deliveries read: ${rows.length} (last ${args.perStation} per station); ` +
        `confirmed: ${confirmed.length}; in the last ${args.days} days: ${recent.length}.`,
    );
    if (!fetchedSeen) {
      out.push(
        "\nfetched_at is NULL on every row: the printers fetch straight from R2, so the Worker " +
          "never sees the GET. b and c cannot be separated from this data; b+c is the measurable hop.",
      );
    }
    out.push("");
    out.push(table("By station", groupBy(confirmed, (r) => r.station), "station"));
    out.push(table("By station × kind × reason", groupBy(confirmed, (r) => `${r.station} · ${r.kind} · ${r.reason}`), "station · kind · reason"));
    out.push(table("By station × channel", groupBy(confirmed, (r) => `${r.station} · ${r.channel}`), "station · channel"));
    out.push(table(`Last ${args.days} days, by station`, groupBy(recent, (r) => r.station), "station"));
    out.push(table("By hour (America/Los_Angeles), both stations", groupBy(confirmed, (r) => String(r.hour).padStart(2, "0")), "hour"));
    const failures = rows.filter((r) => r.confirm_code && !/^2/.test(r.confirm_code));
    if (failures.length > 0) {
      out.push(
        "### Non-2xx confirmations\n\n" +
          failures.map((r) => `- ${r.station} ${r.kind} ${r.reason}: ${r.confirm_code} after ${Number(r.bc).toFixed(1)}s`).join("\n") +
          "\n",
      );
    }
    console.log(out.join("\n"));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
