import { Resvg, initWasm } from "@resvg/resvg-wasm";

/**
 * resvg, initialized exactly once per isolate.
 *
 * @resvg/resvg-js (the native build) cannot run on Cloudflare Workers at all —
 * it ships a platform `.node` addon, and `nodejs_compat` does not help with
 * native addons. The wasm build is the only option, and it needs an explicit
 * one-time `initWasm()` before the first `new Resvg(...)`.
 *
 * THE SINGLETON IS NOT OPTIONAL. `initWasm()` throws
 * "Already initialized. The `initWasm()` function can be used only once." on a
 * second call. And the flag it checks is set only AFTER its internal await, so
 * a boolean guard is not enough: two requests arriving on a cold isolate can
 * both pass the check and the second throws. Caching the PROMISE is what makes
 * it safe — the second caller awaits the first call's result.
 *
 * Failure is not cached permanently on purpose: if init rejects (a corrupt
 * module, an OOM at cold start), the promise is cleared so the next request
 * retries rather than the isolate being poisoned for its whole life.
 */

let initPromise: Promise<void> | null = null;

/** Where sync-wasm.mjs puts the module inside the assets directory. */
const WASM_ASSET_PATH = "/wasm/resvg.wasm";

/**
 * The wasm module. This is the ONE platform seam in the renderer.
 *
 *   Workers — fetched from the ASSETS binding, once per isolate.
 *   Node    — read from node_modules (scripts: ticket:sample).
 *
 * WHY NOT `import wasm from "@resvg/resvg-wasm/index_bg.wasm"`, which is the
 * form Cloudflare's own docs show: Turbopack claims `.wasm` first and does
 * ASYNC INSTANTIATION, meaning it tries to satisfy the module's imports at
 * build time. resvg is wasm-bindgen output with 18 imports from the "wbg"
 * namespace that only its own JS glue provides, so `next build` dies with
 * "Module not found: Can't resolve 'wbg'". Measured, not assumed — that is
 * the exact error this replaced.
 *
 * Going through the assets binding means the bundler never sees a `.wasm`
 * import at all. `env.ASSETS.fetch()` is a binding call, not a global fetch,
 * so `global_fetch_strictly_public` does not apply and it costs no external
 * subrequest.
 *
 * `initWasm` accepts `RequestInfo | URL | Response | BufferSource |
 * WebAssembly.Module` — a Response is valid input, so the fetch result is
 * handed over directly and streamed into WebAssembly.instantiate.
 */
async function loadWasm(): Promise<Response | BufferSource> {
  // The documented workerd marker.
  const onWorkers =
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers";

  if (onWorkers) {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    if (!env.ASSETS) {
      throw new Error(
        "ASSETS binding is missing — the ticket renderer cannot load resvg.wasm. " +
          "Check the `assets` block in wrangler.jsonc.",
      );
    }
    // The origin is ignored by the binding; only the path is used.
    const response = await env.ASSETS.fetch(
      new URL(WASM_ASSET_PATH, "https://assets.local"),
    );
    if (!response.ok) {
      throw new Error(
        `resvg.wasm not found at ${WASM_ASSET_PATH} (${response.status}). ` +
          "Did `npm run sync:wasm` run before the build?",
      );
    }
    return response;
  }

  // Node path — scripts and local tooling.
  //
  // The path is assembled from the package ROOT rather than written as
  // "@resvg/resvg-wasm/index_bg.wasm". A literal `.wasm` specifier anywhere in
  // this file — even on a branch Workers never take — makes Turbopack claim it
  // and try to instantiate it at build time, which fails on wasm-bindgen's
  // "wbg" imports. Keeping the filename out of the specifier keeps the bundler
  // out of it entirely.
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  const require = createRequire(import.meta.url);
  const packageEntry = require.resolve("@resvg/resvg-wasm");
  return await readFile(join(dirname(packageEntry), "index_bg.wasm"));
}

/** Await before constructing a Resvg. Safe to call on every render. */
export function ensureResvg(): Promise<void> {
  initPromise ??= (async () => {
    await initWasm(await loadWasm());
  })().catch((err: unknown) => {
    initPromise = null; // let the next request retry
    throw err;
  });
  return initPromise;
}

export { Resvg };
