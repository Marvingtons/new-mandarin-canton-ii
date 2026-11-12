/**
 * MAC comparison, unit-level: the env var and the poll must match however
 * either is spelled.
 *
 *   npm run verify:printer-mac
 *
 * The TSP143IVUE sends `printerMAC: "00:11:62:55:24:d4"` in the poll body and
 * `mac=00%3A11%3A62%3A55%3A24%3Ad4` on GET and DELETE; staff copy the MAC off
 * a self-test print, usually in capitals, sometimes without colons. Every
 * pairing of those spellings must be one printer, and a value that is not a
 * MAC must match nothing and be warned about once.
 */

import {
  looksLikeMac,
  normalizeMac,
  printerIdentity,
  printerMacConfigWarnings,
  resolvePrinterIdentity,
} from "../src/lib/print/printerIdentity";

const results: { name: string; passed: boolean; detail?: string }[] = [];
function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "✓" : "✗"} ${name}${!passed && detail ? ` — ${detail}` : ""}`);
}

const SPELLINGS: Record<string, string> = {
  colon: "00:11:62:55:24:d4",
  "no colon": "0011625524d4",
  uppercase: "00:11:62:55:24:D4",
  "uppercase, no colon": "0011625524D4",
  dashes: "00-11-62-55-24-D4",
  "padded with spaces": "  00:11:62:55:24:d4 \n",
  "percent-encoded (query string)": "00%3A11%3A62%3A55%3A24%3Ad4",
};
const OTHER = "00:11:62:55:24:e5";

console.log("\nnormalize");
for (const [label, value] of Object.entries(SPELLINGS)) {
  check(`${label}: ${JSON.stringify(value)} -> 0011625524d4`, normalizeMac(value) === "0011625524d4",
    String(normalizeMac(value)));
}
check("an encoded colon is decoded, never read as the hex digits 3a", normalizeMac("00%3A11") === "0011");
check("empty and missing are null", normalizeMac("") === null && normalizeMac(null) === null && normalizeMac(undefined) === null);

console.log("\nmatch: every spelling of the env var against every spelling on the wire");
let pairs = 0;
let matched = 0;
for (const env of Object.values(SPELLINGS)) {
  for (const wire of Object.values(SPELLINGS)) {
    pairs++;
    const who = resolvePrinterIdentity(wire, { online: env, store: OTHER });
    if (who?.station === "online") matched++;
  }
}
check(`${pairs} pairings, all the online printer`, matched === pairs, `${matched}/${pairs}`);
check("the store MAC in capitals is the store printer",
  resolvePrinterIdentity(OTHER.toUpperCase(), { online: SPELLINGS.colon, store: OTHER })?.station === "store");
check("a different MAC is nobody",
  resolvePrinterIdentity("00:11:62:55:24:ff", { online: SPELLINGS.colon, store: OTHER }) === null);

console.log("\nnot a MAC");
for (const bad of ["printer-a", "00:11:62:55:24", "00:11:62:55:24:d4:00", "zz:11:62:55:24:d4"]) {
  check(`${JSON.stringify(bad)} does not look like a MAC`, !looksLikeMac(bad));
}
check("a mistyped env MAC matches no printer, not even the one it was meant to be",
  resolvePrinterIdentity(SPELLINGS.colon, { online: "00:11:62:55:24:d", store: OTHER }) === null);
const warnings = printerMacConfigWarnings({ online: "printer-a", store: OTHER });
check("config warning names the variable and the bad value",
  warnings.length === 1 && warnings[0].includes("CLOUDPRNT_PRINTER_MAC_ONLINE") && warnings[0].includes("printer-a"),
  JSON.stringify(warnings));
check("valid MACs in any spelling raise no warning",
  printerMacConfigWarnings({ online: SPELLINGS.uppercase, store: "0011625524E5" }).length === 0);
check("no MAC at all is warned about (both stations would read Not set up)",
  printerMacConfigWarnings({}).some((w) => w.includes("no printer MAC is configured")));

console.log("\nwarned once, at first use");
process.env.CLOUDPRNT_PRINTER_MAC_ONLINE = "not-a-mac";
process.env.CLOUDPRNT_PRINTER_MAC_STORE = OTHER;
const seen: string[] = [];
const original = console.warn;
console.warn = (...args: unknown[]) => void seen.push(args.join(" "));
try {
  printerIdentity(SPELLINGS.colon);
  printerIdentity(SPELLINGS.colon);
  printerIdentity(OTHER);
} finally {
  console.warn = original;
}
check("three polls, one warning line", seen.filter((l) => l.includes("does not look like a MAC")).length === 1,
  JSON.stringify(seen));

const failed = results.filter((r) => !r.passed);
console.log(`\nprinter MAC: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exit(1);
