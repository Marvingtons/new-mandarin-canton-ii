/**
 * Copy the resvg wasm module into public/ so it ships as a static asset.
 *
 *   npm run sync:wasm     (runs automatically as part of build:cf)
 *
 * WHY NOT JUST IMPORT IT: Turbopack's `.wasm` loader does async instantiation
 * — it tries to satisfy the module's imports itself. resvg is wasm-bindgen
 * output with 18 imports from the "wbg" namespace, which only its own JS glue
 * can provide, so the build fails with:
 *
 *     Module not found: Can't resolve 'wbg'
 *
 * Serving it as an asset sidesteps the bundler entirely. The Worker fetches it
 * once per isolate through the ASSETS binding and hands the Response straight
 * to initWasm(), which accepts one. See src/lib/ticket/resvg.ts.
 *
 * Kept out of git (public/wasm is gitignored) because it is a verbatim copy of
 * a dependency's build artifact — regenerated from node_modules on every
 * Cloudflare build, so it can never drift from the installed version.
 */

import { copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const source = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
const target = join(process.cwd(), "public", "wasm", "resvg.wasm");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);

const { size } = await stat(target);
console.log(
  `sync:wasm  ${(size / 1024 / 1024).toFixed(2)} MB  ->  public/wasm/resvg.wasm`,
);
