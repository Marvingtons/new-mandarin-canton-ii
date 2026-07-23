import type { Metadata } from "next";
import SectionHeading from "@/components/SectionHeading";
import MenuNavigator from "@/components/MenuNavigator";
import MenuSection from "@/components/MenuSection";
import MenuCombos from "@/components/MenuCombos";
import { menu, combos } from "@/data/menu";
import { restaurant, telHref } from "@/data/restaurant";
import { ORDER_DIRECT_NOTE } from "@/data/order";

export const metadata: Metadata = {
  title: "Order Takeout",
  description:
    "Order takeout direct from New Mandarin Canton II in Chula Vista — no delivery-app fees. Browse the full menu and call to place your pickup order.",
};

/**
 * On-site ordering page (Phase 3, Mode A default destination). Today it's
 * a browse-and-call flow: the full menu plus a clear call-to-order card.
 * Online checkout arrives with the Clover integration — deliberately not
 * a half-built cart. When CLOVER_ORDERING_URL is set the primary CTAs
 * skip this page entirely (see src/data/order.ts).
 */
export default function OrderPage() {

  return (
    <>
      <MenuNavigator />
      <div className="mx-auto max-w-5xl px-4 pb-5 pt-8">
        <SectionHeading as="h1" en="Order Takeout" />
        <p className="mt-4 max-w-2xl leading-relaxed text-ink/75">
          Pickup on Telegraph Canyon Rd. {ORDER_DIRECT_NOTE} — your order
          goes straight to the family, not a delivery app.
        </p>

        {/* Browse-and-call card until Clover online checkout ships. */}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4 border border-gold/40 bg-cream px-5 py-4">
          <p className="text-sm leading-relaxed text-ink/75">
            <span className="font-semibold text-ink">
              To place a pickup order, call us.
            </span>{" "}
            Online ordering is coming soon.
          </p>
          <a
            href={telHref}
            className="ml-auto inline-flex min-h-12 items-center justify-center bg-lacquer px-6 py-3 font-semibold text-ivory transition-colors hover:bg-lacquer-dark"
          >
            Call {restaurant.phone}
          </a>
        </div>
      </div>

      {/* Category jump nav — sticks under the top of the viewport */}
      <nav
        aria-label="Menu categories"
        className="sticky top-0 z-40 border-y border-gold/40 bg-ivory/95 backdrop-blur"
      >
        <ul
          data-lenis-prevent
          className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 py-3 text-sm"
        >
          {[...menu, ...combos].map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="cat-link token-colors whitespace-nowrap border border-transparent px-3 py-1 font-semibold text-lacquer hover:border-gold/60"
              >
                {section.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mx-auto max-w-5xl px-4 pb-24">
        {menu.map((category) => (
          <MenuSection key={category.id} category={category} />
        ))}
        {combos.map((section) => (
          <MenuCombos key={section.id} section={section} />
        ))}
      </div>
    </>
  );
}
