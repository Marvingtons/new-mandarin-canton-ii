import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { E2E_DB_PORT, E2E_KITCHEN_PASSWORD } from "./env";
import { chooseRequired, tapDish } from "./posSheet";

/**
 * Staff orders have NO time limits. The tablet's clock is pinned to 8:41 PM on
 * a Friday, after the 8:30 PM close, the moment the POS used to say
 * 請選預訂時間 over an empty picker and refuse to print.
 *
 * NOT in test mode, on purpose: nothing about this may depend on the bypass.
 * The server runs on the real clock, and the staff route checks no hours at
 * any time of day, so an ASAP order is accepted whenever this runs.
 */

/** Friday 2026-11-27, 8:41 PM in America/Los_Angeles (PST, -08:00). */
const FRIDAY_841_PM = new Date("2026-11-27T20:41:00-08:00");

test("8:41 PM Friday, after close: ASAP preselected, Print enabled, the order prints 盡快", async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  // A running clock from 8:41 PM, so the POS's own ticks stay after close.
  await page.clock.install({ time: FRIDAY_841_PM });

  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator('[data-action="print"]')).toBeVisible();

  // One dish.
  await tapDish(page, page.locator("button[data-item]:not([disabled])").first());
  const sheetAdd = page.getByRole("button", { name: /加入單據/ });
  if (await sheetAdd.isVisible().catch(() => false)) {
    await chooseRequired(page);
    await sheetAdd.click();
  }

  // The picker: 盡快 ASAP first and chosen, then times past closing (9:15 PM).
  await page.locator('[data-context="takeout"]').click();
  const picker = page.locator('select[data-field="scheduled"]');
  await expect(picker).toHaveValue("asap");
  await expect(picker.locator("option").first()).toHaveText("盡快 ASAP");
  await expect(picker.locator('option[value="21:15"]')).toHaveCount(1);
  await page.locator('[data-action="details-done"]').click();

  // Print is live: no 請選預訂時間, nothing missing.
  const print = page.locator('[data-action="print"]');
  await expect(print).toBeEnabled();
  await expect(page.getByText("請選預訂時間")).toHaveCount(0);

  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/kitchen/orders") && r.request().method() === "POST",
  );
  await print.click();
  const response = await posted;
  expect(JSON.parse(response.request().postData() ?? "{}").pickup.time).toBe("asap");
  const body = (await response.json()) as { ok: boolean; order: { id: number } };
  expect(response.status()).toBe(200);
  expect(body.ok).toBe(true);

  // The ticket the printer gets: 取餐時間 PICKUP / 盡快 ASAP, no □.
  const pngPath = info.outputPath("after-hours-asap-ticket.png");
  const { stdout } = await promisify(execFile)(
    "npx",
    ["tsx", "--conditions=react-server", "scripts/ticket-text.ts", String(body.order.id), pngPath],
    { env: { ...process.env, DATABASE_URL: `postgresql://postgres:postgres@localhost:${E2E_DB_PORT}/nmc_e2e` } },
  );
  await info.attach("after-hours-asap-ticket.png", { path: pngPath, contentType: "image/png" });
  const ticket = JSON.parse(stdout) as { lines: string[]; missing: number[] };
  expect(ticket.missing).toEqual([]);
  expect(ticket.lines).toContain("取餐時間 PICKUP");
  expect(ticket.lines).toContain("盡快 ASAP");

  // The board card: 盡快 · 落單 <time>.
  await page.goto("/kitchen");
  const card = page.locator(`article[data-order-id="${body.order.id}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('[data-pickup="asap"]')).toContainText(/^盡快 · 落單 \d{1,2}:\d{2} [AP]M$/);

  await context.close();
});
