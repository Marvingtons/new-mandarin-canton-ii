"use client";

import { useEffect, useMemo, useState } from "react";
import type { Menu, MenuItem } from "@/lib/menu/types";
import { isAvailable, itemSizes } from "@/lib/menu/types";
import { itemMatches, queryTerms } from "@/lib/menu/search";
import { favoriteItemIds } from "@/data/favorites";

/** The one category whose position on the page depends on the clock. */
const LUNCH_CATEGORY_ID = "lunch-specials";
import { useCart } from "@/lib/cart/CartContext";
import { isLunchService } from "@/lib/order/gates";
import { restaurant, sharedLastOnlineOrder } from "@/data/restaurant";
import { formatCents } from "@/lib/money";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { describeItem } from "@/data/menu-descriptions-es";
import PhoneLinks from "@/components/PhoneLinks";
import { SpicyMark } from "@/components/SpicyMark";
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
  lunchOpenInitial,
}: {
  menu: Menu;
  taxRateBps: number | null;
  timezone: string;
  /** Decided on the server so the first paint has lunch in the right place. */
  lunchOpenInitial: boolean;
}) {
  const { t, locale } = useLocale();
  const { itemCount, hydrated } = useCart();
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [spicyOnly, setSpicyOnly] = useState(false);

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
  // Seeded from the server (see menu/page.tsx) rather than starting null, so
  // there is no hydration flash AND no post-mount reshuffle of the whole
  // page when lunch is running. The interval only catches 3:00 PM passing
  // under a page somebody left open.
  const [lunchOpen, setLunchOpen] = useState<boolean>(lunchOpenInitial);
  useEffect(() => {
    const opts = { timezone, leadMinutes: 0, intervalMinutes: 15 };
    const tick = () => setLunchOpen(isLunchService(new Date(), opts));
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [timezone]);

  /**
   * ONE ordering, used by both the jump nav and the sections.
   *
   * During service Lunch Specials leads the page: it is an 11-to-3
   * product, so for those four hours it is the most likely reason someone
   * opened the menu, and it sits fourteenth in printed-menu order. Outside
   * the window it drops back to where the printed menu puts it, still
   * visible and still visibly unorderable.
   *
   * Derived once and shared, because a category bar whose order disagrees
   * with the page is worse than no category bar.
   */
  const categories = useMemo(() => {
    const withItems = menu.categories.filter((c) => c.items.length > 0);
    if (!lunchOpen) return withItems;
    const lunch = withItems.filter((c) => c.id === LUNCH_CATEGORY_ID);
    const rest = withItems.filter((c) => c.id !== LUNCH_CATEGORY_ID);
    return [...lunch, ...rest];
  }, [menu.categories, lunchOpen]);

  /* ---- search + spicy filter ---------------------------------------
     Both narrow the SAME list, so they compose: "beef" with the spicy
     chip on gives spicy beef. Categories left with nothing drop out
     entirely rather than rendering an empty heading. */
  const terms = useMemo(() => queryTerms(query), [query]);
  const filtering = terms.length > 0 || spicyOnly;

  const visible = useMemo(() => {
    if (!filtering) return categories;
    return categories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (item) =>
            (!spicyOnly || item.spicy) &&
            // The category name joins the haystack, so "soup" finds the
            // Soup section's dishes even when no dish is called soup.
            itemMatches(item, terms, cat.nameEn),
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [categories, terms, spicyOnly, filtering]);

  const resultCount = useMemo(
    () => visible.reduce((n, c) => n + c.items.length, 0),
    [visible],
  );

  /** The favourites, resolved against the ORDERABLE menu, in listed order. */
  const favorites = useMemo(() => {
    const byId = new Map(
      menu.categories.flatMap((c) => c.items).map((i) => [i.id, i]),
    );
    return favoriteItemIds
      .map((id) => byId.get(id))
      .filter((i): i is MenuItem => i !== undefined);
  }, [menu.categories]);

  return (
    <>
      <div className="container-wide pb-24 pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl text-lacquer sm:text-5xl">
              {t("menu.title")}
            </h1>
            <p className="mt-3 max-w-2xl leading-relaxed text-ink/75">
              {t("menu.intro")}{" "}
              <span className="font-semibold text-ink">
                {t("menu.pickupOnlyAt", { street: restaurant.address.street })}
              </span>
            </p>
          </div>
          <button
            onClick={() => setCartOpen(true)}
            className="hidden items-center gap-2 rounded-lg border border-gold/60 px-4 py-2.5 font-semibold text-lacquer transition-colors hover:border-gold hover:bg-gold/10 sm:inline-flex"
          >
            <span aria-hidden="true">🛒</span>
            {t("menu.cart")}
            {hydrated && itemCount > 0 ? ` · ${itemCount}` : ""}
          </button>
        </div>

        {/* The persistent line: pickup and the wait, stated at the entry point
            so nobody discovers either at the cart.

            The allergy sentence is a SECOND LINE OF THIS BANNER, not a
            banner of its own. A page that opens with two stacked notices
            teaches people to skip both, and the one we most need read is
            the one about allergies. */}
        <div className="mt-4 rounded-md border border-gold/40 bg-gold/5 px-4 py-2 text-sm text-ink/70">
          <p>
            <span className="font-semibold text-ink">
              {t("banner.pickupReady")}
            </span>{" "}
            {t("banner.longPrep")}
          </p>
          {/* The website stops taking orders before the doors shut, so this
              belongs beside the wait time rather than only in the refusal a
              customer sees after they have built a cart. */}
          {sharedLastOnlineOrder && (
            <p className="mt-1.5 border-t border-gold/25 pt-1.5">
              <span className="font-semibold text-ink">
                {t("banner.onlineUntil", { time: sharedLastOnlineOrder })}
              </span>{" "}
              <span lang="zh-Hant" className="font-chinese text-ink/75">
                · {t("banner.onlineUntilZh")}
              </span>
              . {t("banner.callAfter")}
            </p>
          )}
          <p className="mt-1.5 border-t border-gold/25 pt-1.5">
            <span className="font-semibold text-ink">
              {t("banner.allergy")}
            </span>{" "}
            <span lang="zh-Hant" className="font-chinese text-ink/75">
              · {t("banner.allergyZh")}
            </span>{" "}
            <PhoneLinks
              separator={` ${t("ui.or")} `}
              className="font-semibold text-lacquer underline underline-offset-2"
            />
          </p>
        </div>

        {/* HOUSE FAVOURITES — the same six the homepage carousel shows,
            from the one list in data/favorites.ts. Tapping opens the dish,
            which is the whole point: on the homepage they are a display,
            here they are a way to order in two taps.

            Hidden while a filter is active. A curated shortcut is help
            when you do not know what you want and noise the moment you
            have told us. */}
        {!filtering && favorites.length > 0 && (
          <section aria-labelledby="fav-strip" className="mt-6">
            <h2
              id="fav-strip"
              className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/55"
            >
              {t("menu.favourites")}
            </h2>
            <ul
              data-lenis-prevent
              className="mt-2 flex gap-2 overflow-x-auto pb-1"
            >
              {favorites.map((item) => (
                <li key={item.id} className="shrink-0">
                  <button
                    onClick={() => setActiveItem(item)}
                    className="token-colors flex items-center gap-2 whitespace-nowrap rounded-full border border-gold/50 bg-cream px-3.5 py-1.5 text-sm font-semibold text-ink hover:border-gold hover:bg-gold/10"
                  >
                    {item.nameEn}
                    {item.spicy && <SpicyMark />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Category jump nav + search.
            STICKY, and the search rides with it: a filter you cannot reach
            without scrolling back to the top is a filter people use once.

            The pill row WRAPS from lg up (two rows, no horizontal scroll)
            and keeps the swipe bar below it, which is the behaviour the
            mobile scrollspy was built around. */}
        <nav
          aria-label={t("menu.categoriesAria")}
          className="sticky top-0 z-40 -mx-4 mt-6 border-y border-gold/40 bg-ivory/95 px-4 py-3 backdrop-blur"
        >
          <div className="flex flex-col gap-2 lg:flex-row-reverse lg:items-start lg:gap-4">
            <div className="flex shrink-0 items-center gap-2">
              <label className="relative flex-1 lg:w-56 lg:flex-none">
                <span className="sr-only">{t("menu.searchLabel")}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("menu.search")}
                  className="w-full rounded-sm border border-gold/50 bg-cream px-3 py-1.5 text-sm text-ink outline-none focus:border-lacquer"
                />
              </label>
              <button
                type="button"
                onClick={() => setSpicyOnly((v) => !v)}
                aria-pressed={spicyOnly}
                className={`token-colors shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold ${
                  spicyOnly
                    ? "border-lacquer bg-lacquer text-ivory"
                    : "border-gold/50 text-lacquer hover:border-gold hover:bg-gold/10"
                }`}
              >
                <span aria-hidden="true">🌶</span> {t("menu.spicyOnly")}
              </button>
            </div>

            <ul
              data-lenis-prevent
              className="flex gap-1 overflow-x-auto text-sm lg:flex-wrap lg:overflow-x-visible"
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
          </div>
        </nav>

        {/* Where "Order Takeout" lands: the first dish you can actually add. */}
        <div id="order" className="scroll-mt-20" />

        {/* Nothing matched. Named categories are the way out, because the
            list is 137 dishes and "try a different word" is not advice. */}
        {filtering && resultCount === 0 && (
          <p
            role="status"
            className="mt-10 rounded-md border border-gold/40 bg-gold/5 px-4 py-6 text-center leading-relaxed text-ink/75"
          >
            <span className="font-semibold text-ink">
              {t("menu.noMatches")}
            </span>{" "}
            <span lang="zh-Hant" className="font-chinese text-ink/75">
              · {t("menu.noMatchesZh")}
            </span>
            <button
              onClick={() => {
                setQuery("");
                setSpicyOnly(false);
              }}
              className="mt-3 block w-full text-sm text-lacquer underline underline-offset-2"
            >
              {t("menu.clearFilter")}
            </button>
          </p>
        )}

        {visible.map((cat) => (
          <section key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-20 pt-10">
            <h2 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display text-3xl text-lacquer">
              {cat.nameEn}
              {/* The lunch window, stated on the section itself. During
                  service this section leads the page, so the chip answers
                  "why is this first"; outside it, the same chip is the
                  reason the rows below are unorderable. */}
              {cat.id === LUNCH_CATEGORY_ID && (
                <span
                  className={`rounded-full border px-2.5 py-0.5 font-body text-xs font-semibold uppercase tracking-[0.1em] ${
                    lunchOpen
                      ? "border-gold bg-gold/15 text-ink"
                      : "border-ink/25 text-ink/55"
                  }`}
                >
                  {lunchOpen ? (
                    <>
                      {t("menu.lunchUntil")}{" "}
                      <span lang="zh-Hant" className="font-chinese">
                        · {t("menu.lunchUntilZh")}
                      </span>
                    </>
                  ) : (
                    t("menu.lunchWindowOnly")
                  )}
                </span>
              )}
            </h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {cat.items.map((item) => {
                const sizes = itemSizes(item);
                const from = Math.min(...sizes.map((s) => s.priceCents));
                const hasChoice = sizes.length > 1;
                const outsideLunch = item.lunchSpecial === true && !lunchOpen;
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
                      {/* The blurb translates; the NAME never does. A dish
                          name is a proper noun here — it is what the ticket
                          prints and what a customer points at on the
                          printed menu — but "what is in it" is exactly
                          what a Spanish reader needs. Untranslated dishes
                          fall back to their English blurb rather than to
                          nothing. */}
                      {describeItem(item.id, item.description, locale) && (
                        <span className="mt-1 block text-sm text-ink/65">
                          {describeItem(item.id, item.description, locale)}
                        </span>
                      )}
                      {outsideLunch ? (
                        <span className="mt-1 block text-sm text-ink/50">
                          {t("menu.lunchOnly")}
                        </span>
                      ) : (
                        disabled && (
                          <span className="mt-1 block text-sm text-ink/50">
                            {t("menu.unavailable")}
                          </span>
                        )
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="font-semibold text-lacquer">
                        {hasChoice
                          ? t("menu.from", { price: formatCents(from) })
                          : formatCents(from)}
                      </span>
                      {!disabled && (
                        <span className="mt-0.5 block text-xs uppercase tracking-[0.12em] text-ink/45">
                          {t("menu.addPlus")}
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
