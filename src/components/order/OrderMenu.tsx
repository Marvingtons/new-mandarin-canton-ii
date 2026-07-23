"use client";

import { useState } from "react";
import type { Menu, MenuItem, MenuSource } from "@/lib/menu/types";
import { isAvailable, itemSizes } from "@/lib/menu/types";
import { useCart } from "@/lib/cart/CartContext";
import { formatCents } from "@/lib/money";
import { SpicyMark } from "@/components/MenuSection";
import ItemSheet from "@/components/order/ItemSheet";
import CartDrawer from "@/components/order/CartDrawer";
import StickyCartBar from "@/components/order/StickyCartBar";

/**
 * The online-ordering experience: category nav + item grid, item sheet, cart
 * drawer, sticky mobile bar. Reads the menu passed from the server (getMenu);
 * the cart lives in CartProvider. Pickup only — no delivery language anywhere.
 */
export default function OrderMenu({
  menu,
  taxRateBps,
  menuSource,
}: {
  menu: Menu;
  taxRateBps: number | null;
  menuSource: MenuSource;
}) {
  const { itemCount, hydrated } = useCart();
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const categories = menu.categories.filter((c) => c.items.length > 0);

  return (
    <>
      <div className="container-wide pb-24 pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl text-lacquer sm:text-5xl">
              Order Pickup
            </h1>
            <p className="mt-3 max-w-2xl leading-relaxed text-ink/75">
              Add items to your cart and pay online — your order goes straight to
              the family, not a delivery app.{" "}
              <span className="font-semibold text-ink">
                Pickup only on Telegraph Canyon Rd.
              </span>
            </p>
          </div>
          <button
            onClick={() => setCartOpen(true)}
            className="hidden items-center gap-2 border border-gold/60 px-4 py-2.5 font-semibold text-lacquer transition-colors hover:border-gold hover:bg-gold/10 sm:inline-flex"
          >
            <span aria-hidden="true">🛒</span>
            Cart{hydrated && itemCount > 0 ? ` · ${itemCount}` : ""}
          </button>
        </div>

        {menuSource === "seed" && (
          <p className="mt-4 border border-gold/40 bg-gold/5 px-4 py-2 text-sm text-ink/70">
            Showing a sample of our most-ordered dishes. The full menu comes
            online shortly.
          </p>
        )}

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
                  className="cat-link token-colors whitespace-nowrap border border-transparent px-3 py-1 font-semibold text-lacquer hover:border-gold/60"
                >
                  {cat.nameEn}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {categories.map((cat) => (
          <section key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-20 pt-10">
            <h2 className="font-display text-3xl text-lacquer">{cat.nameEn}</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {cat.items.map((item) => {
                const sizes = itemSizes(item);
                const from = Math.min(...sizes.map((s) => s.priceCents));
                const hasChoice = sizes.length > 1;
                const disabled = !isAvailable(item);
                return (
                  <button
                    key={item.id}
                    onClick={() => !disabled && setActiveItem(item)}
                    disabled={disabled}
                    className="flex items-start justify-between gap-3 border border-gold/40 bg-cream px-4 py-3 text-left transition-colors hover:border-gold enabled:hover:bg-gold/5 disabled:cursor-not-allowed disabled:opacity-50"
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
                      {disabled && (
                        <span className="mt-1 block text-sm text-ink/50">
                          Currently unavailable
                        </span>
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
