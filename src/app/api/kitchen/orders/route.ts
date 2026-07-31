import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { businessDateFor } from "@/lib/orders/businessDate";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { listActiveOrders } from "@/lib/orders/repository";
import { readPrinterStatus } from "@/lib/print/healthStore";
import { derivePrinterHealth, type PrinterHealth } from "@/lib/print/printerStatus";
import { cloudPrntConfigured } from "@/lib/print/status";

/** Printer health as the board renders it. Recomputed on every poll. */
export interface PrinterHealthPayload {
  health: PrinterHealth;
  /** Whole seconds since the last poll, or null if it has never polled. */
  secondsSinceSeen: number | null;
  /** The printer's own words, for the operator who wants the detail. */
  statusCode: string | null;
  /** True while jobs are being withheld — the board says "waiting", not "stuck". */
  blocked: boolean;
  /** False when no printer is configured at all; the strip then stays quiet. */
  configured: boolean;
}

/**
 * Health, derived fresh on every board poll.
 *
 * Derived rather than stored, because "offline" is not something a printer
 * ever tells us — it is the absence of it telling us anything, and that can
 * only be computed against the clock at read time. A stored `online` column
 * would be permanently one poll behind and would read "OK" forever after a
 * power cut.
 */
async function printerHealth(tenantId: string): Promise<PrinterHealthPayload> {
  const configured = cloudPrntConfigured();
  const row = await readPrinterStatus(tenantId);
  if (!row) {
    return {
      health: "unknown",
      secondsSinceSeen: null,
      statusCode: null,
      blocked: false,
      configured,
    };
  }

  const secondsSinceSeen = Math.max(
    0,
    Math.round((Date.now() - Date.parse(row.lastSeenAt)) / 1000),
  );
  const health = derivePrinterHealth({
    secondsSinceSeen,
    paperOut: row.paperOut,
    coverOpen: row.coverOpen,
  });

  return {
    health,
    secondsSinceSeen,
    statusCode: row.statusCode,
    // Exactly the states in which the poll route is withholding work. Offline
    // is included even though nothing is being withheld deliberately — from a
    // queued order's point of view the outcome is identical, and the board's
    // job is to say why nothing is printing.
    blocked: health === "paper-out" || health === "cover-open" || health === "offline",
    configured,
  };
}

/**
 * GET /api/kitchen/orders — the board's polling endpoint.
 *
 * Deliberately NOT rate limited: the board polls every 10s by design, and
 * throttling it would blind the kitchen exactly when the restaurant is busy
 * enough to have several tablets open.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const tenant = publicTenant();

  if (!isOrdersDbConfigured()) {
    // A missing DATABASE_URL is an operator problem. Say so plainly on the
    // board rather than rendering an empty queue, which reads as "no orders".
    return Response.json({
      ok: false,
      error: "The order database is not configured (DATABASE_URL).",
      orders: [],
    });
  }

  const url = new URL(request.url);
  const includeCompleted = url.searchParams.get("completed") === "1";
  const businessDate =
    url.searchParams.get("date") ?? businessDateFor(tenant.timezone);

  try {
    // Both in one round trip — the board asks the same question ten seconds
    // later, and a health strip that lagged the queue by a poll would tell the
    // kitchen the printer was fine while the orders under it said otherwise.
    const [orders, printer] = await Promise.all([
      listActiveOrders(tenant.tenantId, businessDate, { includeCompleted }),
      printerHealth(tenant.tenantId),
    ]);
    return Response.json(
      { ok: true, orders, businessDate, printer },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error(
      "[kitchen] order list failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return Response.json(
      { ok: false, error: "Could not load orders.", orders: [] },
      { status: 503 },
    );
  }
}
