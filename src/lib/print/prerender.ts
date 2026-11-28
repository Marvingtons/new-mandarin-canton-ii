import "server-only";

import { randomUUID } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ticketCopies, ticketCopyRoles } from "@/config/tenant.server";
import { payloadHash } from "@/lib/print/cloudprnt";
import {
  deletePrintJob,
  printJobKeyFor,
  printJobStoreReady,
  putPrintJob,
} from "@/lib/print/jobStore";
import { printBodyFor, stagePrintJob } from "@/lib/orders/repository";
import type { Order } from "@/lib/orders/types";
import { renderTicketJob, TICKET_WIDTH_PX, type TicketJob } from "@/lib/ticket/render";
import { maxStarPrntRows } from "@/lib/ticket/starprnt";

/**
 * PRE-RENDER AT ORDER CREATION (docs/print-latency.md, Step 2 fix 1).
 *
 * The poll that hands a ticket over used to render it and upload it to R2
 * before answering jobReady, so the printer waited for both. Now the order
 * route renders and uploads the first kitchen ticket inside ctx.waitUntil,
 * after its response, and records it on the order (orders.print_prerender).
 * The hand-over takes it in one statement instead of rendering.
 *
 * CORRECTNESS RESTS ON THE FINGERPRINT, not on timing. It is the sha256 of
 * every input the render reads: the body printBodyFor chose (order, change
 * ticket, revision chip), timezone, copies, copy roles, segment and height cap.
 * The hand-over computes it from ITS inputs and uses the staged body only on
 * an exact match. An edit, a failover reroute (REROUTED FROM, the station), a
 * reprint chip: each changes the fingerprint, and the hand-over renders as
 * before. Nothing printed can differ from what a render at hand-over would
 * have produced.
 *
 * WHAT DOES NOT CHANGE. Same bytes, same copies, same buzzer, the same one
 * delivery per hand-over and the same confirmation. The stage is single-use
 * (cleared by the statement that takes it), so no two deliveries are ever
 * handed one URL, which is the property the delivery id in the key exists
 * for. A stage that loses the race to the first poll, or fails, simply is not
 * used.
 */

/**
 * Order fields the claim and the board change between creation and hand-over,
 * none of which the ticket renderer reads (src/lib/ticket never touches them).
 * Left out of the fingerprint so a claim does not by itself invalidate a stage.
 */
const VOLATILE: ReadonlySet<string> = new Set([
  "status",
  "printAttempts",
  "offeredAt",
  "printDeliveryId",
  "printDeliveryExpiresAt",
  "printedAt",
  "lastPrintError",
  "alertedAt",
  "updatedAt",
  "ticketRevision",
  "reprintPending",
  "changePending",
  "donePreviousStatus",
  "doneAt",
  "deliveryCount",
  "fetchCount",
  "reprintCount",
  "printPendingSince",
  "printStuck",
  "changeCount",
  "changeFailed",
]);

type PrintBody = Awaited<ReturnType<typeof printBodyFor>>;

/** JSON with object keys sorted, so two reads of one order hash alike. */
function stable(value: unknown, top = false): string {
  if (Array.isArray(value)) return `[${value.map((v) => stable(v)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => v !== undefined && !(top && VOLATILE.has(k)))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function renderArgs(timezone: string, body: PrintBody, segment: number) {
  return {
    options: {
      timezone,
      copies: ticketCopies(),
      copyRoles: ticketCopyRoles(),
      change: body.change,
      revision: body.revision,
    },
    job: {
      format: "starprnt" as const,
      // Star's 512KB GET cap, expressed as rows. Applies to the R2 object
      // exactly as it applied to the Worker response.
      maxHeight: maxStarPrntRows(TICKET_WIDTH_PX),
      segment,
    },
  };
}

/** The fingerprint of what a render of this body and piece would read. */
export async function printerJobFingerprint(
  timezone: string,
  body: PrintBody,
  segment: number,
): Promise<string> {
  const { options, job } = renderArgs(timezone, body, segment);
  const text = `v1|${stable(body.order, true)}|${stable({ ...options, ...job, width: TICKET_WIDTH_PX })}`;
  return payloadHash(new TextEncoder().encode(text));
}

/** The one render call the printer path makes, at creation and at hand-over. */
export function renderPrinterJob(
  timezone: string,
  body: PrintBody,
  segment: number,
): Promise<TicketJob> {
  const { options, job } = renderArgs(timezone, body, segment);
  return renderTicketJob(body.order, options, job);
}

/** Render, upload and record the first kitchen ticket of a new order. */
export async function prerenderTicket(
  tenant: { tenantId: string; timezone: string },
  order: Order,
): Promise<void> {
  const started = Date.now();
  // No delivery yet: the body a first offer will carry (current revision, no
  // change ticket, no chip). Reads nothing from the database for a new order.
  const body = await printBodyFor(tenant.tenantId, order, null);
  const fingerprint = await printerJobFingerprint(tenant.timezone, body, 0);
  const ticket = await renderPrinterJob(tenant.timezone, body, 0);
  const sha256 = await payloadHash(ticket.body);
  // "pre" + a fresh uuid stands where a delivery id goes: an identity of its
  // own, used by exactly one delivery (the stage is single-use).
  const key = printJobKeyFor(order.orderNumber, `pre${randomUUID()}`, sha256, 0);
  if (!(await putPrintJob(key, ticket.body))) return;
  let staged: boolean;
  try {
    staged = await stagePrintJob(tenant.tenantId, order.id, {
      key,
      segments: ticket.segments,
      fingerprint,
    });
  } catch (err) {
    await deletePrintJob(key);
    throw err;
  }
  if (!staged) {
    // The printer claimed it first and rendered its own; this copy is unused.
    await deletePrintJob(key);
    console.info(`[cloudprnt] ${order.orderNumber} pre-render lost the race to the first poll`);
    return;
  }
  console.info(
    `[cloudprnt] ${order.orderNumber} pre-rendered -> R2 ${key} ` +
      `(${ticket.body.length} bytes, ${ticket.segments} piece(s)) in ${Date.now() - started}ms`,
  );
}

interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Pre-render a newly created order after the response, inside ctx.waitUntil.
 * Never throws and never delays the caller beyond scheduling: a failed
 * pre-render only means the hand-over renders, as it always did. A no-op
 * without the R2 store (local dev, tests), where the hand-over has nowhere to
 * take a staged body from anyway.
 */
export function schedulePrerender(
  tenant: { tenantId: string; timezone: string },
  order: Order,
): void {
  if (!printJobStoreReady()) return;
  // Yield first, so the render's CPU runs after the order response is on its
  // way rather than in front of it.
  const work = new Promise((resolve) => setTimeout(resolve, 0))
    .then(() => prerenderTicket(tenant, order))
    .catch((err) => {
      console.warn(
        `[cloudprnt] ${order.orderNumber} pre-render failed (the hand-over will render): ` +
          (err instanceof Error ? err.message : "unknown error"),
      );
    });
  try {
    const ctx = getCloudflareContext().ctx as WaitUntilContext | undefined;
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
  } catch {
    // Off Workers: the promise above runs on its own and cannot reject.
  }
}
