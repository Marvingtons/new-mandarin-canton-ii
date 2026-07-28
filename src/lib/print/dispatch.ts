import "server-only";

import { publicTenant } from "@/config/tenant.server";
import { renderTicketImage } from "@/lib/ticket/render";
import { rasterToEscPos } from "@/lib/print/escpos";
import { submitPrintJob } from "@/lib/print/printnode";
import { recordPrintAttempt } from "@/lib/orders/repository";
import type { Order } from "@/lib/orders/types";

/**
 * Render a ticket and get it to the printer, then record what happened on the
 * order row.
 *
 * The customer's money is already taken and their order is already committed
 * before anything here runs. So the contract is absolute: THIS MUST NEVER
 * THROW INTO THE CHECKOUT PATH. A jammed printer, a revoked API key, a
 * PrintNode outage — each ends as a PRINT_FAILED row that sorts to the top of
 * the /kitchen board, not as a failed checkout for someone standing at the
 * counter with a receipt.
 */

export interface DispatchResult {
  printed: boolean;
  skipped: boolean;
  error: string | null;
}

export async function printOrder(
  order: Order,
  options: { reprint?: boolean } = {},
): Promise<DispatchResult> {
  const tenant = publicTenant();

  try {
    const image = await renderTicketImage(order, {
      timezone: tenant.timezone,
      reprint: options.reprint,
    });

    const raw = rasterToEscPos(image.pixels, image.width, image.height);
    const outcome = await submitPrintJob({
      raw,
      title: `${order.orderNumber}${options.reprint ? " (reprint)" : ""}`,
    });

    if (outcome.status === "skipped") {
      // Not a failure. No printer is a valid configuration — the board is the
      // fallback — so the order must not be branded PRINT_FAILED for it.
      return { printed: false, skipped: true, error: null };
    }

    if (outcome.status === "printed") {
      await recordPrintAttempt(order.tenantId, order.id, { ok: true });
      return { printed: true, skipped: false, error: null };
    }

    await recordPrintAttempt(order.tenantId, order.id, {
      ok: false,
      error: outcome.error,
    });
    return { printed: false, skipped: false, error: outcome.error };
  } catch (err) {
    // A render failure (missing font file, malformed order) lands here. It is
    // still just a print failure as far as the customer is concerned.
    const message =
      err instanceof Error ? err.message : "ticket rendering failed";
    console.error(`[print] ${order.orderNumber}: ${message}`);
    await recordPrintAttempt(order.tenantId, order.id, {
      ok: false,
      error: message,
    }).catch(() => {
      /* the DB is down too; the board will show the order as PAID */
    });
    return { printed: false, skipped: false, error: message };
  }
}

/**
 * Fire-and-forget wrapper for the checkout route.
 *
 * Deliberately NOT awaited by the caller: the confirmation response must not
 * wait on a printer. On serverless this races the function freeze, so a print
 * can be lost — which is precisely why PRINT_FAILED and the reprint button
 * exist, and why the board never depends on the printer having worked.
 *
 * ⚠️ TODO(confirm): if lost prints prove common in production, move this to
 * `waitUntil()` from `@vercel/functions` (or a queue). That is a deploy-target
 * decision, not a code one — `printOrder` itself does not change.
 */
export function printOrderInBackground(order: Order): void {
  void printOrder(order).catch((err: unknown) => {
    console.error(
      `[print] background dispatch crashed for ${order.orderNumber}:`,
      err instanceof Error ? err.message : "unknown error",
    );
  });
}
