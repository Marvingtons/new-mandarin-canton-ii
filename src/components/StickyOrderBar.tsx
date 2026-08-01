import OrderTakeout from "@/components/OrderTakeout";
import { telHref } from "@/data/restaurant";
import { getT } from "@/lib/i18n/server";

/**
 * Mobile-only sticky action bar pinned to the bottom of the viewport:
 * the primary Order Takeout CTA beside a one-tap Call. Hidden from `sm`
 * up, where the hero and header already carry these actions. A matching
 * spacer in the layout keeps page content clear of the fixed bar.
 *
 * The top corners lift on the BAR, and the gold segment matches on the
 * one corner it actually touches. `overflow-hidden` would have been the
 * shorter way to say that and is wrong here: the two segments fill this
 * bar edge to edge with no padding, so clipping the bar also clips the
 * focus ring off its own children — the primary mobile CTA would show a
 * single gold line instead of a focus indicator. Nothing is clipped; the
 * one child that could poke through carries its own corner.
 */
export default async function StickyOrderBar() {
  const t = await getT();

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex rounded-t-lg border-t border-gold/50 bg-ink text-center sm:hidden">
      <OrderTakeout className="flex-1 rounded-tl-lg bg-gold py-3.5 font-semibold text-ink transition-colors active:bg-gold-light">
        {t("hero.orderTakeout")}
      </OrderTakeout>
      <a
        href={telHref}
        className="flex-1 border-l border-gold/40 py-3.5 font-semibold text-ivory transition-colors active:text-gold-light"
      >
        {t("hero.call")}
      </a>
    </div>
  );
}
