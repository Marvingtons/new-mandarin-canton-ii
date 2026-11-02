/**
 * Entry point for `npm run build:ticket-font -- <path to NotoSansTC[wght].ttf>`.
 *
 * Runs the two steps in order:
 *   1. build:ticket-font:subset  (scripts/build-ticket-font.ts <path>)
 *   2. build:ticket-font:module  (scripts/emit-font-module.ts)
 *
 * WHY A NODE SCRIPT. The old `tsx a.ts && npm run b` one-liner handed the
 * `-- <path>` argument to the LAST command in the chain, so the subset step
 * never saw the font and printed its usage line. Shell tricks (`sh -c '"$@"'`)
 * would fix that on macOS and Linux and break it on Windows, where npm runs
 * scripts under cmd.exe. Spawning tsx's CLI through the current Node binary
 * works the same on every platform, with no shell involved.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

const fontPath = process.argv[2];
if (!fontPath) {
  console.error(
    "Usage: npm run build:ticket-font -- <path to NotoSansTC[wght].ttf>\n" +
      "Download it from:\n" +
      "  https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf",
  );
  process.exit(1);
}

function run(args) {
  const result = spawnSync(process.execPath, [tsxCli, ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["scripts/build-ticket-font.ts", fontPath]);
run(["scripts/emit-font-module.ts"]);
