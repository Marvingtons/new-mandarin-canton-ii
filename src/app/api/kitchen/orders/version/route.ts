import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { boardHeaders, boardVersion, etagMatches } from "@/lib/kitchen/boardFeed";
import { businessDateFor } from "@/lib/orders/businessDate";

/**
 * GET /api/kitchen/orders/version — the staff board's poll, every 4 seconds
 * per tablet (20 while hidden).
 *
 * ONE statement (readBoardVersion): today's open orders' count and newest
 * updated_at, index-only on migration 013's partial index, plus the two
 * printers' visible state by primary key. No lock, no transaction.
 *
 * Send the ETag you hold as If-None-Match: unchanged is a 304 with no body.
 * Changed is a tiny JSON body, and the cue to fetch GET /api/kitchen/orders
 * with the same If-None-Match.
 *
 * X-Server-Time is the database clock, on the 304 too.
 *
 * Not rate limited, for the same reason as the list.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isOrdersDbConfigured()) {
    return Response.json(
      { ok: false, error: "The order database is not configured (DATABASE_URL)." },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const tenant = publicTenant();
  const businessDate =
    new URL(request.url).searchParams.get("date") ?? businessDateFor(tenant.timezone);

  try {
    const version = await boardVersion(tenant.tenantId, businessDate);
    const headers = boardHeaders(version);
    if (etagMatches(request.headers.get("if-none-match"), version.etag)) {
      return new Response(null, { status: 304, headers });
    }
    return Response.json(
      {
        ok: true,
        version: version.etag,
        openOrders: version.openCount,
        updatedAt: version.maxUpdatedAt,
      },
      { headers },
    );
  } catch (err) {
    console.error(
      "[kitchen] board version failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return Response.json(
      { ok: false, error: "Could not check for changes." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
