import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * THE ONE PLACE that knows where the Postgres connection string comes from.
 *
 * Two hosts, one seam:
 *
 *   Cloudflare Workers — `env.HYPERDRIVE.connectionString`. Hyperdrive sits in
 *     front of Supabase and owns the real connection pool, keeping warm
 *     connections at the edge so a cold isolate does not pay a TLS+auth
 *     round-trip to us-west on every request.
 *
 *   Plain Node — `process.env.DATABASE_URL`. Scripts (verify:orders, dev:db)
 *     and any local tooling. Unchanged from before the migration.
 *
 * Nothing above this file knows which path it is on. `ordersPool()` asks for a
 * string and gets one; the repository, the routes, and the scripts are all
 * untouched by the move.
 *
 * ⚠️ Give Hyperdrive Supabase's DIRECT (session, port 5432) string, NOT the
 * :6543 transaction pooler. Hyperdrive IS the pooler; stacking it in front of
 * PgBouncer's transaction mode breaks prepared statements, which is exactly
 * what `pg` uses under the hood.
 */

interface HyperdriveBinding {
  connectionString: string;
}

/**
 * True on workerd. `navigator.userAgent` is the documented marker; Node does
 * not define `navigator` at all in the versions this project targets.
 */
function onWorkers(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  );
}

/**
 * Read the Hyperdrive binding, or null when it is absent.
 *
 * Synchronous `getCloudflareContext()` is used deliberately: this is only ever
 * called from inside a request, where the adapter has already installed the
 * context. It returns null rather than throwing so a Worker deployed without
 * the binding degrades to the DATABASE_URL path (and then to a clean
 * "not configured" response) instead of 500ing.
 */
function hyperdriveConnectionString(): string | null {
  if (!onWorkers()) return null;
  try {
    const binding = getCloudflareContext().env[
      "HYPERDRIVE" as keyof CloudflareEnv
    ] as HyperdriveBinding | undefined;
    return binding?.connectionString ?? null;
  } catch {
    // Called outside a request context, or the adapter is not installed.
    return null;
  }
}

/**
 * MUST be an indexed read, never `process.env.DATABASE_URL`.
 *
 * Next's bundler statically replaces dotted `process.env.FOO` references in
 * server code with their build-time values. DATABASE_URL is unset at build
 * time on Workers — it arrives as a binding at runtime — so the dotted form
 * compiles to `undefined` and the app reports "no database" forever, with the
 * variable plainly bound in `wrangler dev`'s own binding list.
 *
 * Measured: CLOUDPRNT_SECRET reached the same worker fine because
 * tenant.server.ts reads it as `process.env[name]`, which cannot be inlined.
 * This is the same trick, for the same reason.
 */
const DATABASE_URL_KEY = "DATABASE_URL";

function databaseUrl(): string | null {
  return process.env[DATABASE_URL_KEY] ?? null;
}

/** The Postgres connection string for this host, or null if unconfigured. */
export function ordersConnectionString(): string | null {
  return hyperdriveConnectionString() ?? databaseUrl();
}

/** Which path supplied it — for logs and the readiness endpoint only. */
export function connectionSource(): "hyperdrive" | "database-url" | "none" {
  if (hyperdriveConnectionString()) return "hyperdrive";
  if (databaseUrl()) return "database-url";
  return "none";
}
