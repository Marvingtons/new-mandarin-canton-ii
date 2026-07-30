import "server-only";

import { Resvg, ensureResvg } from "@/lib/ticket/resvg";
import { isPrintable, loadTicketFonts } from "@/lib/ticket/font";
import { loadTicketMetrics } from "@/lib/ticket/measure";
import { BLACK, Canvas, WHITE } from "@/lib/ticket/layout";
import type { PlacedLine } from "@/lib/ticket/layout";
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
 * WHY HAND-COMPOSED SVG AND NOT satori: satori@0.29.0 inlines the Emscripten
 * build of yoga-layout as a base64 data URI and instantiates those bytes at
 * runtime. workerd forbids that ("Wasm code generation disallowed by
 * embedder"), and satori's `init()` export is a no-op — `function Gu(A){}` — so
 * there is no hand-off that would let it accept a pre-compiled module the way
 * resvg does. A receipt is a fixed-width vertical stack; measuring advance
 * widths and stacking blocks (see layout.ts, measure.ts) is the whole job that
 * a CSS layout engine was doing here.
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
/** Everything is laid out inside the padding. */
const CONTENT_WIDTH = TICKET_WIDTH_PX - 2 * PAD;

/** Quantity badge, and the indent every per-item detail line hangs off. */
const QTY_WIDTH = 74;
const QTY_GAP = 14;
const QTY_HEIGHT = 48;
const INDENT = QTY_WIDTH + QTY_GAP;

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

/** One order line: quantity badge, name, cross-check, size, modifiers, note. */
function drawLine(c: Canvas, line: OrderLine, coverage: Set<number>): void {
  const name = pick(line.nameZh, line.nameEn, coverage);

  // The badge and the name sit on one row, so the row's height is whichever is
  // taller — a two-line name pushes the row, a short one leaves the badge's
  // 48px as the floor.
  const rowTop = c.height;
  c.rect(0, rowTop, QTY_WIDTH, QTY_HEIGHT);
  c.place(0, rowTop + 4, QTY_WIDTH, (badge) => {
    badge.text(`×${line.quantity}`, {
      size: 34,
      weight: 700,
      color: WHITE,
      align: "center",
    });
  });

  const nameHeight = c.group(INDENT, CONTENT_WIDTH - INDENT, (col) => {
    col.text(name.primary, { size: 40, weight: 700, lineHeight: 1.2 });
    if (name.fallback) col.text(EN_MARK, { size: 20, weight: 700 });
  });
  if (nameHeight < QTY_HEIGHT) c.space(QTY_HEIGHT - nameHeight);

  // English cross-check line — always printed when the primary is 中文, so
  // staff can verify against the English menu without a second copy.
  if (!name.fallback) {
    c.text(line.nameEn, {
      size: 21,
      x: INDENT,
      maxWidth: CONTENT_WIDTH - INDENT,
      marginTop: 3,
    });
  }

  // Size is only worth a line when the item actually has a choice; "Regular"
  // is the implicit single tier and would be noise on every row.
  if (line.sizeLabel.toLowerCase() !== "regular") {
    const size = pick(line.sizeLabelZh, line.sizeLabel, coverage);
    c.text(
      size.primary + (size.fallback ? `  ${EN_MARK}` : ` / ${line.sizeLabel}`),
      { size: 26, weight: 700, x: INDENT, maxWidth: CONTENT_WIDTH - INDENT, marginTop: 5 },
    );
  }

  for (const [i, mod] of line.modifiers.entries()) {
    const m = pick(mod.nameZh, mod.nameEn, coverage);
    c.text(
      `● ${m.primary}` + (m.fallback ? `  ${EN_MARK}` : ` / ${mod.nameEn}`),
      {
        size: 26,
        lineHeight: 1.35,
        x: INDENT,
        maxWidth: CONTENT_WIDTH - INDENT,
        marginTop: i === 0 ? 5 : 0,
      },
    );
  }

  if (line.specialInstructions) {
    c.box(
      { x: INDENT, width: CONTENT_WIDTH - INDENT, border: 3, padding: 8, marginTop: 8 },
      (note) => {
        note.text(`${L.note} NOTE`, { size: 22, weight: 700 });
        note.text(line.specialInstructions as string, { size: 27, lineHeight: 1.35 });
      },
    );
  }

  c.space(18);
}

export interface RenderTicketOptions {
  timezone: string;
  /** Printed in the header so a reprint is obvious at the pass. */
  reprint?: boolean;
}

/**
 * Compose the ticket as SVG and report what was laid out.
 *
 * Exported separately from the rasterizer so tests and scripts can assert on
 * geometry — line widths, total height — without paying for a PNG.
 */
export async function composeTicketSvg(
  order: Order,
  options: RenderTicketOptions,
): Promise<{
  svg: string;
  height: number;
  /** Every line as placed, so callers can assert none overflows its column. */
  lines: PlacedLine[];
  /** Codepoints drawn as .notdef because the subset lacks them. */
  missing: number[];
}> {
  const [fonts, metrics] = await Promise.all([
    loadTicketFonts(),
    loadTicketMetrics(),
  ]);
  const { coverage } = fonts;

  // The STORED window (lib/order/readyWindow) so the ticket, the board, the
  // confirmation, and the SMS all quote the same promise.
  const pickupLabel = orderReadyLabel(order, options.timezone);
  const placedLabel = formatPickupTime(order.createdAt, options.timezone);

  const c = new Canvas(CONTENT_WIDTH, metrics);

  /* ---------------- header ---------------- */
  const headerTop = c.height;
  c.text(L.takeout, { size: 44, weight: 700 });
  if (options.reprint) {
    // Right-aligned inverted chip, overlaid on the header's own row — the
    // equivalent of the old justify-content: space-between.
    const label = `${L.reprint} REPRINT`;
    const w = metrics.measure(label, 24, 700) + 20;
    const h = 24 * 1.2 + 6;
    c.rect(CONTENT_WIDTH - w, headerTop, w, h);
    c.place(CONTENT_WIDTH - w, headerTop + 3, w, (chip) => {
      chip.text(label, { size: 24, weight: 700, color: WHITE, align: "center" });
    });
  }

  c.text(order.orderNumber, { size: 96, weight: 700, lineHeight: 1.1, marginTop: 2 });

  c.box({ border: 4, padding: 10, marginTop: 8 }, (box) => {
    box.text(`${L.pickup} PICKUP`, { size: 24, weight: 700 });
    box.text(pickupLabel, { size: 52, weight: 700 });
  });

  c.rule(5);

  /* ---------------- items ---------------- */
  for (const line of order.items) drawLine(c, line, coverage);

  c.rule(5);

  /* ---------------- customer ---------------- */
  c.text(`${L.customer} ${order.customer.name}`, { size: 30, weight: 700 });
  c.text(`${L.phone} ${order.customer.phone}`, { size: 30, weight: 700, marginTop: 2 });
  c.text(`${L.placed} ${placedLabel}`, { size: 21, marginTop: 6 });

  c.rule();

  /* ---------------- totals ---------------- */
  const money = (
    label: string,
    cents: number,
    size: number,
    weight: 400 | 700,
    marginTop: number,
  ) => {
    const top = c.height + marginTop;
    c.text(label, { size, weight, marginTop });
    // The amount rides the same row, right-aligned, without moving the cursor.
    c.place(0, top, CONTENT_WIDTH, (v) => {
      v.text(formatCents(cents), { size, weight, align: "right" });
    });
  };

  money(`${L.subtotal} SUBTOTAL`, order.totals.subtotalCents, 22, 400, 0);
  money(`${L.tax} TAX`, order.totals.taxCents, 22, 400, 2);
  if (order.totals.tipCents > 0) {
    money(`${L.tip} TIP`, order.totals.tipCents, 22, 400, 2);
  }
  money(`${L.total} TOTAL`, order.totals.totalCents, 36, 700, 6);

  /* The single most consequential string on the ticket. Nothing is paid
     online any more, so this must read as "COLLECT PAYMENT" — an earlier
     revision inherited "PAID ONLINE" from the cancelled prepaid flow, which
     would have had staff hand over food without taking money. */
  c.banner(`${L.payAtCounter} · COLLECT PAYMENT`, { size: 30, marginTop: 12 });

  const { svg, height } = c.toSvg(TICKET_WIDTH_PX, PAD);
  return { svg, height, lines: c.placed, missing: [...c.missing] };
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
  const { svg, missing } = await composeTicketSvg(order, options);

  // The subset is built from glyphs.ts, but ticket-font-coverage.json records
  // the codepoints REQUESTED rather than the ones the subsetter emitted, so
  // isPrintable() can pass for a glyph the font does not actually contain.
  // This is the ground truth — the font's own cmap — and it is loud, because
  // the failure it catches otherwise prints as an empty box on the kitchen's
  // only copy of the order.
  if (missing.length > 0) {
    console.warn(
      `[ticket] order ${order.orderNumber}: ${missing.length} codepoint(s) absent ` +
        `from the subset font and drawn as .notdef: ` +
        missing
          .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")} ${String.fromCodePoint(cp)}`)
          .join(", ") +
        `. Re-run \`npm run build:ticket-font\`.`,
    );
  }

  // resvg is wasm here, not the native addon — it must be initialized once per
  // isolate before the first construction. ensureResvg() is idempotent and
  // cheap after the first call.
  await ensureResvg();

  // Unlike satori, which emitted glyphs as vector paths, this SVG carries real
  // <text>, so resvg needs the fonts. They are the SAME buffers measure.ts
  // measured with, which is what makes the composed geometry match the ink.
  // loadSystemFonts stays false — there are no system fonts on workerd, and
  // asking for them costs a scan that finds nothing.
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: TICKET_WIDTH_PX },
    background: WHITE,
    font: {
      fontBuffers: [new Uint8Array(fonts.regular), new Uint8Array(fonts.bold)],
      defaultFontFamily: "NotoTicket",
      loadSystemFonts: false,
    },
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

/** Re-exported so callers keep importing one module. */
export { BLACK };
