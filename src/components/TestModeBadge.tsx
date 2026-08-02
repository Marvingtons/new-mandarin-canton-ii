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
    <>
      {/*
       * ⚠️ TWO SHAPES, ONE STATE, AND ONLY ONE OF THEM IS EVER RENDERED.
       *
       * Below `sm` this is a 24px full-width ribbon at the TOP edge; from
       * `sm` up it is the floating chip it has always been, bottom-left.
       *
       * The chip is wrong on a phone. It only mounts on /menu and /order,
       * which are the two routes whose bottom-left corner already belongs
       * to the order flow's own fixed bar — so a staff-only reminder was
       * sitting on top of Order Takeout, or on the running cart total, at
       * the exact moment somebody was tapping them. The top edge is the
       * one strip of a phone that no control on this site occupies.
       *
       * The header is pushed down by exactly the ribbon's height rather
       * than covered, via --test-ribbon-h. That variable is declared HERE,
       * in markup that only exists when the cookie is valid, which keeps
       * the whole mechanism inside the component that owns the state —
       * globals.css defaults it to 0px and the header reads it always. A
       * <style> element in a server component is the only way to say
       * "this document is in test mode" without shipping a client
       * component that could claim a state it cannot prove.
       *
       * `pointer-events-none` on both: it is not dismissible (see above)
       * and it must never take a tap meant for what is underneath.
       */}
      <style>{`:root{--test-ribbon-h:24px}@media(min-width:640px){:root{--test-ribbon-h:0px}}`}</style>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex h-6 items-center justify-center border-b-2 border-lacquer bg-gold text-[11px] font-semibold uppercase tracking-[0.15em] text-ink sm:hidden"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-lacquer"
        />
        Test mode · gates off
      </div>
      <div
        // Fixed and above the sticky order bar, which is z-50. The role is
        // on BOTH copies rather than one: whichever is not at this width
        // is `display: none`, which takes it out of the accessibility tree
        // entirely, so exactly one live region ever exists.
        className="pointer-events-none fixed bottom-3 left-3 z-[60] hidden sm:block"
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
    </>
  );
}
