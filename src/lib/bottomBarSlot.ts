import { useEffect } from "react";

/**
 * ONE BAR ACROSS THE BOTTOM OF A PHONE, AND IT IS ALWAYS THE MORE
 * SPECIFIC ONE.
 *
 * Two components own that strip and neither could see the other. The
 * site-wide StickyOrderBar lives in the root layout; StickyCartBar lives
 * inside OrderMenu, under a CartProvider the layout is not inside — so
 * there is no shared state and no parent to arbitrate. They also both
 * carry z-50, which means the later one in the DOM wins, which is the
 * layout's, which is the wrong one.
 *
 * Measured on /menu at 390 with one dish in the cart: the cart bar sat at
 * y=771 and 73px tall, the order bar at y=791 and 53px tall, painted over
 * it. The customer's running total and the only route to checkout were
 * behind "Order Takeout" — a button that goes back to the menu they are
 * already looking at.
 *
 * So the specific bar CLAIMS the slot and the general one stands down.
 * Same shape as lib/headerState: a module-scope value, a subscriber set,
 * and a `useSyncExternalStore` on the reading side, because this has to
 * survive a component in one React subtree telling a component in another
 * that the corner is taken.
 *
 * A COUNTER, not a boolean. Route transitions overlap mounts — the next
 * page's bar can claim before the previous page's unmounts — and a
 * boolean would have the outgoing release cancel the incoming claim,
 * leaving both bars visible for exactly as long as nobody scrolled.
 */
let claims = 0;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}

export function subscribeBottomBar(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function getBottomBarClaimed(): boolean {
  return claims > 0;
}

/** The server renders the unclaimed state — nothing may reserve space. */
export function getBottomBarClaimedServer(): boolean {
  return false;
}

/**
 * Hold the bottom slot for as long as `active` is true. Called
 * unconditionally so it sits above any early return in the caller.
 */
export function useClaimBottomBar(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    claims += 1;
    notify();
    return () => {
      claims -= 1;
      notify();
    };
  }, [active]);
}
