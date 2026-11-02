/**
 * Prove that every character that can reach a kitchen ticket is really in the
 * subset font.
 *
 *   npm run verify:ticket-glyphs
 *
 * WHY THIS IS NOT CIRCULAR. `collectTicketGlyphs()` is the input to the
 * subsetter, so checking the font against it can only ever say "the subsetter
 * did what it was told". The failure that actually reaches paper is the other
 * one: a string the ORDER PIPELINE can produce that the COLLECTOR never walked.
 * That is exactly what happened to the combo panels — lunch specials, family
 * dinners and their entrée choices were orderable for weeks while the collector
 * only read the override maps, so 午市套餐 was one order away from printing □.
 *
 * So this script enumerates the reachable strings INDEPENDENTLY, from
 * `catalogMenu()` — the same menu the cart, the price recompute and
 * `resolveOrderLine` read — plus the renderer's own chrome, and checks each
 * codepoint against the REAL cmap parsed out of both committed TTFs. Neither
 * `ticket-font-coverage.json` nor the collector is trusted; both are reported
 * beside the ground truth so a drift between them is visible.
 *
 * Exits non-zero on any missing glyph. A missing glyph is a □ on the kitchen's
 * only copy of an order.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "opentype.js";
import { catalogMenu } from "../src/lib/menu/catalog";
import { itemSizes } from "../src/lib/menu/types";
import { resolveSizeZh } from "../src/data/menu-overrides";
import { restaurant } from "../src/data/restaurant";
import { collectTicketGlyphs, TICKET_LABELS } from "../src/lib/ticket/glyphs";
import { TICKET_COPY_PROFILES } from "../src/lib/ticket/copies";

const FONT_DIR = join(process.cwd(), "public", "fonts");

/** One reachable string, and where it came from, so a failure names itself. */
interface Source {
  where: string;
  text: string;
}

/**
 * Everything the renderer prints that is not read from an order: labels, the
 * fixed English beside them, the money format, the size-chip brackets.
 */
function chromeSources(): Source[] {
  const out: Source[] = [];
  for (const [key, zh] of Object.entries(TICKET_LABELS)) {
    out.push({ where: `TICKET_LABELS.${key}`, text: zh });
  }
  for (const profile of Object.values(TICKET_COPY_PROFILES)) {
    out.push({
      where: `copy bar (${profile.role})`,
      text: `${profile.labelZh} ${profile.labelEn}`,
    });
  }
  out.push(
    { where: "header", text: "PICKUP REPRINT NOTE" },
    { where: "customer", text: "AMPM" },
    { where: "totals", text: "SUBTOTAL TAX TIP TOTAL · COLLECT PAYMENT" },
    // Every glyph formatCents and the quantity badge can emit.
    { where: "money / quantity", text: "$0123456789.,-×" },
    // The modifier bullet, the bilingual separator, the size-chip brackets.
    { where: "line chrome", text: "● / 【】" },
    { where: "restaurant", text: restaurant.name },
  );
  if (restaurant.chineseName) {
    out.push({ where: "restaurant 中文", text: restaurant.chineseName });
  }
  return out;
}

/**
 * Every string an ORDER can put on a ticket, read from the real catalogue.
 *
 * Walks what `resolveOrderLine` would store: both names, the size label and its
 * 中文 (and the uppercased short form the chip prints), and every modifier in
 * every group — which is where the lunch entrée choices live.
 */
function orderSources(): Source[] {
  const out: Source[] = [];
  for (const category of catalogMenu().categories) {
    out.push({ where: `category ${category.id}`, text: category.nameEn });
    if (category.nameZh) {
      out.push({ where: `category ${category.id} 中文`, text: category.nameZh });
    }
    for (const item of category.items) {
      const at = `${category.id}/${item.id}`;
      out.push({ where: at, text: item.nameEn });
      if (item.nameZh) out.push({ where: `${at} 中文`, text: item.nameZh });
      for (const size of itemSizes(item)) {
        // The chip prints the label uppercased, plus its 中文 when there is one.
        out.push({ where: `${at} size ${size.id}`, text: size.label.toUpperCase() });
        const zh = resolveSizeZh(size.label);
        if (zh) out.push({ where: `${at} size ${size.id} 中文`, text: zh });
      }
      for (const group of item.modifierGroups) {
        for (const mod of group.modifiers) {
          out.push({ where: `${at} mod ${mod.id}`, text: mod.nameEn });
          if (mod.nameZh) {
            out.push({ where: `${at} mod ${mod.id} 中文`, text: mod.nameZh });
          }
        }
      }
    }
  }
  return out;
}

/** The codepoints a TTF's own cmap maps to a real glyph. */
async function realCmap(file: string): Promise<Set<number>> {
  const buffer = await readFile(join(FONT_DIR, file));
  const font = parse(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  const table = font.tables.cmap as { glyphIndexMap?: Record<string, number> };
  const map = table?.glyphIndexMap;
  if (!map) throw new Error(`${file}: no cmap glyphIndexMap — cannot verify`);
  const out = new Set<number>();
  for (const [cp, glyph] of Object.entries(map)) {
    // index 0 is .notdef: a cmap entry pointing at it is not coverage.
    if (glyph !== 0) out.add(Number(cp));
  }
  return out;
}

function hex(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

async function main(): Promise<void> {
  const [regular, bold, coverageRaw] = await Promise.all([
    realCmap("NotoSansTC-Ticket-Regular.ttf"),
    realCmap("NotoSansTC-Ticket-Bold.ttf"),
    readFile(join(FONT_DIR, "ticket-font-coverage.json"), "utf8"),
  ]);
  const declared = new Set(
    (JSON.parse(coverageRaw) as { codepoints: number[] }).codepoints,
  );

  const emittable = new Set([...collectTicketGlyphs()].map((ch) => ch.codePointAt(0)!));
  const sources = [...chromeSources(), ...orderSources()];

  // Every codepoint of every reachable string, remembering one place it came
  // from so a failure is actionable rather than a bare number.
  const reachable = new Map<number, string>();
  for (const { where, text } of sources) {
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === undefined || cp === 0x20) continue;
      if (!reachable.has(cp)) reachable.set(cp, where);
    }
  }

  const missing: { cp: number; where: string; weights: string[] }[] = [];
  for (const [cp, where] of reachable) {
    const weights: string[] = [];
    if (!regular.has(cp)) weights.push("Regular");
    if (!bold.has(cp)) weights.push("Bold");
    if (weights.length > 0) missing.push({ cp, where, weights });
  }

  // A collector that does not know about a reachable string is the bug this
  // script exists for; report it even when the font happens to contain the
  // glyph anyway (shared characters hide gaps).
  const uncollected = [...reachable.keys()].filter((cp) => !emittable.has(cp));
  const declaredButAbsent = [...declared].filter(
    (cp) => !regular.has(cp) || !bold.has(cp),
  );

  const rows: [string, number | string][] = [
    ["reachable codepoints (independent walk)", reachable.size],
    ["strings walked", sources.length],
    ["glyphs the collector can emit", emittable.size],
    ["cmap codepoints, NotoSansTC-Ticket-Regular.ttf", regular.size],
    ["cmap codepoints, NotoSansTC-Ticket-Bold.ttf", bold.size],
    ["codepoints in ticket-font-coverage.json", declared.size],
    ["declared in coverage.json but absent from a real cmap", declaredButAbsent.length],
    ["reachable but NOT collected (collector gap)", uncollected.length],
    ["MISSING FROM EITHER WEIGHT", missing.length],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(width)}  ${String(value).padStart(6)}`);
  }

  if (uncollected.length > 0) {
    console.error("\ncollector gap — reachable but never offered to the subsetter:");
    for (const cp of uncollected.slice(0, 40)) {
      console.error(
        `  ${hex(cp)} ${String.fromCodePoint(cp)}  first seen in ${reachable.get(cp)}`,
      );
    }
  }
  if (missing.length > 0) {
    console.error("\nmissing glyphs — these print as □ on paper:");
    for (const m of missing.slice(0, 40)) {
      console.error(
        `  ${hex(m.cp)} ${String.fromCodePoint(m.cp)}  ${m.weights.join("+")}  ` +
          `first seen in ${m.where}`,
      );
    }
  }

  if (missing.length > 0 || uncollected.length > 0 || declaredButAbsent.length > 0) {
    console.error("\nFAIL — re-run `npm run build:ticket-font -- <NotoSansTC[wght].ttf>`.");
    process.exit(1);
  }
  console.log("\nzero missing glyphs across every source that can reach a ticket ✓");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
