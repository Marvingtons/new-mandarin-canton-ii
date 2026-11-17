import type { Page } from "@playwright/test";

/**
 * The POS item sheet opens with every required choice other than the rice
 * UNMADE (Add disabled until staff pick), and its sections may be
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

/**
 * "Some dish on the ticket": tap the first orderable card, then finish what
 * it asks. A rice dish opens the picker on the card (a second tap takes
 * 白飯); a dish with another required choice opens the sheet.
 */
export async function addFirstDish(page: Page): Promise<void> {
  const card = page.locator("button[data-item]:not([disabled])").first();
  await card.click();
  if (await page.locator("[data-rice-pop]").isVisible().catch(() => false)) {
    await card.click();
    return;
  }
  const sheetAdd = page.getByRole("button", { name: /加入單據/ });
  if (await sheetAdd.isVisible().catch(() => false)) {
    await chooseRequired(page);
    await sheetAdd.click();
  }
}
