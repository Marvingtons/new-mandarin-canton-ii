"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STATIONS, isStation, type Station } from "@/config/stations";
import { formatCents } from "@/lib/money";
import type { Order, OrderStatus } from "@/lib/orders/types";
import Icon from "@/components/kitchen/Icon";
import { useKT } from "@/components/kitchen/KitchenI18n";
import { useKitchenLive } from "@/components/kitchen/KitchenLive";
import OrderList from "@/components/kitchen/OrderList";
import Button from "@/components/kitchen/ui/Button";
import { buttonClass } from "@/components/kitchen/ui/buttonClass";
import EmptyState from "@/components/kitchen/ui/EmptyState";
import Segmented from "@/components/kitchen/ui/Segmented";
import { useShortcuts } from "@/components/kitchen/ui/shortcuts";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * THE ORDERS BOARD: every order today from both stations, web and counter
 * alike, on one screen. Filter by station (All / Online / Store) and by
 * status; the chosen filter is filled lacquer and lives in the URL, so it is
 * obvious at a glance, survives a reload, and a bookmark can open the board
 * already filtered (an Online-only tablet at the pass, say).
 *
 * The data is the shell's live feed (KitchenLive): no fetch of its own.
 */

type StatusFilter = "active" | "new" | "cooking" | "done" | "cancelled" | "all";
type StationFilter = "all" | Station;

const STATUS_FILTERS: StatusFilter[] = ["active", "new", "cooking", "done", "cancelled", "all"];

const IN_FILTER: Record<StatusFilter, (s: OrderStatus) => boolean> = {
  active: (s) => s !== "COMPLETED" && s !== "CANCELLED",
  new: (s) => s === "QUEUED" || s === "PRINTED" || s === "PRINT_FAILED",
  cooking: (s) => s === "ACCEPTED",
  done: (s) => s === "COMPLETED",
  cancelled: (s) => s === "CANCELLED",
  all: () => true,
};

function matchesSearch(order: Order, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const digits = q.replace(/\D/g, "");
  return (
    order.orderNumber.toLowerCase().includes(needle) ||
    order.customer.name.toLowerCase().includes(needle) ||
    (digits.length >= 3 && order.customer.phone.replace(/\D/g, "").includes(digits)) ||
    (order.tableLabel !== null && order.tableLabel.toLowerCase() === needle)
  );
}

export default function OrdersBoard({
  timezone,
  businessDate,
  basePath,
}: {
  timezone: string;
  businessDate: string;
  basePath: string;
}) {
  const t = useKT();
  const { orders, printers, status } = useKitchenLive();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  const stationParam = params.get("station");
  const station: StationFilter = isStation(stationParam) ? stationParam : "all";
  const statusParam = params.get("status") as StatusFilter | null;
  const statusFilter: StatusFilter = statusParam && STATUS_FILTERS.includes(statusParam) ? statusParam : "active";
  // Typed into locally (instant), mirrored to the URL.
  const [query, setQuery] = useState(() => params.get("q") ?? "");

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  useShortcuts({
    "1": () => setParam("station", null),
    "2": () => setParam("station", "online"),
    "3": () => setParam("station", "store"),
    "/": () => searchRef.current?.focus(),
  });

  // Today's orders only; history is its own screen.
  const today = useMemo(() => orders.filter((o) => o.businessDate === businessDate), [orders, businessDate]);
  const searched = useMemo(() => today.filter((o) => matchesSearch(o, query)), [today, query]);

  const visible = useMemo(
    () =>
      searched.filter(
        (o) => (station === "all" || o.station === station) && IN_FILTER[statusFilter](o.status),
      ),
    [searched, station, statusFilter],
  );

  const stationCounts = useMemo(() => {
    const inStatus = searched.filter((o) => IN_FILTER[statusFilter](o.status));
    return {
      all: inStatus.length,
      online: inStatus.filter((o) => o.station === "online").length,
      store: inStatus.filter((o) => o.station === "store").length,
    };
  }, [searched, statusFilter]);

  const statusCounts = useMemo(() => {
    const inStation = searched.filter((o) => station === "all" || o.station === station);
    return Object.fromEntries(
      STATUS_FILTERS.map((f) => [f, inStation.filter((o) => IN_FILTER[f](o.status)).length]),
    ) as Record<StatusFilter, number>;
  }, [searched, station]);

  // Printers that are withholding or cannot collect: their QUEUED tickets are
  // waiting, not lost. A station with no printer of its own ("not set up")
  // follows the printer covering it; it is never blocked itself.
  const waitingStations = useMemo(() => {
    const blocked = new Set(printers.filter((p) => p.blocked).map((p) => p.station));
    const out = new Set<Station>();
    for (const p of printers) if (blocked.has(p.printedBy)) out.add(p.station);
    return out;
  }, [printers]);

  const failed = today.filter((o) => o.status === "PRINT_FAILED" || o.printStuck === true).length;
  const filtered = station !== "all" || statusFilter !== "active" || query !== "";
  const loading = status === "loading";
  const notCancelled = today.filter((o) => o.status !== "CANCELLED");

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 pt-5 pb-16 sm:px-6">
      {/* ---- title ---- */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-staff-heading font-bold tracking-tight">
          {t("board.title")} <span className="ml-2 text-staff-body font-medium text-staff-soft">{businessDate}</span>
        </h1>
        <span className="hidden text-staff-caption text-staff-soft md:inline">{t("shortcuts.hint")} <kbd className={ui.kbd}>?</kbd></span>
      </div>

      {status === "unconfigured" && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-staff-card bg-staff-brand px-5 py-3.5 text-staff-body font-medium text-staff-on-brand">
          <Icon name="alert" size={20} className="mt-0.5" />
          {t("board.dbMissing")}
        </p>
      )}

      {failed > 0 && (
        <p role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-staff-card bg-staff-brand px-5 py-3 text-staff-body font-semibold text-staff-on-brand">
          <Icon name="alert" size={22} />
          <span className="flex-1">{t("board.failedBanner", { n: failed })}</span>
          {statusFilter !== "new" && (
            <Button variant="secondary" size="sm" onClick={() => setParam("status", "new")}>
              {t("board.showFailed")}
            </Button>
          )}
        </p>
      )}

      {/* ---- filters: station, status, search ---- */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Segmented
          label={t("station.filter")}
          value={station}
          onChange={(v) => setParam("station", v === "all" ? null : v)}
          options={[
            { value: "all" as const, label: t("station.all"), count: stationCounts.all },
            ...STATIONS.map((s) => ({
              value: s,
              label: (
                <>
                  <Icon name={s === "online" ? "globe" : "store"} size={18} />
                  {t(`station.${s}`)}
                </>
              ),
              ariaLabel: t(`station.${s}`),
              count: stationCounts[s],
            })),
          ]}
        />
        <Segmented
          label={t("filter.status")}
          value={statusFilter}
          onChange={(v) => setParam("status", v === "active" ? null : v)}
          options={STATUS_FILTERS.map((f) => ({ value: f, label: t(`filter.${f}`), count: statusCounts[f] }))}
        />
        <label className="relative ml-auto flex min-w-[min(100%,18rem)] flex-1 items-center sm:flex-none">
          <span className="sr-only">{t("filter.search")}</span>
          <Icon name="search" size={20} className="pointer-events-none absolute left-3 text-staff-soft" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setParam("q", e.target.value || null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                setParam("q", null);
                e.currentTarget.blur();
              }
            }}
            placeholder={t("filter.search")}
            className="min-h-12 w-full rounded-staff-control bg-staff-panel pr-3 pl-11 text-staff-body shadow-[inset_0_0_0_1px_var(--color-staff-line-strong)] outline-none placeholder:text-staff-soft focus-visible:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]"
          />
        </label>
      </div>

      {filtered && !loading && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-staff-caption text-staff-soft">
          <span role="status">{t("filter.showing", { n: visible.length, total: today.length })}</span>
          <Button
            variant="quiet"
            size="sm"
            icon="x"
            onClick={() => {
              setQuery("");
              router.replace(pathname, { scroll: false });
            }}
          >
            {t("filter.clear")}
          </Button>
        </div>
      )}

      {/* ---- the orders ---- */}
      <section aria-label={t("board.orders")} className="mt-5">
        {!loading && today.length === 0 && status !== "unconfigured" ? (
          <EmptyState
            icon="receipt"
            title={t("board.emptyToday")}
            body={t("board.emptyTodayHint")}
            action={
              <Link href={`${basePath}/pos`} className={buttonClass({ variant: "primary" })}>
                <Icon name="plus" size={20} />
                {t("board.newOrderCta")}
              </Link>
            }
          />
        ) : !loading && visible.length === 0 ? (
          <EmptyState
            icon="search"
            title={t("board.emptyFiltered")}
            body={t("board.emptyFilteredHint")}
            action={
              <Button
                variant="secondary"
                icon="x"
                onClick={() => {
                  setQuery("");
                  router.replace(pathname, { scroll: false });
                }}
              >
                {t("filter.clear")}
              </Button>
            }
          />
        ) : (
          <OrderList
            orders={visible}
            timezone={timezone}
            variant="board"
            loading={loading}
            keyboard
            waitingStations={waitingStations}
          />
        )}
      </section>

      {notCancelled.length > 0 && (
        <p className="mt-8 text-right text-staff-caption text-staff-soft">
          {t("board.footer", {
            n: notCancelled.length,
            total: formatCents(notCancelled.reduce((n, o) => n + o.totals.totalCents, 0)),
          })}
        </p>
      )}
    </main>
  );
}
