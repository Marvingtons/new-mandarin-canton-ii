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

/**
 * The wasm module. This is the ONE platform seam in the renderer.
 *
 *   Workers — a PRE-COMPILED WebAssembly.Module handed over by
 *             custom-worker.ts on globalThis.
 *   Node    — bytes read from node_modules (scripts: ticket:sample).
 *
 * WHY THE HAND-OFF, rather than importing or fetching the wasm here. Two
 * constraints, both measured on this project:
 *
 *   workerd forbids RUNTIME wasm compilation. Fetching the module from the
 *   ASSETS binding and passing the Response to initWasm fails with
 *   "CompileError: WebAssembly.instantiate(): Wasm code generation disallowed
 *   by embedder". It must arrive already compiled, which only a build-time
 *   `import` of a .wasm file produces.
 *
 *   Turbopack cannot process THIS .wasm. It claims the extension and tries to
 *   instantiate the module itself, then fails on wasm-bindgen's 18 "wbg"
 *   imports: "Module not found: Can't resolve 'wbg'". So the import cannot
 *   live anywhere Turbopack bundles — i.e. anywhere in src/.
 *
 * custom-worker.ts is bundled by wrangler instead, so the import works there
 * and the compiled module reaches us on globalThis.
 */
declare global {
  // eslint-disable-next-line no-var
  var __RESVG_WASM__: WebAssembly.Module | undefined;
}

async function loadWasm(): Promise<WebAssembly.Module | BufferSource> {
  // The documented workerd marker.
  const onWorkers =
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers";

  if (onWorkers) {
    const compiled = globalThis.__RESVG_WASM__;
    if (!compiled) {
      throw new Error(
        "__RESVG_WASM__ is missing. custom-worker.ts must import " +
          "@resvg/resvg-wasm/index_bg.wasm and assign it to globalThis before " +
          "any ticket renders. Check that wrangler `main` points at " +
          "custom-worker.ts and not at .open-next/worker.js.",
      );
    }
    return compiled;
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
