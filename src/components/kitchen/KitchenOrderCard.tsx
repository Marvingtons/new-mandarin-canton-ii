"use client";

import { orderReadyLabel } from "@/lib/order/readyWindow";
import { useState } from "react";
import { formatCents } from "@/lib/money";
import { formatPhoneNational } from "@/lib/phone";
import { formatPickupTime } from "@/lib/orders/businessDate";
import type { Order, OrderChannel, OrderStatus } from "@/lib/orders/types";
import Icon, { type IconName } from "@/components/kitchen/Icon";
import { useKT } from "@/components/kitchen/KitchenI18n";

/**
 * One order, sized to be read across a hot line.
 *
 * 中文 leads on every line, exactly as the printed ticket does — staff should
 * not have to re-learn the layout when they switch from paper to the tablet.
 * Dish and option names always show BOTH languages whatever the toggle says;
 * everything around them follows the toggle. Anything without 中文 carries the
 * same ⚠ EN marker, so a translation gap looks identical everywhere.
 *
 * Used by the board and, expanded, by the history screen (`variant="history"`),
 * where only 重印 and 單據 are offered: history is for looking back, not for
 * moving an order along.
 */

export type CardAction = "accept" | "complete" | "cancel" | "reprint";

const CHANNEL_STYLE: Record<OrderChannel, { className: string; icon: IconName }> = {
  web: { className: "border border-staff-line-strong text-staff-soft", icon: "globe" },
  phone: { className: "bg-staff-accent-tint text-staff-accent", icon: "phone" },
  walk_in: { className: "bg-staff-blue-tint text-staff-blue", icon: "store" },
  dine_in: { className: "bg-staff-ink text-staff-panel", icon: "table" },
};

/** The 網上 / 電話 / 到店 / 堂食 badge. Shared with the history rows. */
export function ChannelBadge({ channel }: { channel: OrderChannel }) {
  const t = useKT();
  const style = CHANNEL_STYLE[channel];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-base font-medium whitespace-nowrap ${style.className}`}
    >
      <Icon name={style.icon} size={18} />
      {t(`channel.${channel}`)}
    </span>
  );
}

/**
 * Where a dine-in order goes: 4 號桌 · 3 位, and 加菜 for a later round.
 * Nothing for takeout. Shared with the history rows.
 */
export function TableBadge({ order }: { order: Pick<Order, "channel" | "tableLabel" | "guestCount" | "isAddon"> }) {
  const t = useKT();
  if (order.channel !== "dine_in" || !order.tableLabel) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Icon name="table" size={20} />
        {t("board.table", { table: order.tableLabel })}
      </span>
      {order.guestCount != null && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Icon name="users" size={20} />
          {t("board.guests", { n: order.guestCount })}
        </span>
      )}
      {order.isAddon && (
        <span className="rounded-md border-2 border-staff-ink px-2 whitespace-nowrap">{t("ticket.addon")}</span>
      )}
    </span>
  );
}

/** Status as a tinted pill: colour only where the state asks for attention. */
export const STATUS_PILL: Record<OrderStatus, string> = {
  QUEUED: "bg-staff-warn-tint text-staff-warn",
  PRINTED: "bg-staff-sunken text-staff-soft",
  PRINT_FAILED: "bg-staff-danger text-white",
  ACCEPTED: "bg-staff-blue-tint text-staff-blue",
  COMPLETED: "bg-staff-accent-tint text-staff-accent",
  CANCELLED: "bg-staff-sunken text-staff-faint line-through",
};

export function StatusPill({ status }: { status: OrderStatus }) {
  const t = useKT();
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-base font-medium whitespace-nowrap ${STATUS_PILL[status]}`}>
      {t(`status.${status}`)}
    </span>
  );
}

export default function KitchenOrderCard({
  order,
  timezone,
  fresh = false,
  waitingForPrinter = false,
  variant = "board",
  onAction,
}: {
  order: Order;
  timezone: string;
  fresh?: boolean;
  /** The printer is out of paper, cover-open, or silent. See KitchenBoard. */
  waitingForPrinter?: boolean;
  variant?: "board" | "history";
  onAction: (orderId: number, action: CardAction, extra?: { note?: string }) => Promise<void>;
}) {
  const t = useKT();
  const [busy, setBusy] = useState<CardAction | null>(null);
  const [showTicket, setShowTicket] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelNote, setCancelNote] = useState("");

  const failed = order.status === "PRINT_FAILED";
  /**
   * A QUEUED order the printer has already been handed and not confirmed is
   * the quiet failure mode: paper may never have come out.
   *
   * UNLESS the printer is simply unavailable, in which case this is not a
   * failure at all — the server is deliberately withholding the job and will
   * hand it over when the printer comes back.
   */
  const waiting = order.status === "QUEUED" && waitingForPrinter;
  const stale = order.status === "QUEUED" && order.printAttempts > 0 && !waiting;
  const cancelled = order.status === "CANCELLED";
  const done = order.status === "COMPLETED" || cancelled;
  const onBoard = variant === "board";

  // Delivery audit, from print_deliveries. A labeled 重印 is the only
  // legitimate second ticket; anything else with more than one delivery or a
  // body fetched twice is worth a glance at the pass.
  const fetchCount = order.fetchCount ?? 0;
  const deliveryCount = order.deliveryCount ?? 0;
  const reprintCount = order.reprintCount ?? 0;
  const multiTicket = fetchCount > 1 || deliveryCount > 1;

  async function run(action: CardAction, extra?: { note?: string }) {
    setBusy(action);
    try {
      await onAction(order.id, action, extra);
    } finally {
      setBusy(null);
    }
  }

  const enOnly = (
    <span className="ml-2 rounded-sm bg-staff-warn-tint px-1.5 py-0.5 align-middle text-base font-semibold text-staff-warn">
      {t("card.enOnly")}
    </span>
  );

  const secondary =
    "flex min-h-12 items-center justify-center gap-2 rounded-md border border-staff-line-strong bg-staff-panel px-4 text-base font-medium text-staff-ink transition-colors hover:bg-staff-sunken disabled:opacity-50";

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-lg bg-staff-panel ${
        failed
          ? "border-2 border-staff-danger"
          : fresh
            ? "border border-staff-accent ring-4 ring-staff-accent/20"
            : "border border-staff-line"
      } ${done && onBoard ? "bg-staff-sunken" : ""}`}
    >
      {/* header: number + pickup time, the two things read first */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <div className="text-4xl leading-none font-semibold tracking-tight">{order.orderNumber}</div>
          {order.channel === "dine_in" && (
            <div className="mt-2 text-2xl">
              <TableBadge order={order} />
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <ChannelBadge channel={order.channel} />
            <StatusPill status={order.status} />
            {reprintCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-staff-sunken px-2.5 py-1 text-base font-medium text-staff-soft">
                <Icon name="repeat" size={14} />
                {t("card.reprinted", { n: reprintCount })}
              </span>
            )}
            {multiTicket && (
              <span className="inline-flex items-center gap-1 rounded-full bg-staff-danger-tint px-2.5 py-1 text-base font-medium text-staff-danger">
                {t("card.multiDelivery", { d: deliveryCount, f: fetchCount })}
              </span>
            )}
          </div>
          {/* Print trail: how many times it was handed over and how many
              times a body was actually fetched. */}
          {(order.printAttempts > 0 || deliveryCount > 0) && order.status === "PRINTED" && (
            <div className="mt-2 text-base text-staff-faint">
              {t("card.printTrail", { sent: order.printAttempts, fetched: fetchCount })}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          {order.channel === "dine_in" ? (
            // A table has no pickup time; when it ordered is what matters.
            <div className="text-2xl font-semibold whitespace-nowrap">
              {t("card.placed", { time: formatPickupTime(order.createdAt, timezone) })}
            </div>
          ) : (
            <>
              <div className="text-base font-medium text-staff-faint">{t("card.pickup")}</div>
              <div className="mt-0.5 text-2xl font-semibold whitespace-nowrap">{orderReadyLabel(order, timezone)}</div>
            </>
          )}
          {!onBoard && (
            <div className="mt-1 text-base text-staff-faint">
              {t("card.placed", { time: `${order.businessDate} ${formatPickupTime(order.createdAt, timezone)}` })}
            </div>
          )}
        </div>
      </div>

      {failed && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-md bg-staff-danger-tint px-3 py-2.5 text-base font-medium text-staff-danger">
          <Icon name="alert" size={20} className="mt-0.5" />
          <span>
            {t("card.notPrinted")}
            {order.lastPrintError ? ` (${order.lastPrintError})` : ""}
          </span>
        </div>
      )}

      {stale && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-md bg-staff-danger-tint px-3 py-2.5 text-base font-medium text-staff-danger">
          <Icon name="alert" size={20} className="mt-0.5" />
          <span>{t("card.unconfirmed", { n: order.printAttempts })}</span>
        </div>
      )}

      {waiting && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-md bg-staff-warn-tint px-3 py-2.5 text-base font-medium text-staff-warn">
          <Icon name="clock" size={20} className="mt-0.5" />
          <span>{t("card.waiting")}</span>
        </div>
      )}

      {/* items */}
      <ul className="flex-1 divide-y divide-staff-line border-t border-staff-line px-5">
        {order.items.map((line, index) => (
          <li key={`${line.itemId}-${index}`} className="flex gap-3 py-3">
            <span className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md bg-staff-ink px-2 text-lg font-semibold text-white">
              {line.quantity}
            </span>
            <div className="min-w-0 flex-1">
              <div lang="zh-Hant" className="text-2xl leading-snug font-semibold">
                {line.nameZh ?? line.nameEn}
                {!line.nameZh && enOnly}
              </div>
              {line.nameZh && (
                <div lang="en" className="text-base text-staff-faint">
                  {line.nameEn}
                </div>
              )}

              {line.sizeLabel.toLowerCase() !== "regular" &&
                line.sizeLabel.toLowerCase() !== "individual" && (
                  <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-sm bg-staff-accent-tint px-2 py-0.5 text-base font-semibold text-staff-accent">
                    {line.sizeLabelZh ?? line.sizeLabel}
                    {line.sizeLabelZh ? <span className="text-base font-normal">{line.sizeLabel}</span> : enOnly}
                  </div>
                )}

              {line.modifiers.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {line.modifiers.map((mod) => (
                    <li key={mod.id} className="flex items-baseline gap-2 text-lg text-staff-soft">
                      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 translate-y-[-0.2em] rounded-full bg-staff-line-strong" />
                      <span>
                        {mod.nameZh ?? mod.nameEn}
                        {mod.nameZh ? <span className="ml-2 text-base text-staff-faint">{mod.nameEn}</span> : enOnly}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {line.specialInstructions && (
                <div className="mt-2 rounded-md bg-staff-warn-tint px-3 py-2">
                  <div className="text-base font-semibold text-staff-warn">{t("card.note")}</div>
                  <div className="text-lg text-staff-ink">{line.specialInstructions}</div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* customer + total */}
      <div className="flex flex-col gap-1 border-t border-staff-line bg-staff-bg/60 px-5 py-3 text-base">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {order.channel === "dine_in" ? (
            // The table already leads the card, at the top.
            <span />
          ) : (
            <span className="flex items-center gap-2 font-semibold">
              <Icon name="user" size={16} className="text-staff-faint" />
              {order.customer.name}
            </span>
          )}
          <span className="font-semibold">{formatCents(order.totals.totalCents)}</span>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-base">
          {order.channel === "dine_in" ? (
            <span />
          ) : order.customer.phone ? (
            <a
              href={`tel:${order.customer.phone.replace(/\D/g, "")}`}
              className="text-staff-accent underline decoration-staff-accent/40 underline-offset-4"
            >
              {formatPhoneNational(order.customer.phone)}
            </a>
          ) : (
            <span className="text-staff-faint">{t("card.noPhone")}</span>
          )}
          <span className="text-staff-faint">{t("pos.payAtCounter")}</span>
        </div>
        {order.paymentNote && (
          <div className="mt-1 text-base text-staff-soft">
            <span className="font-semibold text-staff-ink">{t("card.paymentNote")}</span> {order.paymentNote}
          </div>
        )}
        {order.staffNote && (
          <div className="mt-1 text-base whitespace-pre-line text-staff-soft">
            <span className="font-semibold text-staff-ink">{t("card.staffNote")}</span> {order.staffNote}
          </div>
        )}
      </div>

      {/* cancel confirmation: a second, deliberate step */}
      {confirmingCancel ? (
        <div className="flex flex-col gap-3 border-t border-staff-danger/30 bg-staff-danger-tint p-4">
          <div className="text-lg font-semibold text-staff-danger">{t("card.cancelTitle", { number: order.orderNumber })}</div>
          <label className="flex flex-col gap-1.5">
            <span className="text-base text-staff-soft">{t("card.cancelReason")}</span>
            <input
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              maxLength={300}
              className="min-h-12 rounded-md border border-staff-line-strong bg-staff-panel px-3 text-base outline-none focus:border-staff-accent"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                await run("cancel", { note: cancelNote.trim() || undefined });
                setConfirmingCancel(false);
              }}
              disabled={busy !== null}
              className="min-h-12 flex-1 rounded-md bg-staff-danger px-4 text-base font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-50"
            >
              {busy === "cancel" ? t("common.busy") : t("card.cancelConfirm")}
            </button>
            <button type="button" onClick={() => setConfirmingCancel(false)} className={`${secondary} flex-1`}>
              {t("card.cancelBack")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-staff-line p-3">
          {onBoard && order.status !== "ACCEPTED" && !done && (
            <button
              onClick={() => run("accept")}
              disabled={busy !== null}
              className="min-h-12 flex-1 basis-[6.5rem] rounded-md bg-staff-accent px-4 text-lg font-semibold whitespace-nowrap text-white transition-colors hover:bg-staff-accent-hover disabled:opacity-50"
            >
              {busy === "accept" ? t("common.busy") : t("card.accept")}
            </button>
          )}
          {onBoard && !done && (
            <button
              onClick={() => run("complete")}
              disabled={busy !== null}
              className={`min-h-12 flex-1 basis-[6.5rem] rounded-md px-4 text-lg font-semibold whitespace-nowrap transition-colors disabled:opacity-50 ${
                order.status === "ACCEPTED"
                  ? "bg-staff-accent text-white hover:bg-staff-accent-hover"
                  : "border border-staff-accent text-staff-accent hover:bg-staff-accent-tint"
              }`}
            >
              {busy === "complete" ? t("common.busy") : t("card.complete")}
            </button>
          )}
          {!cancelled && (
            <button onClick={() => run("reprint")} disabled={busy !== null} className={secondary}>
              <Icon name="printer" size={18} />
              {busy === "reprint" ? t("common.busy") : t("card.reprint")}
            </button>
          )}
          <button onClick={() => setShowTicket((v) => !v)} aria-expanded={showTicket} className={secondary}>
            <Icon name="receipt" size={18} />
            {showTicket ? t("card.hideReceipt") : t("card.receipt")}
          </button>
          {onBoard && !done && (
            <button
              onClick={() => setConfirmingCancel(true)}
              disabled={busy !== null}
              className="ml-auto min-h-12 rounded-md px-3 text-base font-medium text-staff-danger transition-colors hover:bg-staff-danger-tint disabled:opacity-50"
            >
              {t("card.cancel")}
            </button>
          )}
        </div>
      )}

      {/* The exact image that goes to the printer — the fallback that makes a
          dead printer survivable. */}
      {showTicket && (
        <div className="border-t border-staff-line bg-staff-sunken p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered PNG of unknown height, not a static asset */}
          <img
            src={`/api/kitchen/orders/${order.id}/ticket`}
            alt={t("card.ticketAlt", { number: order.orderNumber })}
            className="mx-auto w-full max-w-[576px] rounded-sm bg-white shadow-[0_2px_8px_-2px_rgba(27,26,23,0.2)]"
          />
        </div>
      )}
    </article>
  );
}
