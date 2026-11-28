import { expect, test, type Page } from "@playwright/test";
import { E2E_CANCEL_PIN, E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";

/**
 * 取消 Cancel on the board asks for the manager PIN on a keypad. A wrong PIN
 * shakes and says 密碼錯誤 Wrong PIN, the dialog stays open and the order
 * stays; the right one cancels; Undo brings it back with no PIN. The keypad
 * keys are 44px or more, and the PIN is never in the page.
 */

async function signIn(page: Page): Promise<void> {
  await enableTestMode(page);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator('[data-action="print"]')).toBeVisible();
}

async function placeOrder(page: Page): Promise<{ id: number; orderNumber: string }> {
  const body = await page.evaluate(async () => {
    const res = await fetch("/api/kitchen/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "phone",
        customer: { phone: "6195550199" },
        pickup: { time: "asap" },
        idempotencyKey: `cancel-pin-${Date.now()}-${Math.random()}`,
        lines: [{ itemId: "egg-rolls", sizeId: "regular", modifierIds: [], quantity: 1 }],
      }),
    });
    return res.json();
  });
  expect(body.ok, JSON.stringify(body)).toBe(true);
  return body.order;
}

async function typePin(page: Page, pin: string): Promise<void> {
  for (const d of pin) await page.locator(`[data-cancel-pin] [data-pin-key="${d}"]`).click();
}

test("cancel asks for the manager PIN: wrong shakes, right cancels, undo needs none", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await signIn(page);
  const order = await placeOrder(page);
  await page.goto("/kitchen");
  const card = page.locator(`article[data-order-id="${order.id}"]`);
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: /^取消/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const pad = dialog.locator("[data-cancel-pin]");
  await expect(pad.locator("[data-pin-key]")).toHaveCount(12);
  for (const key of await pad.locator("[data-pin-key]").all()) {
    const box = (await key.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  const confirm = dialog.locator('[data-action="confirm-cancel"]');
  await expect(confirm).toBeDisabled();

  // Wrong PIN: shakes, 密碼錯誤 Wrong PIN, nothing cancelled, the dialog stays.
  await typePin(page, "0000");
  await expect(pad.locator("[data-pin-length]")).toHaveAttribute("data-pin-length", "4");
  await expect(pad.locator("[data-pin-length]")).not.toContainText("0000");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog.locator("[data-pin-error]")).toHaveAttribute("data-pin-error", "wrong");
  await expect(dialog).toContainText("密碼錯誤 Wrong PIN");
  await expect(pad.locator("output")).toHaveClass(/staff-shake/);
  await expect(pad.locator("[data-pin-length]")).toHaveAttribute("data-pin-length", "0");
  await expect(dialog).toBeVisible();
  await expect(card).toBeVisible();

  // The PIN is nowhere in what the browser was sent.
  expect(await page.content()).not.toContain(E2E_CANCEL_PIN);

  // Right PIN: cancelled, the dialog closes, the card leaves the board.
  const answered = page.waitForResponse((r) => r.url().endsWith(`/api/kitchen/orders/${order.id}`) && r.request().method() === "POST");
  await typePin(page, E2E_CANCEL_PIN);
  await confirm.click();
  expect((await answered).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("section article").filter({ has: page.getByRole("heading", { name: order.orderNumber }) })).toHaveCount(0);

  // Undo from Recently done: no PIN asked.
  const recent = page.locator("details").filter({ has: page.locator("summary", { hasText: "Recently done" }) });
  await recent.locator("summary").click();
  const undo = page.waitForResponse((r) => r.url().endsWith(`/api/kitchen/orders/${order.id}`) && r.request().method() === "POST");
  await recent.locator(`article[data-order-id="${order.id}"]`).getByRole("button", { name: "Undo / 復原 / Deshacer" }).click();
  expect((await undo).status()).toBe(200);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("section article").filter({ has: page.getByRole("heading", { name: order.orderNumber }) })).toBeVisible();

  await context.close();
});
