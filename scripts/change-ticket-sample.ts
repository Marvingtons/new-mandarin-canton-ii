/**
 * 改單 CHANGE TICKET samples, through the real renderer, font and rasterizer.
 *
 *   npm run ticket:change-sample
 *
 * Writes docs/edit-order/ticket-*.png: the original B-002 ticket, then one
 * change ticket per diff case the design names (added, removed, size changed,
 * note only), each as the two stacked copies the printer cuts apart (kitchen,
 * then register). The lines are built through the real resolveOrderLine
 * against the real catalogue and diffed by the real diffOrderLines, so what is
 * printed here is what the server would store and print.
 *
 * Fails on any overflowing line or any glyph drawn as .notdef.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { composeTicketSvg, renderTicket } from "../src/lib/ticket/render";
import { resolveOrderLine } from "../src/lib/orders/lines";
import { diffOrderLines, type OrderChangeTicket } from "../src/lib/orders/revisionDiff";
import { RICE_FRIED_ID } from "../src/lib/menu/rice";
import { taxCents } from "../src/lib/money";
import type { MenuItem } from "../src/lib/menu/types";
import type { Order, OrderLine } from "../src/lib/orders/types";
import { fixtureOrder, FIXTURE_TAX_RATE_BPS } from "./fixtures/orders";

const TIMEZONE = "America/Los_Angeles";
const OUT = join(process.cwd(), "docs", "edit-order");

async function main(): Promise<void> {
  const { catalogMenu } = await import("../src/lib/menu/catalog");
  const byId = new Map<string, MenuItem>(
    catalogMenu().categories.flatMap((c) => c.items).map((i) => [i.id, i]),
  );
  const line = (id: string, size: string, qty: number, mods: string[] = [], note?: string): OrderLine => {
    const item = byId.get(id);
    if (!item) throw new Error(`no catalogue item "${id}"`);
    // "first" = the item's own first size (individual / regular / small).
    const sizeId = size === "first" ? (item.sizes?.[0]?.id ?? "regular") : size;
    return resolveOrderLine(item, sizeId, mods, qty, note);
  };
  const totals = (lines: OrderLine[]) => {
    const subtotalCents = lines.reduce((n, l) => n + l.lineCents, 0);
    const tax = taxCents(subtotalCents, FIXTURE_TAX_RATE_BPS);
    return { subtotalCents, taxCents: tax, tipCents: 0, totalCents: subtotalCents + tax };
  };

  // The original phone order, B-002: what the kitchen already has on paper.
  const original: OrderLine[] = [
    line("orange-flavored-chicken-special", "individual", 1, [RICE_FRIED_ID], "加辣"),
    line("beef-broccoli", "first", 2),
    line("mandarin-special", "party-tray", 1),
  ];
  const base: Order = {
    ...fixtureOrder(),
    orderNumber: "B-002",
    channel: "phone",
    station: "store",
    customer: { name: "", phone: "+16195550101" },
    items: original,
    totals: totals(original),
    createdAt: "2026-11-24T02:31:00.000Z",
  };

  const cases: { file: string; title: string; next: OrderLine[] }[] = [
    {
      file: "ticket-1-added",
      title: "+ one line: 2 egg rolls",
      next: [...original, line("egg-rolls", "first", 2)],
    },
    {
      file: "ticket-2-removed",
      title: "- one line: the beef with broccoli",
      next: [original[0], original[2]],
    },
    {
      file: "ticket-3-size",
      title: "改 the tray: 餐盤 → 半盤",
      next: [original[0], original[1], line("mandarin-special", "half-tray", 1)],
    },
    {
      file: "ticket-4-note",
      title: "改 only a note: 加辣 → 走辣",
      next: [
        line("orange-flavored-chicken-special", "individual", 1, [RICE_FRIED_ID], "走辣"),
        original[1],
        original[2],
      ],
    },
  ];

  await mkdir(OUT, { recursive: true });
  let failures = 0;

  const write = async (file: string, order: Order, change: OrderChangeTicket | null) => {
    const opts = { timezone: TIMEZONE, copies: 2, change };
    const composed = await composeTicketSvg(order, opts);
    const over = composed.lines.filter((l) => l.width > l.column + 0.5 || l.x + l.width > 536 + 0.5);
    if (composed.missing.length > 0 || over.length > 0) {
      failures++;
      console.error(`  ✗ ${file}: missing ${composed.missing.length} glyphs, ${over.length} overflowing lines`);
    }
    const png = await renderTicket(order, opts);
    await writeFile(join(OUT, `${file}.png`), png);
    console.log(`  ${file}.png  ${composed.height}px`);
  };

  await write("ticket-0-original", base, null);
  for (const [i, c] of cases.entries()) {
    const diff = diffOrderLines(original, c.next);
    const after = totals(c.next);
    const change: OrderChangeTicket = {
      revision: 1,
      fromRevision: 0,
      savedAt: `2026-11-24T02:${String(40 + i).padStart(2, "0")}:00.000Z`,
      diff,
      oldTotalCents: base.totals.totalCents,
      newTotalCents: after.totalCents,
    };
    console.log(
      `${c.title}: +${diff.added.length} -${diff.removed.length} 改${diff.changed.length} ` +
        `unchanged ${diff.unchangedCount}`,
    );
    await write(c.file, { ...base, items: c.next, totals: after }, change);
  }

  // The Receipt view of an edited order: the full current ticket, marked.
  const edited = cases[0].next;
  const composed = await renderTicket(
    { ...base, items: edited, totals: totals(edited) },
    { timezone: TIMEZONE, copies: 1, revision: 1 },
  );
  await writeFile(join(OUT, "ticket-5-receipt-revised.png"), composed);
  console.log("  ticket-5-receipt-revised.png");

  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
