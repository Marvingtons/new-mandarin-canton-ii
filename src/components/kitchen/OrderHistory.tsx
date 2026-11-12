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
import { STATIONS, type Station } from "@/config/stations";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Icon from "@/components/kitchen/Icon";
import OrderList from "@/components/kitchen/OrderList";
import Button from "@/components/kitchen/ui/Button";
import { buttonClass } from "@/components/kitchen/ui/buttonClass";
import { ChannelBadge, StationBadge, StatusPill, TableBadge } from "@/components/kitchen/ui/Badges";
import EmptyState from "@/components/kitchen/ui/EmptyState";
import Segmented from "@/components/kitchen/ui/Segmented";
import { Skeleton } from "@/components/kitchen/ui/Skeleton";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * Every previous order: a date range, filters, a search, totals, and a CSV.
 *
 * Everything is SERVER-SIDE: filtering, the 50-row pages, the summary, and
 * the export, which streams. This screen only holds one page at a time, so a
 * busy month costs the tablet nothing. The summary and the CSV read the same
 * query through the same parser (lib/orders/history), so the totals on screen
 * are the totals in the file.
 *
 * Same shell, same controls and the same OrderCard as the board: an expanded
 * row IS the board's card, and its 重印 goes through the same live action.
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
  const [station, setStation] = useState<"all" | Station>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  // The search box is debounced into `q`, so typing a phone number is one
  // request, not ten.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const query: HistoryQuery = {
    from: range.from,
    to: range.to,
    statuses,
    channels,
    stations: station === "all" ? [] : [station],
    q,
  };
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

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const multiDay = range.from !== range.to;
  const dateInput =
    "min-h-12 rounded-staff-control bg-staff-panel px-3 text-staff-body text-staff-ink shadow-[inset_0_0_0_1px_var(--color-staff-line-strong)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]";
  // One row per order from a laptop up (1280px); stacked on a tablet. In rem
  // against the staff type scale, so 大字 widens the columns with the text.
  const columns =
    "xl:grid-cols-[5.5rem_5.5rem_minmax(0,1fr)_9rem_4rem_6rem_8rem_6rem]";

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 pt-5 pb-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-staff-heading font-bold tracking-tight">{t("history.title")}</h1>
        <a href={`/api/kitchen/history/csv?${csvParams}`} download className={buttonClass({ variant: "secondary" })}>
          <Icon name="download" size={20} />
          {t("history.export")}
        </a>
      </div>

      {/* ------------------------------------------------ range + filters -- */}
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label={t("history.range")}
            value={preset}
            onChange={choosePreset}
            options={PRESETS.map((p) => ({ value: p, label: t(`history.preset.${p}`) }))}
          />
          {preset === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-staff-body text-staff-soft">
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
              <label className="flex items-center gap-2 text-staff-body text-staff-soft">
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
            <Icon name="search" size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-staff-soft" />
            <input
              type="text"
              inputMode="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("history.search")}
              aria-label={t("history.search")}
              className="min-h-12 w-full rounded-staff-control bg-staff-panel pr-3 pl-11 text-staff-body text-staff-ink shadow-[inset_0_0_0_1px_var(--color-staff-line-strong)] outline-none placeholder:text-staff-soft focus-visible:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Segmented
            label={t("station.filter")}
            value={station}
            onChange={(v) => {
              setStation(v);
              setPage(1);
            }}
            options={[
              { value: "all" as const, label: t("station.all") },
              ...STATIONS.map((st) => ({ value: st, label: t(`station.${st}`) })),
            ]}
          />
          <div role="group" aria-label={t("history.status")} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-staff-caption font-semibold text-staff-soft">{t("history.status")}</span>
            {ORDER_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={statuses.includes(s)}
                onClick={() => {
                  setStatuses((v) => toggle(v, s));
                  setPage(1);
                }}
                className={ui.chip}
              >
                {t(`status.${s}`)}
              </button>
            ))}
          </div>
          {/* Service: the two halves of the POS, as one tap each. Sets the same
              channel filter as the chips below, so the server reads one rule. */}
          <div role="group" aria-label={t("history.service")} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-staff-caption font-semibold text-staff-soft">{t("history.service")}</span>
            {(
              [
                ["all", [] as OrderChannel[], "history.all"],
                ["dineIn", ["dine_in"] as OrderChannel[], "history.service.dineIn"],
                ["takeout", [...TAKEOUT_CHANNELS] as OrderChannel[], "history.service.takeout"],
              ] as const
            ).map(([id, set, label]) => {
              const chosen = new Set(channels);
              const on = set.length === chosen.size && set.every((c) => chosen.has(c));
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setChannels([...set]);
                    setPage(1);
                  }}
                  className={ui.chip}
                >
                  {t(label)}
                </button>
              );
            })}
          </div>
          <div role="group" aria-label={t("history.channel")} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-staff-caption font-semibold text-staff-soft">{t("history.channel")}</span>
            {ORDER_CHANNELS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={channels.includes(c)}
                onClick={() => {
                  setChannels((v) => toggle(v, c));
                  setPage(1);
                }}
                className={ui.chip}
              >
                {t(`channel.${c}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------- summary -- */}
      {data ? (
        <dl className={`${ui.card} mt-5 grid grid-cols-2 overflow-hidden sm:grid-cols-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_1.6fr]`}>
          {[
            { label: t("history.summary.orders"), value: String(data.summary.orderCount) },
            { label: t("history.summary.sales"), value: formatCents(data.summary.salesCents) },
            { label: t("history.summary.average"), value: formatCents(data.summary.averageCents) },
            { label: t("history.summary.cancelled"), value: String(data.summary.cancelledCount) },
          ].map((stat) => (
            <div key={stat.label} className="border-b border-staff-line px-4 py-3 sm:border-r lg:border-b-0">
              <dt className="text-staff-caption text-staff-soft">{stat.label}</dt>
              <dd className="mt-0.5 text-staff-heading font-bold">{stat.value}</dd>
            </div>
          ))}
          <div className="col-span-2 flex flex-col justify-center gap-1.5 px-4 py-3 sm:col-span-4 lg:col-span-1">
            {ORDER_CHANNELS.map((c) => (
              <div key={c} className="flex items-center justify-between gap-3 text-staff-body">
                <ChannelBadge channel={c} />
                <span className="text-staff-soft">
                  {data.summary.byChannel[c].orderCount} ·{" "}
                  <span className="font-semibold text-staff-ink">{formatCents(data.summary.byChannel[c].salesCents)}</span>
                </span>
              </div>
            ))}
          </div>
        </dl>
      ) : (
        loading && <Skeleton className="mt-5 h-24 w-full" />
      )}

      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-staff-card bg-staff-brand px-4 py-3 text-staff-body font-medium text-staff-on-brand">
          <Icon name="alert" size={20} className="mt-0.5" />
          {error}
        </p>
      )}

      {/* -------------------------------------------------------- rows -- */}
      <div className={`${ui.card} mt-5 overflow-hidden`} aria-busy={loading}>
        <div className={`hidden gap-3 border-b border-staff-line bg-staff-bg px-4 py-2.5 text-staff-caption font-semibold text-staff-soft xl:grid ${columns}`}>
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
          <EmptyState icon="receipt" title={t("history.empty")} body={t("board.emptyFilteredHint")} />
        )}
        {!data && loading && (
          <ul aria-label={t("common.loading")} className="divide-y divide-staff-line">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-6 flex-1" />
                <Skeleton className="h-6 w-24" />
              </li>
            ))}
          </ul>
        )}

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
                  className={`grid min-h-14 w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-staff-bg ${columns} ${
                    open ? "bg-staff-bg" : ""
                  }`}
                >
                  <span className="text-staff-title font-bold">{o.orderNumber}</span>
                  <span className="text-staff-body text-staff-soft">
                    {multiDay ? `${o.businessDate.slice(5)} ` : ""}
                    {formatPickupTime(o.createdAt, timezone)}
                  </span>
                  <span className="col-span-3 min-w-0 xl:col-span-1">
                    {o.channel === "dine_in" ? (
                      <TableBadge order={o} />
                    ) : (
                      <span className="block truncate text-staff-body font-medium">{o.customer.name}</span>
                    )}
                    {o.channel !== "dine_in" && o.customer.phone && (
                      <span className="block truncate text-staff-caption text-staff-soft">{formatPhoneNational(o.customer.phone)}</span>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <StationBadge station={o.station} />
                    <ChannelBadge channel={o.channel} />
                  </span>
                  <span className="text-staff-body text-staff-soft">{t("history.itemsCount", { n: itemCount })}</span>
                  <span className={`text-right text-staff-body font-semibold ${o.status === "CANCELLED" ? "text-staff-soft line-through" : ""}`}>
                    {formatCents(o.totals.totalCents)}
                  </span>
                  <span>
                    <StatusPill status={o.status} />
                  </span>
                  <span className="flex flex-wrap items-center gap-1 text-staff-caption text-staff-soft">
                    {deliveries > 0 && t("history.sent", { n: deliveries })}
                    {multi && (
                      <span className={`${ui.pill} bg-staff-brand-tint text-staff-brand`}>
                        {t("card.multiDelivery", { d: deliveries, f: o.fetchCount ?? 0 })}
                      </span>
                    )}
                  </span>
                </button>
                {open && (
                  <div className="border-t border-staff-line bg-staff-bg px-4 py-4">
                    <div className="max-w-2xl">
                      {/* The board's own card and action path: a reprint here
                          is the same call, with the same station picker. */}
                      <OrderList orders={[o]} timezone={timezone} variant="history" onActed={load} />
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
          <span className="text-staff-caption text-staff-soft">
            {t("history.totalRows", { n: data.total })} · {t("history.page", { page, pages })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              icon="chevronLeft"
              disabled={page <= 1 || loading}
              onClick={() => {
                setPage((p) => Math.max(1, p - 1));
                setExpanded(null);
              }}
            >
              {t("history.prev")}
            </Button>
            <Button
              variant="secondary"
              disabled={page >= pages || loading}
              onClick={() => {
                setPage((p) => p + 1);
                setExpanded(null);
              }}
            >
              {t("history.next")}
              <Icon name="chevronRight" size={20} />
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
