import "server-only";

import type { QueryResultRow } from "pg";
import { ordersPool } from "@/lib/db/postgres";
import { CUSTOM_ITEM_ID, SURCHARGE_MODIFIER_ID } from "@/lib/kitchen/customCharge";
import { TRAY_SIZE_IDS } from "@/lib/menu/types";
import {
  CANCELLED_STATUSES,
  REPORT_CHANNELS,
  REPORT_COLUMNS,
  SOLD_STATUSES,
  TOP_ITEMS,
  UNPRINTED_STATUSES,
  emptyBucket,
  familyDinnerItemIds,
  reportCode,
  type Bucket,
  type DailyReport,
  type HourRow,
  type ReportColumn,
  type ReportOrderRow,
  type TopItem,
  scopeChannels,
  type ChannelScope,
} from "@/lib/reports/dailyModel";
import { CHANNEL_STATION } from "@/config/stations";
import { isOrderChannel, isOrderStatus, type OrderChannel } from "@/lib/orders/types";

/**
 * 日結 DAILY REPORT, from the database: ONE aggregate statement per report.
 *
 * The rules are lib/reports/dailyModel.ts, and summarizeDay there is the
 * reference model. This file is the same arithmetic written as SQL so a day of
 * a few hundred orders is summed where the rows live instead of being shipped
 * to the Worker. verify:daily-report builds a known day in a real Postgres and
 * asserts the two agree number for number, and that both agree with numbers
 * worked out by hand.
 *
 * WHICH DAY. `orders.business_date`, the restaurant-local date written once at
 * insert (lib/orders/businessDate.ts). Never `created_at::date`, which is a UTC
 * date: a 9:15pm Saturday order in Chula Vista is 05:15 Sunday UTC and belongs
 * to Saturday. The hour buckets are created_at in the tenant timezone.
 *
 * SHAPE OF THE STATEMENT:
 *   o   the day's rows, each classed sold / unprinted / cancelled
 *   l   a lateral over items jsonb: every line, its quantity, line total and
 *       加價 share (a custom line whole, or surcharge modifiers x quantity)
 *   oc  each order with its charges summed from its lines
 *   then one row of jsonb: buckets by (class, channel), trays, top items and
 *   hours, plus the first and last order of the day.
 */

const REPORT_SQL = `
with o as (
  select id, channel, status, is_addon, items, created_at,
         case when status = any($3::text[]) then 'sold'
              when status = any($4::text[]) then 'unprinted'
              when status = any($5::text[]) then 'cancelled'
         end as kind,
         coalesce(round((totals->>'subtotalCents')::numeric), 0)::bigint as sub,
         coalesce(round((totals->>'taxCents')::numeric), 0)::bigint      as tax,
         coalesce(round((totals->>'tipCents')::numeric), 0)::bigint      as tip,
         coalesce(round((totals->>'totalCents')::numeric), 0)::bigint    as total
    from orders
   where tenant_id = $1
     and business_date = $2::date
     and channel = any($12::text[])
),
l as (
  select o.id, o.kind, o.created_at, x.ord,
         x.line->>'itemId'  as item_id,
         x.line->>'sizeId'  as size_id,
         x.line->>'nameEn'  as name_en,
         x.line->>'nameZh'  as name_zh,
         greatest(1, coalesce(round((x.line->>'quantity')::numeric), 0))::bigint as qty,
         coalesce(round((x.line->>'lineCents')::numeric), 0)::bigint           as line_cents,
         -- coalesce: ->>'custom' is NULL on every menu line, and NULL here
         -- would drop the line from "not is_custom" below.
         coalesce(x.line->>'custom' = 'true' or x.line->>'itemId' = $6, false) as is_custom,
         case
           when x.line->>'custom' = 'true' or x.line->>'itemId' = $6
             then coalesce(round((x.line->>'lineCents')::numeric), 0)
           else greatest(1, coalesce(round((x.line->>'quantity')::numeric), 0))
                * coalesce((
                    select sum(coalesce(round((m->>'priceCents')::numeric), 0))
                      from jsonb_array_elements(coalesce(x.line->'modifiers', '[]'::jsonb)) m
                     where m->>'id' = $7
                  ), 0)
         end::bigint as line_charge
    from o
    cross join lateral jsonb_array_elements(o.items) with ordinality as x(line, ord)
),
oc as (
  select o.*,
         coalesce((select sum(l.line_charge) from l where l.id = o.id), 0)::bigint as charges
    from o
),
buckets as (
  select kind, channel,
         count(*) filter (where not is_addon)::int as count,
         sum(sub - charges)::bigint as subtotal,
         sum(charges)::bigint       as charges,
         sum(tax)::bigint           as tax,
         sum(tip)::bigint           as tip,
         sum(total)::bigint         as total
    from oc
   where kind is not null
   group by kind, channel
),
top_items as (
  select item_id,
         (array_agg(name_en order by created_at, id, ord))[1] as name_en,
         (array_agg(name_zh order by created_at, id, ord))[1] as name_zh,
         sum(qty)::bigint                       as quantity,
         sum(line_cents - line_charge)::bigint  as sales
    from l
   where kind = 'sold' and not is_custom
   group by item_id
   order by quantity desc, sales desc, item_id collate "C"
   limit $11
),
hours as (
  select extract(hour from created_at at time zone $8)::int as hour,
         count(*) filter (where not is_addon)::int          as count,
         sum(total)::bigint                                 as total
    from oc
   where kind = 'sold'
   group by 1
)
select
  (select min(created_at) from o) as first_at,
  (select max(created_at) from o) as last_at,
  (select coalesce(jsonb_agg(jsonb_build_object(
            'kind', kind, 'channel', channel, 'count', count,
            'subtotal', subtotal, 'charges', charges, 'tax', tax, 'tip', tip, 'total', total)), '[]'::jsonb)
     from buckets) as buckets,
  (select jsonb_build_object(
            'half',   coalesce(sum(qty) filter (where size_id = 'half-tray'), 0),
            'party',  coalesce(sum(qty) filter (where size_id = any($9::text[]) and size_id <> 'half-tray'), 0),
            'family', coalesce(sum(qty) filter (where item_id = any($10::text[])), 0))
     from l where kind = 'sold') as trays,
  (select coalesce(jsonb_agg(jsonb_build_object(
            'itemId', item_id, 'nameEn', name_en, 'nameZh', name_zh,
            'quantity', quantity, 'sales', sales)
          order by quantity desc, sales desc, item_id collate "C"), '[]'::jsonb)
     from top_items) as top,
  (select coalesce(jsonb_agg(jsonb_build_object('hour', hour, 'count', count, 'total', total)
          order by hour), '[]'::jsonb)
     from hours) as hours
`;

interface BucketJson {
  kind: "sold" | "unprinted" | "cancelled";
  channel: string;
  count: number;
  subtotal: number;
  charges: number;
  tax: number;
  tip: number;
  total: number;
}

function toBucket(b: BucketJson): Bucket {
  return {
    count: Number(b.count),
    subtotalCents: Number(b.subtotal),
    chargesCents: Number(b.charges),
    taxCents: Number(b.tax),
    tipCents: Number(b.tip),
    totalCents: Number(b.total),
  };
}

function addInto(into: Bucket, from: Bucket): void {
  into.count += from.count;
  into.subtotalCents += from.subtotalCents;
  into.chargesCents += from.chargesCents;
  into.taxCents += from.taxCents;
  into.tipCents += from.tipCents;
  into.totalCents += from.totalCents;
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);

export interface ReportScope {
  tenantId: string;
  /** Restaurant-local YYYY-MM-DD. */
  businessDate: string;
  timezone: string;
  /** 範圍: which channels count (dailyModel CHANNEL_SCOPES). Default all. */
  channels?: ChannelScope;
}

/** The day's report, summed by Postgres. See the header for what each part is. */
export async function readDailyReport(scope: ReportScope): Promise<DailyReport> {
  const { rows } = await ordersPool().query(REPORT_SQL, [
    scope.tenantId,
    scope.businessDate,
    SOLD_STATUSES,
    UNPRINTED_STATUSES,
    CANCELLED_STATUSES,
    CUSTOM_ITEM_ID,
    SURCHARGE_MODIFIER_ID,
    scope.timezone,
    [...TRAY_SIZE_IDS],
    [...familyDinnerItemIds()],
    TOP_ITEMS,
    scopeChannels(scope.channels ?? "all"),
  ]);
  return mapReport(rows[0], scope);
}

function mapReport(row: QueryResultRow, scope: ReportScope): DailyReport {
  const channels = Object.fromEntries(
    REPORT_CHANNELS.map((c) => [c, emptyBucket()]),
  ) as Record<OrderChannel, Bucket>;
  const columns = Object.fromEntries(
    REPORT_COLUMNS.map((c) => [c, emptyBucket()]),
  ) as Record<ReportColumn, Bucket>;
  const cancelled = emptyBucket();
  const unprinted = emptyBucket();

  for (const b of row.buckets as BucketJson[]) {
    const bucket = toBucket(b);
    if (b.kind === "cancelled") addInto(cancelled, bucket);
    else if (b.kind === "unprinted") addInto(unprinted, bucket);
    else if (isOrderChannel(b.channel)) {
      // Online + Store = All is true BY CONSTRUCTION: every sold bucket goes
      // into its channel, its station's column, and All, once each.
      addInto(channels[b.channel], bucket);
      addInto(columns[CHANNEL_STATION[b.channel]], bucket);
      addInto(columns.all, bucket);
    }
  }

  const t = row.trays as { half: number; party: number; family: number };
  const top: TopItem[] = (row.top as Array<Record<string, unknown>>).map((i) => ({
    itemId: String(i.itemId),
    nameEn: String(i.nameEn ?? ""),
    nameZh: i.nameZh === null || i.nameZh === undefined ? null : String(i.nameZh),
    quantity: Number(i.quantity),
    salesCents: Number(i.sales),
  }));
  const hours: HourRow[] = (row.hours as Array<Record<string, unknown>>).map((h) => ({
    hour: Number(h.hour),
    count: Number(h.count),
    totalCents: Number(h.total),
  }));

  const channelScope = scope.channels ?? "all";
  const report: Omit<DailyReport, "code"> = {
    tenantId: scope.tenantId,
    ...(channelScope === "all" ? {} : { scope: channelScope }),
    businessDate: scope.businessDate,
    timezone: scope.timezone,
    firstOrderAt: iso(row.first_at),
    lastOrderAt: iso(row.last_at),
    channels,
    columns,
    cancelled,
    unprinted,
    trays: { halfTray: Number(t.half), partyTray: Number(t.party), familyDinners: Number(t.family) },
    top,
    hours,
  };
  return { ...report, code: reportCode(report) };
}

/**
 * The same day's rows as the reference model reads them, oldest first.
 * verify:daily-report feeds these to summarizeDay and compares; nothing on the
 * live path calls it.
 */
export async function readReportRows(scope: ReportScope): Promise<ReportOrderRow[]> {
  const { rows } = await ordersPool().query(
    `select channel, status, is_addon, items, totals, created_at
       from orders
      where tenant_id = $1 and business_date = $2::date
        and channel = any($3::text[])
      order by created_at, id`,
    [scope.tenantId, scope.businessDate, scopeChannels(scope.channels ?? "all")],
  );
  return rows.flatMap((r) =>
    isOrderChannel(r.channel) && isOrderStatus(r.status)
      ? [
          {
            channel: r.channel,
            status: r.status,
            isAddon: Boolean(r.is_addon),
            items: r.items,
            totals: r.totals,
            createdAt: (r.created_at as Date).toISOString(),
          },
        ]
      : [],
  );
}
