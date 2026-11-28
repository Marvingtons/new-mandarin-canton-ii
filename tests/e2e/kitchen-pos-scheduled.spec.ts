import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { E2E_DB_PORT, E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";
import { chooseRequired, tapDish } from "./posSheet";

/**
 * The POS pickup control: 盡快 ASAP first and preselected.
 *
 *   - Left on ASAP, the phone order goes in as "asap" and its ticket prints
 *     取餐時間 PICKUP / 盡快 ASAP under the phone, never an estimated time.
 *   - Set, the order carries that time and its ticket prints 預訂 SCHEDULED
 *     and the one time, directly under the phone number.
 *
 * The ticket is read back with scripts/ticket-text.ts, the same compose the
 * printer gets (see kitchen-pos-required.spec.ts for why not the route).
 */

async function openPos(page: Page): Promise<void> {
  await enableTestMode(page);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator('[data-action="print"]')).toBeVisible();
}

async function addAnyDish(page: Page): Promise<void> {
  await tapDish(page, page.locator("button[data-item]:not([disabled])").first());
  const sheetAdd = page.getByRole("button", { name: /加入單據/ });
  if (await sheetAdd.isVisible().catch(() => false)) {
    await chooseRequired(page);
    await sheetAdd.click();
  }
}

async function placeAndRead(page: Page, info: TestInfo, png: string): Promise<{ id: number; lines: string[]; missing: number[] }> {
  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/kitchen/orders") && r.request().method() === "POST",
  );
  await page.locator('[data-action="print"]').click();
  const response = await posted;
  const body = (await response.json()) as { ok: boolean; order: { id: number } };
  expect(body.ok).toBe(true);
  const pngPath = info.outputPath(png);
  const { stdout } = await promisify(execFile)(
    "npx",
    ["tsx", "--conditions=react-server", "scripts/ticket-text.ts", String(body.order.id), pngPath],
    { env: { ...process.env, DATABASE_URL: `postgresql://postgres:postgres@localhost:${E2E_DB_PORT}/nmc_e2e` } },
  );
  await info.attach(png, { path: pngPath, contentType: "image/png" });
  const rendered = JSON.parse(stdout) as { lines: string[]; missing: number[] };
  return { id: body.order.id, lines: rendered.lines, missing: rendered.missing };
}

test("Pickup: ASAP prints 盡快, a set time prints 預訂 SCHEDULED under the phone; the name is optional", async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await openPos(page);

  /* ---- 1. Phone order, pickup left on ASAP ---- */
  await addAnyDish(page);
  await page.locator('[data-context="takeout"]').click();
  await page.locator('[data-channel="phone"]').click();
  await page.getByLabel("客人姓名").fill("E2E Scheduled");
  await page.getByLabel("電話", { exact: true }).fill("6195550166");
  const scheduled = page.locator('select[data-field="scheduled"]');
  // 盡快 ASAP, preselected.
  await expect(scheduled).toHaveValue("asap");
  await expect(scheduled.locator("option").first()).toHaveText("盡快 ASAP");
  await page.locator('[data-action="details-done"]').click();

  const asapRequest = page.waitForRequest(
    (r) => r.url().endsWith("/api/kitchen/orders") && r.method() === "POST",
  );
  const asap = await placeAndRead(page, info, "phone-asap-ticket.png");
  expect(((await asapRequest).postDataJSON() as { pickup: { time: string } }).pickup.time).toBe("asap");
  expect(asap.missing).toEqual([]);
  const a = asap.lines.indexOf("(619) 555-0166");
  expect(asap.lines.slice(a + 1, a + 3)).toEqual(["取餐時間 PICKUP", "盡快 ASAP"]);
  expect(asap.lines.some((l) => /SCHEDULED|預訂/.test(l))).toBe(false);

  /* ---- 2. Phone order with a Scheduled for time and NO name ---- */
  await addAnyDish(page);
  await page.locator('[data-context="takeout"]').click();
  await page.locator('[data-channel="phone"]').click();
  // The name is optional now: left empty on purpose.
  await expect(page.getByLabel("客人姓名")).toHaveValue("");
  await page.getByLabel("電話", { exact: true }).fill("6195550166");
  // The first clock time after ASAP.
  const firstTime = scheduled.locator("option:not([value='asap'])").first();
  const value = (await firstTime.getAttribute("value")) ?? "";
  const label = ((await firstTime.textContent()) ?? "").trim();
  expect(value).toMatch(/^\d{2}:\d{2}$/);
  await scheduled.selectOption(value);
  await page.locator('[data-action="details-done"]').click();
  // The ticket header on screen says so before it is printed, and Print is
  // live without a name.
  await expect(page.locator('[data-context="takeout"]')).toContainText(label);
  await expect(page.locator('[data-action="print"]')).toBeEnabled();

  const timedRequest = page.waitForRequest(
    (r) => r.url().endsWith("/api/kitchen/orders") && r.method() === "POST",
  );
  const timed = await placeAndRead(page, info, "phone-scheduled-ticket.png");
  expect(((await timedRequest).postDataJSON() as { pickup: { time: string } }).pickup.time).toBe(value);
  expect(timed.missing).toEqual([]);
  const i = timed.lines.indexOf("(619) 555-0166");
  expect(i).toBeGreaterThanOrEqual(0);
  expect(timed.lines.slice(i + 1, i + 3)).toEqual(["預訂 SCHEDULED", label]);
  expect(timed.lines.some((l) => /PICKUP|取餐時間/.test(l))).toBe(false);
  expect(timed.lines.some((l) => l.startsWith("客人") || /undefined/.test(l))).toBe(false);

  // The board card: the phone, no empty name, no "undefined".
  await page.goto("/kitchen");
  const card = page.locator(`article[data-order-id="${timed.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText("(619) 555-0166");
  await expect(card).not.toContainText("undefined");

  await context.close();
});
