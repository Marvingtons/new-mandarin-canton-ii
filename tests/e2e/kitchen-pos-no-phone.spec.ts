import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { E2E_DB_PORT, E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";
import { chooseRequired, tapDish } from "./posSheet";

/**
 * A phone order may be taken without a phone number.
 *
 *   POS      Phone channel, customer left completely empty: Print is live, the
 *            field's placeholder says the number may be left blank.
 *   TICKET   PHONE ORDER, and no phone line at all (as a walk-in prints).
 *   BOARD    The card shows 無電話 in the phone slot.
 *   HISTORY  The row shows 無電話 and is found by its order number.
 */

async function openPos(page: Page): Promise<void> {
  await enableTestMode(page);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator('[data-action="print"]')).toBeVisible();
}

test("a phone order with an empty customer prints, and shows 無電話 on the board and in History", async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await openPos(page);

  await tapDish(page, page.locator("button[data-item]:not([disabled])").first());
  const sheetAdd = page.getByRole("button", { name: /加入單據/ });
  if (await sheetAdd.isVisible().catch(() => false)) {
    await chooseRequired(page);
    await sheetAdd.click();
  }

  await page.locator('[data-context="takeout"]').click();
  await page.locator('[data-channel="phone"]').click();
  await expect(page.getByLabel("客人姓名")).toHaveValue("");
  const phone = page.getByLabel("電話", { exact: true });
  await expect(phone).toHaveValue("");
  await expect(phone).toHaveAttribute("placeholder", "電話（可留空）");
  await page.locator('[data-action="details-done"]').click();
  await expect(page.locator('[data-action="print"]')).toBeEnabled();

  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/kitchen/orders") && r.request().method() === "POST",
  );
  await page.locator('[data-action="print"]').click();
  const body = (await (await posted).json()) as { ok: boolean; order: { id: number; orderNumber: string; channel: string } };
  expect(body.ok).toBe(true);
  expect(body.order.channel).toBe("phone");

  // The ticket: PHONE ORDER, no phone line, no "undefined".
  const pngPath = info.outputPath("phone-no-number-ticket.png");
  const { stdout } = await promisify(execFile)(
    "npx",
    ["tsx", "--conditions=react-server", "scripts/ticket-text.ts", String(body.order.id), pngPath],
    { env: { ...process.env, DATABASE_URL: `postgresql://postgres:postgres@localhost:${E2E_DB_PORT}/nmc_e2e` } },
  );
  await info.attach("ticket", { path: pngPath, contentType: "image/png" });
  const rendered = JSON.parse(stdout) as { lines: string[]; missing: number[] };
  expect(rendered.missing).toEqual([]);
  expect(rendered.lines.some((l) => l.includes("PHONE ORDER"))).toBe(true);
  expect(rendered.lines.some((l) => /\(\d{3}\) \d{3}-\d{4}|undefined|null/.test(l))).toBe(false);

  // The board card.
  await page.goto("/kitchen");
  const card = page.locator(`article[data-order-id="${body.order.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText("無電話");
  await expect(card).not.toContainText("undefined");

  // History: found by its order number, and the phone slot says 無電話.
  await page.goto("/kitchen/history");
  await page.getByRole("searchbox").or(page.getByLabel(/搜尋/)).first().fill(body.order.orderNumber);
  const row = page.locator("li > button[aria-expanded]", { hasText: body.order.orderNumber }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("無電話");

  await context.close();
});
