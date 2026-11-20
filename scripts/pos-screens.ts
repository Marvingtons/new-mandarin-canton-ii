/**
 * The POS review screenshots: an empty ticket, a 6-line ticket (one of them a
 * 自訂 custom charge), and the custom charge sheet, at 1024x768 and 1366x1024
 * (landscape) and 768x1024 (portrait, where the 6-line shot is the ticket
 * sheet open, and a fourth shows the bar with the sheet closed).
 *
 *   npm run build
 *   npx tsx scripts/e2e-server.ts        # the throwaway server, in another tab
 *   npx tsx scripts/pos-screens.ts [outDir]
 *
 * Runs against the e2e server only (test password, throwaway database). Both
 * printer stations are made to check in with the test print secret first, so
 * the shots show the screen as it looks with the printers up rather than the
 * "printer not connected" banners a printerless test server always has.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD, E2E_PORT } from "../tests/e2e/env";

const BASE = `http://localhost:${E2E_PORT}`;
const OUT = process.argv[2] ?? join(process.cwd(), "docs", "pos-landscape");
const PRINT_SECRET = "e2e-print-secret-not-a-printer";
const MACS = ["00:11:62:00:00:0A", "00:11:62:00:00:0B"];

async function pollPrinters(): Promise<void> {
  for (const printerMAC of MACS) {
    await fetch(`${BASE}/api/print/${PRINT_SECRET}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ printerMAC, statusCode: "200%20OK", printingInProgress: false }),
    });
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE}/kitchen/pos`);
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await page.locator('[data-action="print"]:visible, [data-action="bar-print"]:visible').first().waitFor();
}

/** Six common dishes, as a phone order would build them: one tap each. */
async function sixLines(page: Page): Promise<void> {
  const tap = (label: string) =>
    page.locator(`button[data-item]:not([data-asks])[aria-label*="${label}"]`).first().click();
  await tap("Orange Flavored Chicken");
  await tap("Mongolian Beef");
  await tap("Mongolian Beef");
  await page.locator('[data-defaults="rice"] button[data-value="fried"]').click();
  await tap("Salted Pepper Chicken Wings");
  await tap("Honey Walnut Shrimp");
  await page.locator('[data-defaults="rice"] button[data-value="steamed"]').click();
  await page.locator('[data-cat-link="vegetables"]').click();
  await page.locator('[data-cat="vegetables"] button[data-item]:not([data-asks])').first().click();
  // A 自訂 custom charge: 加蝦 Extra shrimp, $3.00.
  await page.locator('[data-cat-link="specials"]').click();
  await page.locator("button[data-custom-tile]").first().click();
  const custom = page.locator('[data-sheet="custom"]');
  await custom.locator('[data-preset="extra-shrimp"]').click();
  for (const k of ["3", "0", "0"]) await custom.locator(`[data-key="${k}"]`).click();
  await custom.locator('[data-action="sheet-add"]').click();
  await custom.waitFor({ state: "detached" });
  await page.locator('[data-cat-link="specials"]').click();
  await page.waitForTimeout(1200); // the line and tile flashes settle
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  const timer = setInterval(() => void pollPrinters(), 3_000);
  await pollPrinters();
  try {
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 1366, height: 1024 },
    ]) {
      const portrait = viewport.width < 1000;
      const tag = `${viewport.width}x${viewport.height}`;
      const context = await browser.newContext({ viewport });
      await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
      const page = await context.newPage();
      await signIn(page);
      await page.waitForTimeout(1500);

      await page.screenshot({ path: join(OUT, `pos-${tag}-1-empty.png`) });

      await sixLines(page);
      await page.mouse.move(0, 0);
      if (portrait) {
        await page.screenshot({ path: join(OUT, `pos-${tag}-4-bar.png`) });
        await page.locator('[data-action="open-ticket"]').click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: join(OUT, `pos-${tag}-2-six-lines.png`) });
      if (portrait) await page.keyboard.press("Escape");

      // The custom charge sheet, opened from its tile.
      await page.locator("button[data-custom-tile]").first().click();
      await page.locator('[data-sheet="custom"]').waitFor();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, `pos-${tag}-3-custom-sheet.png`) });
      await context.close();
      console.log(`${tag}: ${portrait ? 4 : 3} shots`);
    }
  } finally {
    clearInterval(timer);
    await browser.close();
  }
  console.log(`written to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
