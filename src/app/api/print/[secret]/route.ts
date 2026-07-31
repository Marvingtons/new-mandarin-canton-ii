import {
  lateConfirmationGraceSeconds,
  printOfferCap,
  printOfferCooldownSeconds,
  printOffersBeforeCooldown,
  printRenderCap,
  publicTenant,
  ticketCopies,
  ticketCopyRoles,
} from "@/config/tenant.server";
import {
  JOB_MEDIA_TYPE_STARPRNT,
  NO_JOB,
  OFFERED_MEDIA_TYPES,
  describeConfirmation,
  jobResponse,
  matchOfferedMediaType,
  payloadHash,
  peripheralHeaders,
  printerMacAllowed,
  printerReportsHealthy,
  logPollBody,
  logPrinterLimits,
  readConfirmation,
  readPoll,
  readPrinterLimits,
  secretMatches,
  warnBuzzerUnavailable,
  type CloudPrntStatusResponse,
} from "@/lib/print/cloudprnt";
import {
  advancePrintSegment,
  bumpPrintAttempt,
  claimNextPrintJob,
  currentPrintJob,
  findRecentOrderByNumber,
  markPrinted,
  printSegmentState,
  recordPrintAttempt,
  recordPrintJobKey,
  recordPrintSegments,
  recordRenderFailure,
} from "@/lib/orders/repository";
import {
  deletePrintJob,
  getPrintJob,
  printJobKeyFor,
  printJobStoreReady,
  printJobUrl,
  putPrintJob,
} from "@/lib/print/jobStore";
import type { Order } from "@/lib/orders/types";
import { renderTicketJob, TICKET_WIDTH_PX } from "@/lib/ticket/render";
import { maxStarPrntRows } from "@/lib/ticket/starprnt";
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

  // FIRST thing in the path, before any gate can drop the request: print what
  // this printer actually sends. Once per shape, so once per boot. Star's poll
  // spec carries no decoding capability, but this is where we would see one if
  // this firmware volunteers it anyway.
  logPollBody(poll);

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

    // COOLDOWN — the thing that stops one missed confirmation becoming a roll
    // of paper. A-008 printed six times because every poll re-offered a job
    // the printer had already produced and the server had not recorded. After
    // two hand-overs with no DELETE, the job goes quiet for a minute: a slow
    // printer confirming late can no longer race a fresh copy out of the
    // queue, and a genuine failure still recovers, just not sixty times.
    if (job) {
      const held = coolingDown(job);
      if (held !== null) {
        console.warn(
          `[cloudprnt] verdict=cooldown ${job.orderNumber} — ${job.printAttempts} ` +
            `offers, no confirmation; holding ${held}s more before re-offering`,
        );
        return Response.json(NO_JOB);
      }
    }

    if (job) {
      const attempts = await bumpPrintAttempt(tenant.tenantId, job.id);
      if (attempts > printOfferCap()) {
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

    // Publish the body to R2 and point the printer at the object.
    //
    // This is where the 520 fix lives. The body no longer leaves through this
    // Worker's response — Star's `jobGetUrl` sends the printer to "a different
    // server for managing the print job file downloads such as a data 'blob'
    // service", which is an R2 object on our own zone: a static GET with a
    // fixed Content-Length and no streaming layer to negotiate with.
    //
    // Published at CLAIM, not per poll. The key ends in the sha256 of the
    // body, so the URL cannot be derived without rendering; the key is stored
    // and reused, and a re-offer of the same piece re-advertises the same
    // object rather than re-rendering a ticket that already exists.
    const jobUrl = await publishJobBody(tenant, job);

    const body: CloudPrntStatusResponse = {
      jobReady: true,
      // With the body already encoded and sitting in R2, the media type is no
      // longer the printer's to choose — so only the type of the object we
      // published is advertised. Falling back to the Worker path (no jobUrl)
      // restores the full menu, since then the GET does pick a format.
      mediaTypes: jobUrl ? [JOB_MEDIA_TYPE_STARPRNT] : OFFERED_MEDIA_TYPES,
      // Echoed back on the DELETE, which is what lets a confirmation name the
      // order it belongs to rather than being applied to whatever is in flight.
      jobToken: job.orderNumber,
      deleteMethod: "DELETE",
      // Only the GET moves. `jobConfirmationUrl` is deliberately left unset so
      // confirmations still come back here and the state machine is untouched.
      ...(jobUrl ? { jobGetUrl: jobUrl } : {}),
    };
    if (jobUrl) {
      console.info(`[cloudprnt] ${job.orderNumber} job body published at ${jobUrl}`);
    }
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

/**
 * Seconds still to wait before this job may be offered again, or null to offer.
 *
 * Reads the two columns the offer loop already maintains: `print_attempts`
 * counts hand-overs, and `updated_at` moves on every one of them, so "last
 * offered" needs no column of its own. Exported shape is deliberately a number
 * rather than a boolean so the log can say how much longer.
 */
function coolingDown(job: Order): number | null {
  const after = printOffersBeforeCooldown();
  const window = printOfferCooldownSeconds();
  if (window <= 0 || job.printAttempts < after) return null;
  const since = (Date.now() - Date.parse(job.updatedAt)) / 1000;
  if (!Number.isFinite(since)) return null;
  return since >= window ? null : Math.ceil(window - since);
}

/**
 * Print the headers a job response actually leaves with.
 *
 * Every previous round of this bug was argued from what the code intended to
 * send. The wire disagreed four times. These are the headers as constructed —
 * still not what Cloudflare finally emits, but the last point we control, so a
 * difference between this line and what curl sees is proof the change happened
 * downstream rather than here.
 *
 * Not sampled or deduplicated: a job GET happens a few times a day, and this
 * is the line worth having when one of them fails.
 */
function logJobResponse(orderNumber: string, response: Response): Response {
  const headers = [...response.headers.entries()]
    .map(([k, v]) => `${k}: ${v}`)
    .sort()
    .join(" | ");
  console.info(`[cloudprnt] ${orderNumber} response headers -> ${headers}`);
  return response;
}

/**
 * Make sure a body exists in R2 for the piece currently on offer, and return
 * the URL the printer should fetch.
 *
 * Returns null when the store is not configured, or when rendering or the
 * upload fails. Null is not an error path — it means the poll answers without
 * a `jobGetUrl` and the printer falls back to fetching from this Worker, which
 * still prints. A ticket served the slow way beats a ticket not offered.
 *
 * Idempotent per piece: the stored key short-circuits everything below, so the
 * render happens once per piece rather than once per poll.
 */
async function publishJobBody(
  tenant: { tenantId: string; timezone: string },
  job: Order,
): Promise<string | null> {
  if (!printJobStoreReady()) return null;

  const { segment, jobKey } = await printSegmentState(tenant.tenantId, job.id);
  if (jobKey) return printJobUrl(jobKey);

  try {
    const ticket = await renderTicketJob(
      job,
      { timezone: tenant.timezone, copies: ticketCopies(), copyRoles: ticketCopyRoles() },
      {
        format: "starprnt",
        // Star's 512KB GET cap, expressed as rows. Applies to the R2 object
        // exactly as it applied to the Worker response.
        maxHeight: maxStarPrntRows(TICKET_WIDTH_PX),
        segment,
      },
    );

    if (ticket.segments > 1) {
      // Read by DELETE to know whether the piece it confirms was the last.
      await recordPrintSegments(tenant.tenantId, job.id, ticket.segments);
    }

    const sha256 = await payloadHash(ticket.body);
    const key = printJobKeyFor(job.orderNumber, sha256);
    const stored = await putPrintJob(key, ticket.body);
    if (!stored) return null;

    await recordPrintJobKey(tenant.tenantId, job.id, key);
    console.info(
      `[cloudprnt] ${job.orderNumber} piece ${ticket.segment + 1}/${ticket.segments} ` +
        `-> R2 ${key} (${ticket.body.length} bytes, ${ticket.height}px) sha256=${sha256}`,
    );
    return printJobUrl(key);
  } catch (err) {
    // Counted like any other render failure so a template that cannot render
    // is eventually condemned rather than retried forever.
    const message = err instanceof Error ? err.message : "ticket render failed";
    const outcome = await recordRenderFailure(
      tenant.tenantId,
      job.id,
      message,
      printRenderCap(),
    );
    console.error(
      `[cloudprnt] publishing ${job.orderNumber} failed ` +
        `(attempt ${outcome?.attempts ?? "?"}, now ${outcome?.status ?? "?"}): ${message}`,
    );
    return null;
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

  // The printer echoes its chosen media type, and for the extended type that
  // value carries the height declarations as parameters — so this matches on
  // the media type alone. Anything we did not offer means a confused client;
  // serving a PNG it did not ask for would print garbage.
  const requested = url.searchParams.get("type");
  const mediaType = matchOfferedMediaType(requested);
  if (mediaType === null) {
    console.warn(
      `[cloudprnt] printer asked for ${requested}; ` +
        `only ${OFFERED_MEDIA_TYPES.join(" and ")} are offered`,
    );
    return new Response("", { status: 404 });
  }

  // What the printer says it can decode, read off this GET's query string —
  // the only place Star documents these. Logged on change, not per poll.
  const limits = readPrinterLimits(url);
  logPrinterLimits(limits);

  // StarPRNT command data needs no conversion on the printer, so it is the one
  // path that cannot hit the 511 memory failure — and the height ceiling the
  // printer declares describes its PNG converter, so it does not apply.
  const format = mediaType === JOB_MEDIA_TYPE_STARPRNT ? "starprnt" : "png";
  if (format === "starprnt") warnBuzzerUnavailable(mediaType);

  try {
    // If a body was already published for this piece, serve THOSE bytes rather
    // than rendering again. This is the fallback path — a printer that ignores
    // jobGetUrl, or a deployment with no bucket — and serving the published
    // object keeps the two paths byte-identical, so the sha256 in the log
    // describes whichever one the printer actually used.
    const published = await printSegmentState(tenant.tenantId, job.id);
    if (published.jobKey && format === "starprnt") {
      const body = await getPrintJob(published.jobKey);
      if (body) {
        const sha256 = await payloadHash(body);
        console.info(
          `[cloudprnt] serving ${job.orderNumber} from R2 ${published.jobKey} ` +
            `(${body.byteLength} bytes) sha256=${sha256}`,
        );
        return logJobResponse(
          job.orderNumber,
          jobResponse(body, mediaType, peripheralHeaders()),
        );
      }
    }

    // The height gate, and the only number allowed to drive it: the printer's
    // own. It gates the PNG paths only: mono_len is the ceiling for 1-bit PNG
    // (24bpp_len describes a format we no longer send), and neither bounds
    // command data. A null ceiling means the printer declared nothing, and
    // renderTicketJob sends the whole ticket rather than falling back to a
    // constant we made up.
    const { segment } = published;
    // starprnt has no conversion to run out of memory on, but it still has to
    // arrive: Star caps a job GET at 512KB for this printer class and answers
    // 521 above it. Command data is uncompressed, so that cap converts exactly
    // into a row count, and the same splitter the PNG path uses turns an
    // over-long ticket into consecutive jobs instead of one refusal.
    const ceiling =
      format === "starprnt" ? maxStarPrntRows(TICKET_WIDTH_PX) : limits.monoLen;
    const ticket = await renderTicketJob(
      job,
      { timezone: tenant.timezone, copies: ticketCopies(), copyRoles: ticketCopyRoles() },
      { format, maxHeight: ceiling, segment },
    );

    if (ticket.segments > 1) {
      // Recorded on every piece, not just the first: it is what DELETE reads
      // to know whether the piece it is confirming was the last one.
      await recordPrintSegments(tenant.tenantId, job.id, ticket.segments);
      console.info(
        `[cloudprnt] ${job.orderNumber} is ${ticket.totalHeight}px against a ` +
          `declared mono_len=${limits.monoLen}; sending piece ` +
          `${ticket.segment + 1}/${ticket.segments} (${ticket.height}px)`,
      );
    }

    // The hash of exactly what we handed over. This is the anchor for proving
    // a download byte-identical from outside: hash what the printer's URL
    // actually returns and compare. Anything that rewrote the body in between
    // — a compression layer, a re-encode, a truncated stream — moves it.
    const sha256 = await payloadHash(ticket.body);
    console.info(
      `[cloudprnt] serving ${job.orderNumber} as ${mediaType} ` +
        `(${ticket.body.length} bytes, ${ticket.height}px) sha256=${sha256}`,
    );

    // Peripheral control rides the response headers, which Star documents for
    // the PNG and text types only — on a starprnt job it must be in the print
    // data instead, and the TSP100IV accepts no command that does it (see
    // lib/ticket/starprnt.ts). Sent regardless: an unsupported header is
    // ignored, never a failed job.
    return logJobResponse(
      job.orderNumber,
      jobResponse(ticket.body, mediaType, peripheralHeaders()),
    );
  } catch (err) {
    // A render failure is USUALLY our bug — but "usually" is not "always", and
    // condemning the order on the first one threw away the cold-start OOMs and
    // resource blips that a second attempt would have printed. Count it, keep
    // the order QUEUED, and only fail it at printRenderCap(). The order stays
    // visible to the board and the unprinted-order alert either way.
    const message = err instanceof Error ? err.message : "ticket render failed";
    const outcome = await recordRenderFailure(
      tenant.tenantId,
      job.id,
      message,
      printRenderCap(),
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

/** Always 200 — see confirmPrinted. */
function acknowledged(): Response {
  return new Response("", { status: 200 });
}

/**
 * The confirmation, shared by DELETE and the `?delete` GET variant.
 *
 * Always answers 200. A printer that cannot get its confirmation acknowledged
 * may reprint, and a duplicate ticket is a far smaller problem than a jammed
 * confirmation loop.
 *
 * EVERY PATH THROUGH THIS FUNCTION LOGS, and that is the point of its current
 * shape. It used to have four ways to return without saying anything: no
 * database, a MAC mismatch, no job in flight, and a markPrinted that matched
 * no row. Order A-003 took the third: the offer cap had already retired it to
 * PRINT_FAILED, PRINTABLE_STATUSES contains only QUEUED, so `currentPrintJob`
 * no longer saw it, and its confirmation was dropped in silence — no warning,
 * no print recorded, and an order that had physically printed left looking as
 * though it never had.
 *
 * Worse than the silence was what the same line would do on a busier evening:
 * with the retired order invisible, `currentPrintJob` returns whatever job is
 * in flight NOW, and A-003's confirmation would have marked a DIFFERENT order
 * printed. Star sends `token` on the DELETE precisely so that cannot happen,
 * and this now resolves by token first.
 */
async function confirmPrinted(url: URL): Promise<Response> {
  const confirmation = readConfirmation(url);
  const described = describeConfirmation(confirmation);

  if (!isOrdersDbConfigured()) {
    console.warn(`[cloudprnt] DELETE ${described} — no database configured, nothing recorded`);
    return acknowledged();
  }

  if (!printerMacAllowed(url.searchParams.get("mac"))) {
    console.warn(`[cloudprnt] DELETE ${described} — unexpected printer MAC, ignoring`);
    return acknowledged();
  }

  const tenant = publicTenant();

  // WHICH order is this about? The token is our own jobToken echoed back, so
  // when it is present the answer is exact. currentPrintJob is the fallback
  // for firmware that omits it, and it is only a guess — it answers "what is
  // in flight now", which is not the same question once a job has been
  // retired or replaced.
  let order = confirmation.token
    ? await findRecentOrderByNumber(tenant.tenantId, confirmation.token)
    : null;
  let matchedBy = order ? "token" : "";
  if (!order) {
    order = await currentPrintJob(tenant.tenantId);
    matchedBy = confirmation.token ? "in-flight (token matched no order)" : "in-flight (no token)";
  }

  if (!order) {
    console.warn(
      `[cloudprnt] DELETE ${described} — NO ORDER MATCHED. Nothing was recorded. ` +
        "If the printer sent no token, the job it confirmed had already left " +
        "the printable set and this confirmation cannot be attributed.",
    );
    return acknowledged();
  }

  // One line per confirmation, before any branch, carrying the raw code and
  // the state it arrived into. This is the line whose absence made A-003 a
  // mystery rather than a five-second read.
  console.info(
    `[cloudprnt] DELETE ${order.orderNumber} ${described} matched-by=${matchedBy} ` +
      `status=${order.status} attempts=${order.printAttempts}`,
  );

  if (confirmation.verdict === "failure") {
    console.warn(
      `[cloudprnt] ${order.orderNumber} reported result code ` +
        `${JSON.stringify(confirmation.code)} — recording a print failure`,
    );
    await recordPrintAttempt(tenant.tenantId, order.id, {
      ok: false,
      error: `printer reported code ${confirmation.code}`,
    });
    return acknowledged();
  }

  // A success for a job we already gave up on. The paper came out; we simply
  // stopped waiting first, which is our misjudgement rather than the
  // printer's failure — so inside the grace window this is honoured. Outside
  // it, staff have had time to act on the board and a confirmation this old
  // is likelier a replay than news, so it is logged and left failed.
  if (order.status === "PRINT_FAILED") {
    const agoMs = Date.now() - Date.parse(order.updatedAt);
    const agoSeconds = Number.isFinite(agoMs) ? Math.round(agoMs / 1000) : null;
    const grace = lateConfirmationGraceSeconds();
    const withinGrace = agoSeconds !== null && agoSeconds <= grace;
    if (withinGrace) {
      console.warn(
        `[cloudprnt] LATE CONFIRMATION: ${order.orderNumber} confirmed ${agoSeconds}s ` +
          `after we gave up on it (grace ${grace}s) — honouring it as printed. ` +
          "Raise PRINT_OFFER_CAP if this repeats; the printer is slower than our patience.",
      );
    } else {
      console.error(
        `[cloudprnt] LATE CONFIRMATION: ${order.orderNumber} confirmed ` +
          `${agoSeconds ?? "?"}s after we gave up, outside the ${grace}s grace window — ` +
          "NOT honouring. The order stays PRINT_FAILED and visible to the board.",
      );
      return acknowledged();
    }
  }

  // A ticket too tall for this printer goes over as consecutive jobs, and the
  // printer confirms each one separately. So a confirmation only completes the
  // ORDER when it completes the SEQUENCE; otherwise it advances the cursor and
  // the next poll hands over the next piece. Half a ticket must never read as
  // PRINTED — that is the one outcome the board and the alert exist to prevent.
  const { segment, segments, jobKey } = await printSegmentState(
    tenant.tenantId,
    order.id,
  );
  // The paper is out; the published body has done its job. Removed here rather
  // than left to the bucket's 24h rule, so a ticket carrying a customer's name
  // and phone number is reachable for seconds rather than a day.
  if (jobKey) await deletePrintJob(jobKey);

  if (segments > 1 && segment + 1 < segments) {
    const next = await advancePrintSegment(tenant.tenantId, order.id);
    console.info(
      `[cloudprnt] ${order.orderNumber} piece ${segment + 1}/${segments} printed; ` +
        `${next + 1}/${segments} next`,
    );
    return acknowledged();
  }

  const printed = await markPrinted(tenant.tenantId, order.id);
  if (printed) {
    console.info(`[cloudprnt] ${printed.orderNumber} printed`);
  } else {
    // markPrinted only matches QUEUED and PRINT_FAILED, so this is an order
    // staff already advanced past printing, or a second confirmation for one
    // already marked. Neither is an error; both were previously invisible.
    console.warn(
      `[cloudprnt] ${order.orderNumber} confirmed but not marked printed — its ` +
        `status was ${order.status}, which markPrinted deliberately will not ` +
        "drag backwards. Most likely already printed, or advanced by staff.",
    );
  }

  return acknowledged();
}
