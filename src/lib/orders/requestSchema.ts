import { z } from "zod";
import { MAX_CHARGE_CENTS, MAX_CHARGE_NAME } from "@/lib/kitchen/customCharge";

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
 * Both objects are strict (`z.strictObject`), so an unrecognised key is a hard reject rather
 * than a silently ignored one. That is deliberate and load-bearing: a body
 * carrying `total`, `taxCents` or `amount` must FAIL, not be quietly dropped,
 * because a request that thinks it is setting the price should be told it is
 * not. It also means a cart held open in a tab across a tax-rate change cannot
 * submit the old figure — it has nowhere to put it, and the server recomputes
 * at the rate in force when the order lands.
 */
export const OrderLineSchema = z.strictObject({
  lineId: z.string().optional(),
  itemId: z.string().min(1),
  sizeId: z.string().min(1),
  modifierIds: z.array(z.string()).default([]),
  quantity: z.number().int().min(1).max(50),
  specialInstructions: z.string().max(200).optional(),
}); // a stray `price`/`amount` on a line is a hard reject

export const OrderRequestSchema = z.strictObject({
  lines: z.array(OrderLineSchema).min(1).max(60),
  pickup: z.strictObject({
    name: z.string().min(1).max(80),
    phone: z.string().min(7).max(32),
    time: z.string().min(1).max(20),
  }),
  idempotencyKey: z.string().min(8).max(200),
}); // a top-level `amount`/`total`/`phoneVerified` is a hard reject

export type OrderRequest = z.infer<typeof OrderRequestSchema>;

/**
 * THE POS'S TWO TYPED PRICES, and the only money any request may carry
 * (lib/kitchen/customCharge.ts). Staff-only: the web's OrderLineSchema above
 * has neither, so a web body with one is still a hard 400.
 *
 *   a surcharge on a dish line ("加價 Add charge": +$3 Extra shrimp), per unit
 *   a custom line (自訂 Custom): a name, an amount (0.00 allowed), a quantity
 *
 * The server still multiplies, sums and taxes; nothing here is a total.
 */
const SurchargeSchema = z.strictObject({
  amountCents: z.number().int().min(1).max(MAX_CHARGE_CENTS),
  label: z.string().trim().min(1).max(MAX_CHARGE_NAME),
});

export const StaffItemLineSchema = z.strictObject({
  ...OrderLineSchema.shape,
  surcharge: SurchargeSchema.optional(),
});

export const StaffCustomLineSchema = z.strictObject({
  lineId: z.string().optional(),
  custom: z.literal(true),
  name: z.string().trim().min(1).max(MAX_CHARGE_NAME),
  amountCents: z.number().int().min(0).max(MAX_CHARGE_CENTS),
  quantity: z.number().int().min(1).max(50),
  specialInstructions: z.string().max(200).optional(),
});

export const StaffLineSchema = z.union([StaffCustomLineSchema, StaffItemLineSchema]);
export type StaffLine = z.infer<typeof StaffLineSchema>;

/** Fields every staff order carries. */
const staffCommon = {
  lines: z.array(StaffLineSchema).min(1).max(60),
  /** Free text such as "paid by phone, card ending 4417". Never a card field. */
  paymentNote: z.string().max(200).optional(),
  /** Internal, never printed. */
  staffNote: z.string().max(500).optional(),
  /** Staff override: allow lunch specials outside 11:00 to 15:00. */
  lunchOverride: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(200),
};

/**
 * The staff POS's takeout order. Same lines and the same strictness: no
 * total, tax or line price. The one exception is the custom charge and the
 * surcharge above, which staff type on purpose.
 *
 * What differs is who the customer is. There is no OTP: staff on the phone or
 * at the counter are the verification. The phone number is optional for both
 * channels (a present one must still be valid), and so is the NAME: a store
 * order is called by its number, and its ticket prints no name. (The web
 * checkout still requires both.)
 */
export const StaffTakeoutRequestSchema = z.strictObject({
  ...staffCommon,
  channel: z.enum(["phone", "walk_in"]),
  customer: z.strictObject({
    name: z.string().trim().max(80).optional(),
    phone: z.string().max(32).optional(),
  }),
  pickup: z.strictObject({ time: z.string().min(1).max(20) }),
});

/**
 * What POST /api/kitchen/orders accepts: the takeout order above, and nothing
 * else. (The POS used to take seated dine-in tables too; that service is
 * retired, so a body with `channel: "dine_in"` or a `table` is a hard 400.)
 */
export const StaffOrderRequestSchema = StaffTakeoutRequestSchema;

export type StaffOrderRequest = z.infer<typeof StaffOrderRequestSchema>;

/**
 * 改單 EDIT ORDER: POST /api/kitchen/orders/[id]/edit. The WHOLE edited
 * ticket, in the same no-price line shape as a new staff order; lines loaded
 * from the order carry lineId "orig:<index>" (lib/orders/editPricing.ts).
 * Customer, channel and pickup are not here: an edit cannot change them.
 */
export const OrderEditRequestSchema = z.strictObject({
  /** The revision the POS loaded: the optimistic lock. */
  baseRevision: z.number().int().min(0),
  /** One Save press; a retry with the same token is the same edit. */
  editToken: z.string().min(8).max(200),
  /** Empty is allowed through so the server can answer "use Cancel". */
  lines: z.array(StaffLineSchema).max(60),
  lunchOverride: z.boolean().optional(),
  /** A COMPLETED order prints a change ticket only when staff ask. */
  printChange: z.boolean().optional(),
  /** Price and diff it, write nothing: the confirm sheet. */
  dryRun: z.boolean().optional(),
});

export type OrderEditRequest = z.infer<typeof OrderEditRequestSchema>;
