/**
 * Assert how every plausible DELETE result code is classified.
 *
 *   npm run verify:print-codes
 *
 * This exists because the old test was `/^(200|0|ok)$/i` — an exact match —
 * and Star spells the same idea three ways across this protocol: "OK" on the
 * DELETE, "200 OK" in the poll body, and "200%20OK" on the wire. A code of
 * "200 OK" therefore matched neither branch's intent: it fell to the failure
 * side and would have recorded a perfectly good print as a print failure.
 *
 * Pure — no database, no network. Run it whenever classifyResultCode changes.
 */

import { classifyResultCode, type ResultVerdict } from "../src/lib/print/cloudprnt";

const CASES: { code: string | null; expect: ResultVerdict; why: string }[] = [
  // --- success: what Star documents ---
  { code: "OK", expect: "success", why: "Star: code is set to OK on completion" },
  { code: "ok", expect: "success", why: "case is not guaranteed" },
  { code: "200", expect: "success", why: "bare 2xx status" },
  { code: "200 OK", expect: "success", why: "the poll body's spelling, decoded from 200%20OK" },
  { code: " 200 OK ", expect: "success", why: "some firmware pads it" },
  { code: "201 Created", expect: "success", why: "Star: a status beginning with 2 is fine" },
  { code: "0", expect: "success", why: "emitted by some reference servers" },

  // --- failure: anything that is not a 2xx or OK ---
  { code: "511", expect: "failure", why: "media decoding error — the bug that started all this" },
  { code: "520", expect: "failure", why: "device error" },
  { code: "40 0 0 0 0", expect: "failure", why: "an ASB status string, not a result code" },
  { code: "2000", expect: "failure", why: "not a status code; must not pass the 2xx test" },
  { code: "NOT OK", expect: "failure", why: "must not match the OK test loosely" },
  { code: "okay", expect: "failure", why: "same" },

  // --- absent: its own verdict, so it is never silently a success ---
  { code: null, expect: "absent", why: "no code parameter at all" },
  { code: "", expect: "absent", why: "present but empty" },
  { code: "   ", expect: "absent", why: "present but whitespace" },
];

let failures = 0;
console.log("DELETE result-code classification:\n");
for (const { code, expect, why } of CASES) {
  const actual = classifyResultCode(code);
  const ok = actual === expect;
  if (!ok) failures++;
  const shown = code === null ? "(absent)" : JSON.stringify(code);
  console.log(
    `  ${ok ? "✓" : "✗"} ${shown.padEnd(14)} -> ${actual.padEnd(8)}` +
      `${ok ? "" : ` EXPECTED ${expect}`}   ${why}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} case(s) misclassified`);
  process.exit(1);
}
console.log(`\nall ${CASES.length} cases classified as intended ✓`);
