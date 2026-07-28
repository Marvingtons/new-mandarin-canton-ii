/**
 * Order types — the shape the repository, the ticket renderer, and the kitchen
 * board all agree on.
 *
 * TYPES + PURE HELPERS ONLY. No env reads, no `server-only`, no database
 * import, so the client /kitchen board can share them with the server.
 *
 * Money is INTEGER CENTS everywhere. There is no float anywhere in this file
 * and none may be added: the ticket, the board, and the charge all read these
 * same numbers.
 */

/**
 * Order lifecycle.
 *
 *   PENDING_PAYMENT — row reserved, Clover not yet called. Holds the
 *                     idempotency key so a concurrent duplicate submit loses
 *                     the race before it can charge. Never shown to staff.
 *   PAID            — charge succeeded. The order is real money.
 *   PRINTED         — a kitchen ticket came out of the printer.
 *   PRINT_FAILED    — printing exhausted its retries. Staff must read it on
 *                     the tablet; this sorts to the top of the board.
 *   ACCEPTED        — kitchen tapped 接單.
 *   COMPLETED       — kitchen tapped 完成; handed to the customer.
 *   CANCELLED       — voided by staff.
 */
export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PAID",
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

/** Statuses the kitchen still has work to do on. */
export const ACTIVE_STATUSES: OrderStatus[] = [
  "PAID",
  "PRINTED",
  "PRINT_FAILED",
  "ACCEPTED",
];

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
  /** Tips are not offered yet (TIP_PRESETS unset); kept at 0 for the schema. */
  tipCents: number;
  totalCents: number;
}

export interface OrderCustomer {
  name: string;
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
  chargeId: string | null;
  items: OrderLine[];
  totals: OrderTotals;
  customer: OrderCustomer;
  /** Absolute instant, serialized ISO-8601. Render it in the tenant timezone. */
  pickupAt: string;
  printAttempts: number;
  lastPrintError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What createOrder needs to reserve a row. The number is allocated for you. */
export interface NewOrderInput {
  tenantId: string;
  businessDate: string;
  orderNumberPrefix: string;
  idempotencyKey: string;
  items: OrderLine[];
  totals: OrderTotals;
  customer: OrderCustomer;
  pickupAt: Date;
}

/**
 * Result of a reservation attempt.
 *
 * `created: false` means this idempotency key already had a row — the caller
 * MUST return the existing order rather than charging again.
 */
export interface CreateOrderResult {
  order: Order;
  created: boolean;
}

/** "A" + 17 -> "A-017". Zero-padded to three, as the counter tickets do. */
export function formatOrderNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}
