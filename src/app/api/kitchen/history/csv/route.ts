import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { CSV_HEADER, csvRow, parseHistoryParams } from "@/lib/orders/history";
import { iterateOrders } from "@/lib/orders/repository";

/**
 * GET /api/kitchen/history/csv: the selected range as a CSV download.
 *
 * STREAMED. Rows are read in keyset batches and written as they arrive, so a
 * month of orders never sits in memory on the Worker or in the browser. Same
 * query parser and same WHERE builder as the on-screen list, so the export is
 * exactly the rows the screen counted.
 *
 * Starts with a UTF-8 BOM: Excel otherwise opens 中文 as mojibake.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!isOrdersDbConfigured()) {
    return new Response("The order database is not configured.", { status: 503 });
  }
  const parsed = parseHistoryParams(new URL(request.url).searchParams);
  if (!parsed) return new Response("bad range or filter", { status: 400 });

  const tenant = publicTenant();
  const encoder = new TextEncoder();
  const batches = iterateOrders(tenant.tenantId, parsed.query);
  let headerSent = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(encoder.encode(`﻿${CSV_HEADER.join(",")}\r\n`));
          return;
        }
        const { value, done } = await batches.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(
          encoder.encode(value.map((o) => `${csvRow(o, tenant.timezone)}\r\n`).join("")),
        );
      } catch (err) {
        console.error(
          "[kitchen-history] csv export failed:",
          err instanceof Error ? err.message : "unknown error",
        );
        controller.error(err);
      }
    },
    async cancel() {
      await batches.return(undefined);
    },
  });

  const { from, to } = parsed.query;
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="orders-${from}-to-${to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
