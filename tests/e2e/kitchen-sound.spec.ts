import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_DB_PORT, E2E_KITCHEN_PASSWORD } from "./env";

/**
 * Sound on a staff tablet: the one-time "Enable sound" prompt, the choice kept
 * on the device, the state in the ⋯ menu, and the chime actually reaching the
 * speaker afterwards, including after the tablet suspends the audio context.
 *
 * Runs in Chrome (kitchen-tablet) and in WebKit with an iPad Pro's viewport,
 * user agent and touch (kitchen-ipad), which is Safari's engine. A headless
 * browser has no speaker, so "plays" is measured as the page's own
 * AudioContext being RUNNING and the chime's oscillators being scheduled on
 * it: an init script records every context the page makes and every
 * oscillator started. That is what a muted or suspended context does not do.
 */

const TENANT = "new-mandarin-canton";

declare global {
  interface Window {
    __audio: { contexts: AudioContext[]; oscillators: number };
  }
}

/** Record what the page does with Web Audio, before any page script runs. */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__audio = { contexts: [], oscillators: 0 };
    const w = window as unknown as Record<string, typeof AudioContext | undefined>;
    for (const name of ["AudioContext", "webkitAudioContext"]) {
      const Original = w[name];
      if (!Original) continue;
      const Wrapped = function (this: AudioContext, ...args: unknown[]) {
        const ctx = new (Original as unknown as new (...a: unknown[]) => AudioContext)(...args);
        window.__audio.contexts.push(ctx);
        const create = ctx.createOscillator.bind(ctx);
        ctx.createOscillator = () => {
          const osc = create();
          const start = osc.start.bind(osc);
          osc.start = (when?: number) => {
            window.__audio.oscillators++;
            start(when);
          };
          return osc;
        };
        return ctx;
      } as unknown as typeof AudioContext;
      Wrapped.prototype = Original.prototype;
      w[name] = Wrapped;
    }
  });
}

const audio = (page: Page) =>
  page.evaluate(() => ({
    contexts: window.__audio.contexts.length,
    state: window.__audio.contexts[0]?.state ?? null,
    oscillators: window.__audio.oscillators,
  }));

async function signIn(page: Page): Promise<void> {
  await page.goto("/kitchen");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.getByRole("navigation", { name: "廚房選單" })).toBeVisible();
}

const prompt = (page: Page) => page.getByRole("region", { name: "開啟這部平板的提示音？" });

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "更多" }).click();
  return page.getByRole("menuitemcheckbox", { name: /聲音/ });
}

test("first visit asks once; Enable sound unlocks audio and plays the chime", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await instrument(page);
  await signIn(page);

  await expect(prompt(page)).toBeVisible();
  const before = await audio(page);
  expect(before.oscillators).toBe(0);

  await prompt(page).getByRole("button", { name: "開啟聲音" }).click();
  await expect(prompt(page)).toHaveCount(0);
  await expect.poll(async () => (await audio(page)).state).toBe("running");
  // The confirmation chime: three notes, on a running context.
  await expect.poll(async () => (await audio(page)).oscillators).toBe(3);
  expect(await page.evaluate(() => localStorage.getItem("nmc-kitchen-sound"))).toBe("on");

  // The menu says so.
  const item = await openMenu(page);
  await expect(item).toHaveAttribute("aria-checked", "true");
  await expect(item).toContainText("開");
  await page.keyboard.press("Escape");

  // Every staff page, and a reload: never asked again.
  for (const path of ["/kitchen/pos", "/kitchen/history", "/kitchen"]) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "廚房選單" })).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  }
  await context.close();
});

test("a suspended context resumes on the next tap, and an online order chimes", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await instrument(page);
  await signIn(page);
  await prompt(page).getByRole("button", { name: "開啟聲音" }).click();
  await expect.poll(async () => (await audio(page)).state).toBe("running");

  // The iPad slept: Safari suspends the context.
  await page.evaluate(() => window.__audio.contexts[0].suspend());
  await expect.poll(async () => (await audio(page)).state).toBe("suspended");
  // Any tap on the page brings it back.
  await page.mouse.click(4, 4);
  await expect.poll(async () => (await audio(page)).state).toBe("running");

  // A new online order arrives while the board is open.
  const chimesBefore = (await audio(page)).oscillators;
  const db = new Client({ host: "localhost", port: E2E_DB_PORT, user: "postgres", password: "postgres", database: "nmc_e2e" });
  await db.connect();
  try {
    await db.query(
      `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
                           customer, phone_verified_at, pickup_at, channel, print_station)
       values ($1, 'A-777', (now() at time zone 'America/Los_Angeles')::date, 'QUEUED', $2,
               '[]', '{"subtotalCents":0,"taxCents":0,"tipCents":0,"totalCents":0}',
               '{"name":"Sound Test","phone":"+16195550177"}', now(), now() + interval '20 minutes', 'web', 'online')`,
      [TENANT, `e2e-sound-${Date.now()}`],
    );
    await expect.poll(async () => (await audio(page)).oscillators, { timeout: 15_000 }).toBe(chimesBefore + 3);
    expect((await audio(page)).state).toBe("running");
  } finally {
    await db.query(`delete from orders where tenant_id = $1 and order_number = 'A-777'`, [TENANT]);
    await db.end();
    await context.close();
  }
});

test("Not now is remembered, silent, and shown as off in the menu", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await instrument(page);
  await signIn(page);

  await prompt(page).getByRole("button", { name: "暫時不用" }).click();
  await expect(prompt(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("nmc-kitchen-sound"))).toBe("off");
  expect((await audio(page)).oscillators).toBe(0);

  await page.reload();
  await expect(page.getByRole("navigation", { name: "廚房選單" })).toBeVisible();
  await expect(prompt(page)).toHaveCount(0);
  const item = await openMenu(page);
  await expect(item).toHaveAttribute("aria-checked", "false");
  await expect(item).toContainText("關");

  // Turning it on from the menu is a tap too, so it unlocks audio as well.
  await item.click();
  await expect(item).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await audio(page)).state).toBe("running");
  await context.close();
});
