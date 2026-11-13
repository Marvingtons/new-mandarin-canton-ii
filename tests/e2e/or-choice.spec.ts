import { expect, test } from "@playwright/test";

/**
 * An "or" dish ("Black Pepper Beef or Chicken") cannot go in the cart until
 * the customer says which: its either/or opens unchosen (unlike the rice,
 * which defaults to steamed), Add to Cart stays disabled and names what is
 * missing, and the cart line carries the option they chose.
 */

const OR_DISHES = [
  { name: "Black Pepper Beef or Chicken", missing: "beef or chicken", pick: "Black Pepper Chicken", pickId: "or-black-pepper-chicken" },
  { name: "Steamed or Fried Dumplings (8)", missing: "steamed or fried", pick: "Fried Dumplings (8)", pickId: "or-fried-dumplings" },
  { name: "Chicken or Beef Chow Fun (Dry)", missing: "chicken or beef", pick: "Beef Chow Fun (Dry)", pickId: "or-beef-chow-fun" },
] as const;

for (const dish of OR_DISHES) {
  test(`${dish.name}: the web sheet refuses to add it without a choice`, async ({ page }) => {
    await page.goto("/menu");
    await page.getByRole("button", { name: dish.name }).last().click();

    const sheet = page.getByRole("dialog", { name: dish.name });
    await expect(sheet).toBeVisible();
    const either = sheet.locator(`input[type="radio"][name="group-either-or"]`);
    await expect(either).toHaveCount(2);
    for (const radio of await either.all()) await expect(radio).not.toBeChecked();

    const add = sheet.getByRole("button", { name: /Add to Cart/ });
    await expect(add).toBeDisabled();
    await expect(sheet.getByRole("status")).toContainText(`Please choose ${dish.missing}`);
    await add.click({ force: true });
    await expect(sheet).toBeVisible();

    await sheet.locator("label").filter({ hasText: dish.pick }).click();
    await expect(add).toBeEnabled();
    await add.click();
    await expect(sheet).toHaveCount(0);

    const stored = await page.evaluate(() =>
      Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? "").join("\n"),
    );
    expect(stored).toContain(`"${dish.pickId}"`);
  });
}
