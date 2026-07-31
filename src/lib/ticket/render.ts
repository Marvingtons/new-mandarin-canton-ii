import "server-only";

import { Resvg, ensureResvg } from "@/lib/ticket/resvg";
import { isPrintable, loadTicketFonts } from "@/lib/ticket/font";
import { loadTicketMetrics } from "@/lib/ticket/measure";
import { encodeMonochromePng, findSegmentCuts } from "@/lib/ticket/png";
import { encodeStarPrntCopies } from "@/lib/ticket/starprnt";
import { BLACK, Canvas, WHITE } from "@/lib/ticket/layout";
import type { PlacedLine } from "@/lib/ticket/layout";
import { copyProfile } from "@/lib/ticket/copies";
import type { TicketCopyProfile, TicketCopyRole } from "@/lib/ticket/copies";
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
 * ENGLISH-PRIMARY, 中文 UNDER IT. The first revision printed 中文 large with a
 * small English cross-check, plus a loud ⚠ EN wherever a translation was
 * missing — which, with a quarter of the menu translated, was most of the
 * ticket. The catalogue now carries 中文 on every dish, so the marker has no
 * job left and is gone: the English is the primary line, the 中文 sits directly
 * under it in the same size class, and a dish with no 中文 simply prints one
 * line. Missing glyphs are still reported — to the server log, never to paper.
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

/** Item name type. English leads; the 中文 under it is one step down, regular. */
const NAME_SIZE = 34;
const NAME_ZH_SIZE = 30;

/**
 * The money column on an item row.
 *
 * Fixed rather than fitted, so the amounts line up down the ticket and a
 * cashier can read the column instead of hunting for each number. 128px holds
 * "$1068.00" at 28px bold — more than six of the most expensive thing on the
 * menu — with room to spare.
 */
const PRICE_SIZE = 28;
const PRICE_WIDTH = 128;
const PRICE_GAP = 14;

/**
 * Size tiers that are the DEFAULT and therefore print nothing.
 *
 * "Individual" is what most of the menu is, and "Regular" is the implicit
 * single tier an item with no size choice resolves to (and what normalizeOrder
 * fills in for a row that carries no size at all). Printing either of them cost
 * a whole row per item and told the kitchen nothing it did not already assume.
 * Everything else — tray, cup, half a duck — prints a chip.
 */
const DEFAULT_SIZE_LABELS = new Set(["individual", "regular", ""]);

/**
 * Short English for a size chip, where the catalogue's label is too long to sit
 * inline. Anything not listed prints its own label, uppercased.
 */
const SIZE_CHIP_EN: Record<string, string> = {
  "party tray": "TRAY",
};

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
    orderNumber: asText(order.orderNumber, "-"),
    items: asLines(order.items),
    customer: {
      ...(order.customer ?? {}),
      name: asText(customer.name).trim() || "-",
      phone: asText(customer.phone).trim() || "-",
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

/**
 * The 中文 when we have it AND can draw it, otherwise null.
 *
 * A null here means "print the English alone". It is NOT marked on paper any
 * more: with the catalogue fully translated a missing 中文 is either a
 * hand-written row or a forgotten `npm run build:ticket-font`, and both of
 * those are reported to the server log by rasterizeTicket. A ⚠ on a ticket is
 * a warning to someone who cannot act on it.
 */
function zhIfPrintable(zh: string | null, coverage: Set<number>): string | null {
  if (zh && zh.trim().length > 0 && isPrintable(zh, coverage)) return zh;
  return null;
}

/**
 * The size chip, or null for a default tier.
 *
 * Exception-based on purpose: individual is what most of the menu is, so
 * marking it cost one row on every single item. `【餐盤 TRAY】` is one bracketed
 * token that rides along at the end of the English name — the wrapper treats a
 * 【…】 run as a single atom, so it moves whole or wraps whole, and it can never
 * split across two lines.
 */
function sizeChip(line: OrderLine, coverage: Set<number>): string | null {
  const label = line.sizeLabel.trim();
  if (DEFAULT_SIZE_LABELS.has(label.toLowerCase())) return null;
  const en = SIZE_CHIP_EN[label.toLowerCase()] ?? label.toUpperCase();
  const zh = zhIfPrintable(line.sizeLabelZh, coverage);
  return zh ? `【${zh} ${en}】` : `【${en}】`;
}

/**
 * One order line.
 *
 *   ×2  Mandarin Special 【餐盤 TRAY】              $49.90
 *       招牌大拼盤
 *       ● 加辣 / Extra Spicy
 *       ┌ 備註 NOTE ─────────────────┐
 *
 * The English name is the primary line and the line total rides its first row,
 * right-aligned in a fixed money column. The 中文 sits directly beneath in the
 * same size class — the kitchen reads that line, so it is not a footnote.
 *
 * `showPrice` is false on the kitchen copy, which takes the money column back
 * and gives the whole width to the name.
 */
function drawLine(
  c: Canvas,
  line: OrderLine,
  coverage: Set<number>,
  showPrice: boolean,
): void {
  const column = CONTENT_WIDTH - INDENT;
  // The money column is reserved on the NAME'S FIRST LINE only; a wrapped name
  // runs the full width underneath it.
  const firstLine = showPrice ? column - PRICE_WIDTH - PRICE_GAP : column;

  const chip = sizeChip(line, coverage);
  const nameEn = chip ? `${line.nameEn} ${chip}` : line.nameEn;
  const nameZh = zhIfPrintable(line.nameZh, coverage);

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

  const nameHeight = c.group(INDENT, column, (col) => {
    col.text(nameEn, {
      size: NAME_SIZE,
      weight: 700,
      lineHeight: 1.2,
      firstLineMaxWidth: firstLine,
    });
    if (nameZh) {
      col.text(nameZh, { size: NAME_ZH_SIZE, lineHeight: 1.2, marginTop: 2 });
    }
  });
  if (nameHeight < QTY_HEIGHT) c.space(QTY_HEIGHT - nameHeight);

  // The line total, on the name's own first row, vertically centred against
  // that row's line box so the two read as one line.
  //
  // `lineCents` IS qty × unit: resolveLinePrice does that multiplication in
  // integer cents, once, at order time, and stores the result — which is also
  // the number that was summed into the subtotal below. Multiplying again here
  // would be the same arithmetic on a good row and a column that does not add
  // up to its own subtotal on a hand-written one. ticket:sample asserts both:
  // that the column sums to the printed subtotal, and that stored lineCents
  // really is quantity × unitCents on every catalogue-built order.
  if (showPrice) {
    const drop = ((NAME_SIZE - PRICE_SIZE) * 1.2) / 2;
    c.place(CONTENT_WIDTH - PRICE_WIDTH, rowTop + drop, PRICE_WIDTH, (money) => {
      money.text(formatCents(line.lineCents), {
        size: PRICE_SIZE,
        weight: 700,
        align: "right",
      });
    });
  }

  for (const [i, mod] of line.modifiers.entries()) {
    const zh = zhIfPrintable(mod.nameZh, coverage);
    c.text(zh ? `● ${zh} / ${mod.nameEn}` : `● ${mod.nameEn}`, {
      size: 26,
      lineHeight: 1.35,
      x: INDENT,
      maxWidth: column,
      marginTop: i === 0 ? 5 : 0,
    });
  }

  if (line.specialInstructions) {
    c.box(
      { x: INDENT, width: column, border: 3, padding: 8, marginTop: 8 },
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
   * How many copies this order prints. Defaults to 1 here so scripts and
   * fixtures stay single; the print route passes the tenant setting.
   *
   * On the starprnt path this is NOT a stacking instruction — each copy is
   * rendered separately and cut from the last (see renderCutCopies). It is
   * still used here to pick the footer label, which needs to know the total.
   */
  copies?: number;
  /**
   * Which copy this render IS, 0-based. Set only by renderCutCopies; when
   * absent the compositor falls back to stacking, which is what the PNG path
   * and the preview still do.
   */
  copyIndex?: number;
  /**
   * Which copy is which, and therefore what each shows. The print route passes
   * the tenant's configured roles; everything else takes the default sequence
   * for `copies`. See lib/ticket/copies.ts.
   */
  copyRoles?: TicketCopyRole[] | null;
  /** Printed in the header so a reprint is obvious at the pass. */
  reprint?: boolean;
}

/** What a composed ticket actually printed in money terms. */
export interface TicketMoney {
  /** The profile this copy rendered under. */
  role: TicketCopyRole;
  /** Line totals as printed, in order. Empty when the copy shows no prices. */
  lineCents: number[];
  /** The totals block as printed, or null when the copy omits it. */
  totals: { subtotal: number; tax: number; tip: number; total: number } | null;
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
  /** What each composed copy printed in money terms, in copy order. */
  money: TicketMoney[];
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
   * How many copies this composer draws.
   *
   * THE CUT MOVED. This used to stack every copy into one tall image with a
   * printed tear line between them, because a mid-job cut looked undocumented
   * for image media. It is documented for COMMAND media: Star's CloudPRNT
   * media-type appendix routes cut control "in print data" for the vnd.star
   * formats, and StarPRNT Rev. 4.01's Auto-cutter gives the bytes. So on the
   * starprnt path each copy is now rendered on its own and separated by a real
   * full cut — see renderCutCopies and lib/ticket/starprnt.ts.
   *
   * This loop still stacks when asked to, which is what the PNG path and the
   * preview do: a browser cannot act on a cut command, so a tear line remains
   * the honest thing to draw there. `copyIndex` is how renderCutCopies asks
   * for exactly one copy, labelled as the Nth.
   */
  const copies = Math.max(1, options.copies ?? 1);
  const only = options.copyIndex;
  const first = only ?? 0;
  const last = only ?? copies - 1;
  const printed: TicketMoney[] = [];

  for (let copy = first; copy <= last; copy++) {
    /**
     * WHAT THIS COPY IS. Everything below reads these flags; there is no second
     * renderer for the kitchen copy. See lib/ticket/copies.ts.
     */
    const profile: TicketCopyProfile = copyProfile(copy, copies, options.copyRoles);
    const copyLabelZh = zhIfPrintable(profile.labelZh, coverage);
    const copyLabel = copyLabelZh
      ? `${copyLabelZh} ${profile.labelEn}`
      : profile.labelEn;

    // The tear line, only when this composer is actually stacking. A single
    // requested copy is its own piece of paper and needs no tear mark; drawing
    // one at the top of copy 2 of 3 would print a dashed rule above a ticket
    // that a cutter already separated.
    if (copy > first && only === undefined) {
      // Generous whitespace so a slightly-off tear still misses the type, and
      // a dashed rule so it reads as "tear here" rather than as another
      // section divider.
      c.space(26);
      c.tearLine();
      c.space(26);
    }

  /* ---------------- copy bar ---------------- */
  /* THE FIRST THING VISIBLE, above everything else. Three loose tickets land
     in the same tray, and until now the only thing telling them apart was a
     20px line at the very bottom — under the totals, under the payment banner,
     on the part that gets folded. A full-width inverted bar at the top is
     readable on a ticket lying face up in a pile. A small repeat stays at the
     bottom as a tear check: if the bottom label is missing, paper is missing. */
  if (profile.labelEn) {
    c.banner(copyLabel, { size: 30, padY: 8 });
    c.space(10);
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
  for (const line of order.items) drawLine(c, line, coverage, profile.linePrices);

  c.rule(5);

  /* ---------------- customer ---------------- */
  c.text(`${L.customer} ${order.customer.name}`, { size: 30, weight: 700 });
  c.text(`${L.phone} ${order.customer.phone}`, { size: 30, weight: 700, marginTop: 2 });
  c.text(`${L.placed} ${placedLabel}`, { size: 21, marginTop: 6 });

  /* ---------------- totals ---------------- */
  /* THE KITCHEN COPY STOPS HERE. No subtotal, no tax, no total, no COLLECT
     PAYMENT bar: a cook does not ring the order, so every one of those lines
     is paper spent on something nobody on the line reads. */
  if (profile.priceBlock) {
    c.rule();

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
  }

    /* The tear check: the same label as the top bar, small, at the very end of
       the paper. Its job is not identification — the bar at the top does that
       — but to prove the ticket came out whole. */
    if (profile.labelEn) {
      c.text(copyLabel, {
        size: 20,
        weight: 700,
        align: "center",
        marginTop: profile.priceBlock ? 8 : 14,
      });
    }

    printed.push({
      role: profile.role,
      lineCents: profile.linePrices ? order.items.map((l) => l.lineCents) : [],
      totals: profile.priceBlock
        ? {
            subtotal: order.totals.subtotalCents,
            tax: order.totals.taxCents,
            tip: order.totals.tipCents,
            total: order.totals.totalCents,
          }
        : null,
    });
  }

  const { svg, height } = c.toSvg(TICKET_WIDTH_PX, PAD);
  return { svg, height, lines: c.placed, missing: [...c.missing], money: printed };
}

/**
 * Compose and rasterize, stopping short of encoding.
 *
 * `free()` releases the wasm-side bitmap; callers must invoke it in a finally.
 * Waiting for GC is how a 128 MB isolate holding several 576x4401 RGBA buffers
 * OOMs at cold start.
 */
export async function rasterizeTicket(
  order: Order,
  options: RenderTicketOptions,
): Promise<{ pixels: Uint8Array; width: number; height: number; free: () => void }> {
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

  return {
    pixels: rendered.pixels,
    width: rendered.width,
    height: rendered.height,
    free: () => rendered.free(),
  };
}

/**
 * What to wrap the raster in.
 *
 * "starprnt" is the primary path: printer-ready commands, no on-device
 * conversion, and therefore no 511. "png" is the 1-bit PNG, which serves both
 * the vnd.star.png fallback and every human-facing surface (/kitchen, the
 * preview route) — a browser cannot display StarPRNT commands.
 */
export type TicketFormat = "starprnt" | "png";

/**
 * N copies, each rasterized on its own and cut from the one before.
 *
 * Rendered one at a time and encoded as we go: three 576x1500 RGBA buffers
 * held together is ~10MB, and this runs in an isolate that also holds a wasm
 * renderer. Each raster is freed before the next is made.
 *
 * `maxHeight` gates the WHOLE body, because the 512KB cap is on the download,
 * not on any one copy. If N copies would exceed it the caller gets an error
 * rather than a job the printer answers 521 to — splitting mid-stack would
 * separate a ticket from its own cut.
 */
async function renderCutCopies(
  order: Order,
  options: RenderTicketOptions,
  copies: number,
  maxHeight: number | null,
  segment: number,
): Promise<TicketJob> {
  if (segment !== 0) {
    throw new Error(`a ${copies}-copy job has one segment; ${segment} was asked for`);
  }
  const parts: { pixels: Uint8Array; width: number; height: number }[] = [];
  let perCopyHeight = 0;
  try {
    for (let copy = 0; copy < copies; copy++) {
      const raster = await rasterizeTicket(order, { ...options, copies, copyIndex: copy });
      try {
        // Copied out of the wasm buffer so it survives free().
        parts.push({
          pixels: new Uint8Array(raster.pixels),
          width: raster.width,
          height: raster.height,
        });
        perCopyHeight = raster.height;
      } finally {
        raster.free();
      }
    }

    const body = Buffer.from(encodeStarPrntCopies(parts));
    const totalHeight = parts.reduce((n, p) => n + p.height, 0);
    if (maxHeight !== null && totalHeight > maxHeight) {
      throw new Error(
        `${copies} copies total ${totalHeight}px, over the ${maxHeight}px ceiling ` +
          `the 512KB job cap allows — reduce TICKET_COPIES`,
      );
    }
    return {
      body,
      format: "starprnt",
      segment: 0,
      segments: 1,
      height: perCopyHeight,
      totalHeight,
    };
  } finally {
    parts.length = 0;
  }
}

/** One piece of a ticket, plus how many pieces there turned out to be. */
export interface TicketJob {
  /** The job body, in the requested format. */
  body: Buffer;
  format: TicketFormat;
  /** 0-based index of the piece in this buffer. */
  segment: number;
  /** Total pieces. 1 means the ticket was not split. */
  segments: number;
  /** Height of THIS piece, in pixels. */
  height: number;
  /** Height of the whole ticket, in pixels. */
  totalHeight: number;
}

export interface TicketJobOptions {
  format?: TicketFormat;
  /** The printer's OWN declared height ceiling, or null for none. */
  maxHeight?: number | null;
  segment?: number;
}

/**
 * Render one printable job for an order, splitting only if forced to.
 *
 * `maxHeight` is the printer's OWN declared ceiling or null. Null means send
 * the whole ticket — there is no constant here to fall back on, because a
 * height limit we invented would be indistinguishable from one the printer
 * asked for and would silently start tearing tickets in half.
 *
 * The raster is produced once and only the requested piece is encoded, so a
 * three-piece ticket costs three renders across three polls rather than one
 * render held in memory between them. That trade is deliberate: an isolate
 * that has to hold a 576x4401 RGBA buffer between requests is how cold-start
 * OOM begins, and the render is 77ms.
 *
 * Everything above the final encode is shared by both formats — same SVG, same
 * resvg raster, same threshold — so the two can never drift apart in what they
 * put on paper.
 */
export async function renderTicketJob(
  order: Order,
  options: RenderTicketOptions,
  job: TicketJobOptions = {},
): Promise<TicketJob> {
  const format = job.format ?? "starprnt";
  const maxHeight = job.maxHeight ?? null;
  const segment = job.segment ?? 0;

  // THREE TICKETS, NOT ONE TALL ONE. On the starprnt path each copy is its own
  // raster with its own full cut after it, so the copies drop as separate
  // pieces of paper. The copies are NOT stacked into a single image here —
  // that is what produced one long strip with a printed tear line, and a
  // strip is what this replaces.
  //
  // Still one job: one claim, one confirmation, one R2 object. How many pieces
  // of paper the body produces is a property of the bytes.
  const copies = Math.max(1, options.copies ?? 1);
  if (format === "starprnt" && copies > 1) {
    return renderCutCopies(order, options, copies, maxHeight, segment);
  }

  const { pixels, width, height, free } = await rasterizeTicket(order, options);
  try {
    const cuts = maxHeight === null ? [] : findSegmentCuts(pixels, width, height, maxHeight);
    const bounds = [0, ...cuts, height];
    const segments = bounds.length - 1;
    if (segment < 0 || segment >= segments) {
      throw new Error(`segment ${segment} requested of a ${segments}-segment ticket`);
    }
    const from = bounds[segment];
    const rows = bounds[segment + 1] - from;

    let body: Buffer;
    if (format === "starprnt") {
      // The slice is taken here rather than inside the encoder so both formats
      // are cut at exactly the same rows.
      const slice = pixels.subarray(from * width * 4, (from + rows) * width * 4);
      body = Buffer.from(encodeStarPrntCopies([{ pixels: slice, width, height: rows }]));
    } else {
      body = Buffer.from(await encodeMonochromePng(pixels, width, height, from, rows));
    }

    return { body, format, segment, segments, height: rows, totalHeight: height };
  } finally {
    free();
  }
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
  const { pixels, width, height, free } = await rasterizeTicket(order, options);
  try {
    // NOT rendered.asPng(). resvg only emits colour type 6 — 8-bit truecolour
    // WITH an alpha channel — and the TSP143IV answered that with `code=511
    // Media Decoding Error`. Re-encoding without alpha, as 24-bit colour, did
    // not clear it. We now emit 1 bit per pixel (see png.ts), which is the
    // format Star names first and the only one that describes this artifact
    // honestly: the ticket is black on white, and the thermal head has no
    // midtone to print even if we sent one.
    return Buffer.from(await encodeMonochromePng(pixels, width, height));
  } finally {
    free();
  }
}

/** Re-exported so callers keep importing one module. */
export { BLACK };
