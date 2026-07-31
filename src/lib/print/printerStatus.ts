/**
 * WHAT THE PRINTER IS TELLING US, on every poll.
 *
 * The CloudPRNT POST carries the client's own state, and until now this system
 * read exactly one bit of it — `statusCode` begins with "2" — and used that
 * only to write a warning line. Everything else was thrown away, which is why
 * a paper-out printer looked identical to a healthy one: the server kept
 * handing it jobs, the printer kept not printing them, and the retry budget
 * drained until the orders were condemned. Paper came back to a queue with
 * nothing left in it.
 *
 * HOW THE CONDITION IS READ, and why it is read this way.
 *
 * Star's poll body has two status fields:
 *
 *   statusCode — the guaranteed one. Formatted like an HTTP status: a numeric
 *                code, a space, and a reason phrase ("200 OK"). URL-encoded on
 *                the wire, so "200%20OK" is the same value.
 *   status     — a hex-encoded ASB (Automatic Status Back) block. Optional,
 *                and its bit layout differs across Star's model families.
 *
 * This parser reads the REASON PHRASE, not the number. That is deliberate.
 * Star's numeric vocabulary for these conditions is model- and firmware-
 * specific and this codebase has never seen a real capture of it — asserting
 * that, say, 803 means paper-empty would be inventing a fact. The reason
 * phrase is plain English and stable across the family ("Paper Empty", "Cover
 * Open"), so matching on it is both more likely to be right and obviously
 * wrong when it is not. The numeric half still does the job it always did:
 * anything not beginning with "2" is not ready.
 *
 * The raw `status` hex is STORED, not decoded. Once a real TSP100IV capture
 * exists in the logs (logPollBody prints the whole body on shape change), the
 * ASB bits can be decoded here with confidence. Until then, storing it means
 * the evidence is being collected rather than guessed at.
 *
 * Pure. No env, no database, no `server-only` — the verification script drives
 * it directly.
 */

import type { CloudPrntPoll } from "@/lib/print/cloudprnt";

export interface PrinterCondition {
  /** statusCode begins with "2": the printer says it is ready. */
  online: boolean;
  /** Out of paper. Blocks offering — see printerBlockedReason. */
  paperOut: boolean;
  /** Cover open. Also blocks offering, for the same reason. */
  coverOpen: boolean;
  /** Running low, but still printing. Recorded, never gating. */
  paperLow: boolean;
  /** statusCode exactly as received, percent-decoded. Null when absent. */
  statusCode: string | null;
  /** The ASB hex block verbatim, undecoded. Null when absent. */
  statusRaw: string | null;
}

/** Percent-decoding that never throws on a malformed sequence. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read the condition out of one poll body.
 *
 * Every branch is fail-SAFE in the direction of printing: an absent or
 * unreadable status reports online, no paper problem, no cover problem. A
 * parser that guessed "paper out" from silence would stop the kitchen on a
 * firmware quirk, and this system's whole failure history is orders that did
 * not reach a cook.
 */
export function readPrinterCondition(poll: CloudPrntPoll): PrinterCondition {
  const rawCode = asText(poll.statusCode);
  const statusCode = rawCode === null ? null : decode(rawCode);
  const statusRaw = asText(poll.status);

  // Absent statusCode = assume fine, exactly as printerReportsHealthy has
  // always done. The printer is polling, so it is at least reachable.
  const online = statusCode === null || statusCode.trimStart().startsWith("2");

  // Matched on the reason phrase. Star writes these as words; the spellings
  // below cover the ones its documentation and reference servers use, and the
  // "near"/"low" test is checked FIRST so "Paper Near End" is not read as an
  // empty roll.
  const text = (statusCode ?? "").toLowerCase();
  const mentionsPaper = /paper|receipt/.test(text);
  const paperLow = mentionsPaper && /(near[\s-]?end|low)/.test(text);
  const paperOut =
    mentionsPaper && !paperLow && /(empty|end|out|absent|none)/.test(text);
  const coverOpen = /cover/.test(text) && /open/.test(text);

  return { online, paperOut, coverOpen, paperLow, statusCode, statusRaw };
}

/**
 * Why the printer must not be handed a job right now, or null to offer.
 *
 * ⚠️ COVER-OPEN IS GATED HERE TOO, and the brief that prompted this named only
 * paper-out. It is the same failure with a different label: a printer with its
 * cover open cannot print, so every job handed to it is a hand-over that will
 * never be confirmed, and each one spends part of a budget that ends in
 * PRINT_FAILED. Gating one and not the other would leave exactly the bug being
 * fixed, reachable by lifting a lid. Delete the second clause if the family
 * would rather a cover-open printer kept being offered work.
 *
 * NOT gated: `online === false` on its own. A printer reporting some other
 * fault is still the only printer, and Star's own guidance is that a non-2xx
 * status can be transient — withholding work from it is how a recoverable
 * blip becomes an unprinted order. That was already this system's rule and it
 * stays.
 */
export function printerBlockedReason(
  condition: Pick<PrinterCondition, "paperOut" | "coverOpen">,
): "paper-out" | "cover-open" | null {
  if (condition.paperOut) return "paper-out";
  if (condition.coverOpen) return "cover-open";
  return null;
}

/**
 * Health as the kitchen screen shows it, derived from the stored row.
 *
 * Two inputs, and they answer different questions. `paperOut` is what the
 * printer SAID; `secondsSinceSeen` is whether it is still saying anything.
 * A printer that reported paper-out and then vanished is offline — silence is
 * the more urgent fact, so it is checked first.
 */
export type PrinterHealth = "ok" | "paper-out" | "cover-open" | "offline" | "unknown";

/**
 * A printer polls every ~3 seconds. Sixty is twenty missed polls: long enough
 * that a single dropped request, a Wi-Fi roam, or a worker cold start cannot
 * trip it, short enough that staff learn about a powered-off printer while the
 * order is still cookable.
 */
export const OFFLINE_AFTER_SECONDS = 60;

export function derivePrinterHealth(input: {
  /** Null when the printer has never polled this deployment. */
  secondsSinceSeen: number | null;
  paperOut: boolean;
  coverOpen: boolean;
}): PrinterHealth {
  if (input.secondsSinceSeen === null) return "unknown";
  if (input.secondsSinceSeen > OFFLINE_AFTER_SECONDS) return "offline";
  if (input.paperOut) return "paper-out";
  if (input.coverOpen) return "cover-open";
  return "ok";
}
