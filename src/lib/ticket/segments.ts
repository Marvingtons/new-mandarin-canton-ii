import { MAX_JOB_BYTES, starPrntJobBytes } from "@/lib/ticket/starprnt";

/**
 * How a multi-copy ticket is divided into sequential PRINT JOBS.
 *
 * The 512KB cap is per JOB, not per order — two 500KB jobs are fine, one
 * 600KB job is a 521. So a copy set too tall to send at once is sent as
 * consecutive jobs instead of refused. This used to throw
 * ("reduce TICKET_COPIES"), which meant a ten-line family order simply
 * never printed and sat QUEUED until the unprinted-order alert fired.
 *
 * COPY BOUNDARIES FIRST. A copy is a whole physical ticket with its own
 * cut, so a job of whole copies tears exactly where it would have torn
 * anyway — the kitchen cannot tell a split job from an unsplit one. Only
 * when a SINGLE copy is itself over the cap does the split move inside
 * it, where it costs a continuation marker and a repeated copy bar.
 *
 * ⚠️ THIS MUST BE A PURE FUNCTION OF ITS ARGUMENTS, AND DETERMINISTIC.
 * The segment cursor is a bare integer in Postgres; poll N+1 re-derives
 * the whole plan from scratch and asks for segment `cursor`. If two
 * renders of the same order disagreed about which copies live in which
 * segment, the printer would get a copy twice or not at all. Integer
 * arithmetic only: no clock, no randomness, no floats.
 */

/** One job: either whole copies, or one slice of one oversized copy. */
export type SegmentSpec =
  | { kind: "copies"; copyIndices: number[] }
  | {
      kind: "slice";
      copyIndex: number;
      /** 0-based slice of that copy. */
      sliceIndex: number;
      /** How many slices that copy is cut into. */
      sliceCount: number;
    };

/**
 * Bytes one job costs, given the heights of the copies inside it.
 *
 * NOT `rows <= maxStarPrntRows`. That helper models framing as ONE init
 * and ONE cut, which is right for a single raster and wrong the moment a
 * job carries several: each extra part adds its own cut (3 bytes) and its
 * own band headers (9 bytes per 256 rows). Measured, this matters — three
 * parts of 2426 rows is the same 7278 rows a single part fits in, and
 * comes to 524,297 bytes, nine over the cap. Planning on rows alone would
 * have produced a job the printer answers 521 to, which is the exact
 * failure this change exists to remove.
 */
export function jobBytesFor(copyHeights: readonly number[], width: number): number {
  return starPrntJobBytes(copyHeights, width);
}

/**
 * Group copies into jobs that each fit the byte cap.
 *
 * Greedy, left to right, which both minimises the number of jobs and
 * keeps copies in printing order — the kitchen copy comes off the printer
 * before the bag copy, as it does today.
 *
 * `sliceCountFor` is asked only about a copy that does not fit ALONE, and
 * is the caller's escape into pixel-level splitting. It is a callback
 * rather than an import because working it out needs the raster, and the
 * planner must stay pure and cheap for the common case where no copy is
 * anywhere near the cap.
 */
export function planSegments(
  copyHeights: readonly number[],
  width: number,
  budgetBytes: number,
  sliceCountFor: (copyIndex: number) => number,
): SegmentSpec[] {
  if (copyHeights.length === 0) {
    throw new Error("planSegments: no copies");
  }

  // No ceiling means "send the whole thing", which is what the preview and
  // the sample script rely on: one job, every copy, exactly as before.
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    return [{ kind: "copies", copyIndices: copyHeights.map((_, i) => i) }];
  }

  const out: SegmentSpec[] = [];
  let run: number[] = [];

  const flush = () => {
    if (run.length > 0) {
      out.push({ kind: "copies", copyIndices: run });
      run = [];
    }
  };

  for (let i = 0; i < copyHeights.length; i++) {
    // Alone and still too big: this copy has to be cut inside itself.
    if (jobBytesFor([copyHeights[i]], width) > budgetBytes) {
      flush();
      const sliceCount = Math.max(1, sliceCountFor(i));
      for (let s = 0; s < sliceCount; s++) {
        out.push({ kind: "slice", copyIndex: i, sliceIndex: s, sliceCount });
      }
      continue;
    }

    const withThis = [...run, i].map((c) => copyHeights[c]);
    if (run.length > 0 && jobBytesFor(withThis, width) > budgetBytes) {
      flush();
    }
    run.push(i);
  }
  flush();

  if (out.length === 0) {
    throw new Error("planSegments: produced no segments");
  }
  return out;
}

/** The cap a plan is built against, so callers and tests agree on it. */
export const JOB_BUDGET_BYTES = MAX_JOB_BYTES;
