import { expect, test } from "@playwright/test";
import { E2E_BYPASS, E2E_KITCHEN_PASSWORD } from "./env";

/**
 * Clearing a POS draft is destructive: two taps, always, through the same
 * shared ConfirmDialog as cancelling an order or clearing a table. The safe
 * choice is focused first, so a stray Enter goes back rather than clearing.
 */
test("clearing a draft ticket takes the shared destructive confirm", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await page.goto(`/api/test-mode?key=${E2E_BYPASS}`);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator('[data-value="takeout"]')).toBeVisible();

  const ticket = page.getByRole("complementary", { name: "單據" });
  const lines = ticket.locator("[aria-expanded]");
  await page.locator("button[data-item]:not([disabled])").first().click();
  const sheetAdd = page.getByRole("button", { name: /加入單據/ });
  if (await sheetAdd.isVisible().catch(() => false)) await sheetAdd.click();
  await expect(lines).toHaveCount(1);

  // Tap 1: a dialog, not a cleared ticket.
  await ticket.getByRole("button", { name: "清除單據" }).click();
  const dialog = page.getByRole("dialog", { name: "清除這張單據？" });
  await expect(dialog).toBeVisible();
  await expect(lines).toHaveCount(1);
  // The shared confirm: "返回" first and focused, the destructive one second.
  const buttons = dialog.getByRole("button");
  await expect(buttons.nth(0)).toHaveText("返回");
  await expect(buttons.nth(1)).toHaveText("確認清除");
  await expect(buttons.nth(0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(lines).toHaveCount(1);

  // Tap 1 again, tap 2 on the confirm: now it clears.
  await ticket.getByRole("button", { name: "清除單據" }).click();
  await dialog.getByRole("button", { name: "確認清除" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(lines).toHaveCount(0);
  await context.close();
});
