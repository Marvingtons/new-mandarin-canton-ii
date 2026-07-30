import type { TicketMetrics, Weight } from "@/lib/ticket/measure";

/**
 * A vertical stacking canvas that emits SVG.
 *
 * This is the whole "layout engine" that replaced yoga. A kitchen ticket is a
 * fixed-width column of blocks: a line of text, a rule, a bordered region, an
 * inverted bar. Each block measures its own height from wrapped text and
 * advances a cursor; the total is the sum. There is no flex, no float, no
 * cascade, and nothing to instantiate at runtime.
 *
 * Coordinates are LOCAL to the canvas. Nesting is a `<g transform="translate">`
 * around a child canvas, which is what makes bordered boxes possible: the child
 * is composed first so its height is known, then the border is drawn around it.
 *
 * THERMAL RULES, enforced here rather than remembered per call site:
 *   - pure black on pure white, no greys, no opacity
 *   - no rule thinner than MIN_RULE_PX
 */

export const BLACK = "#000000";
export const WHITE = "#ffffff";

/** Thermal print heads lose hairlines. Nothing thinner than this is drawn. */
export const MIN_RULE_PX = 3;

/** CSS-ish default: the line box is 1.2x the font size. */
const DEFAULT_LINE_HEIGHT = 1.2;

export interface TextOptions {
  size: number;
  weight?: Weight;
  /** Multiple of `size`. */
  lineHeight?: number;
  color?: string;
  align?: "left" | "right" | "center";
  /** Left inset inside the canvas. */
  x?: number;
  /** Column width. Defaults to the canvas width minus `x`. */
  maxWidth?: number;
  marginTop?: number;
  marginBottom?: number;
}

/** One laid-out line, kept so callers can assert on real widths. */
export interface PlacedLine {
  text: string;
  /** ABSOLUTE x within the ticket content box, across every nesting level. */
  x: number;
  width: number;
  size: number;
  /** Column the line was wrapped into — the width it must never exceed. */
  column: number;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class Canvas {
  readonly width: number;
  private readonly metrics: TicketMetrics;
  private readonly ops: string[] = [];
  /** Shared across nested canvases so one report covers the whole ticket. */
  readonly placed: PlacedLine[];
  readonly missing: Set<number>;
  /** This canvas's x offset from the ticket content box, for absolute coords. */
  private readonly originX: number;
  private cursor = 0;

  constructor(
    width: number,
    metrics: TicketMetrics,
    shared?: { placed: PlacedLine[]; missing: Set<number>; originX: number },
  ) {
    this.width = width;
    this.metrics = metrics;
    this.placed = shared?.placed ?? [];
    this.missing = shared?.missing ?? new Set<number>();
    this.originX = shared?.originX ?? 0;
  }

  /** Current height of everything stacked so far. */
  get height(): number {
    return this.cursor;
  }

  /** Shared state for a child placed `dx` to the right of this canvas. */
  private share(dx: number) {
    return {
      placed: this.placed,
      missing: this.missing,
      originX: this.originX + dx,
    };
  }

  /** Blank vertical space. */
  space(px: number): void {
    this.cursor += px;
  }

  /** A solid divider, clamped to the thermal minimum. */
  rule(weight = MIN_RULE_PX, marginTop = 10, marginBottom = 10): void {
    const h = Math.max(MIN_RULE_PX, weight);
    this.cursor += marginTop;
    this.ops.push(
      `<rect x="0" y="${r(this.cursor)}" width="${r(this.width)}" height="${r(h)}" fill="${BLACK}"/>`,
    );
    this.cursor += h + marginBottom;
  }

  /**
   * A dashed rule that reads as "tear here".
   *
   * Drawn as discrete filled rects rather than a stroked dashed path: resvg
   * would render a dash array fine, but on a thermal head a hairline dash can
   * drop out entirely, and MIN_RULE_PX is the floor everything else on this
   * ticket respects. Deliberately visually distinct from `rule()` — a solid
   * divider means "new section", this means "cut the paper".
   */
  tearLine(dash = 12, gap = 8, weight = MIN_RULE_PX): void {
    const h = Math.max(MIN_RULE_PX, weight);
    for (let x = 0; x < this.width; x += dash + gap) {
      this.rect(x, this.cursor, Math.min(dash, this.width - x), h);
    }
    this.cursor += h;
  }

  /** Filled rectangle in local coordinates. */
  rect(x: number, y: number, w: number, h: number, fill = BLACK): void {
    this.ops.push(
      `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${fill}"/>`,
    );
  }

  /**
   * Wrap and draw text, advancing the cursor by the full block height.
   * Returns the height consumed so callers can align siblings against it.
   */
  text(content: string, options: TextOptions): number {
    const {
      size,
      weight = 400,
      lineHeight = DEFAULT_LINE_HEIGHT,
      color = BLACK,
      align = "left",
      x = 0,
      marginTop = 0,
      marginBottom = 0,
    } = options;
    const column = options.maxWidth ?? this.width - x;

    this.cursor += marginTop;
    const start = this.cursor;

    for (const cp of this.metrics.missingIn(content, weight)) this.missing.add(cp);

    const lines = this.metrics.wrap(content, size, weight, column);
    const lineBox = size * lineHeight;
    // Half-leading: centre the font's ascent+descent inside the line box, the
    // same vertical model CSS uses, so switching off satori did not move type.
    const glyphHeight = (this.metrics.ascent + this.metrics.descent) * size;
    const baselineInBox =
      (lineBox - glyphHeight) / 2 + this.metrics.ascent * size;

    for (const line of lines) {
      const w = this.metrics.measure(line, size, weight);
      let lineX = x;
      if (align === "right") lineX = x + column - w;
      else if (align === "center") lineX = x + (column - w) / 2;

      this.placed.push({
        text: line,
        x: this.originX + lineX,
        width: w,
        size,
        column,
      });
      this.ops.push(
        `<text x="${r(lineX)}" y="${r(this.cursor + baselineInBox)}" ` +
          `font-family="NotoTicket" font-size="${r(size)}" font-weight="${weight}" ` +
          `fill="${color}" xml:space="preserve">${escapeXml(line)}</text>`,
      );
      this.cursor += lineBox;
    }

    this.cursor += marginBottom;
    return this.cursor - start;
  }

  /**
   * Compose `build` at an explicit (x, y) WITHOUT moving the cursor.
   *
   * This is what makes side-by-side content possible in a stacking layout: the
   * quantity badge beside the item name, the price beside its label, the
   * REPRINT chip beside the header. The caller owns the row's height.
   */
  place(x: number, y: number, width: number, build: (child: Canvas) => void): number {
    const child = new Canvas(width, this.metrics, this.share(x));
    build(child);
    this.ops.push(
      `<g transform="translate(${r(x)},${r(y)})">${child.ops.join("")}</g>`,
    );
    return child.height;
  }

  /**
   * Compose `build` into a child canvas and place it at (x, cursor).
   * Returns the child's height.
   */
  group(
    x: number,
    width: number,
    build: (child: Canvas) => void,
    marginTop = 0,
  ): number {
    this.cursor += marginTop;
    const child = new Canvas(width, this.metrics, this.share(x));
    build(child);
    this.ops.push(
      `<g transform="translate(${r(x)},${r(this.cursor)})">${child.ops.join("")}</g>`,
    );
    this.cursor += child.height;
    return child.height;
  }

  /**
   * A bordered region. The children are composed first — that is the only way
   * to know how tall the border has to be — then the frame is drawn around
   * them as four filled rects (a stroked rect would put half its width outside
   * the box and land on a half-pixel).
   */
  box(
    options: {
      x?: number;
      width?: number;
      border?: number;
      padding?: number;
      marginTop?: number;
      marginBottom?: number;
    },
    build: (child: Canvas) => void,
  ): void {
    const {
      x = 0,
      border = MIN_RULE_PX,
      padding = 8,
      marginTop = 0,
      marginBottom = 0,
    } = options;
    const outerWidth = options.width ?? this.width - x;
    const innerWidth = outerWidth - 2 * (border + padding);

    this.cursor += marginTop;
    const child = new Canvas(
      innerWidth,
      this.metrics,
      this.share(x + border + padding),
    );
    build(child);

    const outerHeight = child.height + 2 * (border + padding);
    const top = this.cursor;

    this.rect(x, top, outerWidth, border);
    this.rect(x, top + outerHeight - border, outerWidth, border);
    this.rect(x, top, border, outerHeight);
    this.rect(x + outerWidth - border, top, border, outerHeight);

    this.ops.push(
      `<g transform="translate(${r(x + border + padding)},${r(top + border + padding)})">` +
        `${child.ops.join("")}</g>`,
    );

    this.cursor = top + outerHeight + marginBottom;
  }

  /** Inverted bar: solid black band with white text centred in it. */
  banner(
    content: string,
    options: { size: number; padY?: number; marginTop?: number },
  ): void {
    const { size, padY = 6, marginTop = 0 } = options;
    this.cursor += marginTop;
    const top = this.cursor;

    const child = new Canvas(this.width, this.metrics, this.share(0));
    child.text(content, { size, weight: 700, color: WHITE, align: "center" });

    const h = child.height + 2 * padY;
    this.rect(0, top, this.width, h);
    this.ops.push(
      `<g transform="translate(0,${r(top + padY)})">${child.ops.join("")}</g>`,
    );
    this.cursor = top + h;
  }

  /** Serialize to a standalone SVG document of the given padding. */
  toSvg(pageWidth: number, pad: number): { svg: string; height: number } {
    const height = Math.ceil(this.cursor + 2 * pad);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="${height}" ` +
      `viewBox="0 0 ${pageWidth} ${height}">` +
      `<rect x="0" y="0" width="${pageWidth}" height="${height}" fill="${WHITE}"/>` +
      `<g transform="translate(${r(pad)},${r(pad)})">${this.ops.join("")}</g>` +
      `</svg>`;
    return { svg, height };
  }
}

/** Trim float noise so the SVG stays small and diffable. */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}
