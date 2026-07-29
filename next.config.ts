import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Native and connection-holding packages must not be bundled.
   *
   * @resvg/resvg-js ships a platform `.node` binary, which Turbopack cannot
   * place in an ESM chunk at all (the build fails outright). `pg` is pure JS
   * but bundling it breaks its optional native/driver resolution and its
   * connection pooling, both of which we rely on.
   */
  serverExternalPackages: ["@resvg/resvg-js", "pg"],

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
