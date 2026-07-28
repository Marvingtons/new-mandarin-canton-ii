import "server-only";

/**
 * PrintNode delivery.
 *
 * Entirely optional: with PRINTNODE_API_KEY or PRINTNODE_PRINTER_ID unset,
 * `submitPrintJob` is a no-op that logs and reports "skipped". The app —
 * checkout, tickets, the kitchen board — must run fine with no printer
 * hardware anywhere near it, because the board is the fallback and on day one
 * it is the ONLY thing.
 *
 * Credentials are Basic-auth (api key as username, empty password) and are
 * never logged, never interpolated into a URL, and never attached to an error.
 */

const API_URL = "https://api.printnode.com/printjobs";

/** Attempts for a failed submit, including the first. */
const MAX_ATTEMPTS = 3;

export type PrintOutcome =
  | { status: "printed"; jobId: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export interface PrintNodeConfig {
  apiKey: string;
  printerId: number;
}

/**
 * Read the printer config. Returns null when printing is not configured, which
 * every caller must treat as normal rather than as an error.
 *
 * The printer id is per-tenant like everything else — a second restaurant sets
 * its own PRINTNODE_PRINTER_ID and no code changes.
 */
export function printNodeConfig(): PrintNodeConfig | null {
  const apiKey = process.env.PRINTNODE_API_KEY;
  const printerRaw = process.env.PRINTNODE_PRINTER_ID;
  if (!apiKey || !printerRaw) return null;

  const printerId = Number.parseInt(printerRaw, 10);
  if (!Number.isFinite(printerId)) {
    console.warn("[print] PRINTNODE_PRINTER_ID is not a number — printing disabled");
    return null;
  }
  return { apiKey, printerId };
}

export function isPrintingConfigured(): boolean {
  return printNodeConfig() !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Statuses worth another attempt. A 4xx other than 429 will never succeed. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Submit raw printer bytes as a PrintNode job, retrying with exponential
 * backoff. Resolves rather than throws: the caller records the outcome on the
 * order and the customer is never affected either way.
 */
export async function submitPrintJob(args: {
  /** ESC/POS command bytes. */
  raw: Buffer;
  /** Shown in the PrintNode dashboard — helps the owner debug a jam. */
  title: string;
}): Promise<PrintOutcome> {
  const config = printNodeConfig();
  if (!config) {
    console.info(
      `[print] no printer configured — skipping "${args.title}". ` +
        "The order is on the /kitchen board.",
    );
    return { status: "skipped", reason: "printing is not configured" };
  }

  // Basic auth: api key as the username, empty password.
  const authorization = `Basic ${Buffer.from(`${config.apiKey}:`).toString("base64")}`;

  let lastError = "unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          printerId: config.printerId,
          title: args.title,
          // Raster ESC/POS bytes. PrintNode has no PNG content type, and raw
          // is what a thermal printer wants anyway (see lib/print/escpos.ts).
          contentType: "raw_base64",
          content: args.raw.toString("base64"),
          source: "new-mandarin-canton-order-platform",
        }),
        cache: "no-store",
      });

      if (response.ok) {
        // PrintNode returns the job id as a bare number.
        const jobId = Number(await response.text());
        return {
          status: "printed",
          jobId: Number.isFinite(jobId) ? jobId : 0,
        };
      }

      // Never echo the body wholesale — it can carry request context.
      lastError = `PrintNode responded ${response.status}`;
      if (!isRetryable(response.status) || attempt === MAX_ATTEMPTS) break;
    } catch {
      // A network-level failure can embed the request (and its auth header) in
      // the thrown cause, so it is deliberately not propagated.
      lastError = "network error reaching PrintNode";
      if (attempt === MAX_ATTEMPTS) break;
    }

    await sleep(2 ** attempt * 500);
  }

  console.warn(`[print] "${args.title}" failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
  return { status: "failed", error: lastError };
}
