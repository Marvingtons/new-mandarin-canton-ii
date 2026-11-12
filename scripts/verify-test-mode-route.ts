/**
 * /api/test-mode cannot be switched by a forged request, and is off in
 * production unless deliberately enabled.
 *
 *   npm run verify:test-mode-route
 *
 * Drives the REAL route handlers with real Requests:
 *
 *   1. GET only reports: whatever it is sent (the old ?key=<secret> and
 *      ?key=off included), it never sets or clears the cookie.
 *   2. POST toggles, and needs the key in BOTH directions: on and off. A
 *      wrong or missing key is the same 404 as the route not existing.
 *   3. NODE_ENV=production: every method is a 404 unless
 *      TEST_MODE_ROUTE_ENABLED=1 (exactly "1").
 *
 * No database, no network.
 */

// A module (it has no static imports), so its names stay its own.
export {};

const KEY = "verify-test-mode-key";

let failures = 0;
let passes = 0;
function check(name: string, passed: boolean, detail = ""): void {
  if (passed) passes++;
  else failures++;
  console.log(`   ${passed ? "✓" : "✗"} ${name}${!passed && detail ? ` (${detail})` : ""}`);
}

type Handler = (r: Request) => Promise<Response>;
interface Route {
  GET: Handler;
  POST: Handler;
}

const env = process.env as Record<string, string | undefined>;
const URL_BASE = "http://localhost/api/test-mode";

function get(query = "", cookie?: string): Request {
  return new Request(`${URL_BASE}${query}`, { headers: cookie ? { cookie } : {} });
}

function postForm(fields: Record<string, string>, cookie?: string): Request {
  return new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(fields).toString(),
  });
}

function postJson(body: unknown): Request {
  return new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface Seen {
  status: number;
  setCookie: string | null;
  state: string | null;
  body: string;
}

async function see(res: Response): Promise<Seen> {
  return {
    status: res.status,
    setCookie: res.headers.get("set-cookie"),
    state: res.headers.get("x-test-mode"),
    body: await res.text(),
  };
}

/** The cookie value a Set-Cookie header carries, or null. */
function cookieValue(setCookie: string | null): string | null {
  const m = setCookie?.match(/^nmc_test_mode=([^;]*)/);
  return m ? m[1] : null;
}

async function main(): Promise<void> {
  env.ORDER_GATE_BYPASS = KEY;
  env.OTP_SIGNING_SECRET = "verify-test-mode-route-signing-secret-0123456789abcdef";
  env.NODE_ENV = "development";
  delete env.TEST_MODE_ROUTE_ENABLED;

  const route = (await import("../src/app/api/test-mode/route")) as unknown as Route & Record<string, unknown>;
  const bypass = await import("../src/lib/order/bypass");
  const validCookie = `nmc_test_mode=${bypass.issueTestModeCookie()}`;

  // What "this route does not exist" looks like, for byte comparisons.
  env.NODE_ENV = "production";
  const absent = await see(await route.GET(get()));
  env.NODE_ENV = "development";

  console.log("\n1. GET only reports the current state");
  {
    const forged = await see(await route.GET(get(`?key=${KEY}`)));
    check("GET ?key=<the real key> (the old switch-on link) sets no cookie", forged.setCookie === null, String(forged.setCookie));
    check("… and answers 200 with the state: off", forged.status === 200 && forged.state === "off" && /is off/.test(forged.body));
    const offLink = await see(await route.GET(get("?key=off", validCookie)));
    check("GET ?key=off (the old switch-off link) clears nothing", offLink.setCookie === null, String(offLink.setCookie));
    check("… and reports the session as on", offLink.state === "on" && /is ON/.test(offLink.body));
    const plain = await see(await route.GET(get("", validCookie)));
    check("GET with a valid session cookie reports on", plain.status === 200 && plain.state === "on");
    const expired = `nmc_test_mode=${bypass.issueTestModeCookie(new Date(Date.now() - 5 * 3600_000))}`;
    check("GET with an expired session cookie reports off", (await see(await route.GET(get("", expired)))).state === "off");
    check("GET is not cacheable", (await route.GET(get())).headers.get("cache-control") === "no-store");
    check("the route exports GET and POST only (any other method is a 405)",
      Object.keys(route).filter((k) => /^[A-Z]+$/.test(k)).sort().join(",") === "GET,POST",
      Object.keys(route).join(","));
  }

  console.log("\n2. POST toggles, with the key, in both directions");
  {
    const on = await see(await route.POST(postForm({ key: KEY, mode: "on" })));
    const value = cookieValue(on.setCookie);
    check("POST key + mode=on: 200 and a session cookie", on.status === 200 && on.state === "on" && value !== null, String(on.setCookie));
    check("… which the order route accepts as a bypass", bypass.isValidTestModeCookie(value));
    check("… httpOnly, SameSite=Lax, 4 hours", /HttpOnly/.test(on.setCookie ?? "") && /SameSite=Lax/.test(on.setCookie ?? "") && /Max-Age=14400/.test(on.setCookie ?? ""));
    check("POST key with no mode means on", cookieValue((await see(await route.POST(postForm({ key: KEY })))).setCookie) !== null);
    check("POST as JSON works too", (await see(await route.POST(postJson({ key: KEY, mode: "on" })))).state === "on");

    const off = await see(await route.POST(postForm({ key: KEY, mode: "off" }, validCookie)));
    check("POST key + mode=off: 200, cookie cleared (Max-Age=0)", off.status === 200 && off.state === "off" && /^nmc_test_mode=;/.test(off.setCookie ?? "") && /Max-Age=0/.test(off.setCookie ?? ""), String(off.setCookie));

    for (const [name, req] of [
      ["mode=off with NO key", postForm({ mode: "off" }, validCookie)],
      ["mode=off with a wrong key", postForm({ key: "wrong", mode: "off" }, validCookie)],
      ["mode=on with a wrong key", postForm({ key: "wrong", mode: "on" })],
      ["mode=on with no key", postForm({ mode: "on" })],
      ["an empty body", new Request(URL_BASE, { method: "POST" })],
      ["malformed JSON", new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json" }, body: "{" })],
      ["the right key and an unknown mode", postForm({ key: KEY, mode: "maybe" })],
      ["the key in the query string, not the body", new Request(`${URL_BASE}?key=${KEY}&mode=on`, { method: "POST" })],
    ] as const) {
      const r = await see(await route.POST(req));
      check(`POST ${name}: 404 like a missing route, no cookie change`,
        r.status === 404 && r.setCookie === null && r.body === absent.body, `status=${r.status} set-cookie=${r.setCookie}`);
    }

    delete env.ORDER_GATE_BYPASS;
    check("no ORDER_GATE_BYPASS configured: GET is a 404", (await route.GET(get())).status === 404);
    check("… and POST with any key is a 404", (await route.POST(postForm({ key: "", mode: "on" }))).status === 404);
    env.ORDER_GATE_BYPASS = KEY;
  }

  console.log("\n3. production: 404 unless TEST_MODE_ROUTE_ENABLED=1");
  {
    env.NODE_ENV = "production";
    delete env.TEST_MODE_ROUTE_ENABLED;
    const g = await see(await route.GET(get("", validCookie)));
    const pOn = await see(await route.POST(postForm({ key: KEY, mode: "on" })));
    const pOff = await see(await route.POST(postForm({ key: KEY, mode: "off" }, validCookie)));
    check("GET: 404", g.status === 404 && g.body === "Not found");
    check("POST on with the right key: 404, no cookie", pOn.status === 404 && pOn.setCookie === null);
    check("POST off with the right key: 404, no cookie", pOff.status === 404 && pOff.setCookie === null);

    for (const v of ["true", "yes", "0", " 1", ""]) {
      env.TEST_MODE_ROUTE_ENABLED = v;
      const r = await route.POST(postForm({ key: KEY, mode: "on" }));
      check(`TEST_MODE_ROUTE_ENABLED=${JSON.stringify(v)} does not open it`, r.status === 404 && r.headers.get("set-cookie") === null);
    }

    env.TEST_MODE_ROUTE_ENABLED = "1";
    const eg = await see(await route.GET(get()));
    check("TEST_MODE_ROUTE_ENABLED=1: GET reports", eg.status === 200 && eg.state === "off");
    const eon = await see(await route.POST(postForm({ key: KEY, mode: "on" })));
    check("TEST_MODE_ROUTE_ENABLED=1: POST with the key turns it on", eon.status === 200 && cookieValue(eon.setCookie) !== null);
    check("… and the cookie is Secure in production", /;\s*Secure/.test(eon.setCookie ?? ""));
    check("TEST_MODE_ROUTE_ENABLED=1: a wrong key is still a 404", (await route.POST(postForm({ key: "wrong", mode: "on" }))).status === 404);
    const eGetKey = await see(await route.GET(get(`?key=${KEY}`)));
    check("TEST_MODE_ROUTE_ENABLED=1: GET ?key=<the key> still sets nothing", eGetKey.setCookie === null);

    env.NODE_ENV = "test";
    delete env.TEST_MODE_ROUTE_ENABLED;
    check("NODE_ENV=test (not production): available without the flag", (await route.GET(get())).status === 200);
    env.NODE_ENV = "development";
  }

  console.log(`\ntest-mode route: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
