"use client";

import { memo, useState } from "react";
import { orderReadyLabel } from "@/lib/order/readyWindow";
import { formatCents } from "@/lib/money";
import { formatPhoneNational } from "@/lib/phone";
import { formatPickupTime } from "@/lib/orders/businessDate";
import type { Order } from "@/lib/orders/types";
import Icon from "@/components/kitchen/Icon";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Button from "@/components/kitchen/ui/Button";
import { ChannelBadge, StationBadge, StatusPill, TableBadge } from "@/components/kitchen/ui/Badges";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * ONE ORDER, whichever door it came in by. A web order and a counter order
 * are the same card with the same buttons; only the station badge (Online in
 * gold, Store in ink) and the channel say where it came from.
 *
 * 中文 leads on every dish line, as the printed ticket does, and both
 * languages always show for dishes and options; everything around them
 * follows the language toggle. Anything without 中文 carries the same EN
 * marker, so a translation gap looks identical everywhere.
 *
 * The card does not talk to the server. It asks OrderList, which owns the
 * live actions and the confirm / reprint dialogs, so the board, history and
 * the keyboard all go through the same path.
 */

export type CardRequest = "accept" | "complete" | "reprint" | "cancel" | "clearTable";

function OrderCard({
  order,
  timezone,
  variant,
  fresh,
  selected,
  pending,
  waitingForPrinter,
  onRequest,
  onSelect,
}: {
  order: Order;
  timezone: string;
  variant: "board" | "history";
  fresh: boolean;
  selected: boolean;
  pending: boolean;
  /** This order's printer is out of paper, cover-open, or silent. */
  waitingForPrinter: boolean;
  onRequest: (order: Order, request: CardRequest) => void;
  onSelect: (orderId: number) => void;
}) {
  const t = useKT();
  const [showTicket, setShowTicket] = useState(false);

  const failed = order.status === "PRINT_FAILED";
  // A QUEUED order under an unavailable printer is WAITING, not stuck: the
  // server is withholding it and will hand it over when the printer is back.
  const waiting = order.status === "QUEUED" && waitingForPrinter;
  const stale = order.status === "QUEUED" && order.printAttempts > 0 && !waiting;
  const cancelled = order.status === "CANCELLED";
  const done = order.status === "COMPLETED" || cancelled;
  const onBoard = variant === "board";
  const dineIn = order.channel === "dine_in";
  const tableOpen = dineIn && order.tableLabel !== null && order.tableClearedAt === null && !cancelled;

  const fetchCount = order.fetchCount ?? 0;
  const deliveryCount = order.deliveryCount ?? 0;
  const reprintCount = order.reprintCount ?? 0;
  const multiTicket = fetchCount > 1 || deliveryCount > 1;
  const itemCount = order.items.reduce((n, l) => n + l.quantity, 0);

  const enOnly = (
    <span className={`${ui.pill} ml-2 bg-staff-gold-tint align-middle text-staff-ink`}>{t("card.enOnly")}</span>
  );

  const headingId = `order-${order.id}-number`;

  return (
    <article
      data-order-id={order.id}
      aria-labelledby={headingId}
      aria-busy={pending || undefined}
      // Selectable for the keyboard shortcuts: click or J/K picks it, then
      // A / C / P / X act on it.
      tabIndex={onBoard ? -1 : undefined}
      onPointerDown={() => onSelect(order.id)}
      onFocus={() => onSelect(order.id)}
      className={`${ui.card} flex flex-col overflow-hidden outline-none transition-shadow ${
        failed
          ? "shadow-[inset_0_0_0_2px_var(--color-staff-brand),var(--shadow-staff-card)]"
          : fresh
            ? "shadow-[inset_0_0_0_2px_var(--color-staff-gold),var(--shadow-staff-card)]"
            : ""
      } ${selected ? "ring-3 ring-staff-brand ring-offset-2 ring-offset-staff-bg" : ""} ${
        done && onBoard ? "opacity-80" : ""
      }`}
    >
      {/* ---- who, where, when: read first ---- */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-staff-display leading-none font-bold tracking-tight whitespace-nowrap">
            {order.orderNumber}
          </h3>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <StationBadge station={order.station} />
            <ChannelBadge channel={order.channel} />
            <StatusPill status={order.status} />
            {fresh && (
              <span className={`${ui.pill} bg-staff-gold-light text-staff-ink`}>
                <Icon name="bell" size={16} />
                {t("filter.new")}
              </span>
            )}
            {reprintCount > 0 && (
              <span className={`${ui.pill} bg-staff-sunken text-staff-ink`}>
                <Icon name="repeat" size={16} />
                {t("card.reprinted", { n: reprintCount })}
              </span>
            )}
            {multiTicket && (
              <span className={`${ui.pill} bg-staff-brand-tint text-staff-brand`}>
                {t("card.multiDelivery", { d: deliveryCount, f: fetchCount })}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {dineIn ? (
            <div className="text-staff-title font-semibold whitespace-nowrap">
              {t("card.placed", { time: formatPickupTime(order.createdAt, timezone) })}
            </div>
          ) : (
            <>
              <div className="text-staff-caption font-medium text-staff-soft">{t("card.pickup")}</div>
              <div className="text-staff-heading font-bold whitespace-nowrap">{orderReadyLabel(order, timezone)}</div>
            </>
          )}
          {!onBoard && (
            <div className="mt-1 text-staff-caption text-staff-soft">
              {t("card.placed", { time: `${order.businessDate} ${formatPickupTime(order.createdAt, timezone)}` })}
            </div>
          )}
        </div>
      </div>

      {/* ---- customer or table ---- */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 pb-3 text-staff-body">
        {dineIn ? (
          <TableBadge order={order} />
        ) : (
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5 font-semibold">
              <Icon name="user" size={18} className="text-staff-soft" />
              {order.customer.name}
            </span>
            {order.customer.phone ? (
              <a
                href={`tel:${order.customer.phone.replace(/\D/g, "")}`}
                className="inline-flex min-h-11 items-center text-staff-ink underline decoration-staff-line-strong underline-offset-4"
              >
                {formatPhoneNational(order.customer.phone)}
              </a>
            ) : (
              <span className="text-staff-soft">{t("card.noPhone")}</span>
            )}
          </span>
        )}
        <span className="text-staff-caption text-staff-soft">{t("card.items", { n: itemCount })}</span>
      </div>

      {/* ---- print trouble, in words ---- */}
      {failed && (
        <p className="mx-5 mb-3 flex items-start gap-2 rounded-staff-control bg-staff-brand px-3 py-2.5 text-staff-body font-semibold text-staff-on-brand">
          <Icon name="alert" size={20} className="mt-0.5" />
          <span>
            {t("card.notPrinted")}
            {order.lastPrintError ? ` (${order.lastPrintError})` : ""}
          </span>
        </p>
      )}
      {stale && (
        <p className="mx-5 mb-3 flex items-start gap-2 rounded-staff-control bg-staff-brand-tint px-3 py-2.5 text-staff-body font-medium text-staff-brand">
          <Icon name="alert" size={20} className="mt-0.5" />
          <span>{t("card.unconfirmed", { n: order.printAttempts })}</span>
        </p>
      )}
      {waiting && (
        <p className="mx-5 mb-3 flex items-start gap-2 rounded-staff-control bg-staff-gold-tint px-3 py-2.5 text-staff-body font-medium text-staff-ink">
          <Icon name="clock" size={20} className="mt-0.5" />
          <span>{t("card.waiting")}</span>
        </p>
      )}

      {/* ---- items ---- */}
      <ul className="flex-1 divide-y divide-staff-line border-t border-staff-line px-5">
        {order.items.map((line, index) => (
          <li key={`${line.itemId}-${index}`} className="flex gap-3 py-3">
            <span className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-staff-tag bg-staff-ink px-2 text-staff-body font-bold text-staff-panel">
              {line.quantity}
            </span>
            <div className="min-w-0 flex-1">
              <div lang="zh-Hant" className="text-staff-title leading-snug font-semibold">
                {line.nameZh ?? line.nameEn}
                {!line.nameZh && enOnly}
              </div>
              {line.nameZh && (
                <div lang="en" className="text-staff-caption text-staff-soft">
                  {line.nameEn}
                </div>
              )}
              {line.sizeLabel.toLowerCase() !== "regular" && line.sizeLabel.toLowerCase() !== "individual" && (
                <div className={`${ui.pill} mt-1.5 bg-staff-sunken text-staff-ink`}>
                  {line.sizeLabelZh ?? line.sizeLabel}
                  {line.sizeLabelZh ? <span className="font-normal">{line.sizeLabel}</span> : enOnly}
                </div>
              )}
              {line.modifiers.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {line.modifiers.map((mod) => (
                    <li key={mod.id} className="flex items-baseline gap-2 text-staff-body">
                      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 translate-y-[-0.2em] rounded-full bg-staff-line-strong" />
                      <span>
                        {mod.nameZh ?? mod.nameEn}
                        {mod.nameZh ? <span className="ml-2 text-staff-caption text-staff-soft">{mod.nameEn}</span> : enOnly}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {line.specialInstructions && (
                <div className="mt-2 rounded-staff-control bg-staff-gold-tint px-3 py-2">
                  <div className="text-staff-caption font-semibold">{t("card.note")}</div>
                  <div className="text-staff-body">{line.specialInstructions}</div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* ---- money and notes ---- */}
      <div className="flex flex-col gap-1 border-t border-staff-line bg-staff-bg px-5 py-3 text-staff-body">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-staff-soft">{t("pos.payAtCounter")}</span>
          <span className="font-bold">{formatCents(order.totals.totalCents)}</span>
        </div>
        {order.paymentNote && (
          <div className="text-staff-caption text-staff-soft">
            <span className="font-semibold text-staff-ink">{t("card.paymentNote")}</span> {order.paymentNote}
          </div>
        )}
        {order.staffNote && (
          <div className="text-staff-caption whitespace-pre-line text-staff-soft">
            <span className="font-semibold text-staff-ink">{t("card.staffNote")}</span> {order.staffNote}
          </div>
        )}
      </div>

      {/* ---- actions: the same set, in the same order, on every card ---- */}
      <div role="group" aria-label={t("card.actions", { number: order.orderNumber })} className="flex flex-wrap gap-2 border-t border-staff-line p-3">
        {onBoard && !done && order.status !== "ACCEPTED" && (
          <Button variant="primary" className="flex-1 basis-32" shortcut="A" disabled={pending} onClick={() => onRequest(order, "accept")}>
            {t("card.accept")}
          </Button>
        )}
        {onBoard && !done && (
          <Button
            variant={order.status === "ACCEPTED" ? "primary" : "secondary"}
            className="flex-1 basis-32"
            shortcut="C"
            disabled={pending}
            onClick={() => onRequest(order, "complete")}
          >
            {t("card.complete")}
          </Button>
        )}
        {!cancelled && (
          <Button variant="secondary" icon="printer" shortcut="P" disabled={pending} onClick={() => onRequest(order, "reprint")}>
            {t("card.reprint")}
          </Button>
        )}
        <Button variant="secondary" icon="receipt" aria-expanded={showTicket} onClick={() => setShowTicket((v) => !v)}>
          {showTicket ? t("card.hideReceipt") : t("card.receipt")}
        </Button>
        {onBoard && tableOpen && (
          <Button variant="danger" icon="table" disabled={pending} onClick={() => onRequest(order, "clearTable")}>
            {t("card.clearTable")}
          </Button>
        )}
        {onBoard && !done && (
          <Button variant="danger" className="ml-auto" shortcut="X" disabled={pending} onClick={() => onRequest(order, "cancel")}>
            {t("card.cancel")}
          </Button>
        )}
      </div>

      {/* The exact image that goes to the printer: the fallback that makes a dead printer survivable. */}
      {showTicket && (
        <div className="border-t border-staff-line bg-staff-sunken p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered PNG of unknown height, not a static asset */}
          <img
            src={`/api/kitchen/orders/${order.id}/ticket`}
            alt={t("card.ticketAlt", { number: order.orderNumber })}
            className="mx-auto w-full max-w-[576px] rounded-staff-tag bg-staff-panel shadow-staff-card"
          />
        </div>
      )}
    </article>
  );
}

export default memo(OrderCard);
