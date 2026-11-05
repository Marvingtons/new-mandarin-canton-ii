/**
 * A local stand-in for Hyperdrive's query cache, for tests only.
 *
 * Production reaches Postgres through Hyperdrive (the `nmc-db` config), and
 * that config had query caching ON. Hyperdrive's documented behaviour, which
 * this copies:
 *
 *   - A read (SELECT) is cached by its text and parameters for `max_age`
 *     (default 60s), and served from cache to any later identical read.
 *   - Writes do NOT invalidate it. A SELECT right after an UPDATE can return
 *     the row as it was before the UPDATE.
 *   - A query that names a STABLE or VOLATILE function (now(), random(), ...)
 *     is never cached. Hyperdrive detects these by text matching.
 *
 * Two things Hyperdrive does not document, and which this treats strictly so
 * the code under test cannot lean on them:
 *
 *   - Whether a plain SELECT inside BEGIN ... COMMIT is cached. Here it IS.
 *   - A locking read (SELECT ... FOR UPDATE / FOR SHARE) takes a row lock and
 *     cannot be answered from a cache. Here it is never cached.
 *
 * So a read is only guaranteed fresh here if it locks. That is the rule the
 * print path follows after the fix: every read that decides a write or a
 * printer answer is a locking read inside a transaction.
 *
 * Installed by patching pg's Client.prototype.query, which every Pool query
 * goes through as well.
 */

import pg from "pg";

const UNCACHEABLE = [
  /\bnow\s*\(/i,
  /\bcurrent_timestamp\b/i,
  /\bcurrent_date\b/i,
  /\bcurrent_time\b/i,
  /\blocaltime(stamp)?\b/i,
  /\btimeofday\s*\(/i,
  /\brandom\s*\(/i,
  /\blastval\s*\(/i,
  /\btxid_current\s*\(/i,
  /\bnextval\s*\(/i,
  /\bgen_random_uuid\s*\(/i,
  /\bclock_timestamp\s*\(/i,
  /\bstatement_timestamp\s*\(/i,
];

const LOCKING = /\bfor\s+(update|no\s+key\s+update|share|key\s+share)\b/i;

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Would Hyperdrive (as modelled here) serve this from cache? */
export function isCacheableRead(sql: string): boolean {
  const s = stripComments(sql).trim();
  if (!/^(select|with)\b/i.test(s)) return false;
  // A WITH that writes (insert/update/delete inside a CTE) is a write.
  if (/^with\b/i.test(s) && /\b(insert|update|delete)\b/i.test(s)) return false;
  if (LOCKING.test(s)) return false;
  // Hyperdrive matches function names anywhere in the text, comments included.
  return !UNCACHEABLE.some((re) => re.test(sql));
}

export interface CacheEmulator {
  /** Reads answered from cache since install (or the last resetStats). */
  hits: number;
  /** Cacheable reads that went to the database and were stored. */
  misses: number;
  /** Forget everything cached: "max_age has passed". */
  clear(): void;
  resetStats(): void;
  uninstall(): void;
}

interface Entry {
  at: number;
  result: unknown;
}

type QueryFn = (...args: unknown[]) => unknown;

export function installHyperdriveCacheEmulator(maxAgeMs = 60_000): CacheEmulator {
  const proto = pg.Client.prototype as unknown as { query: QueryFn };
  const original = proto.query;
  const cache = new Map<string, Entry>();

  const emu: CacheEmulator = {
    hits: 0,
    misses: 0,
    clear: () => cache.clear(),
    resetStats: () => {
      emu.hits = 0;
      emu.misses = 0;
    },
    uninstall: () => {
      proto.query = original;
      cache.clear();
    },
  };

  proto.query = function patched(this: unknown, ...args: unknown[]): unknown {
    const [first, second, third] = args;
    const text =
      typeof first === "string"
        ? first
        : first && typeof first === "object" && "text" in first
          ? String((first as { text: unknown }).text)
          : null;
    const values = Array.isArray(second)
      ? second
      : first && typeof first === "object" && "values" in first
        ? (first as { values: unknown }).values
        : undefined;
    if (text === null || !isCacheableRead(text)) {
      return original.apply(this, args);
    }

    // pg-pool's Pool.query calls client.query(text, values, callback), so the
    // callback form is the one most reads arrive in.
    const callback = (
      typeof third === "function" ? third : typeof second === "function" ? second : null
    ) as ((err: Error | null, result?: unknown) => void) | null;

    const key = `${text}\u0000${JSON.stringify(values ?? [])}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < maxAgeMs) {
      emu.hits++;
      if (callback) {
        queueMicrotask(() => callback(null, hit.result));
        return undefined;
      }
      return Promise.resolve(hit.result);
    }
    emu.misses++;
    if (callback) {
      const wrapped = (err: Error | null, result?: unknown) => {
        if (!err) cache.set(key, { at: Date.now(), result });
        callback(err, result);
      };
      const rest = args.slice(0, typeof third === "function" ? 2 : 1);
      return original.apply(this, [...rest, wrapped]);
    }
    const p = original.apply(this, args) as Promise<unknown>;
    return p.then((result) => {
      cache.set(key, { at: Date.now(), result });
      return result;
    });
  };

  return emu;
}
