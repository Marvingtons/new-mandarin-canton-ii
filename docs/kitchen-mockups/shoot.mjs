// Screenshots every mockup state at every size and runs the quality-bar checks.
//   node docs/kitchen-mockups/shoot.mjs
// Writes PNGs to docs/kitchen-mockups/shots/ and prints one QA line per shot.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "shots");
mkdirSync(out, { recursive: true });

const SCREENS = [
  ["order-empty", "order.html?state=empty"],
  ["order-6-items", "order.html?state=full"],
  ["floor-plan", "floor.html"],
  ["floor-table-details", "floor.html?view=details"],
  ["guest-count", "floor.html?view=guests"],
];
const SIZES = [
  ["landscape", 1376, 1032, false],
  ["portrait", 1032, 1376, false],
  ["landscape-big", 1376, 1032, true],
  ["portrait-big", 1032, 1376, true],
];

// Runs in the page. Returns problems, not passes.
function qa() {
  const problems = [];
  const vw = innerWidth, vh = innerHeight;
  if (document.documentElement.scrollWidth > vw) problems.push(`page scrolls horizontally (${document.documentElement.scrollWidth}px)`);

  const lum = (c) => {
    const m = c.match(/[\d.]+/g).map(Number);
    const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      const a = c.match(/[\d.]+/g);
      if (a && (a.length === 3 || Number(a[3]) > 0.5)) return c;
    }
    return "rgb(245,241,234)";
  };
  const text = [...document.querySelectorAll("body *")].filter((e) =>
    [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length);
  let minC = 99, minAt = "";
  for (const e of text) {
    const r = e.getBoundingClientRect();
    const clip = e.closest(".scroll");
    if (!clip && (r.right > vw + 0.5 || r.left < -0.5 || r.bottom > vh + 0.5)) problems.push(`off-screen: "${e.textContent.trim().slice(0, 30)}"`);
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflow;
      if (o !== "visible" && !p.classList.contains("scroll")) {
        const pr = p.getBoundingClientRect();
        if (r.right > pr.right + 1 && getComputedStyle(e).textOverflow !== "ellipsis" && getComputedStyle(p).textOverflow !== "ellipsis") problems.push(`clipped: "${e.textContent.trim().slice(0, 30)}"`);
        break;
      }
    }
    if (e.closest(".scrim") === null && document.querySelector(".scrim")) continue; // under the scrim: no contrast check
    const L1 = lum(getComputedStyle(e).color), L2 = lum(bgOf(e));
    const c = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (c < minC) { minC = c; minAt = e.textContent.trim().slice(0, 24); }
  }
  if (minC < 7) problems.push(`lowest text contrast ${minC.toFixed(2)} at "${minAt}"`);

  // Truncation (ellipsis) and unexpected wraps
  const trunc = [];
  for (const e of document.querySelectorAll(".one, .t-ctx .ctx")) if (e.scrollWidth > e.clientWidth + 1) trunc.push(e.textContent.trim().slice(0, 28));
  for (const e of document.querySelectorAll(".btn, .seg button, .rail button, .bar button, .open .m, .total, .sums span, .tbl .st > span")) {
    const lh = parseFloat(getComputedStyle(e).lineHeight) || 24;
    for (const c of e.querySelectorAll(":scope > span, :scope")) {
      if (c.children.length > 1 && c === e) continue;
      const rects = c.getClientRects();
      if (c !== e && rects.length > 1) problems.push(`wraps: "${c.textContent.trim().slice(0, 30)}"`);
    }
    if (e.scrollWidth > e.clientWidth + 1) problems.push(`overflows: "${e.textContent.trim().slice(0, 30)}"`);
  }
  for (const e of document.querySelectorAll(".tile .zh, .tile .en")) if (e.scrollHeight > e.clientHeight + 1) trunc.push("(clamped) " + e.textContent.slice(0, 24));

  for (const e of document.querySelectorAll(".open, .line, .tile, .t-head, .t-foot, .list")) {
    const pr = e.getBoundingClientRect();
    for (const c of e.querySelectorAll("*")) {
      const r = c.getBoundingClientRect();
      if (r.width && r.right > pr.right + 1) { problems.push(`spills out of .${e.className.split(" ")[0]}: "${c.textContent.trim().slice(0, 24)}"`); break; }
    }
  }
  // Button styles
  const styles = {};
  for (const b of document.querySelectorAll("button")) {
    const s = b.classList.contains("btn-primary") ? "primary"
      : b.classList.contains("btn-secondary") || b.closest(".bar") ? "secondary"
      : b.classList.contains("btn-quiet") || b.closest(".rail, .seg") || b.classList.contains("open") ? "quiet"
      : b.classList.contains("print") ? "disabled"
      : b.classList.contains("tbl") ? "table" : b.classList.contains("tile") ? "tile" : "UNSTYLED";
    styles[s] = (styles[s] || 0) + 1;
  }
  if (styles.UNSTYLED) problems.push(`${styles.UNSTYLED} unstyled buttons`);
  // Top bar controls all 56
  const hs = [...document.querySelectorAll(".top .btn, .top .seg")].map((e) => Math.round(e.getBoundingClientRect().height));
  if (new Set(hs).size > 1) problems.push(`top bar heights differ: ${hs}`);
  return { problems, trunc, styles, minContrast: Number(minC.toFixed(2)) };
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
for (const [size, w, h, big] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  for (const [name, path] of SCREENS) {
    const url = pathToFileURL(join(here, path.split("?")[0])).href + "?" + (path.split("?")[1] ?? "") + (big ? "&big=1" : "");
    await page.goto(url);
    await page.waitForTimeout(150);
    const file = `${name}--${size}.png`;
    await page.screenshot({ path: join(out, file) });
    const r = await page.evaluate(qa);
    console.log(`${file.padEnd(44)} contrast≥${r.minContrast} buttons=${JSON.stringify(r.styles)}`);
    for (const p of r.problems) console.log("   ✗ " + p);
    if (r.trunc.length) console.log("   … truncated: " + r.trunc.join(" | "));
  }
  await page.close();
}
await browser.close();
