import { expect, test, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";
import { chooseRequired, tapDish } from "./posSheet";

/**
 * 飲品 on the POS: the alcohol the website never shows is a tile here, it
 * rings and prints, and on paper it sits in its own 飲品 DRINKS block under
 * the food.
 */

const PRINT = "/api/print/e2e-print-secret-not-a-printer";
const STORE_MAC = "00:11:62:00:00:0B";

async function openPos(page: Page): Promise<void> {
  await enableTestMode(page);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator('[data-action="print"]')).toBeVisible();
}

/** Be the store printer until its queue is empty. */
async function printQueue(page: Page): Promise<number> {
  return page.evaluate(
    async ({ PRINT, STORE_MAC }) => {
      let printed = 0;
      for (let i = 0; i < 40; i++) {
        const poll = await (
          await fetch(PRINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ statusCode: "200 OK", printerMAC: STORE_MAC }),
          })
        ).json();
        if (!poll.jobReady) break;
        const token = encodeURIComponent(poll.jobToken);
        await (await fetch(`${PRINT}?token=${token}&mac=${encodeURIComponent(STORE_MAC)}&type=application/vnd.star.starprnt`)).arrayBuffer();
        await fetch(`${PRINT}?token=${token}&mac=${encodeURIComponent(STORE_MAC)}&code=OK`, { method: "DELETE" });
        printed++;
      }
      return printed;
    },
    { PRINT, STORE_MAC },
  );
}

test("the beer tile rings, prints, and lands in the 飲品 block", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await openPos(page);
  await printQueue(page);

  for (const id of ["american-beer", "imported-beer", "house-wine-glass", "hot-or-iced-tea", "soft-drink", "wonton-chips"]) {
    await expect(page.locator(`button[data-item="${id}"]`)).toHaveCount(1);
  }

  await tapDish(page, page.locator('button[data-item="kung-pao-chicken"]'));
  const sheetAdd = page.getByRole("button", { name: /加入單據/ });
  if (await sheetAdd.isVisible().catch(() => false)) {
    await chooseRequired(page);
    await sheetAdd.click();
  }
  await page.locator('button[data-item="american-beer"]').click();
  await expect(page.locator("[data-ticket] [data-line]")).toHaveCount(2);

  await page.locator('[data-context="takeout"]').click();
  await page.locator('[data-channel="phone"]').click();
  await page.locator('[data-action="details-done"]').click();
  const placed = page.waitForResponse((r) => r.url().endsWith("/api/kitchen/orders") && r.request().method() === "POST");
  await page.locator('[data-action="print"]').click();
  const body = (await (await placed).json()) as { ok: boolean; order: { id: number } };
  expect(body.ok, JSON.stringify(body)).toBe(true);

  expect(await printQueue(page)).toBeGreaterThanOrEqual(1);
  const ticket = await page.evaluate(
    async (id) => (await fetch(`/api/kitchen/orders/${id}/ticket?copy=kitchen&format=text`, { cache: "no-store" })).json(),
    body.order.id,
  );
  const lines = ticket.lines as string[];
  const heading = lines.indexOf("飲品 DRINKS");
  expect(heading, lines.join(" | ")).toBeGreaterThan(lines.indexOf("Kung Pao Chicken"));
  expect(lines.indexOf("American Beers")).toBeGreaterThan(heading);
  expect(lines).toContain("美國啤酒");

  await context.close();
});
