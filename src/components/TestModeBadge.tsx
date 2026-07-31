import { cookies } from "next/headers";
import {
  TEST_MODE_COOKIE,
  isValidTestModeCookie,
} from "@/lib/order/bypass";

/**
 * "TEST MODE · gates off" — the reminder that the clocks are switched off.
 *
 * The whole risk of a browser-reachable bypass is not that someone guesses the
 * key; it is that whoever turned it on forgets, takes a real order through a
 * gate that should have stopped it, and finds out when the kitchen is closed.
 * So the badge is deliberately hard to miss and deliberately not dismissible.
 *
 * SERVER COMPONENT, and that is the security property, not a rendering
 * preference. It reads the httpOnly cookie through next/headers — which
 * client JavaScript cannot do and cannot fake — and renders nothing at all
 * when the session is absent or expired. There is no prop, no context and no
 * client state that could turn it on, so a page cannot claim test mode it does
 * not have, and cannot hide test mode it does.
 *
 * What crosses to the browser is one boolean's worth of information, already
 * spent: markup that exists, or markup that does not. The key never reaches
 * this file — it is not in the cookie either, only a signature over an expiry
 * (see lib/order/bypass.ts).
 */
export default async function TestModeBadge() {
  const store = await cookies();
  const active = isValidTestModeCookie(store.get(TEST_MODE_COOKIE)?.value);
  if (!active) return null;

  return (
    <div
      // Fixed and above the sticky order bar, which is z-50. Bottom-left keeps
      // it clear of that bar's buttons on mobile.
      className="pointer-events-none fixed bottom-16 left-3 z-[60] sm:bottom-3"
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-2 rounded-full border-2 border-lacquer bg-gold px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink shadow-lg">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full bg-lacquer"
        />
        Test mode · gates off
      </span>
    </div>
  );
}
