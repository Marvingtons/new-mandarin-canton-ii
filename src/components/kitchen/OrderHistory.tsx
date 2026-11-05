"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@/lib/money";
import { formatPickupTime } from "@/lib/orders/businessDate";
import { formatPhoneNational } from "@/lib/phone";
import {
  historySearchParams,
  presetRange,
  type HistoryPage,
  type HistoryQuery,
  type RangePreset,
} from "@/lib/orders/history";
import {
  ORDER_CHANNELS,
  TAKEOUT_CHANNELS,
  ORDER_STATUSES,
  type OrderChannel,
  type OrderStatus,
} from "@/lib/orders/types";
import { useKT } from "@/components/kitchen/KitchenI18n";
import KitchenOrderCard, {
  ChannelBadge,
  StatusPill,
  TableBadge,
  type CardAction,
} from "@/components/kitchen/KitchenOrderCard";
import Icon from "@/components/kitchen/Icon";

/**
 * Every previous order: a date range, filters, a search, totals, and a CSV.
 *
 * Everything is SERVER-SIDE: filtering, the 50-row pages, the summary, and
 * the export, which streams. This screen only holds one page at a time, so a
 * busy month costs the tablet nothing. The summary and the CSV read the same
 * query through the same parser (lib/orders/history), so the totals on screen
 * are the totals in the file.
 */

const PRESETS: RangePreset[] = ["today", "yesterday", "week", "month", "custom"];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function OrderHistory({ timezone, today }: { timezone: string; today: string }) {
  const t = useKT();
  const [preset, setPreset] = useState<RangePreset>("today");
  const [range, setRange] = useState(() => presetRange("today", today));
  const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [channels, setChannels] = useState<OrderChannel[]>([]);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The search box is debounced into `q`, so typing a phone number is one
  // request, not ten.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const query: HistoryQuery = { from: range.from, to: range.to, statuses, channels, q };
  const params = historySearchParams(query, page).toString();
  const csvParams = historySearchParams(query).toString();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/kitchen/history?${params}`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const body = (await res.json()) as { ok: boolean } & HistoryPage;
      if (!body.ok) {
        setError(t("history.loadFailed"));
        return;
      }
      setData(body);
      setError(null);
    } catch {
      setError(t("history.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [params, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function choosePreset(p: RangePreset) {
    setPreset(p);
    setPage(1);
    setExpanded(null);
    if (p !== "custom") setRange(presetRange(p, today));
  }

  const act = useCallback(
    async (orderId: number, action: CardAction) => {
      try {
        const res = await fetch(`/api/kitchen/orders/${orderId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const body = (await res.json()) as { ok: boolean; code?: string };
        setNotice(
          body.ok
            ? action === "reprint"
              ? t("board.requeued")
              : null
            : body.code === "cancelled"
              ? t("board.cancelledNoReprint")
              : body.code === "printing"
                ? t("board.printingNoReprint")
                : t("board.actionFailed"),
        );
      } catch {
        setNotice(t("board.actionUnreachable"));
      }
      await load();
    },
    [load, t],
  );

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const multiDay = range.from !== range.to;
  const chip = (on: boolean) =>
    `min-h-12 rounded-full border px-4 text-base font-medium whitespace-nowrap transition-colors ${
      on
        ? "border-staff-ink bg-staff-ink text-white"
        : "border-staff-line-strong bg-staff-panel text-staff-soft hover:text-staff-ink"
    }`;
  const segment = (on: boolean) =>
    `min-h-12 rounded-md px-4 text-base font-semibold whitespace-nowrap transition-colors ${
      on ? "bg-staff-panel text-staff-ink shadow-[0_1px_2px_rgba(27,26,23,0.12)]" : "text-staff-soft hover:text-staff-ink"
    }`;
  const secondary =
    "flex min-h-12 items-center gap-2 rounded-md border border-staff-line-strong bg-staff-panel px-4 text-base font-medium text-staff-ink transition-colors hover:bg-staff-sunken disabled:opacity-40";
  const dateInput =
    "min-h-12 rounded-md border border-staff-line-strong bg-staff-panel px-3 text-base text-staff-ink outline-none focus:border-staff-accent";
  // One row per order from a landscape tablet up; stacked below that. Sized
  // in rem against the staff type scale (1rem is 22px), so the customer
  // column keeps room at 1024px.
  const columns =
    "lg:grid-cols-[4.5rem_4.5rem_minmax(0,1fr)_5.5rem_2.5rem_5rem_6rem_4.5rem]";

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 pt-5 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("history.title")}</h1>
        <a href={`/api/kitchen/history/csv?${csvParams}`} download className={secondary}>
          <Icon name="download" size={18} />
          {t("history.export")}
        </a>
      </div>

      {/* ------------------------------------------------ range + filters -- */}
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg bg-staff-sunken p-1">
            {PRESETS.map((p) => (
              <button key={p} type="button" aria-pressed={preset === p} onClick={() => choosePreset(p)} className={segment(preset === p)}>
                {t(`history.preset.${p}`)}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-base text-staff-soft">
                {t("history.from")}
                <input
                  type="date"
                  value={range.from}
                  max={range.to}
                  onChange={(e) => {
                    if (e.target.value) setRange((r) => ({ ...r, from: e.target.value }));
                    setPage(1);
                  }}
                  className={dateInput}
                />
              </label>
              <label className="flex items-center gap-2 text-base text-staff-soft">
                {t("history.to")}
                <input
                  type="date"
                  value={range.to}
                  min={range.from}
                  max={today}
                  onChange={(e) => {
                    if (e.target.value) setRange((r) => ({ ...r, to: e.target.value }));
                    setPage(1);
                  }}
                  className={dateInput}
                />
              </label>
            </div>
          )}
          <div className="relative ml-auto w-full sm:w-80">
            <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-staff-faint" />
            <input
              type="text"
              inputMode="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("history.search")}
              aria-label={t("history.search")}
              className="min-h-12 w-full rounded-md border border-staff-line-strong bg-staff-panel pr-3 pl-10 text-base text-staff-ink outline-none placeholder:text-staff-faint focus:border-staff-accent"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div role="group" aria-label={t("history.status")} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-base font-medium text-staff-faint">{t("history.status")}</span>
            {ORDER_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={statuses.includes(s)}
                onClick={() => {
                  setStatuses((v) => toggle(v, s));
                  setPage(1);
                }}
                className={chip(statuses.includes(s))}
              >
                {t(`status.${s}`)}
              </button>
            ))}
          </div>
          {/* Service: the two halves of the POS, as one tap each. Sets the same
              channel filter as the chips below, so the server reads one rule. */}
          <div role="group" aria-label={t("history.service")} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-base font-medium text-staff-faint">{t("history.service")}</span>
            {(
              [
                ["all", [] as OrderChannel[], "history.all"],
                ["dineIn", ["dine_in"] as OrderChannel[], "history.service.dineIn"],
                ["takeout", [...TAKEOUT_CHANNELS] as OrderChannel[], "history.service.takeout"],
              ] as const
            ).map(([id, set, label]) => {
              const on = set.length === channels.length && set.every((c) => channels.includes(c));
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setChannels([...set]);
                    setPage(1);
                  }}
                  className={chip(on)}
                >
                  {t(label)}
                </button>
              );
            })}
          </div>
          <div role="group" aria-label={t("history.channel")} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-base font-medium text-staff-faint">{t("history.channel")}</span>
            {ORDER_CHANNELS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={channels.includes(c)}
                onClick={() => {
                  setChannels((v) => toggle(v, c));
                  setPage(1);
                }}
                className={chip(channels.includes(c))}
              >
                {t(`channel.${c}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------- summary -- */}
      {data && (
        <dl className="mt-5 grid grid-cols-2 overflow-hidden rounded-lg border border-staff-line bg-staff-panel sm:grid-cols-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_1.6fr]">
          {[
            { label: t("history.summary.orders"), value: String(data.summary.orderCount), tone: "" },
            { label: t("history.summary.sales"), value: formatCents(data.summary.salesCents), tone: "text-staff-accent" },
            { label: t("history.summary.average"), value: formatCents(data.summary.averageCents), tone: "" },
            { label: t("history.summary.cancelled"), value: String(data.summary.cancelledCount), tone: "text-staff-faint" },
          ].map((stat) => (
            <div key={stat.label} className="border-b border-staff-line px-4 py-3 sm:border-r lg:border-b-0">
              <dt className="text-base text-staff-faint">{stat.label}</dt>
              <dd className={`mt-0.5 text-2xl font-semibold ${stat.tone}`}>{stat.value}</dd>
            </div>
          ))}
          <div className="col-span-2 flex flex-col justify-center gap-1.5 px-4 py-3 sm:col-span-4 lg:col-span-1">
            {ORDER_CHANNELS.map((c) => (
              <div key={c} className="flex items-center justify-between gap-3 text-base">
                <ChannelBadge channel={c} />
                <span className="text-staff-soft">
                  {data.summary.byChannel[c].orderCount} · <span className="font-semibold text-staff-ink">{formatCents(data.summary.byChannel[c].salesCents)}</span>
                </span>
              </div>
            ))}
          </div>
        </dl>
      )}

      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-staff-danger-tint px-4 py-3 text-base font-medium text-staff-danger">
          <Icon name="alert" size={20} className="mt-0.5" />
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-lg bg-staff-ink px-4 py-3 text-base font-medium text-white">
          {notice}
        </p>
      )}

      {/* -------------------------------------------------------- rows -- */}
      <div className="mt-5 overflow-hidden rounded-lg border border-staff-line bg-staff-panel" aria-busy={loading}>
        <div className={`hidden gap-3 border-b border-staff-line bg-staff-bg px-4 py-2.5 text-base font-semibold text-staff-faint lg:grid ${columns}`}>
          <span>{t("history.col.number")}</span>
          <span>{t("history.col.time")}</span>
          <span>{t("history.col.customer")}</span>
          <span>{t("history.col.channel")}</span>
          <span>{t("history.col.items")}</span>
          <span className="text-right">{t("history.col.total")}</span>
          <span>{t("history.col.status")}</span>
          <span>{t("history.col.print")}</span>
        </div>

        {data && data.orders.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-3 py-20 text-staff-faint">
            <Icon name="receipt" size={36} className="text-staff-line-strong" />
            <p className="text-lg">{t("history.empty")}</p>
          </div>
        )}
        {!data && loading && <p className="py-20 text-center text-lg text-staff-faint">{t("common.loading")}</p>}

        <ul className={`divide-y divide-staff-line transition-opacity ${loading && data ? "opacity-60" : ""}`}>
          {data?.orders.map((o) => {
            const open = expanded === o.id;
            const deliveries = o.deliveryCount ?? 0;
            const multi = (o.fetchCount ?? 0) > 1 || deliveries > 1;
            const itemCount = o.items.reduce((n, l) => n + l.quantity, 0);
            return (
              <li key={o.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : o.id)}
                  className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-staff-bg ${columns} ${
                    open ? "bg-staff-bg" : ""
                  }`}
                >
                  <span className="text-lg font-semibold">{o.orderNumber}</span>
                  <span className="text-base text-staff-soft">
                    {multiDay ? `${o.businessDate.slice(5)} ` : ""}
                    {formatPickupTime(o.createdAt, timezone)}
                  </span>
                  <span className="col-span-3 min-w-0 lg:col-span-1">
                    {o.channel === "dine_in" ? (
                      <TableBadge order={o} />
                    ) : (
                      <span className="block truncate text-base font-medium">{o.customer.name}</span>
                    )}
                    {o.channel !== "dine_in" && o.customer.phone && (
                      <span className="block truncate text-base text-staff-faint">{formatPhoneNational(o.customer.phone)}</span>
                    )}
                  </span>
                  <span>
                    <ChannelBadge channel={o.channel} />
                  </span>
                  <span className="text-base text-staff-soft">{t("history.itemsCount", { n: itemCount })}</span>
                  <span className={`text-right text-base font-semibold ${o.status === "CANCELLED" ? "text-staff-faint line-through" : ""}`}>
                    {formatCents(o.totals.totalCents)}
                  </span>
                  <span>
                    <StatusPill status={o.status} />
                  </span>
                  <span className="flex flex-wrap items-center gap-1 text-base text-staff-faint">
                    {deliveries > 0 && t("history.sent", { n: deliveries })}
                    {multi && (
                      <span className="rounded-full bg-staff-danger-tint px-2 py-0.5 text-base font-semibold text-staff-danger">
                        {t("card.multiDelivery", { d: deliveries, f: o.fetchCount ?? 0 })}
                      </span>
                    )}
                  </span>
                </button>
                {open && (
                  <div className="border-t border-staff-line bg-staff-bg px-4 py-4">
                    <div className="max-w-2xl">
                      <KitchenOrderCard order={o} timezone={timezone} variant="history" onAction={act} />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* ---------------------------------------------------- paging -- */}
      {data && data.total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-base text-staff-faint">
            {t("history.totalRows", { n: data.total })} · {t("history.page", { page, pages })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => {
                setPage((p) => Math.max(1, p - 1));
                setExpanded(null);
              }}
              className={secondary}
            >
              <Icon name="chevronLeft" size={18} />
              {t("history.prev")}
            </button>
            <button
              type="button"
              disabled={page >= pages || loading}
              onClick={() => {
                setPage((p) => p + 1);
                setExpanded(null);
              }}
              className={secondary}
            >
              {t("history.next")}
              <Icon name="chevronRight" size={18} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
