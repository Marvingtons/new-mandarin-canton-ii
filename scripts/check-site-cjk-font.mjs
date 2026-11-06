/**
 * Fails the build when the customer site prints a Chinese character the
 * self-hosted Noto Serif TC subset (src/app/fonts/cjk.css) does not cover.
 *
 * Runs as `prebuild`. It cannot regenerate the font itself (that needs the
 * running site and the source font, see build-site-cjk-font.mjs), so it
 * does the next best thing: refuse to ship a dish name or a line of copy
 * that would quietly render in the phone's default font instead of the
 * site's. The fix it asks for is one command.
 */

import fs from "node:fs";
import path from "node:path";
import { charsOf, customerSourceFiles } from "./site-cjk-scope.mjs";

const ROOT = process.cwd();
const css = fs.readFileSync(path.join(ROOT, "src/app/fonts/cjk.css"), "utf8");

const covered = new Set();
for (const [, range] of css.matchAll(/unicode-range:([^;}]+)/g)) {
  for (const part of range.split(",")) {
    const [a, b = a] = part.trim().replace(/^U\+/i, "").split("-");
    for (let cp = parseInt(a, 16); cp <= parseInt(b, 16); cp++) covered.add(cp);
  }
}

const missing = new Map(); // char -> first file that uses it
for (const file of customerSourceFiles(ROOT)) {
  for (const c of charsOf(fs.readFileSync(file, "utf8"))) {
    if (!covered.has(c.codePointAt(0)) && !missing.has(c)) {
      missing.set(c, path.relative(ROOT, file));
    }
  }
}

if (missing.size > 0) {
  console.error(
    `\n✖ ${missing.size} Chinese character(s) are not in the site font subset:\n` +
      [...missing].map(([c, f]) => `    ${c}  (${f})`).join("\n") +
      `\n\n  Regenerate it against a running build of this branch:\n` +
      `    npm run build:site-cjk-font -- --site http://localhost:3000\n`,
  );
  process.exit(1);
}
console.log(`✓ site font subset (${covered.size} glyphs) covers every Chinese character in use`);
