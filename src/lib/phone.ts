/**
 * Phone normalization and cheap pre-validation.
 *
 * The phone number is now the anti-abuse control that a card used to be, so it
 * has to be exactly one canonical string everywhere: the rate limiter, the
 * per-day order cap, and the "does this order's phone match the verified one?"
 * check all compare it directly. `(619) 555-0148`, `619-555-0148` and
 * `6195550148` must collapse to a single value or every one of those controls
 * has a trivial bypass.
 *
 * Scope is NANP (+1) by design — the restaurant is in Chula Vista and its
 * customers are local. A non-NANP number is rejected with a clear message
 * rather than mangled into a wrong one.
 *
 * ⚠️ TODO(confirm): this cannot tell a mobile from a landline. Only Twilio
 * Lookup can, and that is a paid API call per number — i.e. the very cost this
 * pre-filter exists to avoid. The filter below rejects the shapes that are
 * definitely not a customer's mobile (toll-free, premium, malformed), which
 * removes the cheap abuse without paying per lookup. If landline signups
 * become a real problem, add Lookup here and accept the cost.
 *
 * Pure. No `server-only`, so the client can pre-validate before submitting.
 */

export type PhoneError =
  | "empty"
  | "too_short"
  | "too_long"
  | "not_nanp"
  | "invalid_area_code"
  | "invalid_exchange"
  | "toll_free"
  | "premium"
  | "repeated_digits";

export interface PhoneResult {
  ok: boolean;
  /** E.164, e.g. "+16195550148". Only set when ok. */
  e164?: string;
  /** "(619) 555-0148" — for display back to the customer. */
  national?: string;
  error?: PhoneError;
}

/** Toll-free NANP area codes. Never someone's mobile. */
const TOLL_FREE = new Set(["800", "833", "844", "855", "866", "877", "888"]);

/** Premium-rate and other non-consumer area codes. */
const PREMIUM = new Set(["900", "976"]);

const MESSAGES: Record<PhoneError, { en: string; zh: string }> = {
  empty: { en: "Please enter your phone number.", zh: "請輸入電話號碼。" },
  too_short: { en: "That number is too short.", zh: "號碼位數不足。" },
  too_long: { en: "That number is too long.", zh: "號碼位數過多。" },
  not_nanp: {
    en: "Please enter a US phone number.",
    zh: "請輸入美國電話號碼。",
  },
  invalid_area_code: {
    en: "That area code isn't valid.",
    zh: "區號無效。",
  },
  invalid_exchange: {
    en: "That number isn't valid.",
    zh: "號碼無效。",
  },
  toll_free: {
    en: "Please use a mobile number — we'll text you a code.",
    zh: "請使用手機號碼，我們會發送驗證碼。",
  },
  premium: {
    en: "That number isn't valid.",
    zh: "號碼無效。",
  },
  repeated_digits: {
    en: "That number isn't valid.",
    zh: "號碼無效。",
  },
};

/** Bilingual, customer-facing message for a rejection reason. */
export function phoneErrorMessage(error: PhoneError): string {
  const m = MESSAGES[error];
  return `${m.en} · ${m.zh}`;
}

/**
 * Normalize to E.164 and reject what is obviously not a reachable US mobile.
 *
 * NANP structure being validated: area code and exchange must both start 2–9,
 * and the exchange's second/third digits may not be "11" (that is an N11
 * service code like 411 or 911).
 */
export function normalizePhone(input: string): PhoneResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 0) return { ok: false, error: "empty" };

  // An explicit +CC that is not +1 is a real number we simply do not serve —
  // say so rather than silently treating it as NANP.
  if (hadPlus && !digits.startsWith("1")) {
    return { ok: false, error: "not_nanp" };
  }

  let national: string;
  if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    national = digits.slice(1);
  } else if (digits.length < 10) {
    return { ok: false, error: "too_short" };
  } else {
    return { ok: false, error: "too_long" };
  }

  const area = national.slice(0, 3);
  const exchange = national.slice(3, 6);

  if (area[0] === "0" || area[0] === "1") {
    return { ok: false, error: "invalid_area_code" };
  }
  if (exchange[0] === "0" || exchange[0] === "1") {
    return { ok: false, error: "invalid_exchange" };
  }
  // N11 service codes (411, 611, 911, …) are not subscriber numbers.
  if (exchange[1] === "1" && exchange[2] === "1") {
    return { ok: false, error: "invalid_exchange" };
  }
  if (TOLL_FREE.has(area)) return { ok: false, error: "toll_free" };
  if (PREMIUM.has(area)) return { ok: false, error: "premium" };
  // 5555555555 and friends — cheap to type, never real.
  if (/^(\d)\1{9}$/.test(national)) {
    return { ok: false, error: "repeated_digits" };
  }

  return {
    ok: true,
    e164: `+1${national}`,
    national: `(${area}) ${exchange}-${national.slice(6)}`,
  };
}

/**
 * The NANP digits behind whatever the customer typed or pasted.
 *
 * Strips punctuation, a leading "+", and the country code — so "+1 858 207
 * 7770", "1-858-207-7770" and "(858) 207-7770" all reduce to "8582077770".
 * Capped at 10 so a stray extra keystroke cannot push the mask out of shape.
 */
export function phoneDigits(input: string): string {
  let digits = input.replace(/\D/g, "");
  // A leading 1 is the country code, not an area code: no NANP area code
  // starts with 1, so this is unambiguous.
  if (digits.length > 10 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/**
 * Progressive display mask: "" -> "(858" -> "(858) 207" -> "(858) 207-7770".
 *
 * DISPLAY ONLY. The value that reaches the API is normalized by
 * normalizePhone() at the boundary, so nothing downstream ever parses this.
 */
export function formatPhoneAsTyped(input: string): string {
  const d = phoneDigits(input);
  if (d.length === 0) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Where the caret belongs after re-masking.
 *
 * Cursor accounting for an input mask is counted in DIGITS, not characters:
 * work out how many digits precede the caret in the raw text, then find the
 * offset in the formatted text that has the same number of digits before it.
 * Without this, typing mid-string or backspacing over ") " sends the caret to
 * the end on every keystroke.
 */
export function caretAfterFormat(
  rawValue: string,
  rawCaret: number,
  formatted: string,
): number {
  const digitsBefore = rawValue.slice(0, rawCaret).replace(/\D/g, "").length;
  if (digitsBefore === 0) return formatted.startsWith("(") ? 1 : 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      seen++;
      if (seen === digitsBefore) return i + 1;
    }
  }
  return formatted.length;
}

/** "+16195550148" -> "(619) 555-0148". Falls back to the input if unparseable. */
export function formatPhoneNational(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length !== 11 || !digits.startsWith("1")) return e164;
  const n = digits.slice(1);
  return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
}

/** Last four digits, for "we texted ••••0148" confirmations. */
export function phoneLast4(e164: string): string {
  return e164.replace(/\D/g, "").slice(-4);
}
