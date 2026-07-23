import "server-only";

import { cloverFetch } from "@/lib/clover/client";
import { sclBase } from "@/lib/clover/env";
import { requirePrivateToken } from "@/config/tenant.server";

/**
 * Clover Ecommerce charge creation. The private token is read here and passed
 * only to cloverFetch, which never logs it. Card data never reaches this
 * server — `source` is a clv_ token produced by the browser iframe.
 *
 * POST {scl}/v1/charges
 *   { amount (cents), currency, source, ecomind:"ecom", metadata }
 */

export interface ChargeResult {
  id: string;
  status?: string;
  amount?: number;
  currency?: string;
}

export interface CreateChargeInput {
  amountCents: number;
  source: string;
  clientIp: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export async function createCharge(
  input: CreateChargeInput,
): Promise<ChargeResult> {
  const token = requirePrivateToken();
  return cloverFetch<ChargeResult>({
    baseUrl: sclBase(),
    path: "/v1/charges",
    token,
    method: "POST",
    headers: {
      // Clover derives risk signals from the real cardholder IP.
      "X-Forwarded-For": input.clientIp,
      // Defense in depth alongside our own order-store idempotency.
      "idempotency-key": input.idempotencyKey,
    },
    body: {
      amount: input.amountCents,
      currency: "usd",
      source: input.source,
      ecomind: "ecom",
      metadata: input.metadata,
    },
    // Do not silently retry a charge POST — a 5xx might have succeeded.
    maxAttempts: 1,
  });
}
