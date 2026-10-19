import { expect, test, type Page } from "@playwright/test";
import { HERO_MEDIA_ORIGIN, HERO_POSTER } from "../../src/lib/heroMedia";

/**
 * Save-Data keeps the hero on its poster and never asks for the footage.
 *
 * Chrome reports data-saver mode as `navigator.connection.saveData` (and a
 * `Save-Data: on` request header, which this site does not read). The
 * override below is installed before any page script runs, so HeroVideo's
 * mount check sees it exactly as it would on a phone in data-saver mode.
 *
 * The second test is the control: same page, Save-Data off, and the
 * footage IS requested. Without it the first test would also pass on a
 * build where the video never loads for anyone.
 */

// Long enough for the ~1s intro, hydration and HeroVideo's mount effect.
const SETTLE_MS = 3000;

async function openHome(page: Page, saveData: boolean) {
  const mediaRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().startsWith(HERO_MEDIA_ORIGIN)) mediaRequests.push(req.url());
  });
  if (saveData) {
    await page.setExtraHTTPHeaders({ "Save-Data": "on" });
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "connection", {
        configurable: true,
        get: () => ({ saveData: true, effectiveType: "4g" }),
      });
    });
  }
  const poster = page.waitForResponse((res) => res.url().endsWith(HERO_POSTER));
  await page.goto("/");
  expect((await poster).ok()).toBe(true);
  await page.waitForTimeout(SETTLE_MS);
  return mediaRequests;
}

test("Save-Data: poster shows, no video element, no video request", async ({ page }) => {
  const mediaRequests = await openHome(page, true);

  const background = await page
    .locator(".hero-kenburns")
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(background).toContain(HERO_POSTER);
  await expect(page.locator(".hero-kenburns")).toBeVisible();

  await expect(page.locator("[data-hero] video")).toHaveCount(0);
  expect(mediaRequests).toEqual([]);
});

test("control: without Save-Data the footage is requested", async ({ page }) => {
  const mediaRequests = await openHome(page, false);
  expect(mediaRequests.length).toBeGreaterThan(0);
});
