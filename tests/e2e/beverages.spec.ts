import { expect, test } from "@playwright/test";

/**
 * 飲品 Beverages on the website: tea and soft drink only. Alcohol (American
 * Beers, Imported Beers, House Wine) is POS-only and is nowhere on the page,
 * not in the section, not in search, not in the JSON-LD.
 */

test("the Beverages section shows tea and soft drink only", async ({ page }) => {
  await page.goto("/menu");
  const section = page.locator("section#cat-beverages");
  await expect(section).toBeAttached();
  await expect(section.locator("h2")).toContainText("Beverages");
  await expect(section.getByRole("button", { name: "Hot Tea or Iced Tea" })).toBeVisible();
  await expect(section.getByRole("button", { name: "Soft Drink" })).toBeVisible();
  for (const name of ["American Beers", "Imported Beers", "House Wine"]) {
    await expect(page.getByText(name)).toHaveCount(0);
  }
  const html = await page.content();
  expect(html).not.toMatch(/American Beers|Imported Beers|House Wine|Chardonnay|Zinfandel/);
});

test("Hot Tea or Iced Tea asks hot or iced before it can be added", async ({ page }) => {
  await page.goto("/menu");
  await page.locator("section#cat-beverages").getByRole("button", { name: "Hot Tea or Iced Tea" }).click();
  const sheet = page.getByRole("dialog", { name: "Hot Tea or Iced Tea" });
  await expect(sheet).toBeVisible();
  const add = sheet.getByRole("button", { name: /Add to Cart/ });
  await expect(add).toBeDisabled();
  await sheet.locator("label").filter({ hasText: "Iced Tea" }).click();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(sheet).toHaveCount(0);
  const stored = await page.evaluate(() => Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? "").join("\n"));
  expect(stored).toContain('"tea-iced"');
});

test("Wonton Chips is on the website, after Fried/Steamed Rice", async ({ page }) => {
  await page.goto("/menu");
  const sides = page.locator("section#cat-sides");
  const names = await sides.getByRole("button").allTextContents();
  const rice = names.findIndex((n) => n.includes("Fried/Steamed Rice"));
  const chips = names.findIndex((n) => n.includes("Wonton Chips"));
  expect(rice).toBeGreaterThanOrEqual(0);
  expect(chips).toBeGreaterThan(rice);
});
