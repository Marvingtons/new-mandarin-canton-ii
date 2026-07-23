import OrderTakeout from "@/components/OrderTakeout";
import { telHref } from "@/data/restaurant";

/**
 * Mobile-only sticky action bar pinned to the bottom of the viewport:
 * the primary Order Takeout CTA beside a one-tap Call. Hidden from `sm`
 * up, where the hero and header already carry these actions. A matching
 * spacer in the layout keeps page content clear of the fixed bar.
 */
export default function StickyOrderBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex border-t border-gold/50 bg-ink text-center sm:hidden">
      <OrderTakeout className="flex-1 bg-gold py-3.5 font-semibold text-ink transition-colors active:bg-gold-light">
        Order Takeout
      </OrderTakeout>
      <a
        href={telHref}
        className="flex-1 border-l border-gold/40 py-3.5 font-semibold text-ivory transition-colors active:text-gold-light"
      >
        Call
      </a>
    </div>
  );
}
