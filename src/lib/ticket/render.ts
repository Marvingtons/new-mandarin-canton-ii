import "server-only";

import { Resvg, ensureResvg } from "@/lib/ticket/resvg";
import { isPrintable, loadTicketFonts } from "@/lib/ticket/font";
import { loadTicketMetrics } from "@/lib/ticket/measure";
import { encodeOpaqueRgbPng } from "@/lib/ticket/png";
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

/**
 * Which copy is which.
 *
 * ⚠️ 廚房 and 袋 are NOT in the shipped subset font today — checked against
 * public/fonts/ticket-font-coverage.json, all three codepoints absent. They are
 * in TICKET_LABELS so the next `npm run build:ticket-font` includes them; until
 * that runs, pick() falls back to the English exactly as it does for an
 * untranslated dish. The label prints either way; it never prints a blank box.
 */
const COPY_LABELS = {
  kitchen: { zh: L.copyKitchen as string, en: "KITCHEN" },
  bag: { zh: L.copyBag as string, en: "BAG" },
} as const;

/* ------------------------------------------------------ shape normalizer -- */

/**
 * Coerce an order into the shape the layout code assumes.
 *
 * `mapOrder` casts the JSONB columns straight through — `items: row.items as
 * OrderLine[]` (repository.ts) — so whatever is in the column IS the object
 * this renderer gets. Orders arrive here from three places and only one of them
 * is typed: the order route builds lines through `resolveOrderLine`, /kitchen
 * reprints replay a stored row, and operators write rows by hand during
 * incidents. A hand-written `items` array carries what a human types — name,
 * qty, price — and none of the fields the layout iterates.
 *
 * That is what took printing down: an item without `nameEn` put `undefined`
 * into the measurer, and `for (const ch of text)` threw "text is not iterable"
 * (minified: "A11 is not iterable"). Attempts then climbed to PRINT_FAILED and
 * the printer 520'd every download.
 *
 * A ticket is the last thing standing between a customer and food nobody
 * cooked. It renders what it has and marks what it lacks; it does not refuse
 * the order because a column was terse.
 */

/** Missing/blank text renders as this rather than throwing or printing "undefined". */
const UNNAMED = "(unnamed item)";

function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return fallback;
}

/** Nullable 中文: anything non-string becomes null, i.e. "fall back to English". */
function asZh(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asCount(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function asCents(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * `items` may not even be an array. A jsonb column can hold an object, and a
 * TEXT column holding JSON comes back as a string — which IS iterable, so it
 * would silently render one ticket line per character.
 */
function asLines(value: unknown): OrderLine[] {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) {
    // An object keyed "0","1",… is what a malformed insert usually produces.
    raw = raw && typeof raw === "object" ? Object.values(raw) : [];
  }
  return (raw as unknown[])
    .filter((line): line is Record<string, unknown> => !!line && typeof line === "object")
    .map((line) => {
      const mods = Array.isArray(line.modifiers) ? line.modifiers : [];
      return {
        itemId: asText(line.itemId, "unknown"),
        nameEn: asText(line.nameEn).trim() || UNNAMED,
        nameZh: asZh(line.nameZh),
        sizeId: asText(line.sizeId, "regular"),
        // "regular" is the tier the layout treats as implicit, so an absent
        // size prints nothing rather than an empty size line.
        sizeLabel: asText(line.sizeLabel, "regular"),
        sizeLabelZh: asZh(line.sizeLabelZh),
        quantity: asCount(line.quantity, 1),
        modifiers: mods
          .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
          .map((m, i) => ({
            id: asText(m.id, `mod-${i}`),
            nameEn: asText(m.nameEn).trim() || UNNAMED,
            nameZh: asZh(m.nameZh),
            priceCents: asCents(m.priceCents),
          })),
        specialInstructions: asZh(line.specialInstructions),
        unitCents: asCents(line.unitCents),
        lineCents: asCents(line.lineCents),
      } as OrderLine;
    });
}

/** The subset of the order this renderer reads, guaranteed well-formed. */
function normalizeOrder(order: Order): Order {
  const customer = (order.customer ?? {}) as unknown as Record<string, unknown>;
  const totals = (order.totals ?? {}) as unknown as Record<string, unknown>;
  return {
    ...order,
    orderNumber: asText(order.orderNumber, "—"),
    items: asLines(order.items),
    customer: {
      ...(order.customer ?? {}),
      name: asText(customer.name).trim() || "—",
      phone: asText(customer.phone).trim() || "—",
    },
    totals: {
      ...(order.totals ?? {}),
      subtotalCents: asCents(totals.subtotalCents),
      taxCents: asCents(totals.taxCents),
      tipCents: asCents(totals.tipCents),
      totalCents: asCents(totals.totalCents),
    },
  } as Order;
}

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
  /**
   * How many copies to stack into one job body. Defaults to 1 here so scripts
   * and fixtures stay single; the print route passes the tenant setting.
   */
  copies?: number;
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
  raw: Order,
  options: RenderTicketOptions,
): Promise<{
  svg: string;
  height: number;
  /** Every line as placed, so callers can assert none overflows its column. */
  lines: PlacedLine[];
  /** Codepoints drawn as .notdef because the subset lacks them. */
  missing: number[];
}> {
  // Every field the layout reads is made well-formed HERE, once, before any
  // measurement runs. Nothing below this line may assume a typed order.
  const order = normalizeOrder(raw);

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

  /**
   * Copies, stacked into ONE job body.
   *
   * NO MID-JOB CUT. Star documents extra control options in the RESPONSE
   * HEADERS for text/plain, image/png and image/jpeg — that is how the buzzer
   * and cash drawer work here (see peripheralHeaders) — but a cut between two
   * images inside a single job is not among the documented options, and I
   * found nothing in the CloudPRNT protocol guide describing one for image
   * media. Rather than guess at firmware behaviour, the copies are separated
   * by a printed tear line with generous whitespace either side, and the
   * operator tears. If a cut command for image media does exist, this is the
   * one place to change.
   */
  const copies = Math.max(1, options.copies ?? 1);

  for (let copy = 0; copy < copies; copy++) {
    if (copy > 0) {
      // The tear line. Generous whitespace so a slightly-off tear still
      // misses the type, and a dashed rule so it reads as "tear here"
      // rather than as another section divider.
      c.space(26);
      c.tearLine();
      c.space(26);
    }

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

    /* Which copy this is — quiet, under the banner, so staff can tell the
       two apart at a glance without either looking like the "real" one.
       The 中文 is used only when the subset font can actually draw it; the
       labels are in glyphs.ts so the next `npm run build:ticket-font` picks
       them up, and until then this prints the English, which is the same
       rule every other bilingual string on the ticket follows. */
    if (copies > 1) {
      const which = copy === 0 ? COPY_LABELS.kitchen : COPY_LABELS.bag;
      const label = pick(which.zh, which.en, coverage);
      c.text(label.primary + (label.fallback ? "" : ` / ${which.en}`), {
        size: 20,
        weight: 700,
        align: "center",
        marginTop: 8,
      });
    }
  }

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

  // NOT rendered.asPng(). resvg only emits colour type 6 — 8-bit truecolour
  // WITH an alpha channel — and the TSP143IV answers a 32-bit RGBA PNG with
  // `code=511 Media Decoding Error`: it receives the file whole and cannot
  // decode it. We re-encode the raw pixels as 24-bit truecolour with no alpha
  // (see png.ts). The channel was redundant anyway; the background below is
  // opaque, so it carried the value 255 for every pixel on the ticket.
  const png = Buffer.from(
    await encodeOpaqueRgbPng(rendered.pixels, rendered.width, rendered.height),
  );
  // Free the wasm-side bitmap promptly rather than waiting for GC. The tall
  // ticket is 576x2350; holding several of those in a 128 MB isolate is how
  // OOM at cold start starts.
  rendered.free();
  return png;
}

/** Re-exported so callers keep importing one module. */
export { BLACK };
