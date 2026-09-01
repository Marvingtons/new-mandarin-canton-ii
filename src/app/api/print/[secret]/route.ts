import {
  lateConfirmationGraceSeconds,
  printConfirmFloorSeconds,
  printFetchViaWorker,
  printOfferCap,
  printRenderCap,
  printSecondsPerCopy,
  publicTenant,
  ticketCopies,
  ticketCopyRoles,
} from "@/config/tenant.server";
import {
  confirmationWindowSeconds,
  decideOffer,
} from "@/lib/print/entitlement";
import { readPrinterCondition } from "@/lib/print/printerStatus";
import { recordPoll } from "@/lib/print/healthStore";
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
  claimNextPrintJob,
  confirmPrintDelivery,
  currentPrintJob,
  getOrderById,
  getPrintDelivery,
  printSegmentState,
  recordDeliveryFetch,
  recordPrintAttempt,
  recordPrintJobKey,
  recordPrintSegments,
  recordRenderFailure,
  reofferPrintDelivery,
  requeueAfterPrinterRestored,
  type ConfirmDeliveryInput,
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

/**
 * How far BEFORE the printer admitted a problem the requeue looks.
 *
 * The order that dies of a paper-out usually dies before the status flips: the
 * roll runs out mid-job, the job is never confirmed, the confirmation window
 * expires its allowance, and the order is condemned — all while the printer is
 * still reporting whatever it was reporting. Five minutes covers a full
 * delivery-cap sequence (4 hand-overs × a 90s window) with room over.
 */
const PAPER_RESTORE_LEAD_SECONDS = 300;

/**
 * Fallback window when the outage has no recorded start — a row written before
 * migration 007, or a restore observed on the very first poll after a deploy.
 * Deliberately short: with no evidence of when the outage began, requeuing an
 * hour of history would put long-abandoned orders back on the line.
 */
const PAPER_RESTORE_LOOKBACK_SECONDS = 900;

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

  // No database means no jobs, and nowhere to record health either. Answer
  // honestly and quietly; the printer keeps polling, and the operator sees the
  // real problem on the kitchen screen.
  if (!isOrdersDbConfigured()) return Response.json(NO_JOB);

  const tenant = publicTenant();

  try {
    /* ---------------- what the printer just told us ---------------- */
    //
    // Read and recorded BEFORE any job logic, because the answer decides
    // whether there is any job logic to do. This is the signal the system was
    // throwing away: a printer out of paper polled exactly like a healthy one,
    // so it was handed jobs it could not print until the retry budget ran out
    // and the orders were condemned. Paper came back to an empty queue.
    const condition = readPrinterCondition(poll);
    const transition = await recordPoll(
      tenant.tenantId,
      condition,
      poll.printerMAC ?? null,
    );

    // EDGES ONLY. A line every three seconds for the life of the deployment
    // buries everything worth reading; a line when the paper runs out is the
    // one somebody needs.
    if (transition.firstEver) {
      console.info(
        `[printer] first poll from this printer — status ${JSON.stringify(condition.statusCode)}`,
      );
    } else if (transition.returnedFromSilence) {
      console.warn(
        `[printer] BACK after ${Math.round(transition.secondsSincePreviousPoll ?? 0)}s of silence ` +
          `— status ${JSON.stringify(condition.statusCode)}`,
      );
    }
    if (transition.blocked) {
      console.warn(
        `[printer] ${transition.blockedReason?.toUpperCase()} — status ` +
          `${JSON.stringify(condition.statusCode)} raw=${JSON.stringify(condition.statusRaw)}. ` +
          "Withholding jobs until it clears; no retry budget will be spent.",
      );
    }

    /* ---------------- paper is back ---------------- */
    if (transition.unblocked) {
      console.warn(
        `[printer] RECOVERED from ${transition.previousBlockedReason} — status ` +
          `${JSON.stringify(condition.statusCode)}`,
      );
      // The edge is reported by a single atomic statement, so this runs once
      // per outage however many polls arrive at the same moment.
      const since = transition.blockedSince
        ? new Date(transition.blockedSince)
        : new Date(Date.now() - PAPER_RESTORE_LOOKBACK_SECONDS * 1000);
      try {
        const restored = await requeueAfterPrinterRestored(
          tenant.tenantId,
          since,
          PAPER_RESTORE_LEAD_SECONDS,
        );
        if (restored.length > 0) {
          console.warn(
            `[printer] PAPER-RESTORED REQUEUE: ${restored.length} order(s) put back in ` +
              `the queue — ${restored.join(", ")}. They were condemned during the outage ` +
              `that began ${since.toISOString()}; their print budgets are reset and the ` +
              "confirmation window governs them from here like any other job.",
          );
        } else {
          console.info(
            "[printer] PAPER-RESTORED REQUEUE: nothing to put back — no order was " +
              "condemned during the outage.",
          );
        }
      } catch (err) {
        // A failed requeue must not also cost the poll its job. The kitchen
        // board still shows every one of these orders.
        console.error(
          "[printer] paper-restored requeue failed:",
          err instanceof Error ? err.message : "unknown error",
        );
      }
    }

    /* ---------------- the gate ---------------- */
    //
    // THE WHOLE POINT: no offer, and NO ATTEMPT COUNTED. Returning here is
    // before `currentPrintJob`, before any hand-over is counted or a delivery
    // stamped — so a printer that is out of paper for an hour costs an order
    // exactly nothing, and the queue it comes back to is intact.
    if (transition.blockedReason !== null) {
      return Response.json(NO_JOB);
    }

    // Advisory only, and deliberately NOT a gate. A printer reporting some
    // other fault is still the only printer, and a non-2xx status can be
    // transient — withholding work from it is how a recoverable blip becomes
    // an unprinted order.
    if (!condition.online) {
      console.warn(
        `[cloudprnt] printer reports status ${JSON.stringify(condition.statusCode)} ` +
          "— still offering work; only paper-out and cover-open withhold it",
      );
    }

    // Config read once. The fresh-claim window assumes a whole ticket (one
    // piece); a re-offer uses the decision's window, which knows the split.
    const copies = ticketCopies();
    const floor = printConfirmFloorSeconds();
    const perCopy = printSecondsPerCopy();
    const cap = printOfferCap();
    const freshWindow = confirmationWindowSeconds(copies, floor, perCopy, 1);

    // A job already handed over and not yet confirmed wins: re-offering the
    // same ticket is correct WHEN WE ARE ENTITLED TO, and handing out a second
    // while the first is unaccounted for would double-print.
    let job = await currentPrintJob(tenant.tenantId);

    // ENTITLEMENT — the thing that stops one order printing its copy-set over
    // and over. The rule and its reasoning live in lib/print/entitlement.ts;
    // this is only the plumbing. Every decision is logged verdict-style,
    // because the previous rounds of this bug were diagnosed from paper rather
    // than from logs that said what the server had decided.
    if (job) {
      // The piece in flight, so the window budgets the paper in THAT piece
      // rather than the whole copy set, and so every piece gets the same
      // number of hand-overs. Read before the decision because both terms
      // depend on it.
      const inFlight = await printSegmentState(tenant.tenantId, job.id);
      const decision = decideOffer({
        now: Date.now(),
        deliveryId: job.printDeliveryId,
        deliveryExpiresAt: job.printDeliveryExpiresAt,
        offeredAt: job.offeredAt,
        printAttempts: job.printAttempts,
        copies,
        floorSeconds: floor,
        perCopySeconds: perCopy,
        deliveryCap: cap,
        segments: inFlight.segments,
        segmentIndex: inFlight.segment,
      });

      const elapsed =
        decision.elapsedSeconds === null ? "-" : `${decision.elapsedSeconds.toFixed(0)}s`;
      const line =
        `[cloudprnt] verdict=${decision.verdict} ${job.orderNumber} ` +
        `attempts=${job.printAttempts} delivery=${job.printDeliveryId ?? "none"} ` +
        `window=${decision.windowSeconds}s elapsed=${elapsed} — ${decision.reason}`;
      if (decision.verdict === "hold") console.info(line);
      else console.warn(line);

      if (decision.verdict === "hold") return Response.json(NO_JOB);

      if (decision.verdict === "capped") {
        // Reachable but not printing. Stop retrying and make it loud.
        await recordPrintAttempt(tenant.tenantId, job.id, {
          ok: false,
          error: `no print confirmation after ${job.printAttempts} hand-overs`,
        });
        job = await claimNextPrintJob(tenant.tenantId, freshWindow);
      } else {
        // retry (an expired delivery, or the next piece of a split). A NEW
        // delivery with its own id and expiry — never a re-stamp of the old
        // one — so the confirmation for the previous hand-over cannot close
        // this one. The window is the piece-aware one from the decision.
        //
        // reofferPrintDelivery returns null when the order is no longer
        // offerable — a confirm flipped it out of QUEUED, or its delivery was
        // already confirmed, between currentPrintJob's read and this write. That
        // is the race that reprinted a confirmed order; skip-retry rather than
        // resurrect it.
        const superseded = job.printDeliveryId;
        const reoffered = await reofferPrintDelivery(
          tenant.tenantId,
          job.id,
          decision.windowSeconds,
          "retry",
        );
        if (!reoffered) {
          console.warn(
            `[cloudprnt] skip-retry ${job.orderNumber} delivery=${superseded ?? "none"} ` +
              "already-confirmed or no longer QUEUED — not re-offering",
          );
          return Response.json(NO_JOB);
        }
        job = reoffered;
      }
    } else {
      job = await claimNextPrintJob(tenant.tenantId, freshWindow);
    }

    if (!job) return Response.json(NO_JOB);

    // Every offer path above stamps a delivery id in the same statement. If it
    // is somehow absent, refuse rather than hand over an unidentifiable job.
    const deliveryId = job.printDeliveryId;
    if (!deliveryId) {
      console.error(
        `[cloudprnt] ${job.orderNumber} offered with no delivery id — refusing`,
      );
      return Response.json(NO_JOB);
    }

    // Publish the body to R2 and point the printer at the object.
    //
    // This is where the 520 fix lives. The body no longer leaves through this
    // Worker's response — Star's `jobGetUrl` sends the printer to "a different
    // server for managing the print job file downloads such as a data 'blob'
    // service", which is an R2 object on our own zone: a static GET with a
    // fixed Content-Length and no streaming layer to negotiate with.
    //
    // Published per DELIVERY: the key carries the delivery id, so a re-offer is
    // a genuinely new URL and a printer holding a stale handle cannot re-fetch
    // the previous body. The key is stored and reused within one delivery, so
    // the render happens once per delivery rather than once per poll.
    const jobUrl = await publishJobBody(tenant, job, deliveryId);

    // The GET URL always encodes the delivery identity. On the R2 path that is
    // the delivery id in the object key. On the fallback path (no bucket, or
    // firmware that honours jobGetUrl) it is a token on this same endpoint, so
    // the Worker GET can count the fetch and refuse a superseded or confirmed
    // delivery. The token IS the authorization for that specific body.
    //
    // ⚠️ TODO(confirm): whether this printer's firmware appends its own mac/type
    // query params to a jobGetUrl that already carries one. The GET tolerates
    // both missing (token authorizes; absent type falls back to the star PNG),
    // but bench-confirm on the real unit. The R2 primary path is unaffected.
    const pollUrl = new URL(request.url);
    const selfGetUrl = `${pollUrl.origin}${pollUrl.pathname}?token=${encodeURIComponent(deliveryId)}`;

    // PRIMARY fetch URL. Default: the R2 object directly (proven path; the
    // Worker never sees the fetch). With PRINT_FETCH_VIA_WORKER on: the Worker's
    // own GET, so the fetch is counted and gated before a 302 to R2 — see
    // printFetchViaWorker() for why that is opt-in.
    const advertisedGetUrl = printFetchViaWorker() ? selfGetUrl : (jobUrl ?? selfGetUrl);

    const body: CloudPrntStatusResponse = {
      jobReady: true,
      // With the body already encoded and sitting in R2, the media type is no
      // longer the printer's to choose — so only the type of the object we
      // published is advertised. The fallback (no jobUrl) restores the full
      // menu, since then the Worker GET picks a format from `type=`.
      mediaTypes: jobUrl ? [JOB_MEDIA_TYPE_STARPRNT] : OFFERED_MEDIA_TYPES,
      // The DELIVERY ID — not the order number any more. This is what lets a
      // confirmation close the exact hand-over it belongs to rather than
      // "whatever is in flight for this order now".
      jobToken: deliveryId,
      deleteMethod: "DELETE",
      // Only the GET moves. `jobConfirmationUrl` is deliberately left unset so
      // confirmations still come back here and the state machine is untouched.
      jobGetUrl: advertisedGetUrl,
    };
    console.info(
      `[cloudprnt] ${job.orderNumber} delivery=${deliveryId} handed over ` +
        `at ${advertisedGetUrl}`,
    );
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
 * Idempotent per DELIVERY: a stored key from THIS delivery short-circuits
 * everything below, so the render happens once per delivery rather than once
 * per poll. A key left from a PREVIOUS delivery does not short-circuit — the
 * re-offer cleared print_job_key precisely so this re-renders under the new
 * delivery-scoped key rather than pointing the printer at the old object.
 */
async function publishJobBody(
  tenant: { tenantId: string; timezone: string },
  job: Order,
  deliveryId: string,
): Promise<string | null> {
  if (!printJobStoreReady()) return null;

  const { segment, jobKey } = await printSegmentState(tenant.tenantId, job.id);
  if (jobKey && jobKey.includes(deliveryId)) return printJobUrl(jobKey);

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

    /* UNCONDITIONAL, including segments === 1. This used to be guarded on
       "> 1", which made print_segments a one-way latch: it could record 2
       and never record 1 again. If a plan shrank between polls — a deploy
       that changed the layout, TICKET_COPIES coming down — the column
       still said 2, so DELETE advanced a cursor the new plan had no piece
       for, and the order either reprinted a copy or burned its render
       budget asking for a segment that did not exist. The column must
       always describe the render it came from. */
    await recordPrintSegments(tenant.tenantId, job.id, ticket.segments);

    const sha256 = await payloadHash(ticket.body);
    const key = printJobKeyFor(job.orderNumber, deliveryId, sha256, ticket.segment);
    const stored = await putPrintJob(key, ticket.body);
    if (!stored) return null;

    await recordPrintJobKey(tenant.tenantId, job.id, key);
    console.info(
      `[cloudprnt] ${job.orderNumber} delivery=${deliveryId} piece ${ticket.segment + 1}/${ticket.segments} ` +
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

  // Resolve WHICH delivery this GET is for. The job URL we hand out carries the
  // delivery id as `token`, so a fetch is addressable to a specific hand-over —
  // which is what lets us count it, and refuse one for a delivery that has been
  // superseded by a re-offer or already confirmed. The token is unguessable and
  // scoped to one body, so it authorizes the fetch on its own; the mac is only
  // required for the bare, tokenless GET a firmware that ignores jobGetUrl makes.
  const token = url.searchParams.get("token");
  let job: Order | null;
  let deliveryId: string | null;

  if (token) {
    const delivery = await getPrintDelivery(tenant.tenantId, token);
    if (!delivery) {
      console.warn(`[cloudprnt] GET token=${token} — no such delivery; 404`);
      return new Response("", { status: 404 });
    }
    if (delivery.confirmedAt !== null) {
      // The paper already came out and was confirmed. A re-fetch here is the
      // silent double-print; 410 Gone stops it printing a second time.
      console.warn(
        `[cloudprnt] GET token=${token} — delivery already confirmed at ` +
          `${delivery.confirmedAt}; 410 Gone (refusing a post-confirmation re-fetch)`,
      );
      return new Response("", { status: 410 });
    }
    const order = await getOrderById(tenant.tenantId, delivery.orderId);
    if (!order) return new Response("", { status: 404 });
    if (order.printDeliveryId !== token) {
      // A newer delivery has superseded this one (the window expired and it was
      // re-offered). The old handle must not print.
      console.warn(
        `[cloudprnt] GET token=${token} — superseded by delivery=` +
          `${order.printDeliveryId ?? "none"}; 410 Gone`,
      );
      return new Response("", { status: 410 });
    }
    job = order;
    deliveryId = token;
  } else {
    // Bare Star GET (firmware that ignores jobGetUrl): mac-gated, current job.
    if (!printerMacAllowed(url.searchParams.get("mac"))) {
      return notFound();
    }
    job = await currentPrintJob(tenant.tenantId);
    // Nothing in flight. 404 is the honest answer; the printer re-polls.
    if (!job) return new Response("", { status: 404 });
    deliveryId = job.printDeliveryId;
  }

  // Worker-mediated fetch (PRINT_FETCH_VIA_WORKER, opt-in): count the fetch and
  // 302-redirect the printer to the per-delivery R2 object. This keeps the heavy
  // body off the Worker — the 520 fix stays intact — while making every fetch
  // visible (fetch_count) and gate-able (the confirmed/superseded 410 above
  // already ran). Only the token path (the advertised jobGetUrl) redirects; a
  // bare GET from firmware that ignores jobGetUrl still streams through below.
  //
  // ⚠️ If this printer's firmware does not follow the 302, tickets will stop
  // printing — flip PRINT_FETCH_VIA_WORKER off (back to R2-direct) or replace
  // this branch with a stream-through-Worker serve, and verify with `wrangler
  // tail`. See printFetchViaWorker().
  if (token && deliveryId && printFetchViaWorker() && printJobStoreReady()) {
    const state = await printSegmentState(tenant.tenantId, job.id);
    const r2Url = state.jobKey ? printJobUrl(state.jobKey) : null;
    if (r2Url) {
      const fetchCount = await recordDeliveryFetch(tenant.tenantId, deliveryId);
      console.info(
        `[cloudprnt] ${job.orderNumber} delivery=${deliveryId} fetch -> 302 R2 ` +
          `${state.jobKey} fetch_count=${fetchCount ?? "?"}`,
      );
      return new Response(null, { status: 302, headers: { location: r2Url } });
    }
    // No R2 object published yet — fall through and serve/render through the Worker.
  }

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
        const fetchCount = deliveryId
          ? await recordDeliveryFetch(tenant.tenantId, deliveryId)
          : null;
        console.info(
          `[cloudprnt] serving ${job.orderNumber} delivery=${deliveryId ?? "none"} ` +
            `from R2 ${published.jobKey} (${body.byteLength} bytes) ` +
            `fetch_count=${fetchCount ?? "?"} sha256=${sha256}`,
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

    {
      // Recorded on every piece, and for a one-piece render too — see the
      // POST site for why the "> 1" guard was a latch rather than a saving.
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
    const fetchCount = deliveryId
      ? await recordDeliveryFetch(tenant.tenantId, deliveryId)
      : null;
    console.info(
      `[cloudprnt] serving ${job.orderNumber} delivery=${deliveryId ?? "none"} ` +
        `as ${mediaType} (${ticket.body.length} bytes, ${ticket.height}px) ` +
        `fetch_count=${fetchCount ?? "?"} sha256=${sha256}`,
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
 * RESOLVES BY DELIVERY ID. The token is the delivery id we handed the printer,
 * echoed back — so a confirmation closes the EXACT hand-over it belongs to. A
 * token that names no delivery, or one already confirmed, writes nothing and is
 * logged as a stale-confirm. There is NO "whatever is in flight now" fallback
 * any more: that guess is what let A-003's late confirmation mark a DIFFERENT
 * order printed once the retired order had left the printable set, and
 * per-delivery identity removes the need for it.
 *
 * The close is ONE transaction — delivery confirmed, order closed, pointer
 * cleared — and the R2 delete happens AFTER it commits. The gap the old
 * revoke → network → markPrinted sequence left (QUEUED, attempts>0, no stamp,
 * one poll from a duplicate) cannot exist here. EVERY PATH LOGS.
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

  // WHICH delivery is this about? The token IS the delivery id we handed out,
  // echoed back. No token, an unknown token, or one already confirmed all mean
  // there is nothing to close — logged as a stale-confirm, 200, nothing written.
  const token = confirmation.token;
  if (!token) {
    console.warn(
      `[cloudprnt] stale-confirm token=(absent) ${described} — no delivery to close, nothing recorded`,
    );
    return acknowledged();
  }

  const delivery = await getPrintDelivery(tenant.tenantId, token);
  if (!delivery) {
    console.warn(
      `[cloudprnt] stale-confirm token=${token} ${described} — no such delivery, nothing recorded`,
    );
    return acknowledged();
  }
  if (delivery.confirmedAt !== null) {
    console.warn(
      `[cloudprnt] stale-confirm token=${token} ${described} — delivery already ` +
        `confirmed at ${delivery.confirmedAt}, nothing recorded`,
    );
    return acknowledged();
  }

  const order = await getOrderById(tenant.tenantId, delivery.orderId);
  if (!order) {
    console.warn(
      `[cloudprnt] stale-confirm token=${token} ${described} — delivery has no order, nothing recorded`,
    );
    return acknowledged();
  }

  // The delivery must still be the order's CURRENT in-flight one. If a newer
  // delivery has superseded it — the window expired and we re-offered, or staff
  // reprinted — this confirmation is for a hand-over we have already given up on
  // and replaced, so it is stale: the live delivery is the authority, and
  // honouring this one would clear the live delivery's pointer and could confirm
  // the wrong hand-over. (Unknown and already-confirmed tokens were caught
  // above; this catches the superseded case.)
  if (order.printDeliveryId !== token) {
    console.warn(
      `[cloudprnt] stale-confirm token=${token} ${described} — superseded by delivery=` +
        `${order.printDeliveryId ?? "none"} on ${order.orderNumber} (${order.status}), nothing recorded`,
    );
    return acknowledged();
  }

  // One line per confirmation, before any branch: the raw code, the delivery,
  // its fetch count, and the state it arrived into.
  console.info(
    `[cloudprnt] DELETE ${order.orderNumber} ${described} delivery=${token} ` +
      `fetch_count=${delivery.fetchCount} status=${order.status} attempts=${order.printAttempts}`,
  );

  // Decide the outcome and whether to honour it as printed; the close itself is
  // atomic (delivery + order + pointer in one transaction) inside
  // confirmPrintDelivery, and the R2 delete happens AFTER it commits.
  let input: ConfirmDeliveryInput;

  if (confirmation.verdict === "failure") {
    // A reported print failure (e.g. 520 download failed). Close the delivery
    // and re-arm the order to re-offer; the offer cap still condemns after
    // enough tries. Correct, and unchanged in spirit from before.
    console.warn(
      `[cloudprnt] ${order.orderNumber} delivery=${token} reported result code ` +
        `${JSON.stringify(confirmation.code)} — re-arming for re-offer`,
    );
    input = {
      code: confirmation.code,
      outcome: "failure",
      markPrinted: false,
      failError: `printer reported code ${confirmation.code}`,
    };
  } else if (order.status === "PRINT_FAILED") {
    // A success for a job we already gave up on. Inside the grace window it is
    // honoured; outside it the delivery is still closed (so it cannot replay)
    // but the order is left PRINT_FAILED and visible on the board.
    const agoMs = Date.now() - Date.parse(order.updatedAt);
    const agoSeconds = Number.isFinite(agoMs) ? Math.round(agoMs / 1000) : null;
    const grace = lateConfirmationGraceSeconds();
    const withinGrace = agoSeconds !== null && agoSeconds <= grace;
    if (withinGrace) {
      console.warn(
        `[cloudprnt] LATE CONFIRMATION: ${order.orderNumber} delivery=${token} confirmed ` +
          `${agoSeconds}s after we gave up on it (grace ${grace}s) — honouring it as printed. ` +
          "Raise PRINT_OFFER_CAP if this repeats; the printer is slower than our patience.",
      );
      input = { code: confirmation.code, outcome: "success", markPrinted: true };
    } else {
      console.error(
        `[cloudprnt] LATE CONFIRMATION: ${order.orderNumber} delivery=${token} confirmed ` +
          `${agoSeconds ?? "?"}s after we gave up, outside the ${grace}s grace window — ` +
          "NOT honouring. The order stays PRINT_FAILED; the delivery is closed so it cannot replay.",
      );
      input = { code: confirmation.code, outcome: "success", markPrinted: false };
    }
  } else {
    input = { code: confirmation.code, outcome: "success", markPrinted: true };
  }

  const result = await confirmPrintDelivery(tenant.tenantId, token, input);

  if (!result || result.kind === "already") {
    // A race: another DELETE for the same delivery won between our read and the
    // transaction. Nothing further to do.
    console.warn(
      `[cloudprnt] stale-confirm token=${token} — delivery closed concurrently, nothing further recorded`,
    );
    return acknowledged();
  }

  // Safe to remove the object now the delivery is closed — AFTER the commit,
  // never between the two writes. A dangling object is harmless (24h lifecycle
  // sweeps it); the gap between clearing and closing was the bug.
  if (result.jobKey) await deletePrintJob(result.jobKey);

  switch (result.kind) {
    case "printed":
      console.info(
        `[cloudprnt] verdict=printed ${result.orderNumber} delivery=${token} — order PRINTED` +
          (result.jobKey ? `, ${result.jobKey} deleted` : ""),
      );
      break;
    case "advanced":
      console.info(
        `[cloudprnt] ${result.orderNumber} delivery=${token} piece ` +
          `${result.segment + 1}/${result.segments} printed; ` +
          `${(result.nextSegment ?? result.segment + 1) + 1}/${result.segments} next`,
      );
      break;
    case "failed":
      console.warn(
        `[cloudprnt] verdict=failed ${result.orderNumber} delivery=${token} — delivery closed, ` +
          `order re-armed to re-offer` +
          (result.jobKey ? `, ${result.jobKey} deleted` : ""),
      );
      break;
    case "closed":
      console.warn(
        `[cloudprnt] ${result.orderNumber} delivery=${token} — late confirmation closed the ` +
          `delivery without printing; order stays ${result.status}`,
      );
      break;
    case "not-printable":
      console.warn(
        `[cloudprnt] ${result.orderNumber} delivery=${token} confirmed but not marked printed — ` +
          `status was ${result.status}, which markPrinted will not drag backwards. ` +
          "Most likely advanced by staff.",
      );
      break;
  }

  return acknowledged();
}
