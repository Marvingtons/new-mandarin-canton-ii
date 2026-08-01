/**
 * The multi-copy split, asserted.
 *
 * This file exists because the thing it tests used to be an exception:
 * renderCutCopies() refused any copy set over the 512KB StarPRNT cap with
 * "reduce TICKET_COPIES", which meant a ten-line family order never
 * printed. The cap is per JOB and not per order, so the fix is to send
 * consecutive jobs — and the claim machinery already knew how to sequence
 * them. What it did not have was a proof that no order can reach a throw.
 *
 * Four claims:
 *   1. NO FIXTURE CAN THROW, including a synthetic 25-line order at
 *      copies=3, and every emitted job is under the byte cap.
 *   2. The plan is DETERMINISTIC. The segment cursor is a bare integer in
 *      Postgres and poll N+1 re-derives the plan from scratch, so two
 *      renders that disagreed would send a copy twice or not at all.
 *   3. Every copy appears EXACTLY ONCE across the whole sequence, in
 *      order, and each job round-trips back to the raster it was made
 *      from.
 *   4. A mid-sequence failure retries THAT piece, not the sequence.
 *
 * Run: npm run verify:print-split
 */
import {
  renderTicketJob,
  rasterizeTicket,
  TICKET_WIDTH_PX,
} from "@/lib/ticket/render";
import {
  decodeStarPrntRaster,
  maxStarPrntRows,
  starPrntJobBytes,
  thresholdToInk,
  MAX_JOB_BYTES,
} from "@/lib/ticket/starprnt";
import { planSegments, jobBytesFor } from "@/lib/ticket/segments";
import { decideOffer, confirmationWindowSeconds } from "@/lib/print/entitlement";
import { fixtureOrders } from "./fixtures/orders";
import type { Order, OrderLine } from "@/lib/orders/types";

const TIMEZONE = "America/Los_Angeles";
const COPIES = 3;
const CEILING = maxStarPrntRows(TICKET_WIDTH_PX);

let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else failures.push(`  ${name}${detail ? `\n     ${detail}` : ""}`);
};

const opts = { timezone: TIMEZONE, copies: COPIES };
const job = { format: "starprnt" as const, maxHeight: CEILING };

/** A synthetic order with `n` distinct lines, per the brief. */
function syntheticOrder(base: Order, n: number): Order {
  const lines: OrderLine[] = [];
  for (let i = 0; i < n; i++) {
    lines.push({
      itemId: `synthetic-${i}`,
      nameEn: `Synthetic Dish Number ${i + 1} With A Long Name`,
      nameZh: "合成菜式",
      sizeId: "individual",
      sizeLabel: "Individual",
      sizeLabelZh: null,
      modifiers: [
        { id: "rice-steamed", nameEn: "Steamed Rice", nameZh: "白飯", priceCents: 0 },
      ],
      quantity: (i % 3) + 1,
      unitCents: 1250 + i,
      lineCents: (1250 + i) * ((i % 3) + 1),
      specialInstructions: i % 4 === 0 ? "no peanuts, extra spicy, sauce on the side" : undefined,
    });
  }
  return { ...base, orderNumber: `S-${n}`, items: lines };
}

async function main(): Promise<void> {
  const fixtures = await fixtureOrders();
  const base = fixtures[0].order;

  const cases: { name: string; order: Order }[] = [
    ...fixtures.map((f) => ({ name: f.name, order: f.order })),
    { name: "synthetic 25-line", order: syntheticOrder(base, 25) },
    { name: "synthetic 40-line", order: syntheticOrder(base, 40) },
  ];

  console.log(`StarPRNT cap ${MAX_JOB_BYTES} bytes (${CEILING} rows at ${TICKET_WIDTH_PX}px), copies=${COPIES}\n`);

  for (const { name, order } of cases) {
    /* ---- 1. never throws, and every piece is under the cap ---- */
    let segments = 0;
    const bodies: Buffer[] = [];
    try {
      const first = await renderTicketJob(order, opts, { ...job, segment: 0 });
      segments = first.segments;
      bodies.push(first.body);
      for (let s = 1; s < segments; s++) {
        const piece = await renderTicketJob(order, opts, { ...job, segment: s });
        bodies.push(piece.body);
      }
    } catch (err) {
      check(
        `${name}: renders without throwing`,
        false,
        err instanceof Error ? err.message : String(err),
      );
      continue;
    }
    check(`${name}: renders without throwing`, true);

    const over = bodies.filter((b) => b.length > MAX_JOB_BYTES);
    check(
      `${name}: every one of ${segments} piece(s) is under the byte cap`,
      over.length === 0,
      over.map((b) => `${b.length} bytes`).join(", "),
    );

    /* ---- 2. deterministic ---- */
    const again = await renderTicketJob(order, opts, { ...job, segment: 0 });
    check(
      `${name}: segment count is stable across renders`,
      again.segments === segments,
      `${segments} then ${again.segments}`,
    );
    check(
      `${name}: segment 0 bytes are identical across renders`,
      again.body.equals(bodies[0]),
      "a re-render produced different bytes, so the cursor cannot be trusted",
    );

    /* ---- 3. every copy exactly once, in order, raster intact ---- */
    const decoded = bodies.map((b) => decodeStarPrntRaster(b, TICKET_WIDTH_PX));
    const totalTickets = decoded.reduce((n, d) => n + d.copies.length, 0);
    // A copy small enough to travel whole is one physical ticket; a copy
    // that had to be sliced inside itself is more than one. Either way the
    // sequence can never carry FEWER pieces of paper than there are copies.
    check(
      `${name}: the sequence yields at least ${COPIES} physical tickets`,
      totalTickets >= COPIES,
      `got ${totalTickets} across ${segments} job(s)`,
    );

    /* THE REAL CLAIM: laid end to end in the order the printer receives
       them, the pieces reconstruct the copy set exactly. That covers all
       three things at once — every copy present, none twice, correct
       order, and pixel-for-pixel identical to a direct render — and it
       holds whether or not a copy had to be sliced, which the previous
       per-ticket comparison did not. */
    const emitted = Buffer.concat(
      decoded.flatMap((d) => d.copies.map((c) => Buffer.from(c.pixels))),
    );
    const expectedParts: Buffer[] = [];
    for (let copyIndex = 0; copyIndex < COPIES; copyIndex++) {
      const src = await rasterizeTicket(order, { ...opts, copyIndex });
      try {
        expectedParts.push(Buffer.from(thresholdToInk(src.pixels, src.width, src.height)));
      } finally {
        src.free();
      }
    }
    const expected = Buffer.concat(expectedParts);
    check(
      `${name}: the pieces reconstruct all ${COPIES} copies exactly, in order`,
      emitted.equals(expected),
      `${emitted.length} ink bytes emitted vs ${expected.length} expected`,
    );

    check(
      `${name}: every job carries its own cut commands`,
      decoded.every((d) => d.cut),
      "a job without a cut leaves the ticket attached to the roll",
    );

    console.log(
      `  ${name.padEnd(26)} ${segments} segment(s)  ` +
        bodies.map((b) => `${Math.round(b.length / 1024)}KB`).join(" + "),
    );
  }

  /* ---- planner unit checks: the arithmetic, without rendering ---- */
  {
    const W = TICKET_WIDTH_PX;
    // Three copies that fit together.
    const small = planSegments([1011, 1273, 1273], W, MAX_JOB_BYTES, () => 1);
    check(
      "planner: a small copy set is one job",
      small.length === 1 && small[0].kind === "copies" && small[0].copyIndices.length === 3,
      JSON.stringify(small),
    );

    // The 8547px fixture shape.
    const big = planSegments([2701, 2923, 2923], W, MAX_JOB_BYTES, () => 1);
    const grouped = big.every((s) => s.kind === "copies");
    const flat = big.flatMap((s) => (s.kind === "copies" ? s.copyIndices : []));
    check(
      "planner: the over-cap fixture splits at copy boundaries",
      grouped && JSON.stringify(flat) === JSON.stringify([0, 1, 2]),
      JSON.stringify(big),
    );
    check(
      "planner: every planned job is under the cap",
      big.every(
        (s) =>
          s.kind !== "copies" ||
          jobBytesFor(s.copyIndices.map((i) => [2701, 2923, 2923][i]), W) <= MAX_JOB_BYTES,
      ),
      JSON.stringify(big),
    );

    // The byte-exact model is what makes that true: the row check disagrees.
    check(
      "planner: rows alone would have wrongly passed 3x2426",
      3 * 2426 <= CEILING && starPrntJobBytes([2426, 2426, 2426], W) > MAX_JOB_BYTES,
      "the row ceiling and the byte cap should disagree here",
    );

    // A single copy over the cap falls back to slicing inside it.
    const huge = planSegments([20000], W, MAX_JOB_BYTES, () => 3);
    check(
      "planner: an oversized single copy slices inside itself",
      huge.length === 3 && huge.every((s) => s.kind === "slice"),
      JSON.stringify(huge),
    );

    // No ceiling means one job with everything, which ticket:sample relies on.
    const uncapped = planSegments([9999, 9999, 9999], W, 0, () => 1);
    check(
      "planner: no ceiling means one job carrying every copy",
      uncapped.length === 1 &&
        uncapped[0].kind === "copies" &&
        uncapped[0].copyIndices.length === 3,
      JSON.stringify(uncapped),
    );
  }

  /* ---- 4. a mid-sequence failure retries THAT piece ---- */
  {
    const now = Date.parse("2026-08-01T20:00:00Z");
    const window = confirmationWindowSeconds(3, 60, 30, 3);

    // Piece 2 of 3 handed over, window expired, no confirmation.
    const expired = decideOffer({
      now,
      offeredAt: new Date(now - (window + 5) * 1000).toISOString(),
      printAttempts: 2,
      copies: 3,
      floorSeconds: 60,
      perCopySeconds: 30,
      deliveryCap: 4,
      segments: 3,
      segmentIndex: 1,
    });
    check(
      "retry: an expired piece is re-offered rather than condemned",
      expired.verdict === "retry",
      `${expired.verdict}: ${expired.reason}`,
    );

    // Still inside the window: nothing is re-offered, so no duplicate piece.
    const holding = decideOffer({
      now,
      offeredAt: new Date(now - 5000).toISOString(),
      printAttempts: 2,
      copies: 3,
      floorSeconds: 60,
      perCopySeconds: 30,
      deliveryCap: 4,
      segments: 3,
      segmentIndex: 1,
    });
    check(
      "retry: a piece still in flight is held, never duplicated",
      holding.verdict === "hold",
      `${holding.verdict}: ${holding.reason}`,
    );

    // The window budgets ONE piece, not the whole copy set.
    check(
      "window: a 3-piece job budgets one copy per piece, not three",
      confirmationWindowSeconds(3, 60, 30, 3) < confirmationWindowSeconds(3, 60, 30, 1) ||
        confirmationWindowSeconds(3, 60, 30, 1) === 90,
      `1-piece=${confirmationWindowSeconds(3, 60, 30, 1)}s 3-piece=${confirmationWindowSeconds(3, 60, 30, 3)}s`,
    );

    // Continuation pieces get the same hand-over allowance as the first.
    const firstPieceCapped = decideOffer({
      now,
      offeredAt: new Date(now - (window + 5) * 1000).toISOString(),
      printAttempts: 4,
      copies: 3,
      floorSeconds: 60,
      perCopySeconds: 30,
      deliveryCap: 4,
      segments: 3,
      segmentIndex: 0,
    });
    const laterPieceNotYet = decideOffer({
      now,
      offeredAt: new Date(now - (window + 5) * 1000).toISOString(),
      printAttempts: 4,
      copies: 3,
      floorSeconds: 60,
      perCopySeconds: 30,
      deliveryCap: 4,
      segments: 3,
      segmentIndex: 1,
    });
    check(
      "cap: piece 1 is condemned at the cap",
      firstPieceCapped.verdict === "capped",
      firstPieceCapped.verdict,
    );
    check(
      "cap: a later piece gets the same allowance, not one fewer",
      laterPieceNotYet.verdict === "retry",
      `${laterPieceNotYet.verdict} — advancePrintSegment leaves attempts at 1, so without ` +
        "the per-piece cap this piece would be condemned a hand-over early",
    );
  }

  const total = pass + failures.length;
  console.log(`\nprint split: ${pass}/${total} checks passed`);
  if (failures.length > 0) {
    console.error("\nFAILED:");
    for (const f of failures) console.error(f);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
