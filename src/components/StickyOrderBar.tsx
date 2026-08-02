"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import OrderTakeout from "@/components/OrderTakeout";
import { telHref } from "@/data/restaurant";
import {
  getBottomBarClaimed,
  getBottomBarClaimedServer,
  subscribeBottomBar,
} from "@/lib/bottomBarSlot";
import { usePastHero } from "@/lib/headerState";
import { useT } from "@/lib/i18n/LocaleContext";

/**
 * Mobile-only sticky action bar pinned to the bottom of the viewport:
 * the primary Order Takeout CTA beside a one-tap Call. Hidden from `sm`
 * up, where the hero and header already carry these actions. A matching
 * spacer in the layout keeps page content clear of the fixed bar.
 *
 * ⚠️ NOT OVER THE HOME HERO, and this is the whole reason the file is a
 * client component now. The hero's own first viewport already offers
 * Order Takeout and a call row; this bar sat on top of them, so a 390px
 * phone opened on two Order Takeout buttons and two ways to call, 106px
 * apart, one of them covering the hero's status pill. The hero gets to
 * make its case, and the bar arrives the moment the hero's CTAs leave —
 * on the same signal that turns the header solid (usePastHero), so the
 * two never disagree about where the hero ended.
 *
 * Everywhere else it renders immediately: no other page has a competing
 * primary CTA in its first screen, and on /menu it is the only order
 * control above the fold.
 *
 * `hidden` rather than unmounted, because mounting a fixed bar mid-scroll
 * would pop it in with no transition and briefly hand the browser a new
 * paint layer over the footage; `.sob` in globals.css owns the fade and
 * switches it off under prefers-reduced-motion.
 *
 * The top corners lift on the BAR, and the gold segment matches on the
 * one corner it actually touches. `overflow-hidden` would have been the
 * shorter way to say that and is wrong here: the two segments fill this
 * bar edge to edge with no padding, so clipping the bar also clips the
 * focus ring off its own children — the primary mobile CTA would show a
 * single gold line instead of a focus indicator. Nothing is clipped; the
 * one child that could poke through carries its own corner.
 */
/**
 * Pages where this bar is not chrome but an interruption: the customer is
 * inside the order they came to place, and "Order Takeout" would take them
 * back to the menu they have already finished with. A fixed bar across the
 * bottom of a form is also the thing that ends up between a phone keyboard
 * and the field it is covering.
 *
 * /menu is deliberately NOT here — there it is the only order control above
 * the fold, and StickyCartBar takes the same corner from it the moment the
 * cart is not empty.
 */
const ORDER_FLOW = ["/order/checkout", "/order/confirmation"];

export default function StickyOrderBar() {
  const t = useT();
  const pathname = usePathname();
  const pastHero = usePastHero();
  // StickyCartBar takes this corner the moment the cart is not empty:
  // a running total and the way to checkout beat a link back to the menu.
  const cartBarUp = useSyncExternalStore(
    subscribeBottomBar,
    getBottomBarClaimed,
    getBottomBarClaimedServer,
  );
  const shown =
    !cartBarUp &&
    !ORDER_FLOW.includes(pathname) &&
    (pathname !== "/" || pastHero);

  return (
    <div
      // aria-hidden with it: while the hero owns the CTAs, a screen
      // reader should not find a second Order Takeout in the tab order
      // either. `visibility` in the transition takes it out of that
      // order without the layout ever moving (same device as .btt).
      aria-hidden={shown ? undefined : "true"}
      className={`sob fixed inset-x-0 bottom-0 z-50 flex rounded-t-lg border-t border-gold/50 bg-ink text-center sm:hidden ${
        shown ? "" : "sob-hidden"
      }`}
    >
      {/* env() goes on the two SEGMENTS, not the bar: each carries its own
          background edge to edge, so padding the bar would leave an ink
          strip under the gold half. Both extend their own colour into the
          home-indicator zone instead, and env() is 0px where there is no
          indicator. */}
      <OrderTakeout className="flex-1 rounded-tl-lg bg-gold py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] font-semibold text-ink transition-colors active:bg-gold-light">
        {t("hero.orderTakeout")}
      </OrderTakeout>
      <a
        href={telHref}
        className="flex-1 border-l border-gold/40 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] font-semibold text-ivory transition-colors active:text-gold-light"
      >
        {t("hero.call")}
      </a>
    </div>
  );
}
