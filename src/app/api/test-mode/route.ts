import { orderGateBypassSecret } from "@/config/tenant.server";
import {
  TEST_MODE_COOKIE,
  TEST_MODE_TTL_SECONDS,
  isGateBypassKey,
  isValidTestModeCookie,
  issueTestModeCookie,
} from "@/lib/order/bypass";

/**
 * /api/test-mode — a browser session that skips the order time gates.
 *
 *   GET   reports whether THIS browser is in test mode, with a form to change
 *         it. Changes nothing, so a link, an <img>, a prefetch or a forged
 *         cross-site request cannot switch anything on or off.
 *   POST  key=<ORDER_GATE_BYPASS>&mode=on|off  turns it on or off. The key is
 *         required in BOTH directions.
 *
 * The bypass has always been server-enforced and header-only, which made it
 * curl-only: a browser cannot attach a custom header to a normal navigation,
 * so the one thing it could not test was the actual ordering UI outside
 * business hours. This hands the same browser a signed, httpOnly cookie that
 * presents the same signal, and changes nothing else about what the bypass
 * skips (two clocks) or does not skip (everything else).
 *
 * OFF IN PRODUCTION. When NODE_ENV is "production" every method is a 404
 * unless TEST_MODE_ROUTE_ENABLED=1 is set on the deployment, so the door
 * exists only while someone has deliberately opened it. (A cookie already
 * issued stays valid until it expires; the route being off only stops new
 * ones. The x-gate-bypass header is unaffected.)
 *
 * A WRONG KEY IS A PLAIN 404, identical to this route being off or not
 * existing: no 401, no 403, no JSON, and a constant-time compare, because a
 * distinct response is how a prober learns there is something here worth
 * guessing at. An unconfigured deploy (no ORDER_GATE_BYPASS) is a 404 for
 * GET too.
 *
 * The key travels in a POST body, so it stays out of browser history and out
 * of access logs that record query strings.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Identical to a missing route. Used for every refusal. */
function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/** Off in production unless deliberately enabled. Read per request. */
function routeEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.TEST_MODE_ROUTE_ENABLED === "1";
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function cookieHeader(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${TEST_MODE_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function text(body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!routeEnabled() || !orderGateBypassSecret()) return notFound();

  const on = isValidTestModeCookie(readCookie(request, TEST_MODE_COOKIE));
  // Static markup: nothing from the request is echoed into it.
  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Test mode</title>
<body style="font: 16px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem">
<h1 style="font-size: 1.25rem">Test mode is ${on ? "ON" : "off"} for this browser</h1>
<p>${
    on
      ? "Order time gates are OFF here. Every other check still applies."
      : "Order time gates apply as normal."
  }</p>
<form method="post" action="/api/test-mode">
  <label>Key <input type="password" name="key" autocomplete="off" required></label>
  <p>
    <button type="submit" name="mode" value="on">Turn on for 4 hours</button>
    <button type="submit" name="mode" value="off">Turn off</button>
  </p>
</form>
</body>
`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-test-mode": on ? "on" : "off",
    },
  });
}

/** key and mode from a form post or a JSON body. */
async function readBody(request: Request): Promise<{ key: string | null; mode: string | null }> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as { key?: unknown; mode?: unknown };
      return {
        key: typeof body.key === "string" ? body.key : null,
        mode: typeof body.mode === "string" ? body.mode : null,
      };
    }
    const form = new URLSearchParams(await request.text());
    return { key: form.get("key"), mode: form.get("mode") };
  } catch {
    return { key: null, mode: null };
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!routeEnabled()) return notFound();

  const { key, mode } = await readBody(request);
  // False when ORDER_GATE_BYPASS is unset, so an unconfigured deploy has no
  // door here at all. Checked for "off" as well as "on".
  if (!isGateBypassKey(key)) return notFound();

  if (mode === "off") {
    console.warn("[order] test-mode session ended — time gates are back ON");
    return text("Test mode off. Time gates are back on.\n", {
      "set-cookie": cookieHeader("", 0),
      "x-test-mode": "off",
    });
  }
  if (mode !== null && mode !== "on") return notFound();

  // Loud, and in the same voice as the order route's own bypass warning, so
  // one grep for GATE BYPASSED finds both the sessions and the orders.
  console.warn(
    "[order] GATE BYPASSED — test-mode session issued, " +
      `${TEST_MODE_TTL_SECONDS / 3600}h. Time gates are OFF for this browser.`,
  );
  return text(
    "Test mode on for 4 hours. Order time gates are OFF for this browser.\n" +
      "Every other check — phone verification, price recomputation, daily " +
      "caps, idempotency — still applies.\n\n" +
      "Open /api/test-mode to turn it off early.\n",
    {
      "set-cookie": cookieHeader(issueTestModeCookie(), TEST_MODE_TTL_SECONDS),
      "x-test-mode": "on",
    },
  );
}
