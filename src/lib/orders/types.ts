/**
 * Order types — the shape the repository, the ticket renderer, and the kitchen
 * board all agree on.
 *
 * TYPES + PURE HELPERS ONLY. No env reads, no `server-only`, no database
 * import, so the client /kitchen board can share them with the server.
 *
 * Money is INTEGER CENTS everywhere. There is no float anywhere in this file
 * and none may be added: the ticket, the board, and the customer's quoted
 * total all read these same numbers.
 */

/**
 * Order lifecycle.
 *
 * There are no payment states. Nothing is charged online — the customer pays
 * cash or card at the counter — so an order is REAL the moment it is stored
 * with a verified phone number. That is the whole point of the OTP: it is the
 * cost an abuser has to pay, standing in for the card that used to be one.
 *
 *   QUEUED       — stored, verified, waiting for the printer to claim it.
 *                  An order sitting here too long is the dangerous case, and
 *                  is exactly what the unprinted-order alert watches for.
 *   PRINTED      — the printer sent a CloudPRNT DELETE confirming it printed.
 *   PRINT_FAILED — handed out too many times without confirmation, or the
 *                  render failed. Sorts to the top of the kitchen board.
 *   ACCEPTED     — kitchen tapped 接單.
 *   COMPLETED    — kitchen tapped 完成; handed over.
 *   CANCELLED    — voided by staff.
 */
export const ORDER_STATUSES = [
  "QUEUED",
  "PRINTED",
  "PRINT_FAILED",
  "ACCEPTED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * Where an order came from.
 *
 *   web:     the online checkout, with an OTP-verified phone.
 *   phone:   taken by staff on the POS while the customer was on the phone.
 *   walk_in: taken by staff on the POS with the customer at the counter.
 *
 * One pipeline regardless: the same daily number sequence, the same
 * server-side price recompute, the same printer path. The channel only changes
 * what the ticket header says and how the board badges the card.
 */
export const ORDER_CHANNELS = ["web", "phone", "walk_in"] as const;

export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** The channels staff can choose on the POS. */
export const STAFF_CHANNELS = ["phone", "walk_in"] as const satisfies readonly OrderChannel[];

export type StaffChannel = (typeof STAFF_CHANNELS)[number];

export function isOrderChannel(value: string): value is OrderChannel {
  return (ORDER_CHANNELS as readonly string[]).includes(value);
}

/** Statuses the kitchen still has work to do on. */
export const ACTIVE_STATUSES: OrderStatus[] = [
  "QUEUED",
  "PRINTED",
  "PRINT_FAILED",
  "ACCEPTED",
];

/**
 * Statuses a print job may be claimed from. Only QUEUED — a PRINT_FAILED order
 * is re-queued explicitly by staff pressing 重印 rather than retried forever
 * against a printer that is plainly not working.
 */
export const PRINTABLE_STATUSES: OrderStatus[] = ["QUEUED"];

/** A modifier as it appears on the ticket — bilingual where we have it. */
export interface OrderLineModifier {
  id: string;
  nameEn: string;
  /** null when no override exists; the ticket then marks it visibly. */
  nameZh: string | null;
  priceCents: number;
}

/**
 * A resolved line item. Prices are the SERVER's recomputed values (see
 * /api/checkout) — never anything the client sent.
 */
export interface OrderLine {
  itemId: string;
  nameEn: string;
  /** null when the menu has no 中文 for this item. The ticket flags it. */
  nameZh: string | null;
  sizeId: string;
  sizeLabel: string;
  /** 中文 size label, when one is configured. */
  sizeLabelZh: string | null;
  modifiers: OrderLineModifier[];
  quantity: number;
  unitCents: number;
  lineCents: number;
  specialInstructions?: string;
}

/** Every amount an order carries. Integers, cents. */
export interface OrderTotals {
  subtotalCents: number;
  taxCents: number;
  /**
   * DORMANT BY DESIGN — not a payment remnant, do not delete.
   *
   * This is the origin of the tip surface: `tipCents` here, the TIP line in
   * the ticket renderer, and TIP_PRESETS -> `tipPresets` in the tenant config.
   * Every writer hardcodes 0 today and TIP_PRESETS ships empty, so the whole
   * surface is inert.
   *
   * It is retained for counter-tip support, which is a real thing a register
   * may want, and NOT because the cancelled prepaid checkout left it behind.
   * An audit that greps for payment words will land here — this comment is the
   * answer. Enabling tipping later is a config change, not a migration.
   */
  tipCents: number;
  totalCents: number;
}

export interface OrderCustomer {
  name: string;
  /**
   * E.164, e.g. "+16195550148". Normalized before storage, never as typed.
   * Empty string for a walk-in who gave no number; every reader must cope.
   */
  phone: string;
}

/** A full order row, as the repository returns it. */
export interface Order {
  id: number;
  tenantId: string;
  orderNumber: string;
  /** Restaurant-local YYYY-MM-DD. */
  businessDate: string;
  status: OrderStatus;
  idempotencyKey: string;
  items: OrderLine[];
  totals: OrderTotals;
  customer: OrderCustomer;
  /** When the customer's phone was proved by OTP. Never null: no verification, no order. */
  phoneVerifiedAt: string;
  /** Absolute instant, serialized ISO-8601. Render it in the tenant timezone. */
  pickupAt: string;
  /**
   * The "ready around 6:45–6:50 PM" window, computed once at order creation
   * (lib/order/readyWindow.ts) and stored. The confirmation, the kitchen
   * board, the ticket, and the order-ready text all read THESE — none of them
   * recomputes, so all four agree and none of them drifts as time passes.
   *
   * Null for orders placed before migration 003; readers fall back to
   * pickupAt rather than inventing a window.
   */
  readyFrom: string | null;
  readyTo: string | null;
  /**
   * Hand-overs of this job to the printer. NOT polls: a poll inside the
   * confirmation window is refused without counting (see lib/print/entitlement).
   */
  printAttempts: number;
  /**
   * When a job body was last handed over with jobReady:true, or null when the
   * printer holds nothing of ours.
   *
   * INFORMATIONAL now. The offer path no longer decides from this — it decides
   * from `printDeliveryId` / `printDeliveryExpiresAt` below. This survives only
   * to report "elapsed since offer" in the poll logs.
   */
  offeredAt: string | null;
  /**
   * IDENTITY of the hand-over the printer is currently holding, or null when it
   * holds nothing of ours. The offer path re-offers only when this is null or
   * the delivery it names has expired — never while an unexpired, unconfirmed
   * delivery exists. It is the token echoed on the confirming DELETE.
   */
  printDeliveryId: string | null;
  /** When the in-flight delivery's confirmation window closes, or null. */
  printDeliveryExpiresAt: string | null;
  /**
   * Board-only aggregates over this order's print_deliveries rows. Populated by
   * `listActiveOrders`; left undefined on every other read, because the print
   * path has no use for them and would pay for the join on every poll.
   */
  deliveryCount?: number;
  /** Total fetches across every delivery. > 1 means a body was fetched twice. */
  fetchCount?: number;
  /** How many manual 重印 hand-overs this order has had. */
  reprintCount?: number;
  /** Set only by a CloudPRNT DELETE — the printer's own confirmation. */
  printedAt: string | null;
  lastPrintError: string | null;
  /** Set once an unprinted-order alert has been sent, so it fires exactly once. */
  alertedAt: string | null;
  /** Where the order came from. 'web' for every row predating migration 009. */
  channel: OrderChannel;
  /** POS payment note, e.g. "paid by phone, card ending 4417". Never a card number field. */
  paymentNote: string | null;
  /** Internal staff note. Never printed. */
  staffNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What createOrder needs to reserve a row. The number is allocated for you. */
export interface NewOrderInput {
  /** Stored pickup window; see Order.readyFrom. */
  readyFrom?: Date | null;
  readyTo?: Date | null;
  tenantId: string;
  businessDate: string;
  orderNumberPrefix: string;
  idempotencyKey: string;
  items: OrderLine[];
  totals: OrderTotals;
  customer: OrderCustomer;
  /**
   * Proof the phone was verified. The route supplies it; the client cannot.
   * For a staff channel it is the moment staff took the order.
   */
  phoneVerifiedAt: Date;
  pickupAt: Date;
  /** Defaults to 'web'. */
  channel?: OrderChannel;
  paymentNote?: string | null;
  staffNote?: string | null;
}

/**
 * Result of an insert attempt.
 *
 * `created: false` means this idempotency key already had a row — the caller
 * MUST return that original order's confirmation rather than making a second.
 */
export interface CreateOrderResult {
  order: Order;
  created: boolean;
}

/** "A" + 17 -> "A-017". Zero-padded to three, as the counter tickets do. */
export function formatOrderNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

/**
 * Why a hand-over happened.
 *
 *   first-offer    — the first time an order is handed to the printer.
 *   retry          — a confirmation window expired unconfirmed; presumed dead.
 *   manual_reprint — staff pressed 重印. The ONLY legitimate marker of a second
 *                    ticket; any second ticket without one is a bug by definition.
 */
export type PrintDeliveryReason = "first-offer" | "retry" | "manual_reprint";

export const PRINT_DELIVERY_REASONS: readonly PrintDeliveryReason[] = [
  "first-offer",
  "retry",
  "manual_reprint",
] as const;

/** One hand-over of a job body to the printer, as the repository returns it. */
export interface PrintDelivery {
  id: string;
  orderId: number;
  tenantId: string;
  offeredAt: string;
  expiresAt: string;
  fetchedAt: string | null;
  fetchCount: number;
  confirmedAt: string | null;
  confirmCode: string | null;
  reason: PrintDeliveryReason;
  actor: string | null;
}
