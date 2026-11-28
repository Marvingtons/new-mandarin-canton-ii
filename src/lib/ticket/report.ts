import "server-only";

import { Resvg, ensureResvg } from "@/lib/ticket/resvg";
import { loadTicketFonts } from "@/lib/ticket/font";
import { loadTicketMetrics } from "@/lib/ticket/measure";
import { encodeMonochromePng } from "@/lib/ticket/png";
import { BLACK, Canvas, MIN_RULE_PX, WHITE } from "@/lib/ticket/layout";
import type { PlacedLine } from "@/lib/ticket/layout";
import { REPORT_LABELS as R } from "@/lib/ticket/glyphs";
import { TICKET_WIDTH_PX } from "@/lib/ticket/render";
import { encodeStarPrntCopies, maxStarPrntRows } from "@/lib/ticket/starprnt";
import { FRAME_D, FU_DS, VIEWBOX_FULL, YUAN_DS } from "@/lib/brand/seal";
import { restaurant } from "@/data/restaurant";
import {
  formatBusinessDate,
  formatClock,
  formatMoney,
  topDishes,
  TOP_DISHES,
  type Bucket,
  type ChannelScope,
  type DailyReport,
  type ReportPrint,
} from "@/lib/reports/dailyModel";

/** The header's 範圍 line: 範圍：全部 All, 範圍：網上 Online only, 範圍：店內 Store only. */
export function scopeLine(scope: ChannelScope): string {
  const name =
    scope === "online" ? `${R.online} Online only` : scope === "store" ? `${R.store} Store only` : `${R.scopeAll} All`;
  return `${R.scope}${R.colon}${name}`;
}

/**
 * 日結 DAILY REPORT renderer: DailyReport -> 80mm PNG.
 *
 * THE SAME PAPER, BIGGER TYPE. The kitchen ticket's canvas (layout.ts),
 * metrics (measure.ts), subset font and rasterizer, on the same TSP143 roll.
 * The owner reads this at arm's length without glasses, so the floor is the
 * kitchen ticket's 中文 dish name (render.ts NAME_ZH_SIZE, 38 bold) and the
 * body sits one step above it:
 *
 *   42 regular   row labels (中文 first)
 *   42 bold      every number: counts, money, quantities (tabular digits)
 *   48 bold      section titles and the 日結 DAILY REPORT band
 *   38           the floor: the restaurant name, the footer's English and code
 *   >= 84 bold   the 合計 TOTAL figure, the largest number on the paper
 *
 * THREE COLUMNS AT MOST. At this size a row holds a label, a count and a
 * total, no more: every count ends on COUNT_RIGHT and every money figure on
 * MONEY_RIGHT, down the whole receipt. Table money drops the "$" (it is the
 * column); only the TOTAL carries it.
 *
 * No em dashes. Black on white only, nothing under MIN_RULE_PX, exactly as
 * render.ts. See docs/daily-report.md for the block-by-block reasoning.
 */

const PAD = 20;
const CONTENT_WIDTH = TICKET_WIDTH_PX - 2 * PAD;

/** Type scale. FLOOR is the kitchen ticket's 中文 dish name. */
const FLOOR = 38;
const BODY = 42;
const TITLE = 48;
/** The TOTAL figure: the first of these that fits the paper, never under 2x BODY. */
const TOTAL_SIZES = [104, 96, 88, 2 * BODY];

/** Body rows sit a little tighter than the 1.2 default: numbers, not prose. */
const ROW_LH = 1.12;

/** Right edges. One for counts, one for money. */
const MONEY_RIGHT = CONTENT_WIDTH;
/**
 * The widest table figure a day can print is "12,345.67" (42 bold, ~201px);
 * the count column ends a gap short of it.
 */
const MONEY_COL = 206;
const COUNT_RIGHT = MONEY_RIGHT - MONEY_COL - 22;
/** A cell's own width, for right alignment inside it. */
const CELL = 230;
/** Labels stop this far short of the first number's ink. */
const LABEL_GAP = 12;

/** The seal beside the name: as tall as the name line, so both fit one line at the floor size. */
const SEAL_HEIGHT = 46;

export interface ComposeReportOptions extends ReportPrint {
  /** Defaults to the restaurant's. */
  timezone?: string;
}

/** The 富源 seal, in black, scaled to `height`. Returns [markup, width]. */
function sealMarkup(height: number): [string, number] {
  const [vx, vy, vw, vh] = VIEWBOX_FULL.split(/\s+/).map(Number);
  const scale = height / vh;
  // The artwork's frame stroke is 1.36 units; at this size that is under a
  // pixel and the print head would drop it. Held at the thermal minimum.
  const stroke = MIN_RULE_PX / scale;
  const paths =
    `<path d="${FRAME_D}" fill="none" stroke="${BLACK}" stroke-width="${stroke.toFixed(2)}" stroke-miterlimit="10"/>` +
    [...FU_DS, ...YUAN_DS].map((d) => `<path d="${d}" fill="${BLACK}"/>`).join("");
  return [
    `<g transform="scale(${scale.toFixed(4)}) translate(${-vx},${-vy})">${paths}</g>`,
    vw * scale,
  ];
}

/**
 * Compose the report as SVG and report what was laid out.
 *
 * Mirrors composeTicketSvg: geometry comes back with the SVG so report:sample
 * can assert no line overflows its column without paying for a PNG.
 */
export async function composeReportSvg(
  report: DailyReport,
  options: ComposeReportOptions,
): Promise<{ svg: string; height: number; lines: PlacedLine[]; missing: number[] }> {
  const metrics = await loadTicketMetrics();
  const tz = options.timezone ?? report.timezone ?? restaurant.timezone;
  const c = new Canvas(CONTENT_WIDTH, metrics);

  /* ------------------------------------------------------------ helpers -- */

  /** Right-align bold `text` so it ends at `right`, on a row starting at `top`. */
  const cell = (text: string, right: number, top: number) => {
    c.place(right - CELL, top, CELL, (v) =>
      v.text(text, { size: BODY, weight: 700, lineHeight: ROW_LH, align: "right" }),
    );
  };

  /**
   * One table row: a label, then right-aligned bold numbers. The label may
   * run up to LABEL_GAP short of the leftmost number's ink, and wraps inside
   * that if it must; the numbers ride its first line.
   */
  const row = (
    label: string,
    cells: { text: string; right: number }[],
    opts: { weight?: 400 | 700; marginTop?: number } = {},
  ) => {
    const weight = opts.weight ?? 400;
    const marginTop = opts.marginTop ?? 0;
    const inkLeft = cells.length
      ? Math.min(...cells.map((x) => x.right - metrics.measure(x.text, BODY, 700)))
      : CONTENT_WIDTH + LABEL_GAP;
    const top = c.height + marginTop;
    c.text(label, { size: BODY, weight, lineHeight: ROW_LH, maxWidth: inkLeft - LABEL_GAP, marginTop });
    for (const x of cells) cell(x.text, x.right, top);
  };

  const section = (title: string) => {
    c.rule(MIN_RULE_PX, 14, 6);
    c.text(title, { size: TITLE, weight: 700, lineHeight: 1.1 });
    c.space(2);
  };

  const money = (cents: number) => formatMoney(cents, false);
  const countMoney = (b: Bucket) => [
    { text: String(b.count), right: COUNT_RIGHT },
    { text: money(b.totalCents), right: MONEY_RIGHT },
  ];

  /* ------------------------------------------------------------- header -- */

  // Seal and name on one line, the name at the floor size.
  const [seal, sealWidth] = sealMarkup(SEAL_HEIGHT);
  const headTop = c.height;
  c.graphic(0, headTop, seal);
  const textX = Math.ceil(sealWidth) + 8;
  const nameLine = FLOOR * 1.15;
  c.place(textX, headTop + (SEAL_HEIGHT - nameLine) / 2, CONTENT_WIDTH - textX, (g) =>
    g.text(restaurant.name.toUpperCase(), { size: FLOOR, weight: 700, lineHeight: 1.15 }),
  );
  c.space(Math.max(SEAL_HEIGHT, nameLine));

  c.banner(`${R.dailyReport} DAILY REPORT`, { size: TITLE, padY: 4, marginTop: 10 });

  // Date, then the order window and this print's #N. At the floor size the
  // three do not fit one 72mm line, so the date takes the first.
  const window =
    report.firstOrderAt && report.lastOrderAt
      ? `${formatClock(report.firstOrderAt, tz)} – ${formatClock(report.lastOrderAt, tz)}`
      : `${R.none}${R.orders} No orders`;
  c.text(formatBusinessDate(report.businessDate), { size: BODY, weight: 700, lineHeight: ROW_LH, marginTop: 8 });
  c.text(`${window} · #${options.sequence}`, { size: BODY, lineHeight: ROW_LH });
  // 範圍 SCOPE: every number below is for these orders only. Bold when it
  // is not All, so a half-day report is never read as the whole day.
  const scope = report.scope ?? "all";
  c.text(scopeLine(scope), { size: BODY, weight: scope === "all" ? 400 : 700, lineHeight: ROW_LH });

  /* ------------------------------------------------------------- ORDERS -- */

  // Two tills, not three channels: Store is phone + walk-in (and dine-in on a
  // day from before 2026-11-14), the TOTALS column the owner counts at the counter.
  //
  // Within a scope the rows are that scope's breakdown: Online only has its
  // one channel; Store only splits into its two counter channels (a dine-in
  // order from before 2026-11-14 sits with walk-in, both taken at the counter).
  const { online, store, all } = report.columns;
  section(`${R.orders} ORDERS`);
  if (scope === "all") {
    row(`${R.online} Online`, countMoney(online));
    row(`${R.store} Store`, countMoney(store));
  } else if (scope === "online") {
    row(`${R.online} Online`, countMoney(online));
  } else {
    const counter = { ...report.channels.walk_in };
    for (const k of Object.keys(counter) as (keyof Bucket)[]) counter[k] += report.channels.dine_in[k];
    row(`${R.phone} Phone`, countMoney(report.channels.phone));
    row(`${R.walkIn} Walk-in`, countMoney(counter));
  }
  c.rule(MIN_RULE_PX, 4, 4);
  row(`${R.all} All`, countMoney(all), { weight: 700 });

  /* ------------------------------------------------------------- TOTALS -- */

  section(`${R.totals} TOTALS`);
  const one = (cents: number) => [{ text: money(cents), right: MONEY_RIGHT }];
  row(`${R.subtotal} Subtotal`, one(all.subtotalCents));
  if (all.chargesCents !== 0) row(`${R.charges} Charges`, one(all.chargesCents));
  row(`${R.tax} Tax`, one(all.taxCents));
  if (all.tipCents !== 0) {
    // Dormant: every writer stores 0 today. Printed only so a day that ever
    // has one still adds up down the column.
    row(`${R.tip} Tip`, one(all.tipCents));
  }
  c.rule(MIN_RULE_PX, 4, 4);
  c.text(`${R.all} TOTAL`, { size: TITLE, weight: 700, lineHeight: 1.1 });
  const total = formatMoney(all.totalCents);
  const totalSize =
    TOTAL_SIZES.find((s) => metrics.measure(total, s, 700) <= CONTENT_WIDTH) ?? TOTAL_SIZES[TOTAL_SIZES.length - 1];
  c.text(total, { size: totalSize, weight: 700, lineHeight: 1.0, align: "right" });

  /* ------------------------------------------------------------- TOP 5 -- */

  const dishes = topDishes(report, TOP_DISHES);
  section(`${R.top} TOP ${TOP_DISHES}`);
  if (dishes.length === 0) row(R.none, []);
  const rankWidth = metrics.measure(`${TOP_DISHES}.`, BODY, 400) + 12;
  for (const [i, d] of dishes.entries()) {
    const top = c.height;
    const qty = String(d.quantity);
    c.place(0, top, rankWidth, (v) => v.text(`${i + 1}.`, { size: BODY, lineHeight: ROW_LH }));
    c.text(d.name, {
      size: BODY,
      lineHeight: ROW_LH,
      x: rankWidth,
      maxWidth: MONEY_RIGHT - metrics.measure(qty, BODY, 700) - LABEL_GAP - rankWidth,
    });
    cell(qty, MONEY_RIGHT, top);
  }

  /* ------------------------------------------------------------- footer -- */

  c.rule(5, 14, 8);
  const { halfTray, partyTray } = report.trays;
  if (halfTray > 0 || partyTray > 0) {
    // One line: body size when the counts are short, the floor size when two
    // two-digit counts push it past the paper; wraps only past that.
    const trays = `${R.trays} Trays: ${R.halfTray} ${halfTray} · ${R.partyTray} ${partyTray}`;
    const fit =
      ([[BODY, 700], [FLOOR, 700], [FLOOR, 400]] as const).find(
        ([size, weight]) => metrics.measure(trays, size, weight) <= CONTENT_WIDTH,
      ) ?? ([FLOOR, 400] as const);
    c.text(trays, { size: fit[0], weight: fit[1], lineHeight: ROW_LH, marginBottom: 6 });
  }
  c.text(`${R.reconcile}${R.colon}${R.all} vs ${R.cardTerminal} + ${R.cash}`, {
    size: BODY,
    weight: 700,
    lineHeight: ROW_LH,
  });
  c.text("Match TOTAL against card batch + cash", { size: FLOOR, lineHeight: ROW_LH });
  c.text(`${report.businessDate} · ${report.code}`, {
    size: FLOOR,
    lineHeight: ROW_LH,
    marginTop: 8,
  });

  const { svg, height } = c.toSvg(TICKET_WIDTH_PX, PAD);
  return { svg, height, lines: c.placed, missing: [...c.missing] };
}

/**
 * Compose and rasterize, stopping short of encoding. Same fonts, same resvg
 * and the same threshold downstream as a kitchen ticket (render.ts
 * rasterizeTicket), so the preview PNG and the printed StarPRNT job are the
 * same pixels. `free()` must be called in a finally: wasm-side memory.
 */
async function rasterizeReport(
  report: DailyReport,
  options: ComposeReportOptions,
): Promise<{ pixels: Uint8Array; width: number; height: number; missing: number[]; free: () => void }> {
  const fonts = await loadTicketFonts();
  const { svg, missing } = await composeReportSvg(report, options);
  if (missing.length > 0) {
    // The same loud warning a ticket gets: a 中文 label drawn as an empty box.
    console.warn(
      `[report] ${report.businessDate} #${options.sequence}: ${missing.length} codepoint(s) ` +
        `absent from the subset font. Re-run \`npm run build:ticket-font\`.`,
    );
  }
  await ensureResvg();
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
    missing,
    free: () => rendered.free(),
  };
}

/** The report as the printer's 1-bit PNG: the preview, and report:sample. */
export async function renderReportPng(
  report: DailyReport,
  options: ComposeReportOptions,
): Promise<{ png: Buffer; height: number; missing: number[] }> {
  const r = await rasterizeReport(report, options);
  try {
    const png = Buffer.from(await encodeMonochromePng(r.pixels, r.width, r.height));
    return { png, height: r.height, missing: r.missing };
  } finally {
    r.free();
  }
}

/**
 * The report as a print job, for the `report` print kind (lib/reports/prints.ts).
 *
 * ONE piece, never split: a report is about 1,750 rows on the busiest fixture
 * day and Star's 512KB job cap is about 7,000 rows at this width. Rather than
 * route a report through the ticket splitter for a case that cannot happen,
 * a report over the cap is refused here, and a refused report is FAILED and
 * reprinted by a person, like every report failure.
 */
export async function renderReportJob(
  report: DailyReport,
  options: ComposeReportOptions,
  format: "starprnt" | "png" = "starprnt",
): Promise<{ body: Buffer; height: number }> {
  const r = await rasterizeReport(report, options);
  try {
    if (format === "png") {
      return { body: Buffer.from(await encodeMonochromePng(r.pixels, r.width, r.height)), height: r.height };
    }
    const ceiling = maxStarPrntRows(TICKET_WIDTH_PX);
    if (r.height > ceiling) {
      throw new Error(`report is ${r.height} rows, over the ${ceiling}-row single-job limit`);
    }
    const body = Buffer.from(
      encodeStarPrntCopies([{ pixels: r.pixels, width: r.width, height: r.height }]),
    );
    return { body, height: r.height };
  } finally {
    r.free();
  }
}
