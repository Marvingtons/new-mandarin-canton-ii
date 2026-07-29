import "server-only";

import satori from "satori";
import { Resvg, ensureResvg } from "@/lib/ticket/resvg";
import { isPrintable, loadTicketFonts } from "@/lib/ticket/font";
import { TICKET_LABELS as L } from "@/lib/ticket/glyphs";
import { formatPickupTime } from "@/lib/orders/businessDate";
import { orderReadyLabel } from "@/lib/order/readyWindow";
import { formatCents } from "@/lib/money";
import type { Order, OrderLine } from "@/lib/orders/types";

/**
 * Kitchen ticket renderer: order -> 80mm PNG.
 *
 * WHY AN IMAGE AND NOT ESC/POS TEXT: thermal printers' CJK code-page support
 * is a lottery — the same bytes render as 中文 on one printer, mojibake on the
 * next, and nothing at all on a third. A bitmap sidesteps the question. What
 * we send is what prints.
 *
 * THERMAL CONSTRAINTS drive the whole layout:
 *   - Pure black on pure white. No greys: thermal paper renders midtones as
 *     mud, and a dithered 50% grey is unreadable across a hot line.
 *   - No hairlines. Every rule is >= 3px so it survives the print head.
 *   - Big type. This is read at arm's length, fast, by someone cooking.
 *
 * Chinese-primary by design: 中文 is the large type, English is the small
 * cross-check line underneath for staff who prefer it.
 */

/** 80mm at 203dpi. The standard receipt printer raster width. */
export const TICKET_WIDTH_PX = 576;

const PAD = 20;
const BLACK = "#000000";
const WHITE = "#ffffff";

/**
 * Marker printed wherever 中文 is unavailable — either no override exists or
 * the character is outside the subset font. Loud on purpose: a silent English
 * fallback is a translation gap nobody ever notices and nobody ever fixes.
 */
const EN_MARK = "⚠ EN";

interface Bilingual {
  /** What to print in the large primary line. */
  primary: string;
  /** True when `primary` is an English fallback and must carry the marker. */
  fallback: boolean;
}

/**
 * Choose the primary string: the 中文 when we have it AND can draw it,
 * otherwise the English with the fallback flag set.
 */
function pick(zh: string | null, en: string, coverage: Set<number>): Bilingual {
  if (zh && zh.trim().length > 0 && isPrintable(zh, coverage)) {
    return { primary: zh, fallback: false };
  }
  return { primary: en, fallback: true };
}

/** A solid divider. Never a hairline — 3px minimum on thermal paper. */
function Rule({ weight = 3 }: { weight?: number }) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: weight,
        backgroundColor: BLACK,
        marginTop: 10,
        marginBottom: 10,
      }}
    />
  );
}

function TicketLine({
  line,
  coverage,
}: {
  line: OrderLine;
  coverage: Set<number>;
}) {
  const name = pick(line.nameZh, line.nameEn, coverage);

  // Size is only worth a line when the item actually has a choice; "Regular"
  // is the implicit single tier and would be noise on every row.
  const showSize = line.sizeLabel.toLowerCase() !== "regular";
  const size = showSize
    ? pick(line.sizeLabelZh, line.sizeLabel, coverage)
    : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        marginBottom: 18,
      }}
    >
      {/* Quantity block + primary name */}
      <div style={{ display: "flex", flexDirection: "row", width: "100%" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: BLACK,
            color: WHITE,
            fontSize: 34,
            fontWeight: 700,
            minWidth: 74,
            height: 48,
            marginRight: 14,
            paddingLeft: 6,
            paddingRight: 6,
          }}
        >
          ×{line.quantity}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
          }}
        >
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, lineHeight: 1.2 }}>
            {name.primary}
          </div>
          {name.fallback && (
            <div style={{ display: "flex", fontSize: 20, fontWeight: 700 }}>
              {EN_MARK}
            </div>
          )}
        </div>
      </div>

      {/* English cross-check line — always printed, even when 中文 is present,
          so staff can verify against the English menu without a second copy. */}
      {!name.fallback && (
        <div
          style={{
            display: "flex",
            fontSize: 21,
            marginTop: 3,
            marginLeft: 88,
          }}
        >
          {line.nameEn}
        </div>
      )}

      {size && (
        <div
          style={{
            display: "flex",
            fontSize: 26,
            fontWeight: 700,
            marginTop: 5,
            marginLeft: 88,
          }}
        >
          {size.primary}
          {size.fallback ? `  ${EN_MARK}` : ` / ${line.sizeLabel}`}
        </div>
      )}

      {line.modifiers.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 5,
            marginLeft: 88,
          }}
        >
          {line.modifiers.map((mod) => {
            const m = pick(mod.nameZh, mod.nameEn, coverage);
            return (
              <div
                key={mod.id}
                style={{ display: "flex", fontSize: 26, lineHeight: 1.35 }}
              >
                ● {m.primary}
                {m.fallback ? `  ${EN_MARK}` : ` / ${mod.nameEn}`}
              </div>
            );
          })}
        </div>
      )}

      {line.specialInstructions && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 8,
            marginLeft: 88,
            border: `3px solid ${BLACK}`,
            padding: 8,
          }}
        >
          <div style={{ display: "flex", fontSize: 22, fontWeight: 700 }}>
            {L.note} NOTE
          </div>
          <div style={{ display: "flex", fontSize: 27, lineHeight: 1.35 }}>
            {line.specialInstructions}
          </div>
        </div>
      )}
    </div>
  );
}

export interface RenderTicketOptions {
  timezone: string;
  /** Printed in the header so a reprint is obvious at the pass. */
  reprint?: boolean;
}

/**
 * Render an order to an 80mm-wide PNG.
 *
 * PNG is the printer's own media type — CloudPRNT streams these bytes to the
 * printer untouched and the firmware rasterizes them. There is no ESC/POS
 * conversion step anywhere in this system, which is why the CJK code-page
 * problem simply does not arise.
 */
export async function renderTicket(
  order: Order,
  options: RenderTicketOptions,
): Promise<Buffer> {
  const fonts = await loadTicketFonts();
  const { coverage } = fonts;

  // The STORED window (lib/order/readyWindow) so the ticket, the board, the
  // confirmation, and the SMS all quote the same promise.
  const pickupLabel = orderReadyLabel(order, options.timezone);
  const placedLabel = formatPickupTime(order.createdAt, options.timezone);

  const element = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: TICKET_WIDTH_PX,
        backgroundColor: WHITE,
        color: BLACK,
        padding: PAD,
        fontFamily: "NotoTicket",
      }}
    >
      {/* ---------------- header ---------------- */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>
          {L.takeout}
        </div>
        {options.reprint && (
          <div
            style={{
              display: "flex",
              fontSize: 24,
              fontWeight: 700,
              color: WHITE,
              backgroundColor: BLACK,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 3,
              paddingBottom: 3,
            }}
          >
            {L.reprint} REPRINT
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          fontSize: 96,
          fontWeight: 700,
          lineHeight: 1.1,
          marginTop: 2,
        }}
      >
        {order.orderNumber}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          border: `4px solid ${BLACK}`,
          padding: 10,
          marginTop: 8,
        }}
      >
        <div style={{ display: "flex", fontSize: 24, fontWeight: 700 }}>
          {L.pickup} PICKUP
        </div>
        <div style={{ display: "flex", fontSize: 52, fontWeight: 700 }}>
          {pickupLabel}
        </div>
      </div>

      <Rule weight={5} />

      {/* ---------------- items ---------------- */}
      <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
        {order.items.map((line, index) => (
          <TicketLine key={`${line.itemId}-${index}`} line={line} coverage={coverage} />
        ))}
      </div>

      <Rule weight={5} />

      {/* ---------------- customer + totals ---------------- */}
      <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>
          {L.customer} {order.customer.name}
        </div>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, marginTop: 2 }}>
          {L.phone} {order.customer.phone}
        </div>
        <div style={{ display: "flex", fontSize: 21, marginTop: 6 }}>
          {L.placed} {placedLabel}
        </div>
      </div>

      <Rule />

      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          width: "100%",
          fontSize: 22,
        }}
      >
        <div style={{ display: "flex" }}>{L.subtotal} SUBTOTAL</div>
        <div style={{ display: "flex" }}>
          {formatCents(order.totals.subtotalCents)}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          width: "100%",
          fontSize: 22,
          marginTop: 2,
        }}
      >
        <div style={{ display: "flex" }}>{L.tax} TAX</div>
        <div style={{ display: "flex" }}>{formatCents(order.totals.taxCents)}</div>
      </div>
      {order.totals.tipCents > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            width: "100%",
            fontSize: 22,
            marginTop: 2,
          }}
        >
          <div style={{ display: "flex" }}>{L.tip} TIP</div>
          <div style={{ display: "flex" }}>
            {formatCents(order.totals.tipCents)}
          </div>
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          width: "100%",
          fontSize: 36,
          fontWeight: 700,
          marginTop: 6,
        }}
      >
        <div style={{ display: "flex" }}>{L.total} TOTAL</div>
        <div style={{ display: "flex" }}>
          {formatCents(order.totals.totalCents)}
        </div>
      </div>

      {/* The single most consequential string on the ticket. Nothing is paid
          online any more, so this must read as "COLLECT PAYMENT" — an earlier
          revision inherited "PAID ONLINE" from the cancelled prepaid flow,
          which would have had staff hand over food without taking money. */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          backgroundColor: BLACK,
          color: WHITE,
          fontSize: 30,
          fontWeight: 700,
          marginTop: 12,
          paddingTop: 6,
          paddingBottom: 6,
        }}
      >
        {L.payAtCounter} · COLLECT PAYMENT
      </div>
    </div>
  );

  const svg = await satori(element, {
    width: TICKET_WIDTH_PX,
    fonts: [
      { name: "NotoTicket", data: fonts.regular, weight: 400, style: "normal" },
      { name: "NotoTicket", data: fonts.bold, weight: 700, style: "normal" },
    ],
  });

  // resvg is wasm here, not the native addon — it must be initialized once per
  // isolate before the first construction. ensureResvg() is idempotent and
  // cheap after the first call.
  await ensureResvg();

  // Satori emits glyphs as vector paths, so resvg needs no font of its own.
  // loadSystemFonts stays false — there are no system fonts on workerd, and
  // asking for them costs a scan that finds nothing.
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: TICKET_WIDTH_PX },
    background: WHITE,
    font: { loadSystemFonts: false },
  }).render();

  // The wasm build returns Uint8Array (the native one returned Buffer). Copy
  // into a Buffer so every caller's `Promise<Buffer>` contract is unchanged —
  // Buffer is available under nodejs_compat, which the adapter requires
  // anyway.
  const png = Buffer.from(rendered.asPng());
  // Free the wasm-side bitmap promptly rather than waiting for GC. The tall
  // ticket is 576x2350; holding several of those in a 128 MB isolate is how
  // OOM at cold start starts.
  rendered.free();
  return png;
}
