/**
 * Local Postgres for development, with a few seeded orders.
 *
 *   npm run dev:db          # start, seed, and stay running
 *   npm run dev:db -- --reset   # wipe the data directory first
 *
 * Replaces the old `.data/orders.json` dev store. That file was convenient
 * precisely because it needed no server — but it was also the reason
 * idempotency and the daily counter were untestable, so it had to go. This
 * script buys the convenience back honestly: a real Postgres, one command, no
 * Docker.
 *
 * Prints the DATABASE_URL to paste into .env.local. Leave it running in one
 * terminal alongside `npm run dev`.
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { taxCents } from "../src/lib/money";

const DATA_DIR = join(process.cwd(), ".data", "postgres");
const PORT = 55432;
const DB_NAME = "nmc_orders";
const URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`;

const TENANT = process.env.TENANT_ID ?? "new-mandarin-canton";
const TIMEZONE = process.env.TENANT_TIMEZONE ?? "America/Los_Angeles";
// Seeded orders carry the same rate the app would quote — read from the
// environment when one is set, so a developer who changes it sees it here.
const TAX_RATE_BPS = Number.parseInt(
  process.env.TENANT_TAX_RATE_BPS ?? "875",
  10,
);

async function main(): Promise<void> {
  if (process.argv.includes("--reset")) {
    await rm(DATA_DIR, { recursive: true, force: true });
    console.log("wiped", DATA_DIR);
  }
  await mkdir(DATA_DIR, { recursive: true });

  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: true,
  });

  // initialise() throws if the cluster already exists; that is the normal
  // second-run path, not an error.
  try {
    await pg.initialise();
  } catch {
    /* already initialised */
  }
  await pg.start();
  try {
    await pg.createDatabase(DB_NAME);
  } catch {
    /* already exists */
  }

  process.env.DATABASE_URL = URL;
  const { ordersPool } = await import("../src/lib/db/postgres");
  const repo = await import("../src/lib/orders/repository");
  const { businessDateFor } = await import("../src/lib/orders/businessDate");

  const schema = await readFile(
    join(process.cwd(), "src", "lib", "db", "schema.sql"),
    "utf8",
  );
  await ordersPool().query(schema);
  console.log("schema applied");

  const businessDate = businessDateFor(TIMEZONE);
  const { rows } = await ordersPool().query(
    "select count(*)::int as n from orders where tenant_id = $1 and business_date = $2::date",
    [TENANT, businessDate],
  );

  if (rows[0].n === 0) {
    await seed(repo, businessDate);
    console.log(`seeded 3 orders for ${businessDate}`);
  } else {
    console.log(`${rows[0].n} order(s) already present for ${businessDate}`);
  }

  console.log(
    `\npostgres running on ${PORT}\n\n` +
      `  DATABASE_URL=${URL}\n\n` +
      "Add that to .env.local (with ADMIN_DASH_PASSWORD) and run `npm run dev`.\n" +
      "Ctrl-C to stop.",
  );

  const shutdown = async () => {
    console.log("\nstopping postgres…");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // Hold the process open.
  await new Promise(() => {});
}

async function seed(
  repo: typeof import("../src/lib/orders/repository"),
  businessDate: string,
): Promise<void> {
  const now = Date.now();

  const orders = [
    {
      key: `dev-seed-1-${businessDate}`,
      customer: { name: "Alice Chen", phone: "+16195550111" },
      pickupOffsetMin: 25,
      items: [
        {
          itemId: "kung-pao-chicken",
          nameEn: "Kung Pao Chicken",
          nameZh: "宮保雞丁",
          sizeId: "party-tray",
          sizeLabel: "Party Tray",
          sizeLabelZh: "大盤",
          modifiers: [
            { id: "m-spicy", nameEn: "Extra Spicy", nameZh: "加辣", priceCents: 0 },
            { id: "m-peanut", nameEn: "No Peanuts", nameZh: "走花生", priceCents: 0 },
          ],
          quantity: 2,
          unitCents: 9000,
          lineCents: 18000,
          specialInstructions:
            "Severe peanut allergy — clean wok and fresh oil please.",
        },
      ],
      // Left QUEUED: this is the "new order" the board should announce, and
      // the one a CloudPRNT poll would claim first.
      finalStatus: "QUEUED" as const,
    },
    {
      key: `dev-seed-2-${businessDate}`,
      customer: { name: "Bao Nguyen", phone: "+16195550122" },
      pickupOffsetMin: 40,
      items: [
        {
          itemId: "orange-chicken",
          // Intentionally has no override -> exercises the ⚠ EN path.
          nameEn: "Orange Flavored Chicken",
          nameZh: null,
          sizeId: "regular",
          sizeLabel: "Regular",
          sizeLabelZh: null,
          modifiers: [],
          quantity: 1,
          unitCents: 1995,
          lineCents: 1995,
        },
        {
          itemId: "mongolian-beef",
          nameEn: "Mongolian Beef",
          nameZh: "蒙古牛",
          sizeId: "regular",
          sizeLabel: "Regular",
          sizeLabelZh: null,
          modifiers: [],
          quantity: 3,
          unitCents: 2150,
          lineCents: 6450,
        },
      ],
      // The case the board exists for: paid, but nobody has a paper copy.
      finalStatus: "PRINT_FAILED" as const,
    },
    {
      key: `dev-seed-3-${businessDate}`,
      customer: { name: "Carmen Ruiz", phone: "+16195550133" },
      pickupOffsetMin: 15,
      items: [
        {
          itemId: "house-fried-rice",
          nameEn: "House Special Fried Rice",
          nameZh: null,
          sizeId: "individual",
          sizeLabel: "Individual",
          sizeLabelZh: "單點",
          modifiers: [],
          quantity: 1,
          unitCents: 1950,
          lineCents: 1950,
        },
      ],
      finalStatus: "ACCEPTED" as const,
    },
  ];

  for (const spec of orders) {
    const subtotalCents = spec.items.reduce((n, l) => n + l.lineCents, 0);
    const tax = taxCents(subtotalCents, TAX_RATE_BPS);

    const { order } = await repo.createOrder({
      tenantId: TENANT,
      businessDate,
      orderNumberPrefix: process.env.ORDER_NUMBER_PREFIX ?? "A",
      idempotencyKey: spec.key,
      items: spec.items,
      totals: {
        subtotalCents,
        taxCents: tax,
        tipCents: 0,
        totalCents: subtotalCents + tax,
      },
      customer: spec.customer,
      phoneVerifiedAt: new Date(now - 60_000),
      pickupAt: new Date(now + spec.pickupOffsetMin * 60_000),
    });

    if (spec.finalStatus === "PRINT_FAILED") {
      await repo.recordPrintAttempt(TENANT, order.id, {
        ok: false,
        error: "printer offline (seeded)",
      });
    } else if (spec.finalStatus !== "QUEUED") {
      await repo.updateStatus(TENANT, order.id, spec.finalStatus);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
