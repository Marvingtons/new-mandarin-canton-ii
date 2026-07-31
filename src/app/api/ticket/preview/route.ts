import { publicTenant } from "@/config/tenant.server";
import { businessDateFor } from "@/lib/orders/businessDate";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { getOrderByNumber } from "@/lib/orders/repository";
import { rasterizeTicket, renderTicket } from "@/lib/ticket/render";
import { encodeStarPrntRaster } from "@/lib/ticket/starprnt";
import {
  JOB_MEDIA_TYPE_STARPRNT,
  jobResponse,
  payloadHash,
} from "@/lib/print/cloudprnt";
import type { Order } from "@/lib/orders/types";

/**
 * GET /api/ticket/preview?orderNumber=A-017[&date=YYYY-MM-DD][&reprint=1]
 *
 * DEVELOPMENT ONLY — 404s in production. It exists so ticket layout can be
 * iterated in a browser without a printer, and with no auth to fight; that is
 * exactly why it must not exist in production, where it would expose customer
 * names and phone numbers to anyone who can guess an order number.
 *
 * With no order number (or no database), it renders a built-in fixture, so the
 * layout is previewable on a laptop with nothing configured at all.
 */
export const runtime = "nodejs";

/** Mirrors scripts/fixtures/orders.ts — a 中文 item, an English-only item. */
function fixtureOrder(): Order {
  const items = [
    {
      itemId: "kung-pao-chicken",
      nameEn: "Kung Pao Chicken",
      nameZh: "宮保雞丁",
      sizeId: "party-tray",
      sizeLabel: "Party Tray",
      sizeLabelZh: "餐盤",
      modifiers: [
        { id: "m1", nameEn: "Extra Spicy", nameZh: "加辣", priceCents: 0 },
        { id: "m2", nameEn: "No Peanuts", nameZh: "走花生", priceCents: 0 },
      ],
      quantity: 2,
      unitCents: 9000,
      lineCents: 18000,
      specialInstructions:
        "Severe peanut allergy — clean wok and fresh oil, please.",
    },
    {
      itemId: "off-menu-special",
      // An off-menu dish, so it carries no 中文 at all. Keeping it in the
      // fixture keeps the English-only row visible: it prints one line and no
      // marker — a ⚠ on paper is a warning to someone who cannot act on it.
      nameEn: "Off-Menu Chef Special",
      nameZh: null,
      sizeId: "regular",
      sizeLabel: "Regular",
      sizeLabelZh: null,
      modifiers: [],
      quantity: 1,
      unitCents: 1995,
      lineCents: 1995,
    },
  ];
  const subtotalCents = items.reduce((n, l) => n + l.lineCents, 0);
  const taxCents = Math.round((subtotalCents * 775) / 10000);
  const now = new Date();

  return {
    id: 0,
    tenantId: "preview",
    orderNumber: "A-017",
    businessDate: businessDateFor("America/Los_Angeles", now),
    status: "QUEUED",
    idempotencyKey: "preview",
    items,
    totals: { subtotalCents, taxCents, tipCents: 0, totalCents: subtotalCents + taxCents },
    customer: { name: "Preview Customer", phone: "+16195550148" },
    phoneVerifiedAt: now.toISOString(),
    pickupAt: new Date(now.getTime() + 25 * 60_000).toISOString(),
    readyFrom: new Date(now.getTime() + 25 * 60_000).toISOString(),
    readyTo: new Date(now.getTime() + 30 * 60_000).toISOString(),
    printAttempts: 0,
    printedAt: null,
    lastPrintError: null,
    alertedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const tenant = publicTenant();
  const url = new URL(request.url);
  const orderNumber = url.searchParams.get("orderNumber");
  const reprint = url.searchParams.get("reprint") === "1";

  let order: Order | null = null;
  if (orderNumber && isOrdersDbConfigured()) {
    const businessDate =
      url.searchParams.get("date") ?? businessDateFor(tenant.timezone);
    order = await getOrderByNumber(tenant.tenantId, businessDate, orderNumber);
    if (!order) {
      return new Response(
        `No order ${orderNumber} on ${businessDate}. Omit orderNumber to render the fixture.`,
        { status: 404 },
      );
    }
  }

  // ?format=starprnt renders the SAME ticket as the printer's job body and
  // returns it through the SAME response builder the job route uses. It is
  // opt-in and the default is unchanged, because this route exists for humans
  // looking at a layout in a browser.
  //
  // It is here because a 520 Download failed is a transfer problem, and the
  // job route cannot be exercised without a database, a queued order and the
  // CloudPRNT secret. This one renders a built-in fixture with nothing
  // configured, so the wire behaviour — content-length present, no
  // content-encoding, body byte-identical to its hash — can be checked under
  // `wrangler dev` before anything is deployed. What it cannot show is
  // Cloudflare's edge, which is not in front of a local worker; only the
  // deployed route proves that half.
  if (url.searchParams.get("format") === "starprnt") {
    const { pixels, width, height, free } = await rasterizeTicket(
      order ?? fixtureOrder(),
      { timezone: tenant.timezone, reprint },
    );
    let body: Uint8Array;
    try {
      body = encodeStarPrntRaster(pixels, width, height);
    } finally {
      free();
    }
    const sha256 = await payloadHash(body);
    console.info(
      `[preview] starprnt fixture: ${body.byteLength} bytes, ${height}px, sha256=${sha256}`,
    );
    return jobResponse(body, JOB_MEDIA_TYPE_STARPRNT, { "x-payload-sha256": sha256 });
  }

  const png = await renderTicket(order ?? fixtureOrder(), {
    timezone: tenant.timezone,
    reprint,
  });

  // Same byte-exact treatment as a real job: a print body is never
  // compressible territory, and the preview is only useful as a proxy for the
  // job route if it is transported identically.
  return jobResponse(new Uint8Array(png), "image/png");
}
