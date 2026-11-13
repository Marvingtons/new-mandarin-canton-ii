/**
 * /api/otp/start sends ONE text however many starts race for a number.
 *
 *   npm run verify:otp-start
 *
 * Drives the real route handler with Twilio replaced by a counting fetch stub
 * (slow, so the requests genuinely overlap), and asserts:
 *   1. 5 parallel starts for one phone (typed five ways) = exactly 1 Twilio
 *      call, and all 5 get the same success response.
 *   2. A start inside the 30 s claim is answered the same, still no call.
 *   3. After the claim expires, a start calls Twilio again.
 *   4. A different number racing alongside gets its own call.
 *   5. A failed send is shared by its duplicates, then released: the retry
 *      calls Twilio.
 */
// A module (the route is imported dynamically, after the env and fetch stub).
export {};

process.env.TWILIO_ACCOUNT_SID ??= "ACverify";
process.env.TWILIO_AUTH_TOKEN ??= "verify-token";
process.env.TWILIO_VERIFY_SERVICE_SID ??= "VAverify";

const twilioCalls: string[] = [];
const failFor = new Set<string>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("twilio.com")) return realFetch(input, init);
  const to = new URLSearchParams(String(init?.body ?? "")).get("To") ?? "?";
  twilioCalls.push(to);
  await new Promise((r) => setTimeout(r, 150));
  if (failFor.has(to)) {
    return new Response(JSON.stringify({ code: 60200 }), { status: 400 });
  }
  return new Response(JSON.stringify({ sid: "VEverify", status: "pending" }), { status: 201 });
}) as typeof fetch;

let now = Date.now();
Date.now = () => now;

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${!ok && detail ? `\n    ${detail}` : ""}`);
}

let ip = 0;
async function start(POST: (r: Request) => Promise<Response>, phone: string) {
  ip++;
  const res = await POST(
    new Request("http://localhost/api/otp/start", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json", "x-forwarded-for": `10.0.0.${ip}` },
      body: JSON.stringify({ phone }),
    }),
  );
  return { status: res.status, body: JSON.stringify(await res.json()) };
}

async function main(): Promise<void> {
  const { POST } = await import("../src/app/api/otp/start/route");
  const { CLAIM_TTL_MS } = await import("../src/lib/otp/startClaim");

  // 1 + 4: five spellings of one number, racing a different number.
  const A = ["6195550101", "(619) 555-0101", "+1 619 555 0101", "619-555-0101", "1 619 555 0101"];
  const [a, b] = await Promise.all([
    Promise.all(A.map((p) => start(POST, p))),
    start(POST, "6195550202"),
  ]);
  const callsA = twilioCalls.filter((t) => t === "+16195550101").length;
  check("5 parallel starts for one phone make exactly 1 Twilio call", callsA === 1, `calls: ${callsA}`);
  check(
    "all 5 get the same success response",
    a.every((r) => r.status === 200 && r.body === a[0].body) && a[0].body === JSON.stringify({ ok: true, last4: "0101" }),
    JSON.stringify(a),
  );
  check(
    "a different number racing alongside gets its own call",
    twilioCalls.filter((t) => t === "+16195550202").length === 1 && b.status === 200,
    JSON.stringify({ twilioCalls, b }),
  );

  // 2: inside the claim.
  now += CLAIM_TTL_MS - 1_000;
  const again = await start(POST, "6195550101");
  check(
    "a start inside the 30 s claim is answered the same with no call",
    again.status === 200 && again.body === a[0].body && twilioCalls.filter((t) => t === "+16195550101").length === 1,
    JSON.stringify({ again, twilioCalls }),
  );

  // 3: after it.
  now += 2_000;
  const later = await start(POST, "6195550101");
  check(
    "after the claim expires a start calls Twilio again",
    later.status === 200 && twilioCalls.filter((t) => t === "+16195550101").length === 2,
    JSON.stringify({ later, twilioCalls }),
  );

  // 5: a failure is shared, then released.
  failFor.add("+16195550303");
  const failed = await Promise.all([1, 2, 3].map(() => start(POST, "6195550303")));
  check(
    "a failed send is 1 call, and its duplicates get the same failure",
    twilioCalls.filter((t) => t === "+16195550303").length === 1 &&
      failed.every((r) => r.status === 400 && r.body === failed[0].body),
    JSON.stringify({ failed, twilioCalls }),
  );
  failFor.delete("+16195550303");
  const retry = await start(POST, "6195550303");
  check(
    "a failed send releases the claim: the retry calls Twilio",
    retry.status === 200 && twilioCalls.filter((t) => t === "+16195550303").length === 2,
    JSON.stringify({ retry, twilioCalls }),
  );

  console.log(`\notp start dedupe: ${passes}/${passes + failures} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
