import "server-only";

import { Pool, type PoolClient } from "pg";

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
 * SERVERLESS: point DATABASE_URL at a POOLER endpoint (Supabase's port 6543,
 * PgBouncer transaction mode), not the direct 5432 port. Each warm lambda
 * holds `max` connections, and Postgres runs out of slots long before Vercel
 * runs out of lambdas. The small max below is that budget.
 */

let pool: Pool | null = null;

/** True when the orders database is configured at all. */
export function isOrdersDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function ordersPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Missing required environment variable DATABASE_URL. It is the Postgres " +
        "connection string for the orders store (use the pooler endpoint on " +
        "serverless). See .env.example.",
    );
  }

  pool = new Pool({
    connectionString,
    // Deliberately small — see the serverless note above.
    max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "4", 10),
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
