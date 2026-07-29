import "server-only";

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
    // Required lazily so plain Node never loads the adapter.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@opennextjs/cloudflare") as {
      getCloudflareContext: () => {
        env: Record<string, unknown>;
      };
    };
    const env = mod.getCloudflareContext().env;
    const binding = env.HYPERDRIVE as HyperdriveBinding | undefined;
    return binding?.connectionString ?? null;
  } catch {
    return null;
  }
}

/** The Postgres connection string for this host, or null if unconfigured. */
export function ordersConnectionString(): string | null {
  return hyperdriveConnectionString() ?? process.env.DATABASE_URL ?? null;
}

/** Which path supplied it — for logs and the readiness endpoint only. */
export function connectionSource(): "hyperdrive" | "database-url" | "none" {
  if (hyperdriveConnectionString()) return "hyperdrive";
  if (process.env.DATABASE_URL) return "database-url";
  return "none";
}
