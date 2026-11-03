import { z } from "zod";
import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { previewOrderingBlocked } from "@/lib/http/deployHost";
import { tablesForLabel } from "@/lib/kitchen/floor-plan";
import { clearTable, listOpenTables } from "@/lib/orders/repository";

/**
 * /api/kitchen/tables: the POS floor plan's occupancy, and 清台.
 *
 * OCCUPANCY IS DERIVED, never stored: a table is open while it has a dine-in
 * order with no table_cleared_at (see listOpenTables). The floor plan polls
 * GET; the layout itself is lib/kitchen/floor-plan, which the client already
 * has, so this returns only which labels are open and since when.
 *
 * Every request re-checks the session server-side. POST also refuses on a
 * preview host, before anything else: clearing a table there would complete
 * real orders in the production database.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isOrdersDbConfigured()) {
    return Response.json({ ok: false, error: "The order database is not configured (DATABASE_URL).", tables: [] });
  }
  try {
    const tables = await listOpenTables(publicTenant().tenantId);
    return Response.json(
      { ok: true, tables, now: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[kitchen-tables] list failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ ok: false, error: "Could not load tables.", tables: [] }, { status: 503 });
  }
}

const BodySchema = z
  .object({
    action: z.literal("clear"),
    label: z.string().min(1).max(16),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const blocked = previewOrderingBlocked(request);
  if (blocked) return blocked;

  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  if (!tablesForLabel(body.label)) {
    return Response.json({ ok: false, code: "table_invalid", error: "Not a table on the floor plan." }, { status: 400 });
  }

  try {
    const cleared = await clearTable(publicTenant().tenantId, body.label);
    if (cleared.length === 0) {
      return Response.json({ ok: false, code: "table_not_open", error: "That table is not seated." }, { status: 409 });
    }
    return Response.json({
      ok: true,
      cleared: cleared.map((o) => ({ id: o.id, orderNumber: o.orderNumber, status: o.status })),
    });
  } catch (err) {
    console.error("[kitchen-tables] clear failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ ok: false, error: "Could not clear the table." }, { status: 503 });
  }
}
