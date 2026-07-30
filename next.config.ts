import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Native and connection-holding packages must not be bundled.
   *
   * @resvg/resvg-js ships a platform `.node` binary, which Turbopack cannot
   * place in an ESM chunk at all (the build fails outright). `pg` is pure JS
   * but bundling it breaks its optional native/driver resolution and its
   * connection pooling, both of which we rely on.
   *
   * `pg-cloudflare` is here for a different reason, and it is load-bearing for
   * CI. It provides CloudflareSocket, which pg requires at
   * pg/lib/stream.js:41 to reach Hyperdrive on workerd, and it exposes that
   * implementation ONLY through a "workerd" export condition — the default
   * condition resolves to dist/empty.js, a deliberate no-op stub.
   *
   * Next's tracer runs with the default conditions, so it traced the stub and
   * left dist/index.js and esm/index.mjs behind. The adapter's esbuild then
   * runs with conditions: ["workerd"] and asks for an entry that was never
   * copied. Locally that still linked, because resolution fell back to the
   * complete copy in the root node_modules; in Cloudflare Workers Builds there
   * is no such fallback and the build fails with `Could not resolve
   * "pg-cloudflare"`.
   *
   * Naming it here is the adapter's own fix: copyWorkerdPackages() copies the
   * FULL package into the traced output and rewrites its package.json with the
   * workerd condition resolved, but only for packages that are BOTH listed in
   * serverExternalPackages AND carry a build condition. pg-cloudflare had the
   * second and was missing the first. See
   * @opennextjs/cloudflare/dist/cli/build/utils/workerd.js.
   */
  serverExternalPackages: ["pg", "pg-cloudflare"],

  /*
   * `outputFileTracingIncludes` USED TO LIVE HERE. Do not restore it.
   *
   * It was a Vercel/serverless mechanism for copying `public/fonts/*.ttf`
   * into a route's lambda bundle so the ticket renderer could read them off
   * disk. On Cloudflare Workers there is no filesystem and no file tracing —
   * the whole concept is gone, and the setting is silently ignored.
   *
   * The fonts now reach satori by being imported directly into the bundle as
   * binary modules. See src/lib/ticket/font.ts and the `rules` block in
   * wrangler.jsonc.
   */
};

export default nextConfig;

/**
 * Makes Cloudflare bindings (ASSETS, HYPERDRIVE, vars, secrets from
 * .dev.vars) available under plain `next dev`, so local development sees the
 * same env shape the Worker does.
 *
 * Deliberately AFTER the default export and deliberately not awaited — that
 * is the placement the adapter documents. It is a side-effecting top-level
 * call, and moving it up with the other imports is a known way to break it.
 */
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
void initOpenNextCloudflareForDev();
