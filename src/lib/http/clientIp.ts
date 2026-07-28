import "server-only";

/**
 * Best-effort client IP for rate limiting.
 *
 * `x-forwarded-for` is client-controllable in general — but on Vercel the
 * platform rewrites it, so the LEFTMOST entry is the real client. Trusting it
 * is correct on that deploy target and wrong on a bare server behind no proxy,
 * which is worth stating rather than assuming.
 *
 * Only ever used as a rate-limit bucket key, never for authorization. A
 * spoofed value can at worst give the spoofer their own fresh bucket, which is
 * exactly why the per-phone limits exist alongside the per-IP ones.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "127.0.0.1";
}
