import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks against a PRODUCTION build: `npm run build` first, then
 * `npm run test:e2e`. The web server below is `next start`, and an already
 * running one on the same port is reused.
 *
 * Runs in the installed Google Chrome (`channel: "chrome"`) rather than a
 * downloaded Chromium, so there is no browser to install. Phone-sized,
 * because the checks here are about what a phone is sent.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Pixel 7"],
    channel: "chrome",
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
