import type { Page } from "@playwright/test";

/**
 * The POS item sheet opens with every required choice the strip's defaults do
 * not cover UNMADE (Add disabled until staff pick), and its sections may be
 * closed. A spec that only needs "some dish on the ticket" opens each 必選
 * group that has nothing chosen and picks its first option before tapping Add.
 */
export async function chooseRequired(page: Page): Promise<void> {
  const sheet = page.getByRole("dialog");
  for (const group of await sheet.locator("fieldset").all()) {
    const legend = group.locator("legend");
    if ((await legend.getByText("必選", { exact: true }).count()) === 0) continue;
    const head = legend.locator("button[aria-expanded]");
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    if ((await group.locator('button[aria-pressed="true"]').count()) > 0) continue;
    await group.locator("button[aria-pressed]").first().click();
  }
}
