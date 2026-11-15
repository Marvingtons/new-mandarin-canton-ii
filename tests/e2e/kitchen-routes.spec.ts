import { expect, test } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD } from "./env";

/**
 * Every staff route that exists on main still works, in the unified shell.
 *
 * main has exactly three staff pages, under the board's slug (KITCHEN_ROUTE_SLUG,
 * default "kitchen"):
 *
 *   /{slug}           the kitchen board       -> the Orders tab
 *   /{slug}/pos       the POS
 *   /{slug}/history   order history
 *
 * The unified shell kept every one of those paths, so none needs a redirect:
 * a 308 from a path to itself would loop. This pins that: each answers 200
 * directly (no redirect hop at all), inside the shell, on the right tab.
 *
 * If a path ever does move, add its 308 in next.config.ts and a row here.
 */

const ROUTES = [
  { path: "/kitchen", tab: "訂單" },
  { path: "/kitchen/pos", tab: "新訂單" },
  { path: "/kitchen/history", tab: "歷史" },
] as const;

test("main's staff routes answer directly in the unified shell", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await page.goto("/kitchen");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.getByRole("navigation", { name: "廚房選單" })).toBeVisible();

  for (const { path, tab } of ROUTES) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    // No redirect anywhere on the way: the request that answered is the one made.
    expect(response?.request().redirectedFrom(), path).toBeNull();
    expect(new URL(page.url()).pathname).toBe(path);
    const nav = page.getByRole("navigation", { name: "廚房選單" });
    await expect(nav.getByRole("link", { name: new RegExp(`^${tab}`) })).toHaveAttribute("aria-current", "page");
  }

  // Dine-in is retired: the POS has no 堂食 mode and no floor plan.
  await page.goto("/kitchen/pos");
  await expect(page.locator('[data-action="print"]')).toBeVisible();
  await expect(page.locator('[data-value="dine_in"]')).toHaveCount(0);
  await expect(page.locator("[data-table]")).toHaveCount(0);
  await context.close();
});
