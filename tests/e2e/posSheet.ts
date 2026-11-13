import type { Page } from "@playwright/test";

/**
 * The POS item sheet opens with every required choice UNMADE (Add disabled
 * until staff pick), so a spec that only needs "some dish on the ticket" picks
 * the first option of each 必選 group before tapping Add.
 */
export async function chooseRequired(page: Page): Promise<void> {
  const sheet = page.getByRole("dialog");
  for (const group of await sheet.locator("fieldset").all()) {
    if ((await group.locator("legend").getByText("必選", { exact: true }).count()) === 0) continue;
    await group.locator("button[aria-pressed]").first().click();
  }
}
