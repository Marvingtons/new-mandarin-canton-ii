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
