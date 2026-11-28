import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { ordersPool } from "@/lib/db/postgres";

/**
 * The board's Cancel: its manager PIN (CANCEL_PIN): the check and its rate limit.
 *
 * The PIN is compared in constant time (HMAC both sides, then
 * timingSafeEqual, so a length difference leaks nothing either). Wrong
 * attempts are counted in Postgres per board session, because the in-memory
 * limiter (lib/http/rateLimit) is per Worker isolate and a 4-digit PIN is
 * only 10,000 guesses.
 *
 * THE RULE: 5 wrong inside 10 minutes from one tablet session locks its
 * cancel for 60 seconds from the last wrong one. After the cooldown it may
 * try again; one more wrong is still 5 inside 10 minutes, so it locks again.
 * A right PIN does not erase earlier misses.
 */

export const CANCEL_PIN_MAX_FAILURES = 5;
export const CANCEL_PIN_WINDOW_SECONDS = 10 * 60;
export const CANCEL_PIN_COOLDOWN_SECONDS = 60;
/** History's word for a cancel authorised with the PIN. */
export const CANCEL_PIN_ACTOR = "manager-pin";

export function cancelPinMatches(submitted: string, expected: string): boolean {
  const key = "nmc-cancel-pin";
  const a = createHmac("sha256", key).update(submitted).digest();
  const b = createHmac("sha256", key).update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Seconds left on this session's cooldown, or 0 when it may try. */
export async function cancelPinCooldown(tenantId: string, sessionKey: string): Promise<number> {
  const { rows } = await ordersPool().query(
    `select count(*)::int as failures,
            extract(epoch from (now() - max(failed_at)))::float8 as since_last
       from cancel_pin_failures
      where tenant_id = $1 and session_key = $2
        and failed_at > now() - make_interval(secs => $3)`,
    [tenantId, sessionKey, CANCEL_PIN_WINDOW_SECONDS],
  );
  const failures = Number(rows[0]?.failures ?? 0);
  const since = Number(rows[0]?.since_last ?? Infinity);
  if (failures < CANCEL_PIN_MAX_FAILURES) return 0;
  return Math.max(0, Math.ceil(CANCEL_PIN_COOLDOWN_SECONDS - since));
}

/** Record one wrong PIN. Returns the cooldown it leaves (0 if none yet). */
export async function recordCancelPinFailure(tenantId: string, sessionKey: string): Promise<number> {
  await ordersPool().query(
    `with gone as (
       delete from cancel_pin_failures where failed_at < now() - interval '1 day'
     )
     insert into cancel_pin_failures (tenant_id, session_key) values ($1, $2)`,
    [tenantId, sessionKey],
  );
  return cancelPinCooldown(tenantId, sessionKey);
}
