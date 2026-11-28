import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks against a PRODUCTION build: `npm run build` first, then
 * `npm run test:e2e`. The web server below is scripts/e2e-server.ts: `next
 * start` on a throwaway embedded Postgres, never the database in .env.local.
 * An already running one on the same port is reused.
 *
 * Runs in the installed Google Chrome (`channel: "chrome"`) rather than a
 * downloaded Chromium, so there is no browser to install. The kitchen specs
 * run at a landscape 11" tablet's size, which is what the counter uses.
 *
 * Serial: the kitchen specs share one dining room (one database), and seating
 * table 4 in one test must not race clearing it in another.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
/** The printer-pool project's own server and database (kitchen-pool specs). */
const POOL_PORT = PORT + 1;
const POOL_DB_PORT = 55442;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    {
      name: "kitchen-tablet",
      testMatch: /kitchen-.*\.spec\.ts/,
      testIgnore: /kitchen-pool.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1180, height: 820 } },
    },
    {
      // Sound on the counter's iPad: Safari's engine (WebKit) with an iPad's
      // viewport, user agent and touch. Only the sound spec: the rest of the
      // kitchen suite is engine-neutral and runs once, in Chrome.
      name: "kitchen-ipad",
      testMatch: /kitchen-(sound|daily-report|edit-order)\.spec\.ts/,
      use: { ...devices["iPad Pro 11 landscape"] },
    },
    {
      // 印表機 PRINTER POOL on (docs/printer-pool.md): its own server, on its
      // own port and database, so the rest of the suite keeps the default
      // channel routing it was written against.
      name: "kitchen-pool",
      testMatch: /kitchen-pool.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1180, height: 820 }, baseURL: `http://localhost:${POOL_PORT}` },
    },
    {
      // Customer-site checks are about what a phone is sent.
      name: "phone",
      testIgnore: /kitchen-.*\.spec\.ts/,
      use: { ...devices["Pixel 7"], channel: "chrome" },
    },
  ],
  webServer: [
    {
      command: "npx tsx scripts/e2e-server.ts",
      url: `http://localhost:${PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npx tsx scripts/e2e-server.ts",
      url: `http://localhost:${POOL_PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { E2E_PORT: String(POOL_PORT), E2E_DB_PORT: String(POOL_DB_PORT), PRINTER_POOL: "on" },
    },
  ],
});
