/**
 * Does anything the customer typed look like it might be about an allergy?
 *
 * ⚠️ THIS IS A HINT, NOT A CONTROL. It decides whether the confirmation
 * screen shows one extra "call us" line. It never blocks an order, never
 * changes what the kitchen sees, and is never treated as a finding. A
 * customer with a severe allergy who types nothing must be no worse off
 * than one who types "peanut", because the whole message on this site is
 * that the notes box is not the channel for this.
 *
 * TUNED FOR RECALL, DELIBERATELY. A false positive costs one redundant
 * sentence on a page the customer has already reached; a false negative
 * costs the one nudge that might have made them phone. So "no shrimp" —
 * far more often a preference than an allergy — is in, and the asymmetry
 * is the point rather than an oversight.
 *
 * Runs in the browser at submit time, on the cart the customer is holding.
 * It deliberately does NOT live on the server: the server's job is to
 * store what was typed, verbatim, and adding a keyword scan there would
 * invite someone to later believe the system "knows" about allergies.
 */

/**
 * `\bnut\b` rather than `nut`, or coconut, donut and "a minute" all match.
 * Everything else here is distinctive enough to be a substring, except the
 * short words that are also ordinary English (soy, milk, egg).
 */
const ALLERGY_PATTERNS: readonly RegExp[] = [
  /\ballerg/i, // allergy, allergic, allergen, allergies
  /intoleran/i, // intolerant, intolerance
  /過敏/, // the same word on the Chinese side of the copy
  /peanut/i,
  /tree ?nut/i,
  /\bnuts?\b/i,
  /shell ?fish/i,
  /shrimp|prawn|crab|lobster|scallop|clam|oyster/i,
  /gluten|celiac|coeliac/i,
  /sesame/i,
  /\bsoy\b|\bsoya\b/i,
  /dairy|lactose/i,
  /\bmsg\b/i,
  /\bepipen\b|anaphyla/i,
];

/**
 * True if any of the given special-instruction strings reads like it could
 * be about an allergy. Undefined/empty entries are ignored.
 */
export function mentionsAllergy(
  notes: readonly (string | undefined | null)[],
): boolean {
  return notes.some((note) => {
    if (!note) return false;
    return ALLERGY_PATTERNS.some((re) => re.test(note));
  });
}
