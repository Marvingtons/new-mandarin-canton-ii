"use client";

import { useEffect, useState } from "react";
import type { Menu, MenuItem } from "@/lib/menu/types";
import { isAvailable, itemSizes } from "@/lib/menu/types";
import { useCart } from "@/lib/cart/CartContext";
import { isLunchService } from "@/lib/order/gates";
import { restaurant } from "@/data/restaurant";
import { formatCents } from "@/lib/money";
import { SpicyMark } from "@/components/MenuSection";
import ItemSheet from "@/components/order/ItemSheet";
import CartDrawer from "@/components/order/CartDrawer";
import StickyCartBar from "@/components/order/StickyCartBar";

/**
 * The menu. Category nav + item grid, item sheet, cart drawer, sticky mobile
 * bar. Reads the menu passed from the server (getMenu); the cart lives in
 * CartProvider. Pickup only — no delivery language anywhere.
 *
 * This is now the ONLY menu surface — /menu renders it and /order redirects
 * there — so it is both the thing search traffic lands on and the thing an
 * order is built in. The two hero CTAs differ only in where they land: "View
 * Menu" at the top, "Order Takeout" at #order, which is the grid itself.
 */
export default function OrderMenu({
  menu,
  taxRateBps,
  timezone,
}: {
  menu: Menu;
  taxRateBps: number | null;
  timezone: string;
}) {
  const { itemCount, hydrated } = useCart();
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  /* ARRIVING VIA "ORDER TAKEOUT" (/menu#order, and /order redirects to it) is
     handled by the browser: the hash scrolls past the header copy and onto the
     grid, which is the whole difference between the two hero CTAs.

     No effect opens the cart drawer on arrival. A hash is available before
     hydration but the CART is not — it rehydrates from sessionStorage after
     mount — so anything that opened the drawer would have to be an effect
     firing on a state change, i.e. a drawer that appears a beat after the page
     settles and re-appears if the customer closes it and the count changes.
     StickyCartBar and the Cart button already surface a non-empty cart the
     moment it hydrates, which is the same information without seizing the
     screen. */

  // Lunch specials are an 11–3 product. This is a UX hint only — it decides
  // what the grid offers, never whether an order is accepted. The submit path
  // re-checks against the server clock (lib/order/gates.ts), so a browser with
  // a wrong clock gets a clear refusal rather than a bad order.
  //
  // Null until mounted, so the server render and the first client render agree
  // and there is no hydration flash.
  const [lunchOpen, setLunchOpen] = useState<boolean | null>(null);
  useEffect(() => {
    const opts = { timezone, leadMinutes: 0, intervalMinutes: 15 };
    const tick = () => setLunchOpen(isLunchService(new Date(), opts));
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [timezone]);

  const categories = menu.categories.filter((c) => c.items.length > 0);

  return (
    <>
      <div className="container-wide pb-24 pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl text-lacquer sm:text-5xl">
              Menu
            </h1>
            <p className="mt-3 max-w-2xl leading-relaxed text-ink/75">
              Order straight from the family, not a delivery app.{" "}
              <span className="font-semibold text-ink">
                Pickup only at {restaurant.address.street}.
              </span>
            </p>
          </div>
          <button
            onClick={() => setCartOpen(true)}
            className="hidden items-center gap-2 rounded-lg border border-gold/60 px-4 py-2.5 font-semibold text-lacquer transition-colors hover:border-gold hover:bg-gold/10 sm:inline-flex"
          >
            <span aria-hidden="true">🛒</span>
            Cart{hydrated && itemCount > 0 ? ` · ${itemCount}` : ""}
          </button>
        </div>

        {/* The persistent line: pickup and the wait, stated at the entry point
            so nobody discovers either at the cart. */}
        <p className="mt-4 rounded-md border border-gold/40 bg-gold/5 px-4 py-2 text-sm text-ink/70">
          <span className="font-semibold text-ink">
            Pickup only · ready in 15–20 minutes.
          </span>{" "}
          Party trays and family dinners take 20–30. Pay at the counter when
          you collect — we don&apos;t take payment online.
        </p>

        {/* Category jump nav */}
        <nav
          aria-label="Menu categories"
          className="sticky top-0 z-40 -mx-4 mt-6 border-y border-gold/40 bg-ivory/95 px-4 backdrop-blur"
        >
          <ul
            data-lenis-prevent
            className="flex gap-1 overflow-x-auto py-3 text-sm"
          >
            {categories.map((cat) => (
              <li key={cat.id}>
                <a
                  href={`#cat-${cat.id}`}
                  className="cat-link token-colors whitespace-nowrap rounded-full border border-transparent px-3 py-1 font-semibold text-lacquer hover:border-gold/60"
                >
                  {cat.nameEn}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Where "Order Takeout" lands: the first dish you can actually add. */}
        <div id="order" className="scroll-mt-20" />

        {categories.map((cat) => (
          <section key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-20 pt-10">
            <h2 className="font-display text-3xl text-lacquer">{cat.nameEn}</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {cat.items.map((item) => {
                const sizes = itemSizes(item);
                const from = Math.min(...sizes.map((s) => s.priceCents));
                const hasChoice = sizes.length > 1;
                // lunchOpen === null means "not mounted yet" — don't disable
                // on the server render, or the grid flickers on hydration.
                const outsideLunch =
                  item.lunchSpecial === true && lunchOpen === false;
                const disabled = !isAvailable(item) || outsideLunch;
                return (
                  <button
                    key={item.id}
                    onClick={() => !disabled && setActiveItem(item)}
                    disabled={disabled}
                    className="flex items-start justify-between gap-3 rounded-md border border-gold/40 bg-cream px-4 py-3 text-left transition-colors hover:border-gold enabled:hover:bg-gold/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-ink">
                          {item.nameEn}
                        </span>
                        {item.spicy && <SpicyMark />}
                      </span>
                      {item.description && (
                        <span className="mt-1 block text-sm text-ink/65">
                          {item.description}
                        </span>
                      )}
                      {outsideLunch ? (
                        <span className="mt-1 block text-sm text-ink/50">
                          Lunch specials are served 11:00 AM – 3:00 PM
                        </span>
                      ) : (
                        disabled && (
                          <span className="mt-1 block text-sm text-ink/50">
                            Currently unavailable
                          </span>
                        )
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="font-semibold text-lacquer">
                        {hasChoice ? `from ${formatCents(from)}` : formatCents(from)}
                      </span>
                      {!disabled && (
                        <span className="mt-0.5 block text-xs uppercase tracking-[0.12em] text-ink/45">
                          Add +
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <ItemSheet item={activeItem} onClose={() => setActiveItem(null)} />
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        taxRateBps={taxRateBps}
      />
      <StickyCartBar onView={() => setCartOpen(true)} />
    </>
  );
}
