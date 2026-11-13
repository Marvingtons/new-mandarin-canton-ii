/**
 * STALE-READ TRIPWIRE. A cheap check that Hyperdrive's query cache really is
 * off, from the inside, with no extra query.
 *
 * Every read in the app is a plain SELECT, which is only correct with caching
 * disabled on the Hyperdrive config (docs/PRINT_STALE_READS.md). If it is ever
 * turned back on, a SELECT can return a row as it was before a write this
 * same isolate just committed. Two places can see that for free:
 *
 *   - an ORDER read whose updated_at is older than the updated_at this
 *     isolate's own write of that order returned;
 *   - the board's VERSION read, whose database clock (now() at the read) is
 *     older than this isolate's newest write: a fresh read starts after that
 *     write committed, so its clock cannot be behind it.
 *
 * Either one logs a single warning per isolate. It is a tripwire, not a
 * feature: it changes no answer, and it costs a Map lookup.
 *
 * SLACK_MS keeps two honest races from tripping it. A transaction's now() is
 * its START, so another request's write that began a moment before ours and
 * committed after it carries an older updated_at than ours. That gap is
 * milliseconds; a cached answer is seconds to a minute old.
 */

const SLACK_MS = 1_000;
/** How many recent order writes to remember. Old ones fall off first. */
const MAX_TRACKED = 64;

/** `${tenantId}:${orderId}` -> the updated_at our write returned, ms. */
const ourWrites = new Map<string, number>();
/** tenantId -> the newest updated_at any of our writes returned, ms. */
const newestWrite = new Map<string, number>();
let warned = false;

function ms(iso: string): number {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : Number.NaN;
}

function warnOnce(detail: string): void {
  if (warned) return;
  warned = true;
  console.warn(
    `[db] STALE READ: ${detail}. Hyperdrive query caching looks ON for this ` +
      "config, and every read here assumes it is off. Disable it with " +
      "`npx wrangler hyperdrive update <id> --caching-disabled true` " +
      "(docs/PRINT_STALE_READS.md). Logged once per isolate.",
  );
}

/** Record what an order write of ours returned. */
export function noteOrderWrite(tenantId: string, orderId: number, updatedAt: string): void {
  const at = ms(updatedAt);
  if (Number.isNaN(at)) return;
  const key = `${tenantId}:${orderId}`;
  ourWrites.delete(key);
  ourWrites.set(key, at);
  if (ourWrites.size > MAX_TRACKED) ourWrites.delete(ourWrites.keys().next().value!);
  if (at > (newestWrite.get(tenantId) ?? Number.NEGATIVE_INFINITY)) newestWrite.set(tenantId, at);
}

/** An order as a read returned it: older than our own write of it is stale. */
export function checkOrderRead(tenantId: string, orderId: number, updatedAt: string, where: string): void {
  if (warned) return;
  const wrote = ourWrites.get(`${tenantId}:${orderId}`);
  if (wrote === undefined) return;
  const read = ms(updatedAt);
  if (read + SLACK_MS < wrote) {
    warnOnce(`${where} returned order ${orderId} as of ${updatedAt}, older than this isolate's write at ${new Date(wrote).toISOString()}`);
  }
}

/** The board version's database clock: behind our newest write is stale. */
export function checkVersionRead(tenantId: string, dbNow: string, where: string): void {
  if (warned) return;
  const wrote = newestWrite.get(tenantId);
  if (wrote === undefined) return;
  const read = ms(dbNow);
  if (read + SLACK_MS < wrote) {
    warnOnce(`${where} read the database clock as ${dbNow}, before this isolate's write at ${new Date(wrote).toISOString()}`);
  }
}

/** Scripts only: has it fired, and start over. */
export const staleReadTripwireForTests = {
  fired: (): boolean => warned,
  reset(): void {
    warned = false;
    ourWrites.clear();
    newestWrite.clear();
  },
};
