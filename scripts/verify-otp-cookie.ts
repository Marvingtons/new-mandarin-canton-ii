/**
 * Regression test for the verified-but-rejected checkout bug.
 *
 *   npm run verify:otp
 *
 * The bug: /api/otp/check mints a token whose first field is an E.164 number,
 * so it starts with "+". Next's cookie serializer percent-encodes the value,
 * and readVerifiedPhoneFromRequest — which parses the RAW cookie header rather
 * than going through cookies().get() — did not decode it. The HMAC was then
 * verified over "%2B1858…" against a signature made over "+1858…", so every
 * order was rejected while the checkout still showed "✓ Number verified".
 *
 * These assertions walk the real handshake: mint exactly as the check route
 * does, serialize exactly as Next does, then read exactly as the order route
 * does.
 */

// Next's own vendored serializer — the exact code that writes the Set-Cookie
// header in production. Untyped, so the shape is asserted at the call site.
// @ts-expect-error — no declaration file ships with the vendored copy.
import cookieLib from "next/dist/compiled/cookie/index.js";
import {
  mintRememberToken,
  mintToken,
  readRememberedPhoneFromRequest,
  readRememberToken,
  readToken,
  readVerifiedPhoneFromRequest,
} from "../src/lib/otp/session";
import { normalizePhone } from "../src/lib/phone";

process.env.OTP_SIGNING_SECRET ??= "test-secret-for-cookie-round-trip";

const COOKIE_NAME = "nmc_phone";
/** The number from the production report. */
const TYPED = "8582077770";
const E164 = "+18582077770";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${String(expected)}, got ${String(actual)}`);
}

/** A Request carrying `token` the way a browser would send it back. */
function requestWith(token: string, encode: boolean): Request {
  const serialized = encode
    ? (cookieLib as { serialize: (n: string, v: string) => string }).serialize(
        COOKIE_NAME,
        token,
      )
    : `${COOKIE_NAME}=${token}`;
  return new Request("https://example.test/api/orders", {
    method: "POST",
    headers: { cookie: serialized },
  });
}

function main(): void {
  console.log("normalization — every typed form collapses to one E.164:");
  for (const input of [
    "8582077770",
    "+18582077770",
    "+1 858 207 7770",
    "(858) 207-7770",
    "858-207-7770",
    "1 (858) 207 7770",
  ]) {
    check(`normalizePhone(${JSON.stringify(input)})`, normalizePhone(input).e164, E164);
  }

  console.log("\ncookie round-trip (the bug):");
  const token = mintToken(E164);

  // How Next actually writes it. This is the case that was failing.
  const encoded = requestWith(token, true);
  check(
    "percent-encoded cookie is read back",
    readVerifiedPhoneFromRequest(encoded)?.e164,
    E164,
  );

  // A cookie written without encoding must still work — belt and braces.
  check(
    "unencoded cookie is read back",
    readVerifiedPhoneFromRequest(requestWith(token, false))?.e164,
    E164,
  );

  console.log("\nthe order route's actual comparison:");
  // What /api/orders does: normalize the submitted phone, compare to the token.
  const verified = readVerifiedPhoneFromRequest(encoded);
  for (const typed of [TYPED, "+1 858 207 7770", "(858) 207-7770"]) {
    const submitted = normalizePhone(typed);
    check(
      `submit ${JSON.stringify(typed)} against the cookie`,
      submitted.ok && submitted.e164 === verified?.e164,
      true,
    );
  }

  console.log("\nrejections still reject:");
  check(
    "tampered signature",
    readVerifiedPhoneFromRequest(requestWith(token.slice(0, -1) + "0", true)),
    null,
  );
  check(
    "different number in the payload",
    readVerifiedPhoneFromRequest(requestWith(mintToken("+16195550148"), true))?.e164 ===
      E164,
    false,
  );
  check(
    "expired token",
    readVerifiedPhoneFromRequest(
      requestWith(mintToken(E164, Date.now() - 16 * 60 * 1000), true),
    ),
    null,
  );
  check("no cookie at all", readVerifiedPhoneFromRequest(new Request("https://example.test/")), null);

  /* ------------------------------- remembered numbers (90-day cookie) -- */
  const TTL = 90;
  const DAY = 86_400_000;
  console.log("\nremembered-number cookie:");

  const remember = mintRememberToken(E164);
  check("round-trips", readRememberToken(remember, TTL)?.e164, E164);
  check(
    "survives percent-encoding, like the order token",
    readRememberedPhoneFromRequest(
      new Request("https://example.test/", {
        headers: {
          cookie: (cookieLib as { serialize: (n: string, v: string) => string })
            .serialize("nmc_verified", remember),
        },
      }),
      TTL,
    )?.e164,
    E164,
  );
  check(
    "tampered signature rejected",
    readRememberToken(remember.slice(0, -1) + "0", TTL),
    null,
  );
  check(
    "tampered PHONE rejected (signature covers it)",
    readRememberToken(remember.replace(E164, "+16195550148"), TTL),
    null,
  );
  check(
    "expired rejected (91 days old)",
    readRememberToken(mintRememberToken(E164, Date.now() - 91 * DAY), TTL),
    null,
  );
  check(
    "89 days old still valid",
    readRememberToken(mintRememberToken(E164, Date.now() - 89 * DAY), TTL)?.e164,
    E164,
  );
  check(
    "shortening the TTL retroactively expires it",
    readRememberToken(mintRememberToken(E164, Date.now() - 30 * DAY), 7),
    null,
  );
  check("TTL 0 disables the feature", readRememberToken(remember, 0), null);
  check("future-dated rejected", readRememberToken(mintRememberToken(E164, Date.now() + DAY), TTL), null);

  // Domain separation: the two token families must not be interchangeable.
  check(
    "a 15-min order token is NOT a valid remember token",
    readRememberToken(mintToken(E164), TTL),
    null,
  );
  check(
    "a remember token is NOT a valid order token",
    readToken(remember),
    null,
  );

  console.log("\ndifferent number requires fresh OTP:");
  const rememberedOther = readRememberToken(mintRememberToken("+16195550148"), TTL);
  check(
    "cookie for another number does not verify this one",
    rememberedOther?.e164 === E164,
    false,
  );

  console.log(
    failures === 0
      ? "\nall checks passed ✓"
      : `\n${failures} check(s) FAILED`,
  );
  if (failures > 0) process.exit(1);
}

main();
