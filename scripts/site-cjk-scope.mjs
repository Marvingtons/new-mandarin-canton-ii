/**
 * What counts as "a Chinese character the customer site prints", shared by
 * the font generator (build-site-cjk-font.mjs) and the prebuild check
 * (check-site-cjk-font.mjs) so the two can never disagree about scope.
 */

import fs from "node:fs";
import path from "node:path";

/** CJK ideographs plus CJK and fullwidth punctuation. */
export const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/gu;

export const charsOf = (text) => new Set(text.match(CJK) ?? []);

/**
 * Everything under src is customer-facing except these: the staff app
 * (which sets Chinese in the device's own sans), the ticket renderer
 * (its own font, see build-ticket-font), and server-only code.
 */
export const EXCLUDE = [
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

/** Customer-facing source files under `root`/src. */
export function customerSourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      const rel = path.relative(root, p);
      if (EXCLUDE.some((x) => rel === x || rel.startsWith(x + path.sep))) continue;
      if (entry.isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(entry.name)) out.push(p);
    }
  };
  walk(path.join(root, "src"));
  return out;
}
