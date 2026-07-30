import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { JOB_MEDIA_TYPE_STARPRNT } from "@/lib/print/cloudprnt";

/**
 * Print-job bodies as R2 objects, fetched by the printer directly.
 *
 * WHY THE BODY LEFT THE WORKER. Four production cycles ended in
 * `520 Download failed` on the job GET. The bytes themselves were never in
 * question — 1-bit raster, no PNG conversion, well inside Star's 512KB cap —
 * but the way they left this Worker was: OpenNext rebuilds the route's
 * Response as a stream, so it goes out chunked, without a Content-Length the
 * firmware can rely on, and negotiated against an Accept-Encoding the printer
 * advertises but cannot actually decode.
 *
 * None of that is worth fixing inside the response path when the protocol
 * already has a way out. Star's poll response carries `jobGetUrl`: "this field
 * may be provided to specify an alternative URL to perform the job GET. This
 * allows easy distribution to a different server for managing the print job
 * file downloads such as a data 'blob' service." An R2 object on a custom
 * domain is precisely that blob service — a static GET, fixed Content-Length,
 * no Worker in the path.
 *
 * A 301/302 from the job route would have been the other way to do it, and it
 * is NOT used here on purpose: Star's protocol guide documents no redirect
 * behaviour for the client at all, so following one would be an assumption
 * about firmware, and this file exists because of a run of those.
 *
 * WHAT STAYS ON THE WORKER: the poll, and the DELETE. `jobConfirmationUrl` is
 * deliberately not set, so confirmations come back to us exactly as before and
 * the state machine is untouched.
 *
 * PRIVACY. A ticket carries a customer's name and phone number, and a bucket
 * on a public custom domain serves whatever key is asked for. The key ends in
 * the sha256 of the body, which cannot be computed without already having the
 * bytes, so the URL is unguessable in practice rather than merely obscure.
 * Objects are deleted on confirmation, and the bucket carries a 24h lifecycle
 * rule as the backstop for jobs that are never confirmed.
 */

/** Key prefix inside the bucket. */
const KEY_PREFIX = "print-jobs/";

/**
 * The three R2 calls this file makes, typed structurally.
 *
 * NOT `R2Bucket` from @cloudflare/workers-types: tsconfig.json deliberately
 * does not load that package, because in the app's DOM+Node world it fights
 * with the lib types over Request/Response/fetch — see the note in
 * tsconfig.worker.json. Declaring the surface actually used keeps this file
 * typed without restarting that argument.
 */
interface JobBucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

interface PrintJobEnv {
  PRINT_JOBS?: JobBucket;
  PRINT_JOBS_PUBLIC_BASE?: string;
}

function printJobEnv(): PrintJobEnv {
  try {
    return getCloudflareContext().env as unknown as PrintJobEnv;
  } catch {
    // Off-request, or plain Node (scripts, `next dev` without the adapter).
    return {};
  }
}

/**
 * Is the R2 path usable?
 *
 * Both halves are required and they fail differently: without the binding
 * there is nowhere to put the body, and without the public base there is no
 * URL to hand the printer even though the object would exist. Either way we
 * fall back to serving from the Worker, which still works — it is just the
 * path that produced the 520s, so this returning false is worth noticing.
 */
export function printJobStoreReady(): boolean {
  const env = printJobEnv();
  return Boolean(env.PRINT_JOBS && env.PRINT_JOBS_PUBLIC_BASE);
}

/** `print-jobs/<token>-<sha256>.bin` */
export function printJobKeyFor(token: string, sha256: string): string {
  // The token is an order number we generate (A-017); the hash is hex. Neither
  // can contain a path separator, but the token is still sanitised because a
  // key is a URL path segment and this is the only place that is enforced.
  const safeToken = token.replace(/[^A-Za-z0-9._-]/g, "");
  return `${KEY_PREFIX}${safeToken}-${sha256}.bin`;
}

/** The URL the printer will fetch, or null when the store is not configured. */
export function printJobUrl(key: string): string | null {
  const base = printJobEnv().PRINT_JOBS_PUBLIC_BASE;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/${key}`;
}

/**
 * Publish a job body and return its key.
 *
 * The content type is set on the OBJECT, so R2 serves it on the public GET
 * without the Worker choosing it per request. Returns null when the store is
 * unavailable or the write fails — callers fall back rather than lose a
 * ticket, because a job served the slow way still prints and a job not offered
 * at all does not.
 */
export async function putPrintJob(
  key: string,
  body: Uint8Array,
): Promise<string | null> {
  const bucket = printJobEnv().PRINT_JOBS;
  if (!bucket) return null;
  try {
    // A Uint8Array is an ArrayBufferView, so R2 stores exactly these bytes —
    // byteOffset and byteLength included, no cast and no re-encode.
    await bucket.put(key, body, {
      httpMetadata: {
        contentType: JOB_MEDIA_TYPE_STARPRNT,
        // The object is a one-shot job body; nothing should hold a copy.
        cacheControl: "no-store, no-transform",
      },
    });
    return key;
  } catch (err) {
    console.error(
      `[cloudprnt] R2 put failed for ${key}: ` +
        (err instanceof Error ? err.message : "unknown error"),
    );
    return null;
  }
}

/** Read a published body back, for the Worker-served fallback path. */
export async function getPrintJob(key: string): Promise<Uint8Array | null> {
  const bucket = printJobEnv().PRINT_JOBS;
  if (!bucket) return null;
  try {
    const object = await bucket.get(key);
    if (!object) return null;
    return new Uint8Array(await object.arrayBuffer());
  } catch (err) {
    console.error(
      `[cloudprnt] R2 get failed for ${key}: ` +
        (err instanceof Error ? err.message : "unknown error"),
    );
    return null;
  }
}

/**
 * Remove a published body.
 *
 * Never throws: a job that printed has printed, and failing a confirmation
 * because the cleanup failed would turn a success into a re-print. The 24h
 * lifecycle rule on the bucket is the backstop.
 */
export async function deletePrintJob(key: string): Promise<void> {
  const bucket = printJobEnv().PRINT_JOBS;
  if (!bucket) return;
  try {
    await bucket.delete(key);
  } catch (err) {
    console.warn(
      `[cloudprnt] R2 delete failed for ${key} (lifecycle will collect it): ` +
        (err instanceof Error ? err.message : "unknown error"),
    );
  }
}
