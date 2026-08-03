"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { SpicyMark } from "@/components/SpicyMark";
import { useT } from "@/lib/i18n/LocaleContext";
import type { Translate } from "@/lib/i18n/dictionary";
import SectionHeading from "@/components/SectionHeading";
import { photos } from "@/data/images";
import type { SitePhoto } from "@/data/images";
import { favoriteCatalogItems } from "@/data/favorites";
import type { FavoriteEntry } from "@/data/favorites";
import { formatCents } from "@/lib/money";

/** Homepage-only blurbs — the menu page stays description-free. Keyed by
 *  item id in src/data/menu.ts.
 *
 *  DELIBERATELY WIDER THAN THE CURATION. Five of these describe dishes that
 *  are not featured today, and they are kept for the same reason the photo
 *  slots for them are: this copy was written for them, and promoting one
 *  back into data/favorites.ts should be one line rather than one line plus
 *  rewriting a sentence. An unused key costs nothing; a missing one costs a
 *  card with no description. */
const blurbs: Record<string, string> = {
  "salted-pepper-chicken-wings-special":
    "Crispy fried wings sautéed with salt, pepper & hot chili.",
  "honey-walnut-shrimp": "Crisp shrimp in a honey glaze with candied walnuts.",
  "house-soft-noodle":
    "Soft noodles tossed with pork, shrimp and cabbage in the house style.",
  "mandarin-special":
    "Duck, shrimp, chicken & roast pork with vegetables in the chef's sauce.",
  oceania:
    "Shrimp, scallops, squid & fish fillet with snow peas and vegetables.",
  "orange-flavored-chicken-special":
    "Crisp chicken in the chef's special tangerine sauce.",
  "kung-po-san-shein":
    "Shrimp, chicken & beef in classic kung pao style: peanuts, chilies, heat.",
  "mongolian-beef-special":
    "Sliced tenderloin with jade-green scallions in a natural sauce.",
  "upside-down-pan-fried-noodles":
    "A crisp noodle pillow under stir-fried meats and vegetables.",
};

/**
 * Dish id → photo slot. This is the site's ONLY dish-photo surface: the
 * item sheet and the menu cards render no image, so a dish photograph that
 * is not reachable from here is not on the site.
 *
 * EVERY CURATED FAVOURITE NOW HAS AN ENTRY WITH A REAL FILE — that is the
 * curation rule (see data/favorites.ts). The rest are kept as correct
 * mappings against slots that are still empty, so a photograph arriving is
 * an edit to images.ts and favorites.ts and not to this file.
 */
const dishPhotoByItemId: Record<string, SitePhoto> = {
  // ---- the curated three: photographed, rendering ----
  "salted-pepper-chicken-wings-special": photos.dishSaltedPepperWings,
  "honey-walnut-shrimp": photos.dishHoneyWalnutShrimp,
  "house-soft-noodle": photos.dishHouseSoftNoodle,
  // ---- mapped, waiting on a photograph ----
  "mandarin-special": photos.dishMandarinSpecial,
  "kung-po-san-shein": photos.dishKungPaoSanShein,
  "upside-down-pan-fried-noodles": photos.dishPanFriedNoodles,
};

/** Resolved once at module scope: the catalogue is a static import. */
const entries: FavoriteEntry[] = favoriteCatalogItems();

/* ---- static rail pieces, hoisted so re-renders bail out of their
   subtrees (SplitText owns the heading's DOM after mount) ---- */

/* Rendered through SectionHeading so "House Favorites" and "The Room" are
   the same object: same size, same gold rule, same gap. The .spt-head
   class is only the cap-trim/nowrap hook the rail alignment needs.
   Stays hoisted AND stays English: SplitText replaces this element's text
   node with per-character spans after mount, so it must never be rebuilt,
   and a section heading is marketing prose rather than functional UI (see
   the long-form Spanish note in docs/SITE_REVIEW_2.md). */
const railHead = <SectionHeading en="House Favorites" className="spt-head" />;

/* The other two rail pieces DO translate, so they cannot be module-scope
   constants any more. They are memoised on `t` instead, which is memoised on
   the locale in LocaleProvider — so their element identity is just as stable
   across re-renders as a hoisted constant was, and the subtrees still bail. */
function useRailPieces(t: Translate) {
  const railIntro = useMemo(
    () => (
      <p
        data-spt-rail-item
        className="spt-intro max-w-[34ch] font-display text-lg italic leading-snug text-ink/75"
      >
        {t("fav.intro")}
      </p>
    ),
    [t],
  );

  const railLink = useMemo(
    () => (
      <p data-spt-rail-item className="spt-link-row">
        <Link
          href="/menu#specials"
          className="arrow-link token-colors font-semibold text-lacquer underline decoration-gold underline-offset-4 hover:text-lacquer-dark"
        >
          {t("fav.seeFullMenu")} <span className="arrow">→</span>
        </Link>
      </p>
    ),
    [t],
  );

  return { railIntro, railLink };
}

/**
 * ONE DISH, ONE CARD. Same anatomy the featured card always had — the
 * frame, the photo, then the plate under the gold rule carrying name,
 * spicy mark, 中文, blurb and price. There is no longer a second, smaller
 * card variant: with three peers there is no hierarchy to express, and the
 * abbreviated name+price strip the "up next" column used was only ever a
 * consequence of being small.
 *
 * The whole card is a link to its dish's section on the menu. It used to be
 * a button that dragged the dish into the spotlight, which was navigation
 * inside a carousel that no longer exists. `/menu#cat-<id>` is as close as
 * the site can get to "this dish": the menu page anchors every category and
 * nothing anchors an individual item, so linking further would mean
 * inventing a URL for the item sheet.
 */
function DishCard({
  entry,
  lead,
  t,
}: {
  entry: FavoriteEntry;
  /** The signature dish. Carries the scrubbed swell and the steam. */
  lead: boolean;
  t: Translate;
}) {
  const { item, categoryId } = entry;
  const photo = dishPhotoByItemId[item.id];

  return (
    <Link
      href={`/menu#cat-${categoryId}`}
      data-spt-small
      {...(lead ? { "data-spt-card": "" } : {})}
      className="spt-card frame"
      aria-label={t("fav.seeOnMenu", { name: item.name })}
    >
      <div className="spt-photo">
        {/* The photo sits in its own wrapper so the lead card's scrubbed
            swell (HomeChoreography SCENE 5) scales the image inside the
            frame rather than the frame itself. */}
        <div {...(lead ? { "data-spt-photo": "" } : {})} className="absolute inset-0">
          {photo?.src ? (
            <Image
              src={photo.src}
              alt={photo.alt}
              fill
              sizes="(min-width: 1024px) 32vw, (min-width: 640px) 48vw, 100vw"
              className="spt-img object-cover"
            />
          ) : (
            /* Unreachable while the curation rule holds — every featured
               dish has a photograph. Kept so a mis-edit to favorites.ts
               degrades to an empty frame rather than a crash. */
            <div className="h-full w-full bg-paper" />
          )}
        </div>
        {lead && (
          <>
            {/* Steam off the signature plate — rests invisible, clipped by
                the frame's overflow so it never escapes the card. */}
            <span
              aria-hidden="true"
              data-steam-wisp
              className="steam-wisp"
              style={{ left: "38%" }}
            />
            <span
              aria-hidden="true"
              data-steam-wisp
              className="steam-wisp"
              style={{ left: "56%" }}
            />
          </>
        )}
      </div>
      <div className="frame-rule spt-plate">
        <div className="flex items-baseline gap-2">
          <h3 className="spt-name font-display text-ink">{item.name}</h3>
          {item.spicy && <SpicyMark />}
        </div>
        {item.chineseName && (
          <p
            lang="zh-Hant"
            className="mt-0.5 font-chinese text-sm tracking-[0.18em] text-ink/55"
          >
            {item.chineseName}
          </p>
        )}
        <p className="mt-2 text-sm italic leading-relaxed text-ink/70">
          {blurbs[item.id]}
        </p>
        <p className="mt-2 font-medium text-lacquer">
          {formatCents(item.priceCents)}
        </p>
      </div>
    </Link>
  );
}

/**
 * House Favorites — a STATIC composition. Every featured dish is visible
 * at once: heading block, then one card per dish.
 *
 * IT WAS A CAROUSEL AND THE CAROUSEL WAS THE PROBLEM. One featured card
 * plus an "up next" column, arrows, an 01/06 counter, a curtain wipe, a
 * swipe handler, and a guarded transaction to keep the three layers in
 * step. All of that machinery existed to hide five dishes, four of which
 * had no photograph — so the page opened on three grey placeholders and
 * the only real dish photo on the site was two clicks away. Nothing here
 * navigates any more, so there is nothing to keep in step: no state, no
 * timers, no refs, no keyboard handler, no touch handler.
 *
 * AN EVEN GRID, NOT THE FEATURE-PLUS-SMALLS COMPOSITION. Both were
 * available and the count decided it. Three dishes are peers — same plate,
 * same overhead framing, same photographer — so a big-one-plus-two-little
 * layout would assert a hierarchy the pictures do not support, and the two
 * smalls would read as leftovers now that "up next" means nothing. Three
 * equal cards at 1024+ also give each photo ~315px, against ~220px if the
 * rail had stayed beside them.
 *
 * The heading therefore moves above the cards, which makes this section
 * structurally identical to The Room directly below it: heading, one line
 * of intro, an even row of framed objects. The code already claimed that
 * was the intent — "so 'House Favorites' and 'The Room' are the same
 * object" — and now the layout agrees with the comment.
 *
 * Reveal is the section's existing vocabulary, unchanged: the rail items
 * stagger and the cards rise in sequence (SCENE 5), once only, instant
 * under prefers-reduced-motion. The signature dish keeps the scrubbed
 * swell and the steam it always had.
 */
export default function FavoritesSpotlight() {
  const t = useT();
  const { railIntro, railLink } = useRailPieces(t);

  return (
    <div data-spt className="spt-grid">
      <div className="spt-rail">
        {railHead}
        {railIntro}
        {railLink}
      </div>

      <div className="spt-cards">
        {entries.map((entry, i) => (
          <DishCard key={entry.item.id} entry={entry} lead={i === 0} t={t} />
        ))}
      </div>
    </div>
  );
}
