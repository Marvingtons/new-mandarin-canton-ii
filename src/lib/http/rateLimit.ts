import "server-only";

/**
 * Per-IP rate limiting for the money-adjacent endpoints.
 *
 * WHY IN-MEMORY AND NOT POSTGRES: this is an abuse speed bump in front of a
 * card-testing target, not an accounting ledger. A database round trip on
 * every checkout to protect against a database-backed endpoint adds latency
 * and a failure mode to the happy path, and the real ceiling downstream is
 * Clover's own fraud controls plus the idempotency index. A fixed-size LRU
 * costs nothing and cannot fail. The trade-off is honest and worth stating:
 * on serverless each instance keeps its own counters, so the effective global
 * limit is (limit × warm instances). That still turns a scripted card-testing
 * run from thousands of attempts into a handful.
 *
 * ⚠️ TODO(confirm): if abuse is ever observed in production, move this to a
 * shared store (Postgres table or Upstash). The interface below does not
 * change — only the body of `hit()`.
 */

interface Bucket {
  /** Timestamps (epoch ms) of the hits still inside the window. */
  hits: number[];
}

export interface RateLimitRule {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests permitted inside one window. */
  max: number;
}

/**
 * Limits per endpoint.
 *
 * Checkout is deliberately tight: a real customer submits once, maybe twice
 * after fixing a card error. Ten in five minutes is already generous.
 * Tokenize is looser because Clover's iframe can legitimately re-tokenize as
 * the customer corrects a field.
 */
export const RATE_LIMITS = {
  checkout: { windowMs: 5 * 60_000, max: 10 },
  tokenize: { windowMs: 60_000, max: 20 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Hard cap on tracked keys, so a spoofed-IP flood cannot exhaust memory. */
const MAX_KEYS = 5_000;

/** Map preserves insertion order, which gives us LRU eviction for free. */
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Seconds until the window frees up. Only meaningful when ok === false. */
  retryAfterSeconds: number;
  limit: number;
}

export function checkRateLimit(
  name: RateLimitName,
  ip: string,
  now: number = Date.now(),
): RateLimitResult {
  const rule = RATE_LIMITS[name];
  const key = `${name}:${ip}`;
  const cutoff = now - rule.windowMs;

  const bucket = buckets.get(key) ?? { hits: [] };
  // Drop hits that have aged out of the window.
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= rule.max) {
    // Re-insert to mark it as recently used, but do NOT record the hit — a
    // blocked caller must not be able to extend its own penalty indefinitely.
    buckets.delete(key);
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldest + rule.windowMs - now) / 1000),
      ),
      limit: rule.max,
    };
  }

  bucket.hits.push(now);
  buckets.delete(key);
  buckets.set(key, bucket);

  // Evict the least recently used keys once we are over budget.
  while (buckets.size > MAX_KEYS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey === undefined) break;
    buckets.delete(oldestKey);
  }

  return {
    ok: true,
    remaining: rule.max - bucket.hits.length,
    retryAfterSeconds: 0,
    limit: rule.max,
  };
}

/** Bilingual 429, matching the customer-facing tone of the checkout errors. */
export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    {
      ok: false,
      error:
        "Too many attempts. Please wait a moment and try again. " +
        "· 嘗試次數過多，請稍候再試。",
    },
    {
      status: 429,
      headers: {
        "retry-after": String(result.retryAfterSeconds),
        "x-ratelimit-limit": String(result.limit),
        "x-ratelimit-remaining": "0",
      },
    },
  );
}

/** Test seam — clears all counters. Never called by application code. */
export function resetRateLimits(): void {
  buckets.clear();
}
