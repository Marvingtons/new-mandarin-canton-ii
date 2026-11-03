/**
 * The server Playwright tests the kitchen against: a production build
 * (`next start`) on a THROWAWAY database.
 *
 *   npm run build && npm run test:e2e     # Playwright starts this itself
 *   npx tsx scripts/e2e-server.ts         # or by hand, to look around
 *
 * WHY A SCRIPT AND NOT `next start`. The POS writes orders, and a test that
 * writes orders must never be able to reach a real database. This starts its
 * own embedded Postgres in a temp directory, applies the real schema.sql, and
 * hands `next start` a DATABASE_URL pointing at it, overriding whatever
 * .env.local says. Twilio is blanked so nothing can text anyone. The printer
 * secret is a test value, so no real printer can be polling this queue.
 * Everything is deleted when the process exits.
 *
 * The kitchen password and the test-mode key are test values too, shared with
 * the specs through tests/e2e/env.ts.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Client } from "pg";

import { E2E_BYPASS, E2E_DB_PORT, E2E_KITCHEN_PASSWORD, E2E_PORT } from "../tests/e2e/env";
const DB_NAME = "nmc_e2e";

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "nmc-e2e-"));
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: E2E_DB_PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();

  const admin = new Client({ host: "localhost", port: E2E_DB_PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${DB_NAME} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();

  const url = `postgresql://postgres:postgres@localhost:${E2E_DB_PORT}/${DB_NAME}`;
  const db = new Client({ connectionString: url });
  await db.connect();
  await db.query(await readFile(join(process.cwd(), "src", "lib", "db", "schema.sql"), "utf8"));
  await db.end();
  console.log(`[e2e] throwaway database ready on :${E2E_DB_PORT}`);

  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const next = spawn(process.execPath, [nextBin, "start", "-p", String(E2E_PORT)], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url,
      TENANT_ID: "new-mandarin-canton",
      RESTAURANT_TIMEZONE: "America/Los_Angeles",
      TENANT_TIMEZONE: "America/Los_Angeles",
      TENANT_TAX_RATE_BPS: "875",
      ORDER_NUMBER_PREFIX: "A",
      ADMIN_DASH_PASSWORD: E2E_KITCHEN_PASSWORD,
      ORDER_GATE_BYPASS: E2E_BYPASS,
      // Signs the test-mode and phone cookies. A test value, like the rest.
      OTP_SIGNING_SECRET: "e2e-otp-signing-secret-0123456789abcdef0123456789",
      CLOUDPRNT_SECRET: "e2e-print-secret-not-a-printer",
      TWILIO_ACCOUNT_SID: "",
      TWILIO_AUTH_TOKEN: "",
      TWILIO_VERIFY_SERVICE_SID: "",
      TWILIO_MESSAGING_FROM: "",
      OWNER_ALERT_PHONE: "",
    },
  });

  let stopping = false;
  const stop = async (code: number) => {
    if (stopping) return;
    stopping = true;
    next.kill("SIGTERM");
    await pg.stop().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
    process.exit(code);
  };
  next.on("exit", (code) => void stop(code ?? 0));
  process.on("SIGINT", () => void stop(0));
  process.on("SIGTERM", () => void stop(0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
