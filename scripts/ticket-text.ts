/**
 * Print the text of one stored order's kitchen ticket, as composed by the same
 * composeTicketSvg the printer and the board's ticket image use.
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/ticket-text.ts <orderId> [pngPath]
 *
 * For browser tests, which cannot read a ticket image: this prints
 * {"lines": [...], "missing": [...]} as JSON, every laid-out text line in
 * order, so a spec can assert what the paper says. With a pngPath it also
 * writes the ticket PNG (renderTicket, the printer's render) for the record.
 */
import { writeFile } from "node:fs/promises";

async function main(): Promise<void> {
  const orderId = Number(process.argv[2]);
  const pngPath = process.argv[3];
  if (!Number.isFinite(orderId)) throw new Error("usage: ticket-text.ts <orderId> [pngPath]");
  const { getOrderById } = await import("../src/lib/orders/repository");
  const { composeTicketSvg, renderTicket } = await import("../src/lib/ticket/render");
  const order = await getOrderById("new-mandarin-canton", orderId);
  if (!order) throw new Error(`order ${orderId} not found`);
  const options = { timezone: "America/Los_Angeles" };
  const { lines, missing } = await composeTicketSvg(order, options);
  if (pngPath) await writeFile(pngPath, await renderTicket(order, options));
  process.stdout.write(JSON.stringify({ lines: lines.map((l) => l.text), missing }) + "\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
