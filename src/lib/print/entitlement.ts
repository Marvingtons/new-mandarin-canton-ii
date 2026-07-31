/**
 * MAY THE PRINTER BE HANDED THIS JOB (AGAIN)?
 *
 * The one question the CloudPRNT poll has to answer, extracted into a pure
 * function so it can be reasoned about and tested without a printer, a
 * database, or a roll of paper.
 *
 * WHAT WENT WRONG. An order printed its three cut copies and then kept
 * printing. The offer loop asked two questions that are not this one:
 *
 *   1. "How many times have we offered it?" — with two offers allowed
 *      back-to-back, the second hand-over happened on the very NEXT poll,
 *      roughly three seconds after the first, while the printer was still on
 *      copy 1 of 3. That doubled every job on its own. It did not need a lost
 *      DELETE, a slow network, or anything to go wrong at all.
 *
 *   2. "How long since this row changed?" — measured from `updated_at`, which
 *      the offer path's own bookkeeping (print_job_key, print_segments) moves.
 *      The quiet period was restarting itself.
 *
 * And the number it compared against was a flat sixty seconds, chosen when a
 * job was one copy. A three-copy job is three times the paper and three cutter
 * cycles, and the printer only confirms once the WHOLE job is out — so the
 * window expired mid-job and bought the next copy-set.
 *
 * WHAT THIS ASKS INSTEAD. "Does the printer currently hold a body of ours, and
 * if so, has it had long enough to finish it?" That is answerable from state:
 * `print_offered_at` is set when a body goes out and cleared when it comes
 * back, and the window it is measured against scales with the job.
 *
 * THE ASYMMETRY THAT SETS THE NUMBERS. Waiting too long on a print that really
 * died costs one delayed ticket, visible on the kitchen board the whole time
 * and covered by the unprinted-order alert. Waiting too little costs a
 * duplicate copy-set — paper, confusion at the pass, and the possibility of two
 * cooks making the same order. So every number here is deliberately generous.
 *
 * Pure: no env, no clock of its own, no `server-only`.
 */

export type OfferVerdict =
  /** Nothing of ours is in flight. Hand it over. */
  | "first-offer"
  /** The window expired with no confirmation; presume the print died. */
  | "retry"
  /** A body is out and still within its confirmation window. */
  | "hold"
  /** Re-delivered as many times as we are willing to. Condemn it. */
  | "capped";

export interface EntitlementDecision {
  verdict: OfferVerdict;
  /** One line, logged verbatim. Says WHY, with the numbers that decided it. */
  reason: string;
  /** Seconds still to wait. Zero unless the verdict is "hold". */
  holdSeconds: number;
  /** The confirmation window this decision used, in seconds. */
  windowSeconds: number;
  /** Seconds since the body went out, or null when none is in flight. */
  elapsedSeconds: number | null;
}

export interface EntitlementInput {
  /** Epoch ms. Injected so a test owns the clock. */
  now: number;
  /** `print_offered_at` as ISO-8601, or null when nothing is in flight. */
  offeredAt: string | null;
  /** `print_attempts` — hand-overs so far, not polls. */
  printAttempts: number;
  /** Copies in this job. A 3-copy job is three times the paper. */
  copies: number;
  /** Lower bound on the window, whatever the copy count. */
  floorSeconds: number;
  /** Allowance per copy, multiplied by `copies`. */
  perCopySeconds: number;
  /** Hand-overs allowed before the order is condemned to PRINT_FAILED. */
  deliveryCap: number;
}

/**
 * How long to wait for a confirmation before believing the print died.
 *
 *   window = max(floor, copies × per-copy)
 *
 * The floor covers everything that is not paper — the printer's own poll
 * interval before it even fetches, the download, decode, and the fact that the
 * confirming DELETE rides the NEXT poll after the last cut rather than the
 * instant the paper stops. The per-copy term covers the paper itself, and
 * scales because that is the term the old flat constant was missing.
 */
export function confirmationWindowSeconds(
  copies: number,
  floorSeconds: number,
  perCopySeconds: number,
): number {
  const n = Number.isFinite(copies) && copies > 0 ? Math.floor(copies) : 1;
  const floor = Math.max(0, floorSeconds);
  const perCopy = Math.max(0, perCopySeconds);
  return Math.max(floor, n * perCopy);
}

/**
 * The entitlement decision, in the order the questions actually matter.
 *
 * `hold` is checked BEFORE `capped` on purpose: an order still inside its
 * confirmation window has not failed at anything, and condemning it to
 * PRINT_FAILED while the paper is physically coming out is the same class of
 * mistake as re-offering it.
 */
export function decideOffer(input: EntitlementInput): EntitlementDecision {
  const windowSeconds = confirmationWindowSeconds(
    input.copies,
    input.floorSeconds,
    input.perCopySeconds,
  );

  const offeredMs = input.offeredAt === null ? NaN : Date.parse(input.offeredAt);
  const inFlight = Number.isFinite(offeredMs);

  if (!inFlight) {
    // No body is out. Either this order has never been handed over, or its
    // last hand-over was confirmed / revoked / advanced past. Nothing to wait
    // for, so nothing to weigh.
    return {
      verdict: input.printAttempts > 0 ? "retry" : "first-offer",
      reason:
        input.printAttempts > 0
          ? `no body in flight after ${input.printAttempts} hand-over(s) — ` +
            "the previous one was confirmed, revoked or advanced; entitled to offer"
          : "never handed over; entitled to offer",
      holdSeconds: 0,
      windowSeconds,
      elapsedSeconds: null,
    };
  }

  const elapsedSeconds = Math.max(0, (input.now - offeredMs) / 1000);

  if (elapsedSeconds < windowSeconds) {
    const holdSeconds = Math.ceil(windowSeconds - elapsedSeconds);
    return {
      verdict: "hold",
      reason:
        `handed over ${elapsedSeconds.toFixed(1)}s ago and the ${input.copies}-copy ` +
        `confirmation window is ${windowSeconds}s — the printer is entitled to ` +
        `still be working; holding ${holdSeconds}s more`,
      holdSeconds,
      windowSeconds,
      elapsedSeconds,
    };
  }

  if (input.printAttempts >= input.deliveryCap) {
    return {
      verdict: "capped",
      reason:
        `${input.printAttempts} hand-over(s) and the ${windowSeconds}s window has ` +
        `expired again with no confirmation — at the ${input.deliveryCap} cap, ` +
        "condemning rather than printing a fifth copy-set",
      holdSeconds: 0,
      windowSeconds,
      elapsedSeconds,
    };
  }

  return {
    verdict: "retry",
    reason:
      `handed over ${elapsedSeconds.toFixed(0)}s ago, past the ${windowSeconds}s ` +
      `confirmation window, still unconfirmed after ${input.printAttempts} ` +
      "hand-over(s) — presuming the print died; entitled to offer again",
    holdSeconds: 0,
    windowSeconds,
    elapsedSeconds,
  };
}

/** True when the verdict means "send the printer a job now". */
export function entitledToOffer(decision: EntitlementDecision): boolean {
  return decision.verdict === "first-offer" || decision.verdict === "retry";
}
