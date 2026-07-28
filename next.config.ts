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
   * make it READABLE from a serverless function, and the trace analyzer
   * cannot see a path built at runtime. Without this, tickets render blank in
   * production and nowhere else, which is the worst possible place to find out.
   */
  outputFileTracingIncludes: {
    "/api/ticket/preview": ["./public/fonts/**"],
    "/api/kitchen/orders/[id]": ["./public/fonts/**"],
    "/api/kitchen/orders/[id]/ticket": ["./public/fonts/**"],
  },
};

export default nextConfig;
