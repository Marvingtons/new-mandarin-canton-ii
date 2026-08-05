/**
 * Prove the tax arithmetic, and prove the customer cannot supply it.
 *
 *   npm run verify:pricing
 *
 * Needs no database and no network — this is arithmetic and a schema. It runs
 * in a second, which is the point: the rate is the one number on this site that
 * is wrong in a way nobody notices until a customer adds it up at the counter.
 *
 *   1. RATE       — the tenant resolves 875 bps (8.75%) from either supported
 *                   form, and refuses rather than guessing when unset.
 *   2. FIXTURE    — the owner-confirmed figure, asserted exactly:
 *                   $112.85 subtotal -> $9.87 tax -> $122.72 total.
 *   3. ROUNDING   — half-up on the cent, at the exact boundary, where
 *                   truncation and banker's rounding each give a DIFFERENT
 *                   answer. This is the assertion that would catch a rewrite.
 *   4. INTEGERS   — no float ever survives the chain: every result is an exact
 *                   integer and subtotal + tax === total across a full sweep.
 *   5. AUTHORITY  — the order wire schema has no money field, so a stale cart
 *                   cannot submit a tax figure computed under the old rate.
 *
 * (5) is what makes a rate change safe to ship mid-service. A tab held open
 * since before the change has an old number on screen; it has nowhere to put
 * that number on the wire, and /api/orders recomputes from tenant.taxRateBps
 * at submission. The screen is stale, the order is not.
 */

import { formatCents, taxCents } from "../src/lib/money";
import { OrderRequestSchema } from "../src/lib/orders/requestSchema";
import {
  FIXTURE_TAX_RATE_BPS,
  fixtureOrder,
  sqlShapedOrder,
  tortureOrder,
} from "./fixtures/orders";

/** The confirmed Chula Vista rate. Must match TENANT_TAX_RATE_BPS. */
const RATE_BPS = 875;

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function equals(label: string, actual: unknown, expected: unknown): void {
  check(
    label,
    Object.is(actual, expected),
    Object.is(actual, expected) ? `${actual}` : `got ${actual}, expected ${expected}`,
  );
}

/** Reload the tenant config with a fresh environment. */
async function tenantWith(
  vars: Record<string, string | undefined>,
): Promise<number | null> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    // Cache-busted so each case reads the environment it just set, rather than
    // whatever the first import happened to see.
    const mod = await import(
      `../src/config/tenant.server.ts?pricing=${Object.values(vars).join("-")}`
    );
    return (mod.publicTenant() as { taxRateBps: number | null }).taxRateBps;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function main(): Promise<void> {
  console.log(`pricing — ${RATE_BPS} bps (${(RATE_BPS / 100).toFixed(2)}%)\n`);

  /* ------------------------------------------------- 1. the rate itself -- */
  console.log("1. the configured rate");
  equals(
    "TENANT_TAX_RATE_BPS=875 resolves to 875 bps",
    await tenantWith({ TENANT_TAX_RATE_BPS: "875", TAX_RATE: undefined }),
    875,
  );
  equals(
    "TAX_RATE=0.0875 resolves to the same 875 bps, without float dust",
    await tenantWith({ TENANT_TAX_RATE_BPS: undefined, TAX_RATE: "0.0875" }),
    875,
  );
  equals(
    "neither set resolves to null — the order flow refuses rather than guesses",
    await tenantWith({ TENANT_TAX_RATE_BPS: undefined, TAX_RATE: undefined }),
    null,
  );
  // The ticket fixtures state the rate rather than resolving one, so this is
  // the tie that stops them drifting a rate change behind the app.
  equals("the ticket fixtures use the same rate", FIXTURE_TAX_RATE_BPS, RATE_BPS);

  /* ---------------------------------------------- 2. the known fixture --- */
  console.log("\n2. the owner-confirmed fixture");
  {
    const subtotal = 11285; // $112.85
    const tax = taxCents(subtotal, RATE_BPS);
    const total = subtotal + tax;
    equals(`${formatCents(subtotal)} -> tax`, tax, 987);
    equals(`${formatCents(subtotal)} -> total`, total, 12272);
    check(
      "reads as $112.85 / $9.87 / $122.72 on paper",
      formatCents(subtotal) === "$112.85" &&
        formatCents(tax) === "$9.87" &&
        formatCents(total) === "$122.72",
      `${formatCents(subtotal)} / ${formatCents(tax)} / ${formatCents(total)}`,
    );
  }

  /* -------------------------------------------------- 3. the rounding ---- */
  console.log("\n3. rounding is half-up on the cent");
  {
    /* At 875 bps an exact half-cent needs a subtotal ≡ 40 (mod 80), so these
       are not arbitrary numbers — they are the ONLY places the three rounding
       rules disagree, and every one of them is a subtotal a real cart can
       reach. `banker` is what Math.round would give if it rounded half to
       even, `trunc` what it would give if the division silently floored. */
    const boundaries = [
      { subtotal: 11320, exact: "990.5", halfUp: 991, banker: 990, trunc: 990 },
      { subtotal: 11240, exact: "983.5", halfUp: 984, banker: 984, trunc: 983 },
      { subtotal: 120, exact: "10.5", halfUp: 11, banker: 10, trunc: 10 },
      { subtotal: 40, exact: "3.5", halfUp: 4, banker: 4, trunc: 3 },
    ];
    for (const b of boundaries) {
      const tax = taxCents(b.subtotal, RATE_BPS);
      const rules = [
        tax !== b.banker || b.halfUp === b.banker ? null : "banker's",
        tax !== b.trunc || b.halfUp === b.trunc ? null : "truncation",
      ].filter(Boolean);
      equals(
        `${formatCents(b.subtotal)} -> ${b.exact}c rounds up` +
          (rules.length ? ` (not ${rules.join(" or ")})` : ""),
        tax,
        b.halfUp,
      );
    }

    // Odd-cent subtotals either side of the half, where the direction is not
    // in doubt but a sign error would show.
    equals("$112.85 -> 987.4375c rounds DOWN", taxCents(11285, RATE_BPS), 987);
    equals("$112.43 -> 983.7625c rounds UP", taxCents(11243, RATE_BPS), 984);
    equals("$0.00 -> no tax on an empty subtotal", taxCents(0, RATE_BPS), 0);
  }

  /* ------------------------------------------------ 4. integers only ----- */
  console.log("\n4. integer cents the whole way down");
  {
    /* Exact half-up, in BigInt, with no division that can produce a fraction.
       This is the reference: if taxCents() ever disagrees with it, a float has
       got into the chain — which is precisely the failure that is invisible in
       spot checks and shows up as a one-cent dispute at the counter. */
    // (BigInt LITERALS need an ES2020 target and this project is ES2017, so
    // the constructor form it is — the arithmetic is identical.)
    const TEN_K = BigInt(10000);
    const ONE = BigInt(1);
    const TWO = BigInt(2);
    const exactHalfUp = (subtotal: number, bps: number): number => {
      const n = BigInt(subtotal) * BigInt(bps);
      const q = n / TEN_K;
      const r = n % TEN_K;
      return Number(r * TWO >= TEN_K ? q + ONE : q);
    };

    // Every subtotal from 0c to $500 in 1c steps: 50,001 orders' worth of
    // arithmetic, each checked against the exact integer answer.
    let nonInteger = 0;
    let disagrees = 0;
    let notMonotonic = 0;
    let previous = -1;
    let firstBad = "";
    for (let subtotal = 0; subtotal <= 50_000; subtotal++) {
      const tax = taxCents(subtotal, RATE_BPS);
      if (!Number.isInteger(tax)) nonInteger++;
      const exact = exactHalfUp(subtotal, RATE_BPS);
      if (tax !== exact) {
        disagrees++;
        if (!firstBad) firstBad = `${subtotal}c -> ${tax}, exact ${exact}`;
      }
      // Tax never decreases as the bill grows — a float artefact would dip.
      if (tax < previous) notMonotonic++;
      previous = tax;
    }
    check("50,001 subtotals all yield integer cents", nonInteger === 0, `${nonInteger} bad`);
    check(
      "every one matches exact BigInt half-up — no float drift",
      disagrees === 0,
      disagrees === 0 ? "50,001 checked" : `${disagrees} differ, first: ${firstBad}`,
    );
    check("tax never decreases as the subtotal grows", notMonotonic === 0, `${notMonotonic} dips`);

    /* The renderer's invariant, on the fixtures the ticket scripts actually
       print: the stored tax IS this rate applied to the stored subtotal, and
       the stored total is the exact sum of the parts. ticket:sample asserts
       the same closure on what was DRAWN; this asserts it on what was stored,
       so a fixture cannot drift out of step with the rate. */
    const stored = [fixtureOrder(), tortureOrder(), sqlShapedOrder()];
    for (const order of stored) {
      const { subtotalCents, taxCents: tax, tipCents, totalCents } = order.totals;
      const lineSum = order.items.reduce((n, l) => n + l.lineCents, 0);
      check(
        `${order.orderNumber}: lines ${formatCents(lineSum)} = subtotal, ` +
          `tax ${formatCents(tax)} @ ${RATE_BPS} bps, total ${formatCents(totalCents)}`,
        lineSum === subtotalCents &&
          tax === taxCents(subtotalCents, RATE_BPS) &&
          subtotalCents + tax + tipCents === totalCents,
      );
    }
  }

  /* --------------------------------------- 5. the server is the authority */
  console.log("\n5. the wire carries no money");
  {
    const valid = {
      lines: [{ itemId: "kung-pao-chicken", sizeId: "individual", quantity: 1 }],
      pickup: { name: "Stale Tab", phone: "+16195550148", time: "asap" },
      idempotencyKey: "stale-cart-key-0001",
    };
    check("a well-formed order parses", OrderRequestSchema.safeParse(valid).success);

    // Each of these is a client trying to tell the server what the order
    // costs. Under the OLD rate, at that. Every one must be refused.
    const moneyFields = ["taxCents", "tax", "total", "totalCents", "subtotalCents", "amount"];
    for (const field of moneyFields) {
      const rejected = !OrderRequestSchema.safeParse({ ...valid, [field]: 874 })
        .success;
      check(`a body carrying \`${field}\` is rejected outright`, rejected);
    }
    for (const field of ["price", "lineCents", "unitCents"]) {
      const rejected = !OrderRequestSchema.safeParse({
        ...valid,
        lines: [{ ...valid.lines[0], [field]: 1495 }],
      }).success;
      check(`a line carrying \`${field}\` is rejected outright`, rejected);
    }

    // The parsed result is the whole of what the server may read. If a money
    // key could survive parsing, the route could accidentally trust it.
    const parsed = OrderRequestSchema.parse(valid);
    const keys = new Set(Object.keys(parsed));
    check(
      "nothing money-shaped survives parsing",
      !moneyFields.some((f) => keys.has(f)),
      [...keys].join(", "),
    );
  }

  console.log(
    failures === 0
      ? "\nall pricing checks passed\n"
      : `\n${failures} pricing check(s) FAILED\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
