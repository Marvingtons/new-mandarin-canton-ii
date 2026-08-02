"use client";

import { useEffect, useMemo, useState } from "react";
import type { Menu, MenuItem } from "@/lib/menu/types";
import { isAvailable, itemSizes } from "@/lib/menu/types";
import { itemMatches, queryTerms } from "@/lib/menu/search";
import { favoriteItemIds } from "@/data/favorites";

/** The one category whose position on the page depends on the clock. */
const LUNCH_CATEGORY_ID = "lunch-specials";

/**
 * Shorter labels for the jump-nav PILLS ONLY.
 *
 * "Big Family Dinner Special" is 25 characters in a row of eleven other
 * pills, and it was single-handedly deciding where the row wrapped. The
 * catalogue keeps the full name — it is what the section heading says, what
 * search matches on, and what the kitchen ticket prints — so this cannot be
 * an edit to `menu.ts`. It is a display override on one control, and the
 * fully-named heading is two lines below the pill that points at it.
 *
 * English only, like every other category name on the site.
 */
const NAV_LABEL_OVERRIDES: Record<string, string> = {
  "big-family-dinner": "Big Family Dinner",
};

const navLabel = (id: string, nameEn: string): string =>
  NAV_LABEL_OVERRIDES[id] ?? nameEn;

/**
 * The number the compressed notice line offers.
 *
 * Both lines are staffed and every other "call us" surface renders both —
 * but this one sits inside a line that has been squeezed onto two rows, and
 * a second number there is a second decision at the moment somebody is
 * trying to make a call. The other number is on this same page, in the
 * footer's contact band, which renders the whole list.
 */
const primaryPhone = phoneLinks[0];
import { useCart } from "@/lib/cart/CartContext";
import { isLunchService } from "@/lib/order/gates";
import { phoneLinks, restaurant, sharedLastOnlineOrder } from "@/data/restaurant";
import { formatCents } from "@/lib/money";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { describeItem } from "@/data/menu-descriptions-es";
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
        {/* ---- BAND 1: TITLE ROW ------------------------------------------
            items-CENTER, not items-end. The Cart button used to hang off the
            baseline of a two-line paragraph, which read as detached from the
            title rather than paired with it. Centred against the whole title
            block, the two are one row.
            The tagline is one line at 1440: two halves joined by a middot,
            the second half — where you collect — carrying the weight. */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div>
            <h1 className="font-display text-4xl text-lacquer sm:text-5xl">
              {t("menu.title")}
            </h1>
            <p className="mt-2 leading-relaxed text-ink/75">
              {t("menu.intro")}{" "}
              <span aria-hidden="true" className="text-ink/35">
                ·
              </span>{" "}
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

        {/* ---- BAND 2: THE ONE NOTICE CARD --------------------------------
            Two lines, no internal rules. It was three stacked lines with a
            gold hairline between each, which is three notices wearing one
            border — and at 390 it stood 246px tall, the single largest thing
            between a customer and the food.

            Line 1 is logistics; line 2 is the clock and the allergy line.
            MIDDOTS SEPARATE TOPICS. A 中文 half follows its English directly
            with no middot of its own — it is set in font-chinese and muted,
            which is what tells you it is the same sentence again rather than
            the next one. Four middots in one line would have made the
            character mean two different things at once.

            ONE phone number, and it is the primary line. The second lives in
            the footer of this same page (see the contact band), and two
            numbers inside a compressed line is noise at the exact moment the
            line is asking somebody to make a call. */}
        <div className="mt-5 rounded-md border border-gold/40 bg-gold/5 px-4 py-3 text-sm leading-relaxed text-ink/75">
          <p>
            <span className="font-semibold text-ink">
              {t("banner.pickupLead")}
            </span>{" "}
            <span aria-hidden="true" className="text-ink/35">
              ·
            </span>{" "}
            {t("banner.logistics")}
          </p>
          <p className="mt-1">
            {/* The website stops taking orders before the doors shut. The
                "call after that" half of this used to sit here too; it is on
                every page already, under the hours in the footer
                (footer.lastOnlineOrder), which is where somebody who has just
                read a cutoff time goes looking. */}
            {sharedLastOnlineOrder && (
              <>
                <span className="font-semibold text-ink">
                  {t("banner.onlineUntil", { time: sharedLastOnlineOrder })}
                </span>{" "}
                {/* nowrap: CJK breaks between any two characters, so at
                    390 this was splitting as 網上訂餐至晚上 / 8:30 and
                    stranding the time on the next line away from the
                    sentence that names it. It is 8 characters; it fits on
                    a line of its own. */}
                <span
                  lang="zh-Hant"
                  className="whitespace-nowrap font-chinese text-ink/60"
                >
                  {t("banner.onlineUntilZh")}
                </span>
                {/* NBSP before the middot, a normal space after. At 390
                    this line wraps mid-sentence and the break was landing
                    in front of the separator, so the allergy half started
                    with a bullet-looking "· " at the left margin. A middot
                    is a joiner; it belongs to the line it ends. */}
                {" "}
                <span aria-hidden="true" className="text-ink/35">
                  ·
                </span>{" "}
              </>
            )}
            {t("banner.allergy")}{" "}
            {/* nowrap for the same reason as the cutoff's 中文 above: CJK
                breaks anywhere, and 食物 / 過敏請先致電 across two lines is
                a phrase cut in half. */}
            <span
              lang="zh-Hant"
              className="whitespace-nowrap font-chinese text-ink/60"
            >
              {t("banner.allergyZh")}
            </span>{" "}
            <a
              href={primaryPhone.href}
              className="tap whitespace-nowrap font-semibold text-lacquer underline underline-offset-2"
            >
              {primaryPhone.phone}
            </a>
          </p>
        </div>

        {/* ---- BANDS 3 + 4: COMMAND ROW, then the BROWSE BAND -------------
            One sticky block, because both halves have to stay reachable: a
            filter you cannot get back to is a filter people use once, and a
            category bar you cannot get back to is not a jump nav.

            The search comes FIRST and fills the row — it is the power tool on
            a 137-dish menu, and it was previously tucked beside the spicy
            chip on a second row below the pills.

            Favourites and categories then read as one "where do you want to
            go" band, divided from the command row by the ONE internal
            hairline this whole zone gets. The block's own bottom edge is not
            that hairline: it is the sticky surface's edge, and it is what
            stops dishes appearing to float into the controls as they scroll
            under it. */}
        {/* ⚠️ THIS BLOCK IS FOUR ROWS OF CONTROLS AND NOT ONE OF THEM WAS
            A THUMB'S WORTH. Measured at 390: search field 34px tall,
            spicy chip 34, favourite chips 30, category pills 28.

            Two different fixes, because the two halves fail differently.
            The command row grows for real (min-h-11), since a search
            field that is taller is simply a better search field. The two
            strips do NOT grow: their chips keep their drawn size and take
            `.tap` instead, with the SCROLLER gaining the padding — a
            pseudo element reaching past an overflow-x box is clipped out
            of hit testing, so the room has to exist before the target can
            use it. That also keeps .cat-link's sliding underline under
            its label instead of 12px below it.

            Everything here is scoped: min-h-11 is dropped from `sm`, the
            strip padding from `lg`, so a mouse pointer at 1440 gets the
            band exactly as it was drawn. The block's own paddings step
            down one notch below `sm` to pay back some of the height.

            Measured at 390: 134px before, 168px after. The `scroll-mt`
            below tracks it and must stay ahead of it. */}
        <div className="sticky top-0 z-40 -mx-4 mt-5 border-b border-gold/40 bg-ivory/95 px-4 py-2 backdrop-blur sm:py-2.5">
          {/* command row — one row at BOTH widths */}
          <div className="flex items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{t("menu.searchLabel")}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("menu.search")}
                className="min-h-11 w-full rounded-sm border border-gold/50 bg-cream px-3 py-1.5 text-sm text-ink outline-none focus:border-lacquer sm:min-h-0"
              />
            </label>
            <button
              type="button"
              onClick={() => setSpicyOnly((v) => !v)}
              aria-pressed={spicyOnly}
              className={`token-colors min-h-11 shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold sm:min-h-0 ${
                spicyOnly
                  ? "border-lacquer bg-lacquer text-ivory"
                  : "border-gold/50 text-lacquer hover:border-gold hover:bg-gold/10"
              }`}
            >
              <span aria-hidden="true">🌶</span> {t("menu.spicyOnly")}
            </button>
          </div>

          {/* browse band */}
          <div className="mt-2 border-t border-gold/25 pt-2 sm:mt-2.5 sm:pt-2.5">
            {/* HOUSE FAVORITES — the same six the homepage carousel shows,
                from the one list in data/favorites.ts. Tapping opens the
                dish: on the homepage they are a display, here they are a way
                to order in two taps.

                The label is now INLINE with the chips rather than stacked
                over them — at 1440 the whole strip is one line. Below lg the
                <ul> keeps its horizontal swipe; from lg it wraps instead.

                Still hidden while a filter is active. A curated shortcut is
                help when you do not know what you want and noise the moment
                you have told us. */}
            {!filtering && favorites.length > 0 && (
              /* mb-0 below lg: both strips now carry py-2 of their own, so
                 the chips and the pills are already 16px apart and this
                 margin was a third gap on top of that. It comes back at lg,
                 where the scroller padding goes away. */
              <section
                aria-labelledby="fav-strip"
                className="mb-0 flex items-center gap-3 lg:mb-2"
              >
                <h2
                  id="fav-strip"
                  className="shrink-0 text-xs font-semibold uppercase tracking-[0.18em] text-ink/60"
                >
                  {t("menu.favourites")}
                </h2>
                {/* py-2 below `lg` is the chips' touch target, not
                    breathing room: the chips stay 30px and their `.tap`
                    pseudo reaches 44, which an overflow-x scroller would
                    CLIP out of hit testing if the box did not already
                    have the 7px a side to hold it. Padding on the
                    scroller rather than height on the chip is what keeps
                    the pill the size the band was drawn at. */}
                <ul
                  data-lenis-prevent
                  className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-2 lg:flex-wrap lg:overflow-x-visible lg:py-0"
                >
                  {favorites.map((item) => (
                    <li key={item.id} className="shrink-0">
                      <button
                        onClick={() => setActiveItem(item)}
                        className="tap token-colors flex items-center gap-2 whitespace-nowrap rounded-full border border-gold/50 bg-cream px-3 py-1 text-sm font-semibold text-ink hover:border-gold hover:bg-gold/10"
                      >
                        {item.nameEn}
                        {item.spicy && <SpicyMark />}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <nav aria-label={t("menu.categoriesAria")}>
              {/* gap-y as well as gap-x: from lg this wraps to two rows, and
                  with only a column gap the second row sat hard against the
                  first and read as overflow rather than as a grid. */}
              {/* py-2: the same clipping problem as the favourites strip
                  above, and the same answer. The pills stay 28px so
                  .cat-link's sliding underline still sits under the
                  label rather than 12px below it. */}
              <ul
                data-lenis-prevent
                className="flex gap-x-1 gap-y-1.5 overflow-x-auto py-2 text-sm lg:flex-wrap lg:overflow-x-visible lg:py-0"
              >
                {categories.map((cat) => (
                  <li key={cat.id}>
                    <a
                      href={`#cat-${cat.id}`}
                      /* px-2.5, not px-3. Measured at 1440: the fourteen
                         pills came to 1350px against a 1310px row — one row
                         missed by 40px, which is what produced the ragged
                         two-row wrap. 4px off each pill is 56px back, and
                         the whole bar sits on one line. (.cat-link's
                         underline inset in globals.css tracks this.) */
                      /* inline-FLEX, not the inline default, and it is
                         load-bearing for the target rather than cosmetic:
                         an inline <a> contributes only its 20px line box
                         to the <li>, so the strip measured 36px tall and
                         clipped the 44px .tap pseudo down to 36. As a
                         flex box it contributes its full 28px, the
                         scroller's py-2 makes 44, and the target fits
                         exactly. Nothing about the pill moves. */
                      className="cat-link tap token-colors inline-flex whitespace-nowrap rounded-full border border-transparent px-2.5 py-1 font-semibold text-lacquer hover:border-gold/60"
                    >
                      {navLabel(cat.id, cat.nameEn)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>

        {/* Where "Order Takeout" lands: the first dish you can actually add.
            scroll-mt-36 (144px), not 20 (80px), and it is the same number the
            sections below use: the sticky block stands 127px at 1440, so an
            80px scroll-margin dropped every jump target underneath the
            controls that made the jump.

            scroll-mt-48 (192px) below `sm`, because the 44px touch targets
            took the same block from 133px to 168px there and 144 stopped
            clearing it. Two values for one measurement that now differs by
            width; if either the band or these change, they change together. */}
        <div id="order" className="scroll-mt-48 sm:scroll-mt-36" />

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
          <section
            key={cat.id}
            id={`cat-${cat.id}`}
            /* Tracks the #order anchor above — same band, same two
               numbers. */
            className="scroll-mt-48 pt-10 sm:scroll-mt-36"
          >
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
                        /* ink/60, not ink/45. This is the affordance label on
                           every one of 137 rows — the thing that says a dish
                           is tappable — and at /45 it measured 2.91:1 on
                           cream, well under the 4.5:1 a 12px label needs.
                           /60 clears it and is the same value the row's own
                           description text already uses. */
                        <span className="mt-0.5 block text-xs uppercase tracking-[0.12em] text-ink/60">
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
