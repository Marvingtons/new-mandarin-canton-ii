import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
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

/**
 * ---------------------------------------------------------------------------
 * CONNECTION LIFETIME, and why it is not one shared pool on Workers.
 *
 * A Worker may not touch an I/O object created by a different request. A TCP
 * socket opened while serving request A is dead to request B:
 *
 *   Cannot perform I/O on behalf of a different request. I/O objects (such as
 *   streams, request/response bodies, and others) created in the context of one
 *   request handler cannot be accessed from a different request's handler.
 *
 * A module-scoped `pg` Pool does exactly that. It parks idle clients between
 * requests (idleTimeoutMillis) and hands them to whoever asks next. On the
 * second request the socket is already void, and the query issued on it NEVER
 * SETTLES — measured on workerd: the reusing request hangs until the runtime
 * cancels it. A hung query is never released, so with `max: 1` the pool is
 * permanently empty from then on and every later acquisition dies at
 * connectionTimeoutMillis with "timeout exceeded when trying to connect".
 *
 * That is the printer bug. The printer polls every 10s against an
 * idleTimeoutMillis of 10s, so it kept catching sockets that were still pooled
 * and already dead. The minute cron never did — 60s is well past the idle
 * timeout, so it always built a fresh connection inside its own request — which
 * is why the cron scanned happily while every poll timed out on the same
 * deployment. The cron was not doing anything right; it was just slow enough to
 * never hit the trap.
 *
 * So on Workers the pool is scoped to the REQUEST, keyed by the execution
 * context, and closed with waitUntil when that request finishes. One connection
 * per request is Cloudflare's documented Hyperdrive pattern anyway: Hyperdrive
 * keeps the real warm pool at the edge, so opening one is cheap and pooling it
 * ourselves buys nothing.
 *
 * On plain Node (scripts, local dev) there is no such rule and a long-lived
 * pool is correct, so that path is unchanged.
 * ---------------------------------------------------------------------------
 */

/** The long-lived pool. Node only — never used on Workers. */
let nodePool: Pool | null = null;

/**
 * Per-request pools on Workers, keyed by the request's execution context.
 * Weak so a finished request's entry disappears with its context.
 */
const requestPools = new WeakMap<object, Pool>();

/** True when the orders database is configured at all. */
export function isOrdersDbConfigured(): boolean {
  return ordersConnectionString() !== null;
}

/**
 * The bit of the execution context this file needs: an identity to key the
 * pool by, and a way to close it when the request ends. Declared locally
 * because @cloudflare/workers-types is a worker-only global that this module
 * is also type-checked against under plain Node.
 */
interface RequestContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * The execution context of the request being served, or null off-request
 * (scripts, module scope, plain Node).
 */
function currentRequestContext(): RequestContext | null {
  try {
    const ctx = getCloudflareContext().ctx as RequestContext | undefined;
    return ctx && typeof ctx.waitUntil === "function" ? ctx : null;
  } catch {
    return null;
  }
}

export function ordersPool(): Pool {
  const requestCtx = currentRequestContext();

  // Workers: one pool per request, torn down with it.
  if (requestCtx) {
    const existing = requestPools.get(requestCtx);
    if (existing) return existing;

    const created = newPool();
    requestPools.set(requestCtx, created);
    return created;

    // DELIBERATELY NO waitUntil(pool.end()) HERE.
    //
    // `waitUntil` takes an already-running promise; it does not defer one. So
    // `waitUntil(pool.end())` starts draining the pool the instant it is
    // created, and every query on it then fails — measured on workerd as
    // "This WritableStream belongs to an object that is closing." on the very
    // first request. There is no end-of-request hook available at this layer to
    // hang the close on instead.
    //
    // Not closing is safe here in a way that reusing never was. The pool is
    // reachable only through this request's context, so the NEXT request cannot
    // get its sockets — which is the entire bug. What is left behind is one
    // idle socket that pg reaps at idleTimeoutMillis, and that Hyperdrive
    // multiplexes on its side regardless.
  }

  // Node: one pool for the process, as before.
  if (nodePool) return nodePool;
  nodePool = newPool();
  return nodePool;
}

function newPool(): Pool {
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

  const pool = new Pool({
    connectionString,
    /**
     * Connections this pool may hold.
     *
     * Behind Hyperdrive the pool is per REQUEST (see the note at the top), so
     * `1` here means exactly one connection per request — which is Cloudflare's
     * documented Hyperdrive pattern. Hyperdrive keeps the real warm pool at the
     * edge, so a second socket per request would buy nothing.
     *
     * On plain Node the pool is per process and the old budget stands — scripts
     * and local dev genuinely benefit from a handful.
     */
    max:
      source === "hyperdrive"
        ? 1
        : Number.parseInt(process.env.DATABASE_POOL_MAX ?? "4", 10),
    // Short on Workers: the pool is unreachable once its request ends, so this
    // is what actually reaps the socket it leaves behind. It is NOT a reuse
    // window any more — a later request gets a different pool regardless of
    // what is idle in this one.
    idleTimeoutMillis: source === "hyperdrive" ? 2_000 : 10_000,
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

/**
 * Close the process-wide pool. Used by scripts so they can exit.
 *
 * Workers never calls this and does not need to: each request's pool is closed
 * by the waitUntil registered when it was created.
 */
export async function closeOrdersPool(): Promise<void> {
  if (!nodePool) return;
  const p = nodePool;
  nodePool = null;
  await p.end();
}
