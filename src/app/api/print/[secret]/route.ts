import { publicTenant } from "@/config/tenant.server";
import {
  JOB_MEDIA_TYPE,
  MAX_PRINT_ATTEMPTS,
  MAX_RENDER_ATTEMPTS,
  NO_JOB,
  peripheralHeaders,
  printerMacAllowed,
  printerReportsHealthy,
  readPoll,
  secretMatches,
  type CloudPrntStatusResponse,
} from "@/lib/print/cloudprnt";
import {
  bumpPrintAttempt,
  claimNextPrintJob,
  currentPrintJob,
  markPrinted,
  recordPrintAttempt,
  recordRenderFailure,
} from "@/lib/orders/repository";
import { renderTicket } from "@/lib/ticket/render";
import { checkRateLimit, rateLimitResponse } from "@/lib/http/rateLimit";
import { clientIp } from "@/lib/http/clientIp";
import { isOrdersDbConfigured } from "@/lib/db/postgres";

/**
 * Star CloudPRNT endpoint — /api/print/<CLOUDPRNT_SECRET>.
 *
 * The printer is configured with this exact URL and polls it forever.
 *
 *   POST   — "any work?" Claims the oldest QUEUED order, answers jobReady.
 *   GET    — "send it."  Renders and returns the ticket PNG (+ buzzer header).
 *   DELETE — "printed."  The ONLY thing that sets status PRINTED.
 *
 * A GET we never hear back about deliberately leaves the order QUEUED. That
 * looks like a bug and is the opposite: with nothing prepaid, an order the
 * kitchen never saw is the worst outcome in this system, so an unconfirmed job
 * must stay visible to both the board and the unprinted-order alert.
 *
 * IDENTITY: the printer never sends a job id. GET and DELETE say only which
 * PRINTER is calling, so the server owns "which job is in flight" — hence
 * `currentPrintJob` rather than any token lookup.
 *
 * Node runtime: satori and resvg both need it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 404, never 401: an unauthenticated caller learns nothing from the shape. */
function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/**
 * Shared gate. Never logs the secret — it is the only credential this endpoint
 * has, and it travels in the URL where it would otherwise land in every log.
 */
async function authorize(
  request: Request,
  params: Promise<{ secret: string }>,
): Promise<Response | null> {
  const limit = checkRateLimit("cloudprnt_ip", clientIp(request));
  if (!limit.ok) return rateLimitResponse(limit);

  const { secret } = await params;
  if (!secretMatches(secret)) return notFound();
  return null;
}

/* ------------------------------------------------------------------ POST -- */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
): Promise<Response> {
  const denied = await authorize(request, params);
  if (denied) return denied;

  const poll = await readPoll(request);

  if (!printerMacAllowed(poll.printerMAC)) {
    console.warn("[cloudprnt] poll from an unexpected printer MAC — ignoring");
    return Response.json(NO_JOB);
  }

  // Advisory only. A printer reporting trouble still gets offered the job —
  // it may be a recoverable cover-open, and withholding work from the only
  // printer is never the safer choice.
  if (!printerReportsHealthy(poll)) {
    console.warn(`[cloudprnt] printer reports status ${poll.statusCode}`);
  }

  // No database means no jobs. Answer honestly and quietly; the printer keeps
  // polling, and the operator sees the real problem on /kitchen.
  if (!isOrdersDbConfigured()) return Response.json(NO_JOB);

  const tenant = publicTenant();

  try {
    // A job already handed over and not yet confirmed wins: re-offering the
    // same ticket is correct, and handing out a second while the first is
    // unaccounted for would double-print.
    let job = await currentPrintJob(tenant.tenantId);

    if (job) {
      const attempts = await bumpPrintAttempt(tenant.tenantId, job.id);
      if (attempts > MAX_PRINT_ATTEMPTS) {
        // Reachable but not printing. Stop retrying and make it loud.
        await recordPrintAttempt(tenant.tenantId, job.id, {
          ok: false,
          error: `no print confirmation after ${attempts} offers`,
        });
        console.warn(
          `[cloudprnt] ${job.orderNumber} gave up after ${attempts} unconfirmed offers`,
        );
        job = await claimNextPrintJob(tenant.tenantId);
      }
    } else {
      job = await claimNextPrintJob(tenant.tenantId);
    }

    if (!job) return Response.json(NO_JOB);

    const body: CloudPrntStatusResponse = {
      jobReady: true,
      // Exactly one type, so the printer's choice is not a variable.
      mediaTypes: [JOB_MEDIA_TYPE],
      // Advisory: the printer does not echo this on GET/DELETE, but it makes
      // the printer's own logs line up with ours.
      jobToken: job.orderNumber,
      deleteMethod: "DELETE",
    };
    return Response.json(body);
  } catch (err) {
    console.error(
      "[cloudprnt] poll failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    // Never hand the printer something it might interpret as a job.
    return Response.json(NO_JOB);
  }
}

/* ------------------------------------------------------------------- GET -- */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
): Promise<Response> {
  const denied = await authorize(request, params);
  if (denied) return denied;

  const url = new URL(request.url);

  // When a server advertises deleteMethod "GET", the printer confirms with a
  // GET carrying a BARE `delete` flag (no value). We advertise DELETE, but
  // firmware varies and a lost confirmation would leave a printed order
  // looking unprinted — so honour both. Test for KEY PRESENCE, never a value.
  if (url.searchParams.has("delete")) {
    return confirmPrinted(url);
  }

  if (!isOrdersDbConfigured()) return new Response("", { status: 404 });

  const tenant = publicTenant();

  if (!printerMacAllowed(url.searchParams.get("mac"))) {
    return notFound();
  }

  const job = await currentPrintJob(tenant.tenantId);
  // Nothing in flight. 404 is the honest answer; the printer re-polls.
  if (!job) return new Response("", { status: 404 });

  // The printer echoes its chosen media type. We advertise exactly one, so
  // anything else means a confused client — serving a PNG it did not ask for
  // would print garbage.
  const requested = url.searchParams.get("type");
  if (requested && requested !== JOB_MEDIA_TYPE) {
    console.warn(`[cloudprnt] printer asked for ${requested}; only ${JOB_MEDIA_TYPE} is offered`);
    return new Response("", { status: 404 });
  }

  try {
    const png = await renderTicket(job, { timezone: tenant.timezone });
    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": JOB_MEDIA_TYPE,
        "content-length": String(png.length),
        "cache-control": "no-store",
        // The audible alert rides on the response headers — see cloudprnt.ts.
        ...peripheralHeaders(),
      },
    });
  } catch (err) {
    // A render failure is USUALLY our bug — but "usually" is not "always", and
    // condemning the order on the first one threw away the cold-start OOMs and
    // resource blips that a second attempt would have printed. Count it, keep
    // the order QUEUED, and only fail it at MAX_RENDER_ATTEMPTS. The order
    // stays visible to the board and the unprinted-order alert either way.
    const message = err instanceof Error ? err.message : "ticket render failed";
    const outcome = await recordRenderFailure(
      tenant.tenantId,
      job.id,
      message,
      MAX_RENDER_ATTEMPTS,
    );
    console.error(
      `[cloudprnt] render failed for ${job.orderNumber} ` +
        `(attempt ${outcome?.attempts ?? "?"}, now ${outcome?.status ?? "?"}): ${message}`,
    );
    // 500 either way: the printer has no ticket. When the order is still
    // QUEUED its next poll re-offers this same job, so the poll loop is the
    // retry — nothing is scheduled.
    return new Response("", { status: 500 });
  }
}

/* ---------------------------------------------------------------- DELETE -- */

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
): Promise<Response> {
  const denied = await authorize(request, params);
  if (denied) return denied;
  return confirmPrinted(new URL(request.url));
}

/**
 * The confirmation, shared by DELETE and the `?delete` GET variant.
 *
 * Always answers 200. A printer that cannot get its confirmation acknowledged
 * may reprint, and a duplicate ticket is a far smaller problem than a jammed
 * confirmation loop.
 */
async function confirmPrinted(url: URL): Promise<Response> {
  if (!isOrdersDbConfigured()) return new Response("", { status: 200 });

  if (!printerMacAllowed(url.searchParams.get("mac"))) {
    return new Response("", { status: 200 });
  }

  const tenant = publicTenant();
  const job = await currentPrintJob(tenant.tenantId);
  if (!job) return new Response("", { status: 200 });

  // Star reports a result code when the job did not complete. Treat anything
  // other than an explicit success as a failure rather than a print — the
  // whole point of this verb is that it is the only trustworthy signal.
  const code = url.searchParams.get("code");
  if (code && !/^(200|0|ok)$/i.test(code)) {
    console.warn(`[cloudprnt] ${job.orderNumber} reported result code ${code}`);
    await recordPrintAttempt(tenant.tenantId, job.id, {
      ok: false,
      error: `printer reported code ${code}`,
    });
    return new Response("", { status: 200 });
  }

  const printed = await markPrinted(tenant.tenantId, job.id);
  if (printed) console.info(`[cloudprnt] ${printed.orderNumber} printed`);

  return new Response("", { status: 200 });
}
