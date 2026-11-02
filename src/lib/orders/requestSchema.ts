import { z } from "zod";

/**
 * The wire shape of a submitted order — and, just as importantly, the shape it
 * is NOT allowed to have.
 *
 * Extracted from the route so it can be asserted on directly. What it
 * guarantees is a pricing-integrity property, not a parsing convenience: there
 * is NO FIELD ON THIS SCHEMA THAT CARRIES MONEY. A client sends what it wants
 * cooked; the server decides what that costs, by recomputing every line
 * against the live menu and applying the tenant's tax rate itself.
 *
 * Both objects are `.strict()`, so an unrecognised key is a hard reject rather
 * than a silently ignored one. That is deliberate and load-bearing: a body
 * carrying `total`, `taxCents` or `amount` must FAIL, not be quietly dropped,
 * because a request that thinks it is setting the price should be told it is
 * not. It also means a cart held open in a tab across a tax-rate change cannot
 * submit the old figure — it has nowhere to put it, and the server recomputes
 * at the rate in force when the order lands.
 */
export const OrderLineSchema = z
  .object({
    lineId: z.string().optional(),
    itemId: z.string().min(1),
    sizeId: z.string().min(1),
    modifierIds: z.array(z.string()).default([]),
    quantity: z.number().int().min(1).max(50),
    specialInstructions: z.string().max(200).optional(),
  })
  .strict(); // a stray `price`/`amount` on a line is a hard reject

export const OrderRequestSchema = z
  .object({
    lines: z.array(OrderLineSchema).min(1).max(60),
    pickup: z
      .object({
        name: z.string().min(1).max(80),
        phone: z.string().min(7).max(32),
        time: z.string().min(1).max(20),
      })
      .strict(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict(); // a top-level `amount`/`total`/`phoneVerified` is a hard reject

export type OrderRequest = z.infer<typeof OrderRequestSchema>;

/**
 * The staff POS's order. Same lines, same strictness, same absence of any
 * money field: a POS is not a place where a price can be typed in.
 *
 * What differs is who the customer is. There is no OTP: staff on the phone or
 * at the counter are the verification. A walk-in may give no number at all,
 * which the route allows for `walk_in` and refuses for `phone`.
 */
export const StaffOrderRequestSchema = z
  .object({
    lines: z.array(OrderLineSchema).min(1).max(60),
    channel: z.enum(["phone", "walk_in"]),
    customer: z
      .object({
        name: z.string().trim().min(1).max(80),
        phone: z.string().max(32).optional(),
      })
      .strict(),
    pickup: z.object({ time: z.string().min(1).max(20) }).strict(),
    /** Free text such as "paid by phone, card ending 4417". Never a card field. */
    paymentNote: z.string().max(200).optional(),
    /** Internal, never printed. */
    staffNote: z.string().max(500).optional(),
    /** Staff override: allow lunch specials outside 11:00 to 15:00. */
    lunchOverride: z.boolean().optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

export type StaffOrderRequest = z.infer<typeof StaffOrderRequestSchema>;
