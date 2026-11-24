// 改單 EDIT ORDER as built: screenshots of the running app, next to the
// Phase 1 mockups (mock-*.png), at 1024x768 and 768x1024.
//
//   npm run build
//   npx tsx scripts/e2e-server.ts        # throwaway database; leave it running
//   node docs/edit-order/shoot-app.mjs
//
// Writes docs/edit-order/app-<n>-<state>-<w>x<h>.png.
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const PRINT = "/api/print/e2e-print-secret-not-a-printer";
const STORE_MAC = "00:11:62:00:00:0B";

const browser = await chromium.launch({ channel: "chrome" });

async function session(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/api/test-mode`);
  await page.locator('input[name="key"]').fill("e2e-gate-bypass");
  await page.getByRole("button", { name: "Turn on for 4 hours" }).click();
  await page.getByText("Test mode on").waitFor();
  await page.goto(`${BASE}/kitchen/pos`);
  await page.locator('input[type="password"]').fill("e2e-kitchen-password");
  await page.locator('input[type="password"]').press("Enter");
  await page.locator('[data-action="print"], [data-action="bar-print"]').first().waitFor({ state: "attached" });
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

const placeOrder = (page) =>
  page.evaluate(async () => {
    const res = await fetch("/api/kitchen/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "phone",
        customer: { phone: "6195550101" },
        pickup: { time: "asap" },
        idempotencyKey: `shoot-app-${Date.now()}-${Math.random()}`,
        lines: [
          { itemId: "orange-flavored-chicken-special", sizeId: "individual", modifierIds: ["rice-fried"], quantity: 1, specialInstructions: "加辣" },
          { itemId: "mongolian-beef-special", sizeId: "individual", modifierIds: ["rice-steamed"], quantity: 2 },
          { itemId: "mandarin-special", sizeId: "party-tray", modifierIds: [], quantity: 1 },
        ],
      }),
    });
    return (await res.json()).order;
  });

const printQueue = (page) =>
  page.evaluate(
    async ({ PRINT, STORE_MAC }) => {
      for (let i = 0; i < 40; i++) {
        const poll = await (
          await fetch(PRINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ statusCode: "200 OK", printerMAC: STORE_MAC }),
          })
        ).json();
        if (!poll.jobReady) return;
        const token = encodeURIComponent(poll.jobToken);
        await (await fetch(`${PRINT}?token=${token}&mac=${encodeURIComponent(STORE_MAC)}&type=application/vnd.star.starprnt`)).arrayBuffer();
        await fetch(`${PRINT}?token=${token}&mac=${encodeURIComponent(STORE_MAC)}&code=OK`, { method: "DELETE" });
      }
    },
    { PRINT, STORE_MAC },
  );

async function tapDish(page, id, portion = "individual") {
  const tile = page.locator(`button[data-item="${id}"]:visible`).first();
  const portions = await tile.getAttribute("data-portions");
  await tile.click();
  if (portions !== null) await page.locator(`[data-sheet="portion"] [data-portion="${portion}"]`).click();
}
async function showTicket(page) {
  const open = page.locator('[data-action="open-ticket"]');
  if (await open.isVisible()) await open.click();
}
const rest = async (page) => {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(400);
};
const shot = (page, name, w, h) => page.screenshot({ path: join(here, `app-${name}-${w}x${h}.png`) });

for (const [w, h] of [
  [1024, 768],
  [768, 1024],
]) {
  const { ctx, page } = await session(w, h);
  const order = await placeOrder(page);
  await printQueue(page);

  await page.goto(`${BASE}/kitchen`);
  const card = page.locator(`article[data-order-id="${order.id}"]`);
  await card.waitFor();
  await card.locator('[data-action="edit-order"]').scrollIntoViewIfNeeded();
  await rest(page);
  await shot(page, "1-board-edit-button", w, h);

  await card.locator('[data-action="edit-order"]').click();
  await page.locator("[data-edit-head]").first().waitFor({ state: "attached" });
  await showTicket(page);
  await rest(page);
  await shot(page, "2-pos-no-changes", w, h);

  if (w < h) await page.locator('[data-action="close-ticket"]:visible').click({ timeout: 1000 }).catch(() => {});
  await tapDish(page, "egg-rolls");
  await showTicket(page);
  await page.locator("[data-ticket] [data-line]").nth(1).locator('[data-step="plus"]').click();
  await rest(page);
  await shot(page, "3-pos-editing", w, h);

  await page.locator('[data-ticket] [data-action="print"]').click();
  await page.locator('[data-sheet="edit-confirm"] [data-block]').first().waitFor();
  await rest(page);
  await shot(page, "4-confirm-diff", w, h);

  await page.locator('[data-action="confirm-edit"]').click();
  await page.waitForURL(/\/kitchen$/);
  await printQueue(page);
  await page.goto(`${BASE}/kitchen/history`);
  await page.locator("li > button[aria-expanded]", { hasText: order.orderNumber }).first().click();
  const past = page.locator(`article[data-order-id="${order.id}"]`);
  await past.waitFor();
  await past.locator('[data-action="toggle-revisions"]').click();
  await past.locator("[data-revision-entry]").first().waitFor();
  await past.locator("[data-revisions]").scrollIntoViewIfNeeded();
  await rest(page);
  await shot(page, "5-history-revisions", w, h);

  await ctx.close();
}

await browser.close();
console.log("app screenshots written to", here);
