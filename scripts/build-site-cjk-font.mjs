/**
 * Builds the customer site's Chinese face: Noto Serif TC, cut down to the
 * characters this site actually prints.
 *
 *   npm run build:site-cjk-font -- --site http://localhost:3000 [--source <css>]
 *
 * WHY. next/font/google shipped Noto Serif TC as Google's full sliced set:
 * 216 @font-face rules (206 KB of CSS on every page, which is what
 * Lighthouse reported as "unused CSS") and, because Google slices by
 * frequency rather than by site, the 39 characters on the homepage landed in
 * 12 slices of ~95 KB each. That was 1.1 MB of font requested before first
 * paint for a seal, a footer line and three dish names.
 *
 * WHAT IT WRITES. src/app/fonts/cjk/*.woff2 and src/app/fonts/cjk.css. The
 * glyphs are split into GROUPS by where they render, each group its own
 * file with a unicode-range of exactly its characters, so a page downloads
 * only the groups it uses. The order below is the assignment order: a
 * character goes to the first group that shows it, so the header/footer
 * group (every page) is never downloaded twice under another name.
 *
 *   chrome   characters every page shows (header seal, footer)
 *   home, menu, about, contact, legal   each page's visible text
 *   rest     every other CJK character in the customer-facing source:
 *            client-only strings (item sheet, checkout, confirmation) that
 *            are not in any page's first HTML
 *
 * A character missing from every group (a dish name added later, say)
 * falls through to the system serif, not to a blank: rerun this after any
 * change to Chinese copy or dish names.
 *
 * SOURCE. --source is a Google Fonts CSS file for Noto Serif TC (wght
 * 500..700), local path or URL. Default is the Google Fonts API, which is
 * the same origin next/font fetched from on every build. Its url()s are
 * fetched or read relative to it, and only the slices that hold a needed
 * character are touched. The slices are a variable font, so each output
 * keeps the 500..700 weight axis: one file per group covers both weights.
 *
 * Staff screens are out of scope on purpose: they set Chinese in the
 * device's own sans (see the Geist note in app/layout.tsx).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import subsetFont from "subset-font";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "src/app/fonts/cjk");
const OUT_CSS = path.join(ROOT, "src/app/fonts/cjk.css");
const FAMILY = "Noto Serif TC Site";
const DEFAULT_SOURCE =
  "https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@500..700&display=swap";
// Google serves woff2 + unicode-range slices only to a browser it recognises.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/gu;

const PAGES = [
  ["home", "/"],
  ["menu", "/menu"],
  ["about", "/about"],
  ["contact", "/contact"],
  ["legal", "/privacy", "/terms"],
];

// Customer-facing source for the `rest` group. Everything under src except
// the staff app, the ticket renderer and server routes.
const EXCLUDE = [
  "src/app/[kitchenSlug]",
  "src/app/api",
  "src/components/kitchen",
  "src/lib/kitchen",
  "src/lib/ticket",
  "src/lib/print",
  "src/lib/otp",
  "src/lib/orders",
  "src/lib/notify",
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const site = arg("--site")?.replace(/\/+$/, "");
const source = arg("--source") ?? DEFAULT_SOURCE;
if (!site) {
  console.error(
    "Usage: npm run build:site-cjk-font -- --site <running site origin> [--source <css path or url>]",
  );
  process.exit(1);
}

const charsOf = (text) => new Set(text.match(CJK) ?? []);

/** Visible text of a page's HTML: no scripts, no styles, no tags. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ");
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    const rel = path.relative(ROOT, p);
    if (EXCLUDE.some((x) => rel === x || rel.startsWith(x + path.sep))) continue;
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

async function load(ref, base) {
  const resolved = base ? new URL(ref, base).href : ref;
  if (/^https?:/.test(resolved)) {
    const res = await fetch(resolved, { headers: { "user-agent": UA } });
    if (!res.ok) throw new Error(`${res.status} fetching ${resolved}`);
    return { buf: Buffer.from(await res.arrayBuffer()), href: resolved };
  }
  const file = resolved.startsWith("file:") ? fileURLToPath(resolved) : path.resolve(resolved);
  return { buf: fs.readFileSync(file), href: pathToFileURL(file).href };
}

function parseRanges(range) {
  return range.split(",").map((part) => {
    const s = part.trim().replace(/^U\+/i, "");
    if (s.includes("?")) {
      return [parseInt(s.replace(/\?/g, "0"), 16), parseInt(s.replace(/\?/g, "F"), 16)];
    }
    const [a, b = a] = s.split("-");
    return [parseInt(a, 16), parseInt(b, 16)];
  });
}

const toRange = (chars) =>
  [...chars]
    .map((c) => c.codePointAt(0))
    .sort((a, b) => a - b)
    .map((cp) => `U+${cp.toString(16).toUpperCase()}`)
    .join(",");

// ---- 1. group the characters ------------------------------------------
const pageChars = [];
for (const [name, ...paths] of PAGES) {
  const chars = new Set();
  for (const p of paths) {
    const res = await fetch(site + p);
    if (!res.ok) throw new Error(`${res.status} for ${p}`);
    for (const c of charsOf(visibleText(await res.text()))) chars.add(c);
  }
  pageChars.push([name, chars]);
}
// The layout's characters are the ones every page has in common.
const chrome = new Set(
  [...pageChars[0][1]].filter((c) => pageChars.every(([, set]) => set.has(c))),
);
const assigned = new Set(chrome);
const groups = [{ name: "chrome", chars: chrome }];
for (const [name, chars] of pageChars) {
  const own = new Set([...chars].filter((c) => !assigned.has(c)));
  own.forEach((c) => assigned.add(c));
  groups.push({ name, chars: own });
}
const rest = new Set();
for (const f of walk(path.join(ROOT, "src"))) {
  for (const c of charsOf(fs.readFileSync(f, "utf8"))) if (!assigned.has(c)) rest.add(c);
}
groups.push({ name: "rest", chars: rest });

// ---- 2. read the source slices ----------------------------------------
const { buf: cssBuf, href: cssHref } = await load(source);
const faces = [
  ...cssBuf
    .toString("utf8")
    .matchAll(/@font-face\s*\{([^}]*)\}/g),
]
  .map(([, body]) => ({
    family: /font-family:\s*['"]?([^;'"]+)/.exec(body)?.[1],
    url: /url\(['"]?([^)'"]+)['"]?\)/.exec(body)?.[1],
    ranges: parseRanges(/unicode-range:\s*([^;]+)/.exec(body)?.[1] ?? "U+0-10FFFF"),
  }))
  .filter((f) => f.family === "Noto Serif TC" && f.url);
// A variable source lists each slice once per weight with the same url.
const slices = [...new Map(faces.map((f) => [f.url, f])).values()];
if (slices.length === 0) throw new Error(`no Noto Serif TC faces in ${source}`);

const cache = new Map();
async function sliceBuffer(url) {
  if (!cache.has(url)) cache.set(url, (await load(url, cssHref)).buf);
  return cache.get(url);
}

// ---- 3. subset each group, slice by slice -----------------------------
/* One output file per (group, slice). A group whose characters sit in
   several slices yields several small files; merging them would need a
   font merger the toolchain does not have, and the browser fetches them
   in parallel over one connection either way. */
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const rules = [];
let missing = [];
const summary = [];
for (const g of groups) {
  let bytes = 0;
  let files = 0;
  const covered = new Set();
  for (const s of slices) {
    const chars = [...g.chars].filter((c) => {
      const cp = c.codePointAt(0);
      return !covered.has(c) && s.ranges.some(([a, b]) => cp >= a && cp <= b);
    });
    if (chars.length === 0) continue;
    chars.forEach((c) => covered.add(c));
    const out = await subsetFont(await sliceBuffer(s.url), chars.join(""), {
      targetFormat: "woff2",
    });
    const hash = crypto.createHash("sha256").update(out).digest("hex").slice(0, 8);
    const file = `${g.name}-${files}.${hash}.woff2`;
    fs.writeFileSync(path.join(OUT_DIR, file), out);
    rules.push(
      `@font-face{font-family:"${FAMILY}";font-style:normal;font-weight:500 700;font-display:swap;` +
        `src:url("./cjk/${file}") format("woff2");unicode-range:${toRange(chars)}}`,
    );
    bytes += out.length;
    files += 1;
  }
  missing = missing.concat([...g.chars].filter((c) => !covered.has(c)));
  summary.push(`${g.name.padEnd(8)} ${String(g.chars.size).padStart(4)} chars  ${files} files  ${(bytes / 1024).toFixed(1)} KB`);
}

fs.writeFileSync(
  OUT_CSS,
  `/* GENERATED by scripts/build-site-cjk-font.mjs. Do not edit; rerun it. */\n` +
    `:root{--font-noto-tc:"${FAMILY}"}\n` +
    rules.join("\n") +
    "\n",
);
console.log(summary.join("\n"));
if (missing.length) console.warn(`not in the source font (system fallback): ${missing.join("")}`);
