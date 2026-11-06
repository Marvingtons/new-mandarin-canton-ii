import { z } from "zod";
import { publicTenant, ticketCopyRoles } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { ownerPinConfigured, ownerPinMatches } from "@/lib/auth/ownerPin";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { clientIp } from "@/lib/http/clientIp";
import { previewOrderingBlocked } from "@/lib/http/deployHost";
import { checkRateLimit, rateLimitResponse } from "@/lib/http/rateLimit";
import { ORDER_CHANNELS, PRINTER_ROLES } from "@/lib/orders/types";
import {
  COPY_ROLE_VALUES,
  PIN_FAILURE_LIMIT,
  PrinterChangeError,
  assignPrinter,
  deactivatePrinter,
  formatMac,
  listAudit,
  listPrinters,
  listRoutes,
  recentPinFailures,
  recordPinFailure,
  renamePrinter,
  setCopies,
  setRoute,
} from "@/lib/print/printers";

/**
 * /api/kitchen/printers: the printers page.
 *
 * GET  — anyone with the kitchen session: every printer with its health, the
 *        routes and copies, and the change log.
 * POST — a change, which ALSO needs the owner PIN in the body. Order of
 *        refusals: preview host, session, per-IP limiter, PIN not configured,
 *        tenant locked out by recent wrong PINs, wrong PIN (recorded). Every
 *        change is audited in the same transaction that makes it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isOrdersDbConfigured()) {
    return Response.json({ ok: false, error: "The order database is not configured (DATABASE_URL)." });
  }
  const tenantId = publicTenant().tenantId;
  try {
    const [printers, routes, audit] = await Promise.all([
      listPrinters(tenantId),
      listRoutes(tenantId),
      listAudit(tenantId, 50),
    ]);
    return Response.json(
      {
        ok: true,
        pinConfigured: ownerPinConfigured(),
        defaultCopyRoles: ticketCopyRoles(),
        printers: printers.map((p) => ({
          id: p.id,
          label: p.label,
          name: p.name,
          mac: formatMac(p.mac),
          role: p.role,
          active: p.active,
          health: p.health,
          down: p.down,
          secondsSinceSeen: p.secondsSinceSeen,
          statusCode: p.statusCode,
          firstSeenAt: p.firstSeenAt,
        })),
        routes,
        audit,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[printers] load failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ ok: false, error: "Could not load printers." }, { status: 503 });
  }
}

const Channel = z.enum(ORDER_CHANNELS);
const Role = z.enum(PRINTER_ROLES);
const PrinterId = z.string().uuid();

const ChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), printerId: PrinterId, role: Role, name: z.string().max(60).optional() }).strict(),
  z.object({ action: z.literal("rename"), printerId: PrinterId, name: z.string().min(1).max(60) }).strict(),
  z.object({ action: z.literal("deactivate"), printerId: PrinterId }).strict(),
  z.object({ action: z.literal("route"), channel: Channel, role: Role }).strict(),
  z
    .object({
      action: z.literal("copies"),
      channel: Channel,
      copyRoles: z.array(z.enum(COPY_ROLE_VALUES)).min(1).max(5).nullable(),
    })
    .strict(),
]);

const BodySchema = z.object({ pin: z.string().min(1).max(32), change: ChangeSchema }).strict();

export async function POST(request: Request): Promise<Response> {
  const blocked = previewOrderingBlocked(request);
  if (blocked) return blocked;

  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const ip = clientIp(request);
  const limit = checkRateLimit("owner_pin", ip);
  if (!limit.ok) return rateLimitResponse(limit);

  if (!isOrdersDbConfigured()) {
    return Response.json({ ok: false, error: "The order database is not configured." }, { status: 503 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return Response.json({ ok: false, code: "bad_request", error: "bad request" }, { status: 400 });
  }

  if (!ownerPinConfigured()) {
    return Response.json({ ok: false, code: "pin_not_configured" }, { status: 403 });
  }

  const tenantId = publicTenant().tenantId;
  try {
    if ((await recentPinFailures(tenantId)) >= PIN_FAILURE_LIMIT) {
      console.warn(`[printers] owner PIN locked: ${PIN_FAILURE_LIMIT}+ wrong PINs in 15 min (last from ${ip})`);
      return Response.json({ ok: false, code: "pin_locked" }, { status: 429 });
    }
    if (!ownerPinMatches(body.pin)) {
      await recordPinFailure(tenantId, ip);
      console.warn(`[printers] wrong owner PIN from ${ip}`);
      return Response.json({ ok: false, code: "pin_wrong" }, { status: 403 });
    }

    const change = body.change;
    switch (change.action) {
      case "assign":
        await assignPrinter(tenantId, change.printerId, { role: change.role, name: change.name }, ip);
        break;
      case "rename":
        await renamePrinter(tenantId, change.printerId, change.name, ip);
        break;
      case "deactivate":
        await deactivatePrinter(tenantId, change.printerId, ip);
        break;
      case "route":
        await setRoute(tenantId, change.channel, change.role, ip);
        break;
      case "copies":
        await setCopies(tenantId, change.channel, change.copyRoles, ip);
        break;
    }
    console.warn(`[printers] owner change from ${ip}: ${JSON.stringify(change)}`);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof PrinterChangeError) {
      return Response.json({ ok: false, code: "invalid", error: err.message }, { status: 400 });
    }
    console.error("[printers] change failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ ok: false, code: "failed" }, { status: 503 });
  }
}
