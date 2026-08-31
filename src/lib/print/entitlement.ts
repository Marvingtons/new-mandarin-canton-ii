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
 * if so, has it had long enough to finish it?" That is answerable from state —
 * but the state is now an IDENTITY, not a bare timestamp. `print_delivery_id`
 * names the specific hand-over the printer is holding and is cleared only when
 * THAT hand-over is confirmed; `print_delivery_expires_at` is its deadline,
 * stamped in the same statement so the two cannot drift. Offer only when no
 * delivery is in flight (`print_delivery_id` is null) or the one in flight has
 * expired. Never while an unexpired, unconfirmed delivery exists.
 *
 * WHY IDENTITY AND NOT JUST A TIMESTAMP. A timestamp the offer path clears
 * itself cannot tell "this print died, re-offer it" apart from "this print
 * succeeded and the confirmation is merely late" — both leave the same NULL
 * behind, and the second re-offered a ticket that was already on paper. Tying
 * the decision to a delivery id the confirmation must name closes that gap: a
 * lost confirmation now costs a delayed ticket (after expiry), never a
 * duplicate. The old `print_offered_at IS NULL AND attempts > 0` branch, which
 * re-offered on the very next poll with no delay, is gone entirely — the state
 * it recovered from can no longer occur (the confirmation closes the delivery
 * atomically; there is no window between clearing and closing).
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
  /**
   * `print_delivery_id` — the delivery the printer is holding, or null when it
   * holds nothing of ours (never offered, or the last delivery was confirmed,
   * failed, or advanced past). This, not a timestamp, is what decides whether a
   * fresh offer is free.
   */
  deliveryId: string | null;
  /**
   * `print_delivery_expires_at` as ISO-8601 — when the in-flight delivery's
   * window closes. Null when nothing is in flight. When a delivery is in flight
   * this is the clock the decision is measured against.
   */
  deliveryExpiresAt: string | null;
  /**
   * `print_offered_at` as ISO-8601 — informational only, for the "elapsed since
   * offer" figure in the logs. The decision does not read it. Optional.
   */
  offeredAt?: string | null;
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
  /**
   * Pieces this order is being sent as. 1 (or 0, meaning "not yet
   * rendered") is the ordinary whole-ticket case.
   *
   * A split job hands over one PIECE at a time, so the window must budget
   * the paper in that piece rather than the whole copy set: a 3-copy order
   * sent as three pieces was previously given the full 3-copy window three
   * times over, which turned a 6-minute worst case into 15 and let one
   * stuck order block the whole tenant queue for that long.
   */
  segments?: number;
  /** Which piece is in flight. Pieces after the first start at attempt 1. */
  segmentIndex?: number;
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
  segments = 1,
): number {
  const n = Number.isFinite(copies) && copies > 0 ? Math.floor(copies) : 1;
  const pieces = Number.isFinite(segments) && segments > 1 ? Math.floor(segments) : 1;
  // Copies carried by the piece actually in flight, rounded up so the
  // fattest piece of an uneven split is still fully covered.
  const perPiece = Math.max(1, Math.ceil(n / pieces));
  const floor = Math.max(0, floorSeconds);
  const perCopy = Math.max(0, perCopySeconds);
  return Math.max(floor, perPiece * perCopy);
}

/**
 * Hand-overs this PIECE is entitled to.
 *
 * Confirming a non-final piece (confirmPrintDelivery's advance path) leaves
 * print_attempts at 1 rather than 0, so the row keeps matching currentPrintJob
 * and the next poll offers the next piece instead of some other order. The side
 * effect was that piece 1 got the full cap of hand-overs and every later piece
 * got one fewer, which is a silent inequality nobody would find from the
 * outside. One extra for the continuation pieces restores it.
 */
export function pieceDeliveryCap(deliveryCap: number, segmentIndex: number): number {
  return segmentIndex > 0 ? deliveryCap + 1 : deliveryCap;
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
    input.segments,
  );
  // Every piece gets the same number of hand-overs, which it did not before
  // — see pieceDeliveryCap.
  const cap = pieceDeliveryCap(input.deliveryCap, input.segmentIndex ?? 0);

  const hasDelivery = input.deliveryId !== null && input.deliveryId !== "";

  // `offeredAt` is informational — it only shapes the human-readable "elapsed"
  // in the reason and log. The decision never turns on it.
  const offeredMs =
    input.offeredAt == null ? NaN : Date.parse(input.offeredAt);
  const elapsedSeconds = Number.isFinite(offeredMs)
    ? Math.max(0, (input.now - offeredMs) / 1000)
    : null;

  if (!hasDelivery) {
    // Nothing of ours is in flight. Either this order has never been handed
    // over, or its last delivery was confirmed / failed / advanced past and its
    // pointer cleared. Nothing to wait for.
    //
    // The cap is checked HERE too, not only on the expiry path. A reported
    // failure (a 520) clears the pointer to re-arm the order, so a printer that
    // fails every hand-over would otherwise re-offer forever with no delivery
    // ever left "in flight to expire". A split continuation is safe from this:
    // advancing a piece resets print_attempts to 1, so a healthy multi-piece
    // ticket never accumulates toward the cap — only genuinely stuck re-offers
    // do. (first-offer is attempts === 0, always below the cap.)
    if (input.printAttempts >= cap) {
      return {
        verdict: "capped",
        reason:
          `${input.printAttempts} hand-over(s) and no delivery in flight — at the ` +
          `${cap} cap with nothing printed, condemning rather than offering again`,
        holdSeconds: 0,
        windowSeconds,
        elapsedSeconds: null,
      };
    }
    return {
      verdict: input.printAttempts > 0 ? "retry" : "first-offer",
      reason:
        input.printAttempts > 0
          ? `no delivery in flight after ${input.printAttempts} hand-over(s) — ` +
            "the previous one was confirmed, failed or advanced; entitled to offer"
          : "never handed over; entitled to offer",
      holdSeconds: 0,
      windowSeconds,
      elapsedSeconds: null,
    };
  }

  // A delivery IS in flight. The only question left is whether it has expired.
  // Measured against its stored deadline, not a recomputed one, so a plan that
  // changed between offer and now cannot move the goalposts. If the deadline is
  // somehow unreadable, fall back to offered_at + window; if that is missing
  // too, HOLD — the one thing we must never do on missing state is re-offer,
  // because that is the duplicate this whole change removes. A genuinely stuck
  // order is caught by the unprinted-order alert, not by guessing here.
  const expiresParsed =
    input.deliveryExpiresAt == null ? NaN : Date.parse(input.deliveryExpiresAt);
  const expiresMs = Number.isFinite(expiresParsed)
    ? expiresParsed
    : Number.isFinite(offeredMs)
      ? offeredMs + windowSeconds * 1000
      : NaN;

  if (!Number.isFinite(expiresMs)) {
    return {
      verdict: "hold",
      reason:
        "a delivery is in flight but its expiry is unreadable — holding rather " +
        "than risk a duplicate; the unprinted-order alert is the net for a " +
        "genuinely stuck order",
      holdSeconds: windowSeconds,
      windowSeconds,
      elapsedSeconds,
    };
  }

  if (input.now < expiresMs) {
    const holdSeconds = Math.max(1, Math.ceil((expiresMs - input.now) / 1000));
    const ago =
      elapsedSeconds === null ? "" : `handed over ${elapsedSeconds.toFixed(1)}s ago and `;
    return {
      verdict: "hold",
      reason:
        `${ago}the ${input.copies}-copy confirmation window is ${windowSeconds}s — ` +
        `an unexpired, unconfirmed delivery is in flight; holding ${holdSeconds}s more`,
      holdSeconds,
      windowSeconds,
      elapsedSeconds,
    };
  }

  if (input.printAttempts >= cap) {
    return {
      verdict: "capped",
      reason:
        `${input.printAttempts} hand-over(s) and the ${windowSeconds}s window has ` +
        `expired again with no confirmation — at the ${cap} cap, ` +
        "condemning rather than printing another copy-set",
      holdSeconds: 0,
      windowSeconds,
      elapsedSeconds,
    };
  }

  const ago =
    elapsedSeconds === null ? "the in-flight delivery is " : `handed over ${elapsedSeconds.toFixed(0)}s ago, `;
  return {
    verdict: "retry",
    reason:
      `${ago}past the ${windowSeconds}s confirmation window, still unconfirmed ` +
      `after ${input.printAttempts} hand-over(s) — presuming the print died; ` +
      "entitled to offer a new delivery",
    holdSeconds: 0,
    windowSeconds,
    elapsedSeconds,
  };
}

/** True when the verdict means "send the printer a job now". */
export function entitledToOffer(decision: EntitlementDecision): boolean {
  return decision.verdict === "first-offer" || decision.verdict === "retry";
}
