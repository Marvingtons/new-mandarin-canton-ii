import "server-only";

import { Resvg, ensureResvg } from "@/lib/ticket/resvg";
import { loadTicketFonts } from "@/lib/ticket/font";
import { loadTicketMetrics } from "@/lib/ticket/measure";
import { encodeMonochromePng } from "@/lib/ticket/png";
import { BLACK, Canvas, MIN_RULE_PX, WHITE } from "@/lib/ticket/layout";
import type { PlacedLine } from "@/lib/ticket/layout";
import { REPORT_LABELS as R } from "@/lib/ticket/glyphs";
import { TICKET_WIDTH_PX } from "@/lib/ticket/render";
import { FRAME_D, FU_DS, VIEWBOX_FULL, YUAN_DS } from "@/lib/brand/seal";
import { restaurant } from "@/data/restaurant";
import { businessDateFor } from "@/lib/orders/businessDate";
import {
  formatBusinessDate,
  formatClock,
  formatHour,
  formatMoney,
  type Bucket,
  type DailyReport,
  type ReportPrint,
} from "@/lib/reports/dailyModel";

/**
 * 日結 DAILY REPORT renderer: DailyReport -> 80mm PNG.
 *
 * THE SAME PAPER, THE SAME TYPE. This is not a second ticket design: it is the
 * kitchen ticket's canvas (layout.ts), metrics (measure.ts), subset font and
 * rasterizer, on the same TSP143 roll. The type scale is the ticket's money
 * block, which is the part of the ticket this report is a column of:
 *
 *   22 regular   every row (the ticket's 小計 SUBTOTAL / 稅金 TAX rows)
 *   22 bold      the All 合計 row
 *   24 bold      section titles (the ticket's 電話 / 取餐時間 labels)
 *   21 regular   header and footer small print (the ticket's 落單 line)
 *   30 bold      the 日結 DAILY REPORT bar (the ticket's COLLECT PAYMENT bar)
 *   rules        5px closing the header and before the footer, 3px elsewhere
 *
 * COLUMN DISCIPLINE. Every count sits on one right edge and every money figure
 * on another, down the whole receipt, so the eye reads a column rather than
 * hunting each number. The TOTALS block's three columns are the only other
 * edges. Digits in this font are tabular (equal advance at each weight), so
 * right alignment lines the digits up too. Money always shows its cents.
 *
 * Black on white only, nothing under MIN_RULE_PX, exactly as render.ts.
 */

const PAD = 20;
const CONTENT_WIDTH = TICKET_WIDTH_PX - 2 * PAD;

/** Rows hang this far in from their section title. */
const INDENT = 16;

/** Right edges. One for counts, one for money, for every block that has them. */
const COUNT_RIGHT = 406;
const MONEY_RIGHT = CONTENT_WIDTH;
/** The TOTALS block: Online, Store, All. 118px apart holds "12,345.67" bold with air. */
const COL_STEP = 118;
const TOTALS_RIGHTS = [MONEY_RIGHT - 2 * COL_STEP, MONEY_RIGHT - COL_STEP, MONEY_RIGHT];
/** A cell's own width, for right alignment inside it. */
const CELL = 112;
/** Labels stop this far short of the first number column. */
const LABEL_GAP = 10;

const ROW = 22;
const TITLE = 24;
const SMALL = 21;
const BAR = 30;

/** The seal beside the name: height of the two header lines, frame stroke held at the thermal floor. */
const SEAL_HEIGHT = 84;

export interface ComposeReportOptions extends ReportPrint {
  /** Defaults to the restaurant's. */
  timezone?: string;
}

/** "(619) 656-6888" -> "619 656 6888", the way the spec's header sets it. */
function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : phone;
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

  /** Right-align `text` so it ends at `right`, on a row starting at `top`. */
  const cell = (text: string, right: number, top: number, weight: 400 | 700, size = ROW) => {
    c.place(right - CELL, top, CELL, (v) => v.text(text, { size, weight, align: "right" }));
  };

  /**
   * One table row: a label, then right-aligned cells. The label may run up to
   * LABEL_GAP short of the leftmost number's ink, and wraps inside that if it
   * must; the cells ride its first line.
   */
  const row = (
    label: string,
    cells: { text: string; right: number }[],
    opts: { weight?: 400 | 700; marginTop?: number } = {},
  ) => {
    const weight = opts.weight ?? 400;
    const marginTop = opts.marginTop ?? 2;
    const inkLeft = cells.length
      ? Math.min(...cells.map((x) => x.right - metrics.measure(x.text, ROW, weight)))
      : CONTENT_WIDTH;
    const top = c.height + marginTop;
    c.text(label, { size: ROW, weight, x: INDENT, maxWidth: inkLeft - INDENT - LABEL_GAP, marginTop });
    for (const x of cells) cell(x.text, x.right, top, weight);
  };

  /** A section title with its column heads on the same line. */
  const section = (title: string, heads: { text: string; right: number }[]) => {
    c.rule(MIN_RULE_PX, 12, 8);
    const top = c.height;
    c.text(title, { size: TITLE, weight: 700 });
    for (const h of heads) {
      c.place(h.right - CELL, top + (TITLE - SMALL) * 0.6, CELL, (v) =>
        v.text(h.text, { size: SMALL, weight: 700, align: "right" }),
      );
    }
    c.space(2);
  };

  const countMoney = (b: Bucket) => [
    { text: String(b.count), right: COUNT_RIGHT },
    { text: formatMoney(b.totalCents), right: MONEY_RIGHT },
  ];
  const heads2 = (a: string, b: string) => [
    { text: a, right: COUNT_RIGHT },
    { text: b, right: MONEY_RIGHT },
  ];

  /* ------------------------------------------------------------- header -- */

  const [seal, sealWidth] = sealMarkup(SEAL_HEIGHT);
  const headTop = c.height;
  c.graphic(0, headTop, seal);
  const textX = Math.ceil(sealWidth) + 16;
  const textWidth = CONTENT_WIDTH - textX;
  const block = new Canvas(textWidth, metrics);
  block.text(restaurant.name.toUpperCase(), { size: BAR, weight: 700, lineHeight: 1.15 });
  block.text(`${restaurant.address.street} · ${phoneDigits(restaurant.phones[0] ?? "")}`, {
    size: SMALL,
    marginTop: 4,
  });
  const nameTop = headTop + Math.max(0, (SEAL_HEIGHT - block.height) / 2);
  c.place(textX, nameTop, textWidth, (g) => {
    g.text(restaurant.name.toUpperCase(), { size: BAR, weight: 700, lineHeight: 1.15 });
    g.text(`${restaurant.address.street} · ${phoneDigits(restaurant.phones[0] ?? "")}`, {
      size: SMALL,
      marginTop: 4,
    });
  });
  c.space(Math.max(SEAL_HEIGHT, block.height));

  c.banner(`${R.dailyReport} DAILY REPORT`, { size: BAR, marginTop: 14 });

  const window =
    report.firstOrderAt && report.lastOrderAt
      ? `${formatClock(report.firstOrderAt, tz)} – ${formatClock(report.lastOrderAt, tz)}`
      : "no orders";
  c.text(`${formatBusinessDate(report.businessDate)} · ${window}`, {
    size: TITLE,
    weight: 700,
    marginTop: 10,
  });

  const printedDay = businessDateFor(tz, new Date(options.printedAt));
  const sameDay = printedDay === report.businessDate;
  const printedLabel = sameDay
    ? formatClock(options.printedAt, tz)
    : `${formatBusinessDate(printedDay).replace(/ \d{4}$/, "")} ${formatClock(options.printedAt, tz)}`;
  const stationLabel = options.station === "store" ? "Store printer" : "Online printer";
  c.text(
    `Printed ${printedLabel} · ${stationLabel} · print #${options.sequence}${sameDay ? " today" : ""}`,
    { size: SMALL, marginTop: 2 },
  );

  /* ------------------------------------------------------------- ORDERS -- */

  section(`ORDERS ${R.orders}`, heads2("Count", "Total"));
  row(`Online ${R.online}`, countMoney(report.channels.web));
  row(`Phone ${R.phone}`, countMoney(report.channels.phone));
  row(`Walk-in ${R.walkIn}`, countMoney(report.channels.walk_in));
  const dineIn = report.channels.dine_in;
  if (dineIn.count > 0 || dineIn.totalCents !== 0) {
    // Retired channel (2026-11-14). Only a day from before then has one.
    row(`Dine-in ${R.dineIn}`, countMoney(dineIn));
  }
  c.rule(MIN_RULE_PX, 6, 4);
  row(`All ${R.all}`, countMoney(report.columns.all), { weight: 700, marginTop: 0 });

  /* ------------------------------------------------------------- TOTALS -- */

  section(`TOTALS ${R.totals}`, [
    { text: "Online", right: TOTALS_RIGHTS[0] },
    { text: "Store", right: TOTALS_RIGHTS[1] },
    { text: "All", right: TOTALS_RIGHTS[2] },
  ]);
  const { online, store, all } = report.columns;
  const three = (pick: (b: Bucket) => number) =>
    [online, store, all].map((b, i) => ({ text: formatMoney(pick(b), false), right: TOTALS_RIGHTS[i] }));
  row(`Subtotal ${R.subtotal}`, three((b) => b.subtotalCents));
  row(`Charges ${R.charges}`, three((b) => b.chargesCents));
  row(`Tax ${R.tax}`, three((b) => b.taxCents));
  if (all.tipCents !== 0) {
    // Dormant: every writer stores 0 today. Printed only so a day that ever
    // has one still adds up down the column.
    row(`Tip ${R.tip}`, three((b) => b.tipCents));
  }
  row(`Total ${R.all}`, three((b) => b.totalCents), { weight: 700 });

  /* ------------------------------------------------------- NOT INCLUDED -- */

  section(`NOT INCLUDED ${R.notIncluded}`, heads2("Count", "Total"));
  row(`Cancelled ${R.cancelled}`, countMoney(report.cancelled));
  row(`Unprinted ${R.unprinted}`, countMoney(report.unprinted), {
    weight: report.unprinted.count > 0 ? 700 : 400,
  });

  /* ------------------------------------------------------------- TRAYS -- */

  if (options.blocks.trays) {
    section(`TRAYS ${R.trays}`, []);
    row(`Half tray ${R.halfTray}`, [{ text: String(report.trays.halfTray), right: COUNT_RIGHT }]);
    row(`Party tray ${R.partyTray}`, [{ text: String(report.trays.partyTray), right: COUNT_RIGHT }]);
    row(`Family dinners ${R.familyDinners}`, [
      { text: String(report.trays.familyDinners), right: COUNT_RIGHT },
    ]);
  }

  /* ------------------------------------------------------------ TOP 10 -- */

  if (options.blocks.top) {
    section(`TOP 10 ${R.top}`, heads2("Qty", "Sales"));
    if (report.top.length === 0) {
      row(`${R.none} None`, []);
    }
    const rankWidth = metrics.measure("10.", ROW, 400) + 8;
    const nameX = INDENT + rankWidth;
    // The name runs up to the widest quantity a day could print (three digits).
    const nameWidth = COUNT_RIGHT - metrics.measure("000", ROW, 400) - LABEL_GAP - nameX;
    for (const [i, item] of report.top.entries()) {
      const top = c.height + 2;
      c.place(INDENT, top, rankWidth, (v) => v.text(`${i + 1}.`, { size: ROW }));
      const name = item.nameZh ? `${item.nameZh} ${item.nameEn}` : item.nameEn;
      c.text(name, { size: ROW, x: nameX, maxWidth: nameWidth, marginTop: 2 });
      cell(String(item.quantity), COUNT_RIGHT, top, 400);
      cell(formatMoney(item.salesCents), MONEY_RIGHT, top, 400);
    }
  }

  /* ------------------------------------------------------------ BY HOUR -- */

  if (options.blocks.hours) {
    section(`BY HOUR ${R.byHour}`, heads2("Count", "Total"));
    if (report.hours.length === 0) {
      row(`${R.none} None`, []);
    }
    for (const h of report.hours) {
      row(formatHour(h.hour), [
        { text: String(h.count), right: COUNT_RIGHT },
        { text: formatMoney(h.totalCents), right: MONEY_RIGHT },
      ]);
    }
  }

  /* ------------------------------------------------------------- footer -- */

  c.rule(5, 14, 8);
  c.text("Orders taken, not payments.", { size: ROW, weight: 700 });
  c.text(`Match All ${R.all} against the card batch + cash drawer.`, { size: SMALL, marginTop: 2 });
  c.text(`${report.businessDate} · #${options.sequence} · ${report.code}`, { size: SMALL, marginTop: 8 });

  const { svg, height } = c.toSvg(TICKET_WIDTH_PX, PAD);
  return { svg, height, lines: c.placed, missing: [...c.missing] };
}

/**
 * Render the report to the printer's 1-bit PNG. Same rasterizer, same
 * threshold and same encoder as renderTicket, so it prints exactly as the
 * preview shows. (Phase 2 adds the StarPRNT job path and the `report` kind.)
 */
export async function renderReportPng(
  report: DailyReport,
  options: ComposeReportOptions,
): Promise<{ png: Buffer; height: number; missing: number[] }> {
  const fonts = await loadTicketFonts();
  const { svg, height, missing } = await composeReportSvg(report, options);
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
  try {
    const png = Buffer.from(
      await encodeMonochromePng(rendered.pixels, rendered.width, rendered.height),
    );
    return { png, height, missing };
  } finally {
    rendered.free();
  }
}
