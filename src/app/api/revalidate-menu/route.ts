import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { requireRevalidateSecret } from "@/config/tenant.server";
import { MENU_CACHE_TAG } from "@/lib/menu/source";

/**
 * POST /api/revalidate-menu
 *
 * Busts the cached menu so an edit made in Clover shows up online immediately
 * instead of waiting out the 300s window. Intended for a Clover webhook or a
 * manual curl by the operator.
 *
 *   curl -X POST https://<site>/api/revalidate-menu \
 *        -H "x-revalidate-secret: $REVALIDATE_SECRET"
 *
 * Uses the Node runtime because it reads a server secret and uses node:crypto.
 */
export const runtime = "nodejs";

/** Constant-time compare that does not leak length via early return. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still burn a comparison so timing does not distinguish "wrong length"
    // from "wrong value".
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  let expected: string;
  try {
    expected = requireRevalidateSecret();
  } catch {
    // Misconfiguration is an operator problem, not a caller problem — but we
    // must not reveal which env var is missing to an unauthenticated caller.
    console.error("[revalidate-menu] REVALIDATE_SECRET is not configured");
    return Response.json({ ok: false }, { status: 503 });
  }

  const provided = request.headers.get("x-revalidate-secret");
  if (!provided || !secretMatches(provided, expected)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  // Two-argument form: the single-arg signature is deprecated in Next 16.
  // "max" gives stale-while-revalidate, so the next visitor gets an instant
  // (stale) page while the fresh menu loads behind them.
  revalidateTag(MENU_CACHE_TAG, "max");

  return Response.json({ ok: true, revalidated: MENU_CACHE_TAG });
}
