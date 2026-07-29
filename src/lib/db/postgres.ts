import "server-only";

import { Pool, type PoolClient } from "pg";
import {
  connectionSource,
  ordersConnectionString,
} from "@/lib/db/connectionString";

/**
 * Direct Postgres pool for the orders path.
 *
 * WHY NOT THE SUPABASE CLIENT (src/lib/db/supabase.ts)?
 *
 * The menu snapshot is a single-row upsert, which PostgREST expresses fine.
 * The orders path is not: it needs `INSERT … ON CONFLICT DO NOTHING RETURNING`
 * and a multi-statement transaction whose ROLLBACK un-burns an order number.
 * PostgREST cannot express either. The correctness guarantee here IS the SQL,
 * so we speak SQL.
 *
 * Both clients coexist deliberately — supabase.ts keeps the menu snapshot, and
 * nothing about it changes.
 *
 * WHERE THE CONNECTION STRING COMES FROM is not this file's business — see
 * src/lib/db/connectionString.ts, the single seam that answers Hyperdrive (on
 * Workers) vs DATABASE_URL (plain Node). Nothing else in the app knows which
 * host it is running on.
 *
 * POOLING, and why the endpoint differs per host:
 *
 *   Workers    Hyperdrive owns the pool. Give HYPERDRIVE Supabase's DIRECT
 *              (session, 5432) string — stacking Hyperdrive in front of the
 *              :6543 transaction pooler breaks prepared statements, which is
 *              what `pg` uses. `max` drops to 1 here; see below.
 *
 *   Node       Point DATABASE_URL at the POOLER endpoint (6543). Scripts and
 *              local dev keep the old budget.
 */

let pool: Pool | null = null;

/** True when the orders database is configured at all. */
export function isOrdersDbConfigured(): boolean {
  return ordersConnectionString() !== null;
}

export function ordersPool(): Pool {
  if (pool) return pool;

  const connectionString = ordersConnectionString();
  if (!connectionString) {
    throw new Error(
      "No Postgres connection available for the orders store. On Cloudflare " +
        "Workers that means the HYPERDRIVE binding is missing from " +
        "wrangler.jsonc; elsewhere it means DATABASE_URL is unset. " +
        "See .env.example and docs/DEPLOY_RUNBOOK.md.",
    );
  }

  const source = connectionSource();

  pool = new Pool({
    connectionString,
    /**
     * Connections held per isolate/process.
     *
     * Behind Hyperdrive this must be SMALL: Hyperdrive already keeps the real
     * warm pool at the edge, and every Worker isolate holding four sockets
     * multiplies against the isolate count for no benefit. One is what
     * Cloudflare's own examples use (they open a Client per request).
     *
     * On plain Node the old budget stands — scripts and local dev genuinely
     * benefit from a handful.
     */
    max:
      source === "hyperdrive"
        ? 1
        : Number.parseInt(process.env.DATABASE_POOL_MAX ?? "4", 10),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Managed Postgres (Supabase, Neon, RDS) terminates TLS with its own CA.
    // Local development runs plaintext, so only ask for TLS when the URL does.
    ssl: /[?&]sslmode=(require|verify-full|verify-ca)/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // A pool-level error (server restart, idle connection reaped) must not take
  // the process down. The next checkout simply opens a fresh connection.
  pool.on("error", (err) => {
    console.warn("[db] idle client error:", err.message);
  });

  return pool;
}

/**
 * Run `fn` inside a transaction, committing on success and rolling back on any
 * throw. The rollback is load-bearing in createOrder: it returns an already
 * incremented order-number counter to its previous value.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await ordersPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      /* connection already gone — the server rolled back for us */
    });
    throw err;
  } finally {
    client.release();
  }
}

/** Close the pool. Used by scripts; serverless never calls this. */
export async function closeOrdersPool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}
