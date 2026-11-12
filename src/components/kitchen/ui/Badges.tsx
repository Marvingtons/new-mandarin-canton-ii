"use client";

import type { Station } from "@/config/stations";
import type { Order, OrderChannel, OrderStatus } from "@/lib/orders/types";
import Icon, { type IconName } from "@/components/kitchen/Icon";
import { useKT } from "@/components/kitchen/KitchenI18n";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * The small labels every order carries, in one place so the board, history
 * and the POS's recent orders never draw them differently. Each pairs its
 * colour with words (and usually an icon): colour is never the only signal.
 */

const STATION_LOOK: Record<Station, string> = {
  online: "bg-staff-gold-light text-staff-ink",
  store: "bg-staff-ink text-staff-panel",
};

/**
 * Which PRINTER this order's ticket is on: Online (gold) or Store (ink),
 * always with the printer icon, so it never reads as the channel badge.
 */
export function StationBadge({ station }: { station: Station }) {
  const t = useKT();
  return (
    <span className={`${ui.pill} ${STATION_LOOK[station]}`}>
      <Icon name="printer" size={16} />
      {t(`station.${station}`)}
    </span>
  );
}

const CHANNEL_ICON: Record<OrderChannel, IconName> = {
  web: "globe",
  phone: "phone",
  walk_in: "user",
  dine_in: "table",
};

/** How the order came in: 網上 / 電話 / 到店 / 堂食. Quiet: the station badge leads. */
export function ChannelBadge({ channel }: { channel: OrderChannel }) {
  const t = useKT();
  return (
    <span className={`${ui.pill} bg-staff-sunken text-staff-ink`}>
      <Icon name={CHANNEL_ICON[channel]} size={16} />
      {t(`channel.${channel}`)}
    </span>
  );
}

const STATUS_LOOK: Record<OrderStatus, { className: string; icon: IconName }> = {
  QUEUED: { className: "bg-staff-gold-tint text-staff-ink", icon: "clock" },
  PRINTED: { className: "bg-staff-panel text-staff-ink shadow-[inset_0_0_0_1px_var(--color-staff-line-strong)]", icon: "printer" },
  PRINT_FAILED: { className: "bg-staff-brand text-staff-on-brand", icon: "alert" },
  ACCEPTED: { className: "bg-staff-ink text-staff-panel", icon: "dot" },
  COMPLETED: { className: "bg-staff-sunken text-staff-ink", icon: "check" },
  CANCELLED: { className: "bg-staff-sunken text-staff-soft line-through", icon: "x" },
};

export function StatusPill({ status }: { status: OrderStatus }) {
  const t = useKT();
  const look = STATUS_LOOK[status];
  return (
    <span className={`${ui.pill} ${look.className}`}>
      <Icon name={look.icon} size={16} />
      {t(`status.${status}`)}
    </span>
  );
}

/** Where a dine-in order goes: 4 號桌 · 3 位, and 加菜 for a later round. Nothing for takeout. */
export function TableBadge({ order }: { order: Pick<Order, "channel" | "tableLabel" | "guestCount" | "isAddon"> }) {
  const t = useKT();
  if (order.channel !== "dine_in" || !order.tableLabel) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Icon name="table" size={20} />
        {t("board.table", { table: order.tableLabel })}
      </span>
      {order.guestCount != null && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-staff-soft">
          <Icon name="users" size={20} />
          {t("board.guests", { n: order.guestCount })}
        </span>
      )}
      {order.isAddon && (
        <span className={`${ui.pill} bg-staff-brand-tint text-staff-brand`}>{t("ticket.addon")}</span>
      )}
    </span>
  );
}
