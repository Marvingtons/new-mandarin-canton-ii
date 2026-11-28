import { stationForChannel, type Station } from "@/config/stations";
import type { Order } from "@/lib/orders/types";

/**
 * The board LANE an order sits in: Online or Store, by its CHANNEL.
 *
 * Until the printer pool (docs/printer-pool.md) this was order.station, which
 * was also the printer. With the pool, order.station is the printer that
 * printed it, so the lane filter, its counts and the new-web-order chime read
 * the channel instead, and a web order printed on the store printer is still
 * a web order. Pure; client and server.
 */
export function laneOf(order: Pick<Order, "channel">): Station {
  return stationForChannel(order.channel ?? "web");
}

/** The printer this ticket is on or was printed on, or null before any printer took it. */
export function printedOn(order: Pick<Order, "station" | "printAttempts" | "printedAt">): Station | null {
  return order.printAttempts > 0 || order.printedAt !== null ? order.station : null;
}
