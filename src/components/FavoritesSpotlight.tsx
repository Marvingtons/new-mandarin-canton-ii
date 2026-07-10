"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { SpicyMark } from "@/components/MenuSection";
import { photos } from "@/data/images";
import type { SitePhoto } from "@/data/images";
import { menu } from "@/data/menu";
import type { MenuItem } from "@/data/menu";

const COUNT = 6;

/** Homepage-only blurbs — the menu page stays description-free. */
const blurbs: Record<string, string> = {
  "honey-walnut-shrimp": "Crisp shrimp in a honey glaze with candied walnuts.",
  "honey-walnut-chicken": "The house glaze and candied walnuts, with chicken.",
  "kung-pao-san-shein":
    "Shrimp, chicken & beef in classic kung pao style — peanuts, chilies, heat.",
  "upside-down-pan-fried-noodles":
    "A crisp noodle pillow under stir-fried meats and vegetables.",
  "crispy-game-hen": "Whole game hen, fried crisp, salt-pepper seasoning.",
  // TODO: replace with real description from owners
  "mandarin-house-special":
    "Ask about the house special — every regular has a theory.",
};

const dishPhotoByItemId: Record<string, SitePhoto> = {
  "mandarin-house-special": photos.dishMandarinSpecial,
  "honey-walnut-shrimp": photos.dishHoneyWalnutShrimp,
  "honey-walnut-chicken": photos.dishHoneyWalnutChicken,
  "kung-pao-san-shein": photos.dishKungPaoSanShein,
  "crispy-game-hen": photos.dishCrispyGameHen,
  "upside-down-pan-fried-noodles": photos.dishPanFriedNoodles,
};

const items: MenuItem[] = (
  menu.find((c) => c.id === "mandarin-specialties")?.items ?? []
).slice(0, COUNT);

/** Static rail elements — hoisted so re-renders bail out of their
    subtrees (SplitText owns the heading's DOM after mount).
    The heading is built locally (not BilingualHeading) because the
    ghost here bleeds off the rail's LEFT edge and is cropped at the
    section boundary, instead of reserving room above the English. */
const railHeading = (
  <div className="relative">
    <span
      aria-hidden="true"
      lang="zh-Hant"
      className="sp-ghost font-chinese text-5xl font-bold leading-none text-gold/35 sm:text-6xl"
    >
      招牌菜
    </span>
    <h2
      data-bh-text
      className="relative font-display text-3xl leading-tight text-lacquer sm:text-4xl"
    >
      House Favorites
    </h2>
    <span aria-hidden="true" className="bh-rule mt-3 block h-px w-12 bg-gold" />
  </div>
);
const railLink = (
  <p>
    <Link
      href="/menu#mandarin-specialties"
      className="arrow-link token-colors font-semibold text-lacquer underline decoration-gold underline-offset-4 hover:text-lacquer-dark"
    >
      See the full menu <span className="arrow">→</span>
    </Link>
  </p>
);

/** Photo or tone-panel placeholder, filling its positioned parent. */
function DishPanel({ item }: { item: MenuItem }) {
  const photo = dishPhotoByItemId[item.id];
  if (photo.src) {
    return (
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        sizes="(min-width: 1024px) 44vw, 100vw"
        className="object-cover"
      />
    );
  }
  return (
    <>
      <div
        className="absolute inset-0"
        style={{ backgroundColor: photo.tone ?? "var(--paper)" }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-15 grayscale mix-blend-multiply"
        style={{
          backgroundImage: "url('/bg-red.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div
        aria-hidden="true"
        lang="zh-Hant"
        className="absolute inset-0 flex select-none items-center justify-center font-chinese text-5xl font-bold tracking-[0.3em] text-ivory/10"
      >
        富源
      </div>
      <span className="absolute bottom-2 left-3 text-[0.6rem] uppercase tracking-[0.22em] text-ivory/60">
        Photo
      </span>
    </>
  );
}

/**
 * "Spotlight" House Favorites: asymmetric editorial grid — text rail
 * left, one large featured dish center, the next two dishes stacked
 * right. Arrows/keys/clicks rotate the featured dish; the featured
 * photo changes via a direction-aware curtain wipe while the plate
 * text rises in. Ships working on the tone-panel placeholders.
 */
export default function FavoritesSpotlight() {
  // One state object + functional updates so rapid clicks (multiple
  // events per frame) chain correctly instead of reading a stale idx.
  const [spot, setSpot] = useState<{
    idx: number;
    prevIdx: number;
    dir: 1 | -1;
  }>({ idx: 0, prevIdx: 0, dir: 1 });
  const { idx, prevIdx, dir } = spot;

  const step = (direction: 1 | -1) =>
    setSpot((s) => ({
      idx: (s.idx + direction + COUNT) % COUNT,
      prevIdx: s.idx,
      dir: direction,
    }));
  const promote = (target: number) =>
    setSpot((s) =>
      target === s.idx
        ? s
        : { idx: ((target % COUNT) + COUNT) % COUNT, prevIdx: s.idx, dir: 1 },
    );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    }
  };

  const featured = items[idx];
  const upNext = [items[(idx + 1) % COUNT], items[(idx + 2) % COUNT]];

  return (
    <div data-fav-spotlight className="sp-grid" onKeyDown={onKeyDown}>
      {/* ---- left rail ---- */}
      <div className="sp-rail flex flex-col gap-8">
        {/* -mt-[11px] lifts the English CAP (not the text box) onto the
            frames' top line at lg — measured: cap sits 11px below the
            box top at text-4xl/leading-tight */}
        <div className="lg:-mt-[11px]">{railHeading}</div>
        <p className="max-w-xs font-display text-lg italic leading-snug text-ink/75">
          The dishes our regulars come back for.
        </p>
        {railLink}
        {/* controls live high on the rail, right below the menu link */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Previous dish"
            className="sp-btn sp-btn-prev"
            onClick={() => step(-1)}
          >
            <span className="sp-glyph" aria-hidden="true">
              ←
            </span>
          </button>
          <button
            type="button"
            aria-label="Next dish"
            className="sp-btn sp-btn-next"
            onClick={() => step(1)}
          >
            <span className="sp-glyph" aria-hidden="true">
              →
            </span>
          </button>
          <span
            className="ml-2 inline-flex items-baseline gap-1.5 font-display text-ink"
            aria-live="polite"
          >
            <span key={idx} className="sp-count-in inline-block text-2xl">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <span className="text-sm text-ink/60">
              / {String(COUNT).padStart(2, "0")}
            </span>
          </span>
        </div>
      </div>

      {/* ---- featured photo (center) ---- */}
      <div className="sp-featured-photo mt-8 lg:mt-0">
        <div className="border-2 border-gold p-[2px]">
          <div className="relative aspect-[4/5] overflow-hidden border border-gold/45">
            {/* previous dish sits beneath; the new one wipes over it */}
            <div className="absolute inset-0">
              <DishPanel item={items[prevIdx]} />
            </div>
            <div
              key={idx}
              className={`absolute inset-0 ${dir === 1 ? "sp-wipe-ltr" : "sp-wipe-rtl"}`}
            >
              <DishPanel item={featured} />
            </div>
          </div>
        </div>
      </div>

      {/* ---- featured plate: paper panel under the frame, matching
              the site's card plate language (panel is static; only the
              text inside rises on dish change) ---- */}
      <div className="sp-featured-plate mt-4 lg:-mt-3">
        <div className="border-t-2 border-gold bg-cream px-5 py-4">
          <div key={idx} className="sp-rise" aria-live="polite">
            <div className="flex items-baseline gap-2">
              <h3 className="font-display text-2xl text-ink">
                {featured.name}
              </h3>
              {featured.spicy && <SpicyMark />}
            </div>
            {featured.chineseName && (
              <p
                lang="zh-Hant"
                className="mt-0.5 font-chinese text-sm text-ink/55"
              >
                {featured.chineseName}
              </p>
            )}
            <p className="mt-2 max-w-md text-sm leading-relaxed text-ink/70">
              {blurbs[featured.id]}
            </p>
            <p className="mt-2 font-semibold text-lacquer">
              ${featured.price.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* ---- up next (right, two stacked) ---- */}
      {upNext.map((dish, n) => (
        <button
          key={n}
          type="button"
          className={`sp-next ${n === 0 ? "sp-next-1" : "sp-next-2"} mt-8 flex h-full w-full flex-col text-left lg:mt-0`}
          aria-label={`${dish.name} — bring to spotlight`}
          onClick={() => promote(items.indexOf(dish))}
        >
          <div className="flex min-h-0 flex-1 border border-gold/60 p-[2px]">
            <div className="relative aspect-[4/5] flex-1 overflow-hidden border border-gold/45 lg:aspect-auto">
              <div
                key={dish.id}
                className={`sp-small-in absolute inset-0 ${n === 1 ? "sp-small-in-2" : ""}`}
              >
                <div className="sp-inner absolute inset-0">
                  <DishPanel item={dish} />
                </div>
              </div>
            </div>
          </div>
          {/* caption bar UNDER the frame. At lg the 5px translate drops
              the TEXT BASELINE onto the featured photo's bottom edge
              (measured descender) without changing the grid row math. */}
          <div className="flex items-baseline justify-between gap-3 px-1 pb-1 pt-3 lg:translate-y-[5px] lg:pb-0">
            <span className="sp-name truncate font-display text-sm text-ink">
              {dish.name}
            </span>
            <span className="shrink-0 text-sm font-semibold text-lacquer">
              ${dish.price.toFixed(2)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
