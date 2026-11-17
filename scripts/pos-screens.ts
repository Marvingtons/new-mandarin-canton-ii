/**
 * The POS review screenshots, upright on an iPad: 13" (1032x1376) and 11"
 * (834x1194). Four per size: 常點 Popular, 套餐 Sets, the open ticket sheet
 * with six lines, and a ticket with the customer set.
 *
 *   npm run build
 *   npx tsx scripts/e2e-server.ts        # the throwaway server, in another tab
 *   npx tsx scripts/pos-screens.ts [outDir]
 *
 * (Or E2E_NEXT_MODE=dev for `next dev`; E2E_PORT picks the port.)
 *
 * Runs against the e2e server only (test password, throwaway database). Both
 * printer stations check in with the test print secret first, so the shots
 * show the printers up. The clock is pinned to 12:30 in the store's zone so
 * the lunch sets are open.
 *
 * Every shot is also MEASURED, and the script fails if any check does: no
 * horizontal scroll, the header 64px, the nine tabs in one row with no label
 * clipped, three cards a row, the bar 88px, and the open sheet (with the bar)
 * at most 70% of the screen.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD, E2E_PORT } from "../tests/e2e/env";

const BASE = `http://localhost:${E2E_PORT}`;
const OUT = process.argv[2] ?? join(process.cwd(), "docs", "pos-portrait");
const PRINT_SECRET = "e2e-print-secret-not-a-printer";
const MACS = ["00:11:62:00:00:0A", "00:11:62:00:00:0B"];

async function pollPrinters(): Promise<void> {
  for (const printerMAC of MACS) {
    await fetch(`${BASE}/api/print/${PRINT_SECRET}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ printerMAC, statusCode: "200%20OK", printingInProgress: false }),
    }).catch(() => undefined);
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE}/kitchen/pos`);
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await page.locator("[data-ticket-bar]").waitFor();
}

/** A card in 常點 Popular. */
const popular = (page: Page, id: string) => page.locator(`[data-tile-key="popular:${id}"] button[data-item]`);

/** Six lines, as a phone order would build them. */
async function sixLines(page: Page): Promise<void> {
  // Wings come with rice: the picker opens on the card; 炒飯.
  await popular(page, "salted-pepper-chicken-wings-special").click();
  await page.locator('[data-rice-pop] button[data-rice="fried"]').click();
  // Egg rolls: no rice, straight on.
  await popular(page, "egg-rolls").click();
  await popular(page, "egg-rolls").click();
  // Mongolian beef, tapped twice: 白飯.
  await popular(page, "mongolian-beef-special").click();
  await popular(page, "mongolian-beef-special").click();
  // Beef with broccoli as a tray, from its 餐盤 pill.
  await page.locator('[data-tile-key="popular:beef-broccoli"] button[data-tray]').click();
  await popular(page, "house-soft-noodle").click();
  // Honey walnut shrimp, no rice.
  await popular(page, "honey-walnut-shrimp").click();
  await page.locator('[data-rice-pop] button[data-rice="none"]').click();
  await page.waitForTimeout(1000); // the flashes settle
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function measure(page: Page, sheetOpen: boolean): Promise<Check[]> {
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    // The staff header (the page also carries the website's own <header>).
    const header = document.querySelector("[data-header-slot]")!.closest("header")!.getBoundingClientRect();
    const tabs = [...document.querySelectorAll<HTMLElement>("[data-cat-link]")];
    const tabTops = new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top)));
    const clipped = tabs
      .flatMap((t) => [...t.querySelectorAll<HTMLElement>("span")])
      .filter((s) => s.scrollWidth > s.clientWidth + 1)
      .map((s) => s.textContent);
    const nav = tabs[0]?.parentElement;
    const firstGrid = document.querySelector<HTMLElement>("[data-cat] [data-tile-key]")?.parentElement;
    const cols = firstGrid ? getComputedStyle(firstGrid).gridTemplateColumns.split(" ").length : 0;
    const tile = document.querySelector<HTMLElement>("[data-tile-key]")!.getBoundingClientRect();
    const bar = document.querySelector<HTMLElement>("[data-ticket-bar]")!.getBoundingClientRect();
    const sheet = document.querySelector<HTMLElement>("[data-ticket]")!.getBoundingClientRect();
    // Any element poking past the right edge of the screen.
    const past = [...document.querySelectorAll<HTMLElement>("[data-kitchen-surface] *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(el).visibility !== "hidden";
      })
      .slice(0, 3)
      .map((el) => el.className || el.tagName);
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      scrollW: doc.scrollWidth,
      header: Math.round(header.height),
      tabRows: tabTops.size,
      tabs: tabs.length,
      navOverflow: nav ? nav.scrollWidth - nav.clientWidth : 0,
      clipped,
      cols,
      tileH: Math.round(tile.height),
      bar: Math.round(bar.height),
      covered: Math.round(window.innerHeight - sheet.top),
      past,
    };
  });
  const checks: Check[] = [
    { name: "no horizontal scroll", ok: m.scrollW <= m.vw, detail: `scrollWidth ${m.scrollW} / ${m.vw}` },
    { name: "nothing past the right edge", ok: m.past.length === 0, detail: m.past.join(", ") || "none" },
    { name: "header 64px", ok: m.header === 64, detail: `${m.header}px` },
    { name: "9 tabs in one row", ok: m.tabs === 9 && m.tabRows === 1 && m.navOverflow <= 0, detail: `${m.tabs} tabs, ${m.tabRows} row(s), overflow ${m.navOverflow}` },
    { name: "no tab label clipped", ok: m.clipped.length === 0, detail: m.clipped.join(", ") || "none" },
    { name: "3 columns", ok: m.cols === 3, detail: `${m.cols}` },
    { name: "cards ~112px", ok: Math.abs(m.tileH - 112) <= 4, detail: `${m.tileH}px` },
    { name: "bar 88px", ok: m.bar === 88, detail: `${m.bar}px` },
  ];
  if (sheetOpen) {
    checks.push({ name: "sheet + bar ≤ 70%", ok: m.covered <= m.vh * 0.7 + 1, detail: `${m.covered}px of ${m.vh} (${Math.round((100 * m.covered) / m.vh)}%)` });
  }
  return checks;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  const timer = setInterval(() => void pollPrinters(), 3_000);
  await pollPrinters();
  let failed = 0;
  try {
    for (const viewport of [
      { width: 1032, height: 1376 },
      { width: 834, height: 1194 },
    ]) {
      const tag = `${viewport.width}x${viewport.height}`;
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 2,
        hasTouch: true,
        timezoneId: "America/Los_Angeles",
      });
      const page = await context.newPage();
      // Lunch is open: 12:30 on a Tuesday, store time.
      await page.clock.setFixedTime(new Date("2026-11-17T12:30:00-08:00"));
      await signIn(page);
      await page.waitForTimeout(1500);

      const shoot = async (name: string, sheetOpen = false) => {
        await page.mouse.move(0, 0);
        await page.screenshot({ path: join(OUT, `pos-${tag}-${name}.png`) });
        for (const c of await measure(page, sheetOpen)) {
          if (!c.ok) failed++;
          console.log(`${tag} ${name}: ${c.ok ? "ok  " : "FAIL"} ${c.name} (${c.detail})`);
        }
      };

      await shoot("1-popular");

      await page.locator('[data-cat-link="sets"]').click();
      await page.waitForTimeout(400);
      await shoot("2-sets");

      await page.locator('[data-cat-link="popular"]').click();
      await sixLines(page);
      await page.locator('[data-action="open-ticket"]').click();
      // A quick note on the wings.
      await page.locator("[data-line] button[aria-expanded]").first().click();
      await page.locator('[data-note="走辣 No spicy"]').click();
      await page.waitForTimeout(400);
      await shoot("3-ticket-sheet", true);

      // The customer set, sheet closed.
      await page.locator('[data-context="takeout"]').click();
      await page.getByRole("dialog").waitFor();
      await page.locator("dialog input").first().fill("Wong");
      await page.locator('dialog input[type="tel"]').fill("6195550142");
      await page.locator('[data-action="details-done"]').click();
      await page.locator('[data-action="close-ticket"]').click();
      await page.waitForTimeout(400);
      await shoot("4-customer-set");

      await context.close();
    }
  } finally {
    clearInterval(timer);
    await browser.close();
  }
  console.log(`written to ${OUT}`);
  if (failed > 0) {
    console.error(`${failed} check(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
