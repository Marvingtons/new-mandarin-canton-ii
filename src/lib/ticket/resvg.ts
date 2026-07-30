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
 *
 * ⚠️ IF YOU ARE HERE BECAUSE OF A CompileError IN PRODUCTION, IT IS PROBABLY
 * NOT THIS FILE. Verified 2026-07-30 against the real built worker on workerd:
 * this path renders a PNG correctly, and the deploy bundle carries
 * index_bg.wasm as a CompiledWasm module. The
 * "Wasm code generation disallowed by embedder" logged at ticket render comes
 * from SATORI, which renderTicket calls first. satori 0.29.0 bundles the
 * Emscripten build of yoga-layout with its wasm inlined as a
 * `data:application/octet-stream;base64,` URI and compiles it from bytes on
 * import; its exported `init()` is a no-op (`function Gu(A){}`), so there is no
 * hand-off to give it a pre-compiled module. Emscripten's own
 * "failed to asynchronously prepare wasm" / "Aborted(...)" wrapper is how you
 * tell the two apart in `wrangler tail`.
 */
declare global {
  var __RESVG_WASM__: WebAssembly.Module | undefined;
}

/**
 * workerd-only global. `navigator.userAgent === "Cloudflare-Workers"` is the
 * documented marker and is currently true, but it is a STRING, and this file
 * used to branch the whole load strategy on it. That made a one-word change to
 * a user-agent string enough to send Workers down the Node path below, read the
 * wasm as BYTES, and hand those to initWasm — which surfaces as
 * "CompileError: Wasm code generation disallowed by embedder", the very error
 * this seam exists to avoid. `WebSocketPair` is a runtime capability rather
 * than a label, and nodejs_compat does not define it.
 */
function onWorkers(): boolean {
  return typeof (globalThis as Record<string, unknown>).WebSocketPair !== "undefined";
}

async function loadWasm(): Promise<WebAssembly.Module | BufferSource> {
  // The hand-off is the SIGNAL, not a platform guess: custom-worker.ts assigns
  // this at module scope, so on Workers it is always present before any
  // request, and in Node tooling it is never present.
  const compiled = globalThis.__RESVG_WASM__;
  if (compiled !== undefined) {
    // Anything other than a compiled module here means the build-time import
    // silently degraded — most likely the CompiledWasm rule in wrangler.jsonc
    // was dropped, in which case the import yields bytes. Say so, rather than
    // passing bytes to initWasm and letting workerd report a CompileError that
    // names nothing.
    if (!(compiled instanceof WebAssembly.Module)) {
      throw new Error(
        "__RESVG_WASM__ is not a WebAssembly.Module (got " +
          Object.prototype.toString.call(compiled) +
          "). The `rules` entry in wrangler.jsonc mapping **/*.wasm to " +
          "CompiledWasm is what compiles the import at build time — check it " +
          "is still there.",
      );
    }
    return compiled;
  }

  if (onWorkers()) {
    throw new Error(
      "__RESVG_WASM__ is missing. custom-worker.ts must import " +
        "@resvg/resvg-wasm/index_bg.wasm and assign it to globalThis before " +
        "any ticket renders. Check that wrangler `main` points at " +
        "custom-worker.ts and not at .open-next/worker.js.",
    );
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
