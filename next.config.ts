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

  /**
   * The ticket renderer reads its subset font off the filesystem at request
   * time. Being under `public/` makes a file publicly SERVED — it does not
   * make it READABLE from a serverless function. If the font is missing from
   * a route's bundle, that route throws ENOENT in production and nowhere
   * else, which is the worst possible place to find out.
   *
   * MEASURED, not assumed (rebuild with this map emptied to re-check): the
   * trace analyzer ALREADY resolves the fonts on its own for every route that
   * imports lib/ticket/font.ts, because `readFile(join(FONT_DIR, "...ttf"))`
   * is statically analyzable. So these entries are belt-and-braces, not the
   * thing keeping tickets alive.
   *
   * They are kept anyway. Automatic resolution depends on that path staying
   * literal; a refactor to a computed filename, or a change in the analyzer,
   * would silently drop the font from the bundle — and the route below that
   * matters is the one the PRINTER fetches, where the failure is invisible
   * until a customer is waiting for food.
   */
  outputFileTracingIncludes: {
    // The printer's own route. Not currently load-bearing (nft finds the
    // fonts unaided) but this is the route whose silent failure costs an
    // order, so it does not get to depend on inference.
    "/api/print/[secret]": ["./public/fonts/**"],
    "/api/ticket/preview": ["./public/fonts/**"],
    "/api/kitchen/orders/[id]": ["./public/fonts/**"],
    "/api/kitchen/orders/[id]/ticket": ["./public/fonts/**"],
  },
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
