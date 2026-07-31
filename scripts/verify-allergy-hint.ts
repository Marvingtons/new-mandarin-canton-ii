/**
 * Cases for the allergy-hint heuristic (src/lib/order/allergyHint.ts).
 *
 * The hint decides whether the confirmation screen repeats the "call us"
 * line. It blocks nothing, so a wrong answer is cheap — but it is tuned
 * for RECALL on purpose, and the way that goes wrong quietly is a word
 * boundary: `nut` matching coconut, donut and "a minute" would fire the
 * notice on half the orders on the menu and teach people to ignore it.
 * That is what the negative cases below are guarding.
 *
 * Run: npm run verify:allergy-hint
 */
import { mentionsAllergy } from "@/lib/order/allergyHint";

const cases: Array<[Array<string | undefined>, boolean, string]> = [
  // --- should fire ---
  [["severe peanut allergy"], true, "the direct statement"],
  [["no nuts please"], true, "nut as its own word"],
  [["I am allergic to shellfish"], true, "allergic + shellfish"],
  [["gluten free if possible"], true, "gluten"],
  [["過敏"], true, "the Chinese half of the copy"],
  [["no MSG"], true, "msg"],
  [["lactose intolerant"], true, "intoleran-"],
  [["carries an epipen"], true, "epipen"],
  [["nothing here", "shrimp allergy on this one"], true, "any line, not just the first"],
  // --- should NOT fire ---
  [["extra spicy"], false, "an ordinary preference"],
  [["sauce on the side"], false, "an ordinary preference"],
  [["coconut rice"], false, "coconut is not a nut match"],
  [["donut"], false, "donut is not a nut match"],
  [["ready in a minute"], false, "minute is not a nut match"],
  [["no onions"], false, "a dislike, not an allergy"],
  [[undefined], false, "an item with no note"],
  [[], false, "an order with no notes at all"],
];

let pass = 0;
const failures: string[] = [];

for (const [input, want, why] of cases) {
  const got = mentionsAllergy(input);
  if (got === want) {
    pass++;
  } else {
    failures.push(
      `  ${JSON.stringify(input)} — expected ${want} (${why}), got ${got}`,
    );
  }
}

console.log(`allergy hint: ${pass}/${cases.length} cases passed`);
if (failures.length > 0) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
