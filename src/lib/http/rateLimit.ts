import "server-only";

/**
 * Rate limiting for the endpoints that cost money or cook food.
 *
 * TWO THINGS ARE BEING PROTECTED, and they are not the same:
 *
 *   1. TWILIO SPEND. Every /api/otp/start is a billable SMS. An open endpoint
 *      that sends texts on demand WILL be found and drained.
 *   2. THE KITCHEN. Nothing is prepaid, so a submitted order costs the
 *      restaurant real food. The per-phone daily order cap is the ceiling
 *      that a stolen session cannot exceed.
 *
 * WHY IN-MEMORY AND NOT POSTGRES: these are abuse speed bumps, not ledgers. A
 * database round trip on every request adds latency and a failure mode to the
 * happy path. A fixed-size LRU costs nothing and cannot fail.
 *
 * The honest limitation: on serverless each instance keeps its own counters,
 * so the effective global limit is (limit × warm instances). That is fine for
 * blunting a script, and NOT fine as the only guard on Twilio spend — which is
 * why the per-phone daily cap is deliberately also enforced by Twilio Verify's
 * own per-number limits (error 60203), and the per-day ORDER cap is enforced
 * in Postgres by `countOrdersForPhone`, where it cannot be evaded by hitting a
 * different lambda.
 *
 * ⚠️ TODO(confirm): if abuse is observed, move `hit()` to a shared store
 * (Postgres table or Upstash). No caller changes.
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
 * Limits per endpoint. Keys ending `_ip` are keyed by client IP, `_phone` by
 * the normalized E.164 number.
 *
 * The phone limits matter more than the IP ones: an abuser changes IP for
 * free, but each phone number they burn is a number they must actually
 * possess. The daily cap is the real ceiling; the burst limit just stops a
 * loop from spending twenty texts in ten seconds.
 */
export const RATE_LIMITS = {
  /** Billable SMS. Burst, then a hard daily ceiling per number. */
  otp_start_phone: { windowMs: 15 * 60_000, max: 3 },
  otp_start_phone_daily: { windowMs: 24 * 60 * 60_000, max: 8 },
  otp_start_ip: { windowMs: 15 * 60_000, max: 10 },
  /** Code checks are cheap, but unlimited guesses are a brute force. */
  otp_check_phone: { windowMs: 15 * 60_000, max: 10 },
  otp_check_ip: { windowMs: 15 * 60_000, max: 30 },
  /** Order submission. A real customer submits once, maybe twice. */
  order_ip: { windowMs: 5 * 60_000, max: 10 },
  /** The printer polls often and legitimately; this only catches a flood. */
  cloudprnt_ip: { windowMs: 60_000, max: 120 },
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
