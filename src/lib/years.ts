/**
 * How many years, and how to say it.
 *
 * THE FAMILY'S STORY STATES A COUNT. "Thirty-one years have passed since
 * we first opened" is true in 2026 and false in 2027, and a family
 * restaurant's own About page going quietly stale is exactly the kind of
 * small untruth the rest of this data layer is built to avoid (see the
 * note on `foundingYear` in data/restaurant.ts). So the figure is
 * computed from the founding year every render, and the prose carries a
 * placeholder rather than a number.
 *
 * The ROUNDED phrasings are deliberately NOT computed here. "For more
 * than thirty years" is the family's own wording, it stays true for the
 * next nine years without help, and rewriting it into a computed
 * sentence would be putting words in their mouth to solve a problem they
 * do not have. Only the exact count moves.
 *
 * Pure on purpose: nothing in here imports the restaurant record, so
 * data/restaurant.ts can import it without a cycle. The founding year
 * arrives as an argument.
 */

import type { Locale } from "@/lib/i18n/locale";

/**
 * Whole years elapsed since `foundingYear`, floored at 0.
 *
 * CALENDAR YEARS, not anniversaries: the month the family opened is not
 * recorded anywhere checkable, so counting from January is the only
 * honest arithmetic available. It is also what the family's own text
 * does, which is what settles it — their 2026 letter says thirty-one
 * years, and 2026 − 1995 = 31.
 */
export function yearsSince(foundingYear: number, now: Date = new Date()): number {
  return Math.max(0, now.getFullYear() - foundingYear);
}

const EN_ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

/**
 * Spanish 0–29 in the form that precedes a masculine noun.
 *
 * `un`, not `uno`, and `veintiún`, not `veintiuno`: the word is always
 * followed by "años" here, and Spanish apocopates before a masculine
 * plural. "treinta y uno años" is the mistake this table exists to make
 * impossible.
 */
const ES_ONES = [
  "cero",
  "un",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiún",
  "veintidós",
  "veintitrés",
  "veinticuatro",
  "veinticinco",
  "veintiséis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
] as const;

const ES_TENS = [
  "",
  "",
  "veinte",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
] as const;

const ZH_DIGITS = [
  "零",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
] as const;

/**
 * The number as words, in both the cases a sentence can need it.
 *
 * TWO FORMS, because the sentence it lands in starts with it in one
 * language and does not in the other: English reads "Thirty-one years
 * have passed…", Spanish reads "Han pasado treinta y un años…". Handing
 * the caller both and letting each dictionary string pick its own
 * placeholder keeps the casing decision in the copy, where it belongs,
 * rather than in a component that would have to know which locale
 * capitalises.
 *
 * 0–99. Above that it returns the digits, which is the right failure for
 * a restaurant that would by then have bigger news than a formatting
 * bug.
 */
export function spellYears(
  n: number,
  locale: Locale,
): { lower: string; upper: string } {
  const lower = spell(n, locale);
  return { lower, upper: lower.charAt(0).toUpperCase() + lower.slice(1) };
}

function spell(n: number, locale: Locale): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (locale === "es") {
    if (n < 30) return ES_ONES[n];
    const tens = ES_TENS[Math.floor(n / 10)];
    const ones = n % 10;
    return ones === 0 ? tens : `${tens} y ${ES_ONES[ones]}`;
  }
  if (n < 20) return EN_ONES[n];
  const tens = EN_TENS[Math.floor(n / 10)];
  const ones = n % 10;
  return ones === 0 ? tens : `${tens}-${EN_ONES[ones]}`;
}

/**
 * The number in Chinese numerals: 31 → 三十一.
 *
 * Its own function rather than a third branch of `spell` because 中文 is
 * not a locale on this site — it is the half of every bilingual pairing
 * that never moves (see lib/i18n/locale.ts), so it is asked for
 * separately, by the string that needs it.
 */
export function yearsInChinese(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 10) return ZH_DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const head = tens === 1 ? "十" : `${ZH_DIGITS[tens]}十`;
  return ones === 0 ? head : `${head}${ZH_DIGITS[ones]}`;
}
