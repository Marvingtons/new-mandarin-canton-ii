import { expect, type Page } from "@playwright/test";
import { E2E_BYPASS } from "./env";

/**
 * Put this browser in test mode (order time gates off) the way a person
 * does: open /api/test-mode, type the key, press Turn on. GET only reports;
 * the switch is the form's POST, which needs the key.
 */
export async function enableTestMode(page: Page): Promise<void> {
  await page.goto("/api/test-mode");
  await page.locator('input[name="key"]').fill(E2E_BYPASS);
  await page.getByRole("button", { name: "Turn on for 4 hours" }).click();
  await expect(page.locator("body")).toContainText("Test mode on");
}
