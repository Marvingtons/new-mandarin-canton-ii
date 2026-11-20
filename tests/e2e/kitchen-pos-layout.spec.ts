import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";

/**
 * The 2026-11-20 POS and ticket changes:
 *
 *   TICKET     no KITCHEN / REGISTER bands; a "$" badge on the register copy
 *   CUSTOM     自訂 Custom lines and 加價 surcharges, priced on both copies
 *              the way a dish is (the kitchen copy shows no money)
 *   LANDSCAPE  1000px and wider: a chip row over four or five columns of
 *              square-ish tiles, the ticket a 340px column
 *   PORTRAIT   under 1000px: the rail, two columns, the ticket a bottom sheet
 *   BOTH       no sideways page scroll, no target under 44px
 *
 * The copies are read through the staff ticket route's text format (what
 * each copy lays out, and what it printed in money), not from pixels.
 */

const LANDSCAPE = { width: 1024, height: 768 };
const PORTRAIT = { width: 768, height: 1024 };
const WIDE = { width: 1366, height: 1024 };

const MONGOLIAN = 'button[data-item="mongolian-beef"]:not([data-asks])';

async function openPos(browser: Browser, viewport = LANDSCAPE): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await enableTestMode(page);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator('[data-action="print"]:visible, [data-action="bar-print"]:visible')).toBeVisible();
  return page;
}

const linesOf = (page: Page) => page.locator("[data-ticket] [data-line]");

/** A walk-in needs no phone, so Print is ready as soon as there is a line. */
async function walkIn(page: Page): Promise<void> {
  await page.locator('[data-context="takeout"]').click();
  await page.locator('[data-channel="walk_in"]').click();
  await page.locator('[data-action="details-done"]').click();
}

/** Print, and return the stored order the POS just sent. */
async function printAndFetch(page: Page) {
  await page.locator('[data-action="print"]').click();
  const sent = page.locator('[data-ticket] [role="status"]').filter({ hasText: /\w-\d{3}/ });
  await expect(sent).toBeVisible();
  const number = (await sent.locator("span").nth(0).textContent())?.trim() ?? "";
  const orders = await page.evaluate(async () => {
    const res = await fetch("/api/kitchen/orders", { cache: "no-store" });
    return ((await res.json()) as { orders: { id: number; orderNumber: string; items: unknown[] }[] }).orders;
  });
  const order = orders.find((o) => o.orderNumber === number);
  expect(order, `order ${number} on the board`).toBeTruthy();
  return order as { id: number; orderNumber: string; items: Record<string, unknown>[] };
}

type CopyText = { lines: string[]; money: { role: string; lineCents: number[]; totals: unknown } };
async function copyText(page: Page, id: number, copy: "kitchen" | "register"): Promise<CopyText> {
  return page.evaluate(
    async ([orderId, which]) => {
      const res = await fetch(`/api/kitchen/orders/${orderId}/ticket?copy=${which}&format=text`, { cache: "no-store" });
      return res.json();
    },
    [id, copy] as const,
  );
}

/* ------------------------------------------------------------- custom -- */

test("a custom charge prints on both copies, priced only on the register copy", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator("button[data-custom-tile]").first().click();
  const sheet = page.locator('[data-sheet="custom"]');
  await expect(sheet).toBeVisible();
  await sheet.locator('[data-preset="extra-shrimp"]').click();
  for (const k of ["3", "0", "0"]) await sheet.locator(`[data-key="${k}"]`).click();
  await expect(sheet.locator("[data-amount-pad] output")).toHaveText("$3.00");
  await sheet.getByRole("button", { name: "增加" }).click();
  await expect(sheet.locator('[data-action="sheet-add"]')).toContainText("$6.00");
  await sheet.locator('[data-action="sheet-add"]').click();
  await expect(sheet).toHaveCount(0);

  await expect(linesOf(page)).toHaveCount(1);
  const line = linesOf(page).first();
  await expect(line).toHaveAttribute("data-custom", "true");
  await expect(line).toContainText("加蝦");
  await expect(line).toContainText("$6.00");

  await walkIn(page);
  const order = await printAndFetch(page);
  expect(order.items[0]).toMatchObject({ custom: true, itemId: "custom", nameZh: "加蝦", nameEn: "Extra shrimp", unitCents: 300, lineCents: 600 });

  const kitchen = await copyText(page, order.id, "kitchen");
  const register = await copyText(page, order.id, "register");
  expect(kitchen.lines).toContain("Extra shrimp");
  expect(register.lines).toContain("Extra shrimp");
  expect(kitchen.money.lineCents).toEqual([]);
  expect(kitchen.money.totals).toBeNull();
  expect(kitchen.lines).not.toContain("$6.00");
  expect(register.money.lineCents).toEqual([600]);
  expect(register.lines).toContain("$6.00");

  // The name it used is the one the next custom line opens on.
  await page.locator("button[data-custom-tile]").first().click();
  await expect(page.locator('[data-field="custom-name"]')).toHaveValue("加蝦 Extra shrimp");
  await page.context().close();
});

test("a custom charge is reachable by searching for it", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator("body").press("/");
  await page.getByRole("textbox", { name: "搜尋菜名或編號" }).fill("custom");
  await expect(page.locator("[data-pos-screen] button[data-custom-tile]")).toHaveCount(1);
  await page.locator("button[data-custom-tile]").click();
  await expect(page.locator('[data-sheet="custom"]')).toBeVisible();
  await page.context().close();
});

test("a surcharge on a dish keeps it one line, on the ticket and on paper", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator(MONGOLIAN).first().click();
  await expect(linesOf(page)).toHaveCount(1);
  await linesOf(page).first().locator("button[aria-haspopup]").click();

  const sheet = page.getByRole("dialog");
  await sheet.locator('[data-section="charge"] button[aria-expanded]').click();
  await sheet.locator('[data-charge] [data-preset="extra-meat"]').click();
  for (const k of ["2", "5", "0"]) await sheet.locator(`[data-charge] [data-key="${k}"]`).click();
  await sheet.getByRole("button", { name: /更新單據/ }).click();
  await expect(sheet).toHaveCount(0);

  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first()).toContainText("+$2.50");

  await walkIn(page);
  const order = await printAndFetch(page);
  expect(order.items).toHaveLength(1);
  const modifiers = order.items[0].modifiers as { id: string; priceCents: number }[];
  expect(modifiers.filter((m) => m.id === "surcharge")).toEqual([expect.objectContaining({ priceCents: 250 })]);

  const kitchen = await copyText(page, order.id, "kitchen");
  const register = await copyText(page, order.id, "register");
  expect(register.lines.some((l) => l.includes("Extra meat +$2.50"))).toBe(true);
  expect(kitchen.lines.some((l) => l.includes("Extra meat"))).toBe(true);
  expect(kitchen.lines.some((l) => l.includes("+$2.50"))).toBe(false);
  expect(register.money.lineCents).toHaveLength(1);
  await page.context().close();
});

/* ------------------------------------------------------------- ticket -- */

test("the $ badge is on the register copy only, and neither copy has a role band", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator(MONGOLIAN).first().click();
  await walkIn(page);
  const order = await printAndFetch(page);
  const kitchen = await copyText(page, order.id, "kitchen");
  const register = await copyText(page, order.id, "register");
  expect(register.lines).toContain("$");
  expect(kitchen.lines).not.toContain("$");
  for (const copy of [kitchen, register]) {
    expect(copy.lines.join(" ")).not.toMatch(/KITCHEN|REGISTER|廚房|收銀/);
  }
  // The register copy is still the one with the money.
  expect(register.lines.join(" ")).toContain("COLLECT PAYMENT");
  expect(kitchen.lines.join(" ")).not.toContain("COLLECT PAYMENT");
  await page.context().close();
});

/* ---------------------------------------------------------- landscape -- */

test("landscape 1024x768: eight or more whole tiles without scrolling, and the chip row follows the grid", async ({ browser }) => {
  const page = await openPos(browser, LANDSCAPE);
  const whole = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>("[data-pos-screen] section[aria-label]")!;
    const bottom = Math.min(innerHeight, pane.getBoundingClientRect().bottom);
    return [...document.querySelectorAll<HTMLElement>("[data-pos-screen] [data-tile]")].filter((t) => {
      const r = t.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= bottom + 0.5 && r.right <= innerWidth;
    }).length;
  });
  expect(whole).toBeGreaterThanOrEqual(8);

  // Four columns at 1024.
  const columns = await page.locator("[data-cat] > div").first().evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(4);

  // The chips are one row.
  const chipTops = await page.locator("[data-cat-link]").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
  expect(chipTops).toHaveLength(1);

  // Scroll the dishes to the last category: its chip is current and the
  // row has scrolled to show it.
  const rail = page.getByRole("navigation", { name: "分類" });
  const lastCat = await page.locator("[data-cat]").last().getAttribute("data-cat");
  await page.locator("[data-pos-screen] section[aria-label]").first().evaluate((pane) => pane.scrollTo({ top: pane.scrollHeight }));
  await expect(page.locator(`[data-cat-link="${lastCat}"]`)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => rail.evaluate((r) => r.scrollLeft)).toBeGreaterThan(0);
  await expect(page.locator(`[data-cat-link="${lastCat}"]`)).toBeInViewport();

  // And the other way: a chip scrolls the dishes to its category.
  await page.locator('[data-cat-link="specials"]').click();
  await expect(page.locator('[data-cat="specials"] h2')).toBeInViewport();
  await expect(page.locator('[data-cat-link="specials"]')).toHaveAttribute("aria-current", "true");
  await page.context().close();
});

test("landscape 1366x1024: five columns, ticket column 340px", async ({ browser }) => {
  const page = await openPos(browser, WIDE);
  const columns = await page.locator("[data-cat] > div").first().evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(5);
  const box = await page.locator("[data-ticket]").boundingBox();
  expect(Math.round(box!.width)).toBe(340);
  await page.context().close();
});

/* ----------------------------------------------------------- portrait -- */

test("portrait: the ticket is a bar that opens into a sheet and closes again", async ({ browser }) => {
  const page = await openPos(browser, PORTRAIT);
  const bar = page.locator("[data-ticket-bar]");
  const ticket = page.locator("[data-ticket]");
  await expect(bar).toBeVisible();
  await expect(ticket).toBeHidden();

  // The rail is still a column, 中文 only, and the dishes two across.
  const railEn = page.locator("[data-cat-link] [lang=en]").first();
  await expect(railEn).toBeHidden();
  const columns = await page.locator("[data-cat] > div").first().evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(2);

  await page.locator(MONGOLIAN).first().click();
  await expect(bar.locator("[data-bar-total]")).not.toHaveText("$0.00");
  const total = await bar.locator("[data-bar-total]").textContent();

  await page.locator('[data-action="open-ticket"]').click();
  await expect(ticket).toBeVisible();
  await expect(ticket).toHaveAttribute("role", "dialog");
  await expect(linesOf(page)).toHaveCount(1);
  await expect(ticket).toContainText(total ?? "");
  await expect(page.locator('[data-action="close-ticket"]')).toBeFocused();

  // Tab stays inside the sheet.
  for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
  expect(await ticket.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  await page.locator('[data-action="close-ticket"]').click();
  await expect(ticket).toBeHidden();
  await expect(bar.locator("[data-bar-total]")).toHaveText(total ?? "");

  // Escape closes it too.
  await page.locator('[data-action="open-ticket"]').click();
  await expect(ticket).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ticket).toBeHidden();
  await page.context().close();
});

/* --------------------------------------------------------------- both -- */

for (const viewport of [PORTRAIT, { width: 820, height: 1180 }, LANDSCAPE, { width: 1180, height: 820 }, WIDE]) {
  test(`no sideways page scroll and no target under 44px at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const page = await openPos(browser, viewport);
    await page.locator(MONGOLIAN).first().click();
    const sideways = await page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>("[data-kitchen-surface]")!;
      const doc = document.scrollingElement as HTMLElement;
      window.scrollTo(200, 0);
      surface.scrollLeft = 200;
      return {
        page: doc.scrollWidth - doc.clientWidth,
        surface: surface.scrollWidth - surface.clientWidth,
        scrolled: window.scrollX + surface.scrollLeft,
      };
    });
    expect(sideways).toEqual({ page: 0, surface: 0, scrolled: 0 });

    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        "[data-kitchen-surface] :is(button, input, select, textarea, a[href], output[tabindex])",
      )) {
        if (el.closest('[aria-hidden="true"]') || el.tabIndex < 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
        if (r.width < 43.5 || r.height < 43.5) {
          out.push(`${el.tagName} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return out;
    });
    expect(small).toEqual([]);
    await page.context().close();
  });
}
