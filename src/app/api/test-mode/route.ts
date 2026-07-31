import { cookies } from "next/headers";
import {
  TEST_MODE_COOKIE,
  TEST_MODE_TTL_SECONDS,
  isGateBypassKey,
  issueTestModeCookie,
} from "@/lib/order/bypass";

/**
 * GET /api/test-mode?key=<ORDER_GATE_BYPASS> — trade the key for a session.
 *
 * The bypass has always been server-enforced and header-only, which made it
 * curl-only: a browser cannot attach a custom header to a normal navigation,
 * so the one thing it could not test was the actual ordering UI outside
 * business hours. This hands the same browser a signed, httpOnly cookie that
 * presents the same signal, and changes nothing else about what the bypass
 * skips (two clocks) or does not skip (everything else).
 *
 * A WRONG KEY IS A PLAIN 404, byte-identical to this route not existing.
 * Not 401, not 403, no JSON, no timing tell — the compare is constant-time and
 * the failure is silent, because a distinct response is how a prober learns
 * there is something here worth guessing at. Same reason the order route
 * ignores a bad header rather than complaining about it.
 *
 * The key travels in the query string, which is the one real cost: it lands in
 * browser history and in any access log that records query strings. That is
 * accepted deliberately — it is the only way to deliver a secret by typing a
 * URL, the value is rotatable, and the cookie it mints carries no trace of it.
 * Keep the visit off shared machines.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Identical to a missing route. Used for every failure. */
function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

export async function GET(request: Request): Promise<Response> {
  const key = new URL(request.url).searchParams.get("key");

  // Turning it OFF needs no key: ending a bypass early is never the dangerous
  // direction, and requiring the secret to undo it would mean re-typing the
  // secret to make the system SAFER.
  if (key === "off") {
    const store = await cookies();
    store.delete(TEST_MODE_COOKIE);
    console.warn("[order] test-mode session ended — time gates are back ON");
    return new Response("Test mode off. Time gates are back on.\n", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // False when ORDER_GATE_BYPASS is unset, so an unconfigured deploy has no
  // door here at all.
  if (!isGateBypassKey(key)) return notFound();

  const store = await cookies();
  store.set(TEST_MODE_COOKIE, issueTestModeCookie(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TEST_MODE_TTL_SECONDS,
  });

  // Loud, and in the same voice as the order route's own bypass warning, so
  // one grep for GATE BYPASSED finds both the sessions and the orders.
  console.warn(
    "[order] GATE BYPASSED — test-mode session issued, " +
      `${TEST_MODE_TTL_SECONDS / 3600}h. Time gates are OFF for this browser.`,
  );

  return new Response(
    "Test mode on for 4 hours. Order time gates are OFF for this browser.\n" +
      "Every other check — phone verification, price recomputation, daily " +
      "caps, idempotency — still applies.\n\n" +
      "Visit /api/test-mode?key=off to end it early.\n",
    { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
