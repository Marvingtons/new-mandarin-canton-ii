import "server-only";

/**
 * Typed fetch wrapper for the Clover REST APIs.
 *
 * SECURITY — this module is the single choke point through which every Clover
 * credential travels, so the leak-prevention rules live here and nowhere else:
 *
 *  1. The bearer token is passed as an argument and attached to the request
 *     headers. It is NEVER interpolated into a URL, a log line, or an error.
 *  2. Errors carry only { status, method, redacted path, Clover error code }.
 *     Request headers and the raw request are never attached, so a reflexive
 *     `console.error(err)` upstream cannot serialize an Authorization header.
 *  3. Any caller that must put a secret in the path (Clover's token inspector
 *     does) passes `redactPath` so the logged/thrown path is masked.
 *
 * Never `console.log` the token, the headers, or the init object in here.
 */

export interface CloverErrorPayload {
  message?: string;
  code?: string;
  error?: { message?: string; code?: string };
}

/** An error safe to log: no credentials, no request headers, no body echo. */
export class CloverApiError extends Error {
  readonly status: number;
  readonly method: string;
  /** Path with any secret segment masked. */
  readonly path: string;
  readonly code: string | null;

  constructor(args: {
    status: number;
    method: string;
    path: string;
    code?: string | null;
    message: string;
  }) {
    super(`Clover ${args.method} ${args.path} -> ${args.status}: ${args.message}`);
    this.name = "CloverApiError";
    this.status = args.status;
    this.method = args.method;
    this.path = args.path;
    this.code = args.code ?? null;
  }

  /**
   * Clover never returns 403 — it collapses "bad token" and "token lacks the
   * required permission" into a single 401. So a 401 on an endpoint we believe
   * is correct means: the token is invalid OR it is missing the permission.
   */
  get isAuthOrPermission(): boolean {
    return this.status === 401;
  }
}

export interface CloverFetchOptions {
  /** Absolute base, e.g. https://apisandbox.dev.clover.com */
  baseUrl: string;
  /** Path beginning with a slash. */
  path: string;
  token: string;
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Extra headers (e.g. Idempotency-Key). Never put credentials here. */
  headers?: Record<string, string>;
  /**
   * Path to use in logs/errors when the real path embeds a secret.
   * e.g. "/v3/access_tokens/***"
   */
  redactPath?: string;
  /** Max attempts for 429/5xx. Default 3. */
  maxAttempts?: number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: CloverFetchOptions["query"],
): string {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Perform a Clover API call with retry/backoff on 429 and 5xx.
 * Honors Retry-After when present, otherwise exponential backoff.
 */
export async function cloverFetch<T>(opts: CloverFetchOptions): Promise<T> {
  const {
    baseUrl,
    path,
    token,
    method = "GET",
    query,
    body,
    headers = {},
    redactPath,
    maxAttempts = 3,
  } = opts;

  // The only place the token is used. Never logged, never in the URL.
  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    // Clover expects a identifying UA; keep it generic and non-sensitive.
    "User-Agent": "new-mandarin-canton-order-platform/1.0",
    ...headers,
  };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";

  /** What we are allowed to show in logs and errors. */
  const safePath = redactPath ?? path;
  const url = buildUrl(baseUrl, path, query);

  let lastError: CloverApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Clover data is cached deliberately by callers (unstable_cache), so
        // the transport itself must never be cached by Next.
        cache: "no-store",
      });
    } catch (cause) {
      // A network-level failure. The thrown cause can embed the request URL,
      // so we deliberately do NOT propagate it — we raise a clean error.
      lastError = new CloverApiError({
        status: 0,
        method,
        path: safePath,
        message: "network error",
      });
      if (attempt < maxAttempts) {
        await sleep(2 ** attempt * 250);
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    // Read the error body for a Clover error code, but never echo it wholesale
    // into logs — it can contain request context.
    let code: string | null = null;
    let message = response.statusText || "request failed";
    try {
      const payload = (await response.json()) as CloverErrorPayload;
      code = payload.code ?? payload.error?.code ?? null;
      message = payload.message ?? payload.error?.message ?? message;
    } catch {
      /* non-JSON error body — keep the status text */
    }

    lastError = new CloverApiError({
      status: response.status,
      method,
      path: safePath,
      code,
      message,
    });

    if (!RETRYABLE.has(response.status) || attempt === maxAttempts) {
      throw lastError;
    }

    const retryAfter = Number.parseInt(
      response.headers.get("retry-after") ?? "",
      10,
    );
    await sleep(
      Number.isFinite(retryAfter) ? retryAfter * 1000 : 2 ** attempt * 250,
    );
  }

  throw lastError ?? new Error("Clover request failed");
}
