"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { SpicyMark } from "@/components/MenuSection";
import PhotoPlaceholder from "@/components/PhotoPlaceholder";
import SectionHeading from "@/components/SectionHeading";
import { photos } from "@/data/images";
import type { SitePhoto } from "@/data/images";
import { menu } from "@/data/menu";
import type { MenuItem } from "@/data/menu";
import { formatCents } from "@/lib/money";

const COUNT = 6;
/** Curtain-wipe duration — the transaction commits when it ends. */
const WIPE_MS = 620;
/** Plate/counter/smalls swap their content at this point of the wipe. */
const SWAP_MS = 220;

/** Homepage-only blurbs — the menu page stays description-free. Keyed by the
 *  Specials item ids in src/data/menu.ts. */
const blurbs: Record<string, string> = {
  "mandarin-special":
    "Duck, shrimp, chicken & roast pork with vegetables in the chef's sauce.",
  oceania:
    "Shrimp, scallops, squid & fish fillet with snow peas and vegetables.",
  "orange-flavored-chicken-special":
    "Crisp chicken in the chef's special tangerine sauce.",
  "salted-pepper-chicken-wings-special":
    "Crispy fried wings sautéed with salt, pepper & hot chili.",
  "kung-po-san-shein":
    "Shrimp, chicken & beef in classic kung pao style: peanuts, chilies, heat.",
  "mongolian-beef-special":
    "Sliced tenderloin with jade-green scallions in a natural sauce.",
  "honey-walnut-shrimp": "Crisp shrimp in a honey glaze with candied walnuts.",
  "upside-down-pan-fried-noodles":
    "A crisp noodle pillow under stir-fried meats and vegetables.",
};

const dishPhotoByItemId: Record<string, SitePhoto> = {
  "mandarin-special": photos.dishMandarinSpecial,
  "kung-po-san-shein": photos.dishKungPaoSanShein,
  "honey-walnut-shrimp": photos.dishHoneyWalnutShrimp,
  "upside-down-pan-fried-noodles": photos.dishPanFriedNoodles,
};

const items: MenuItem[] = (
  menu.find((c) => c.id === "specials")?.items ?? []
).slice(0, COUNT);

/* ---- static rail pieces, hoisted so re-renders bail out of their
   subtrees (SplitText owns the heading's DOM after mount) ---- */

/* Rendered through SectionHeading so "House Favorites" and "The Room" are
   the same object: same size, same gold rule, same gap. The .spt-head
   class is only the cap-trim/nowrap hook the rail alignment needs. */
const railHead = <SectionHeading en="House Favorites" className="spt-head" />;

const railIntro = (
  <p
    data-spt-rail-item
    className="spt-intro max-w-[24ch] font-display text-lg italic leading-snug text-ink/75"
  >
    The dishes our regulars come back for.
  </p>
);

const railLink = (
  <p data-spt-rail-item className="spt-link-row">
    <Link
      href="/menu#specials"
      className="arrow-link token-colors font-semibold text-lacquer underline decoration-gold underline-offset-4 hover:text-lacquer-dark"
    >
      See the full menu <span className="arrow">→</span>
    </Link>
  </p>
);

/**
 * Photo or placeholder, filling its positioned parent.
 *
 * The placeholder is the site's shared one. It used to be a solid
 * dish-tone panel (`photo.tone`) with a raw 富源 wordmark and a "PHOTO"
 * label — a second, darker placeholder style that made an empty dish slot
 * look nothing like an empty room slot. `tone` is now unused in
 * images.ts; the paper placeholder is the standard.
 */
function DishPanel({ item, small = false }: { item: MenuItem; small?: boolean }) {
  const photo = dishPhotoByItemId[item.id];
  if (photo?.src) {
    return (
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        sizes={small ? "(min-width: 900px) 25vw, 50vw" : "(min-width: 900px) 40vw, 100vw"}
        className="object-cover"
      />
    );
  }
  return <PhotoPlaceholder sealSize={small ? 52 : 96} />;
}

/**
 * "Spotlight" House Favorites — one structural CSS grid (rail /
 * featured card / up-next column), align-items:stretch. The featured
 * card's intrinsic height (landscape photo + in-card plate) sets the row;
 * the right column stretches to equal it and its two cards flex to
 * fill — the alignment holds at every width by construction.
 *
 * Dish changes are a guarded transaction: overlay layer curtain-wipes
 * over the base photo (direction-aware), plate/counter/smalls swap
 * their content mid-wipe, and the base commits when the wipe ends.
 */
export default function FavoritesSpotlight() {
  /** Committed photo in the base layer. */
  const [baseIdx, setBaseIdx] = useState(0);
  /** What the plate, counter, and small cards currently show. */
  const [faceIdx, setFaceIdx] = useState(0);
  /** Incoming photo riding the wipe overlay, or null when idle. */
  const [overlay, setOverlay] = useState<{ idx: number; dir: 1 | -1 } | null>(
    null,
  );
  /** True during the swap window — dims smalls, drops the plate. */
  const [swapping, setSwapping] = useState(false);
  const busy = useRef(false);
  const timers = useRef<number[]>([]);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  const advance = (target: number, dir: 1 | -1) => {
    const t = ((target % COUNT) + COUNT) % COUNT;
    if (busy.current || t === faceIdx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // instant, fully functional
      setBaseIdx(t);
      setFaceIdx(t);
      return;
    }
    busy.current = true;
    setOverlay({ idx: t, dir });
    setSwapping(true);
    timers.current.push(
      window.setTimeout(() => {
        setFaceIdx(t);
        setSwapping(false);
      }, SWAP_MS),
    );
    timers.current.push(
      window.setTimeout(() => {
        setBaseIdx(t);
        setOverlay(null);
        busy.current = false;
      }, WIPE_MS),
    );
  };
  const step = (dir: 1 | -1) => advance(faceIdx + dir, dir);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    }
  };

  const face = items[faceIdx];

  return (
    <div data-spt className="spt-grid" onKeyDown={onKeyDown}>
      {/* ---- left rail (display:contents under 900px so the controls
              can reorder after the small cards) ---- */}
      <div className="spt-rail">
        {railHead}
        {railIntro}
        {railLink}
        <div data-spt-rail-item className="spt-controls flex items-center gap-3">
          <button
            type="button"
            aria-label="Previous dish"
            className="spt-btn spt-btn-prev"
            onClick={() => step(-1)}
          >
            <span className="spt-glyph" aria-hidden="true">
              ←
            </span>
          </button>
          <button
            type="button"
            aria-label="Next dish"
            className="spt-btn spt-btn-next"
            onClick={() => step(1)}
          >
            <span className="spt-glyph" aria-hidden="true">
              →
            </span>
          </button>
          <span
            className="ml-2 inline-flex items-baseline gap-1.5 font-display text-ink"
            aria-live="polite"
          >
            <span
              key={faceIdx}
              className="spt-count-in text-2xl leading-none"
            >
              {String(faceIdx + 1).padStart(2, "0")}
            </span>
            <span className="text-sm leading-none text-ink/60">
              / {String(COUNT).padStart(2, "0")}
            </span>
          </span>
        </div>
      </div>

      {/* ---- featured card: ONE framed object — photo + plate ---- */}
      <div
        data-spt-card
        className="frame spt-card"
        onTouchStart={(e) => {
          touchStart.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
          };
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          touchStart.current = null;
          if (!start) return;
          const dx = e.changedTouches[0].clientX - start.x;
          const dy = e.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            step(dx < 0 ? 1 : -1);
          }
        }}
      >
        <div className="spt-photo">
          {/* Both dish layers ride one wrapper so the scroll-scrubbed
              swell (HomeChoreography SCENE 5) scales the image inside
              the frame rather than the frame itself. */}
          <div data-spt-photo className="absolute inset-0">
            <div className="absolute inset-0">
              <DishPanel item={items[baseIdx]} />
            </div>
            {overlay && (
              <div
                className={`absolute inset-0 ${
                  overlay.dir === 1 ? "spt-wipe-ltr" : "spt-wipe-rtl"
                }`}
              >
                <DishPanel item={items[overlay.idx]} />
              </div>
            )}
          </div>
          {/* Steam off the plate — rests invisible, clipped by the
              frame's overflow so it never escapes the card. */}
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
        </div>
        <div className="frame-rule spt-plate">
          <div
            className={`spt-plate-body ${swapping ? "is-out" : ""}`}
            aria-live="polite"
          >
            <div className="flex items-baseline gap-2">
              <h3 className="font-display text-2xl text-ink">{face.name}</h3>
              {face.spicy && <SpicyMark />}
            </div>
            {face.chineseName && (
              <p
                lang="zh-Hant"
                className="mt-0.5 font-chinese text-sm tracking-[0.18em] text-ink/55"
              >
                {face.chineseName}
              </p>
            )}
            <p className="mt-2 max-w-md text-sm italic leading-relaxed text-ink/70">
              {blurbs[face.id]}
            </p>
            <p className="mt-2 font-medium text-lacquer">
              {formatCents(face.priceCents)}
            </p>
          </div>
        </div>
      </div>

      {/* ---- up next: the two dishes after the featured one ---- */}
      <div className="spt-next-col">
        {([1, 2] as const).map((n) => {
          const dish = items[(faceIdx + n) % COUNT];
          return (
            <button
              key={n}
              type="button"
              data-spt-small
              className={`spt-small ${swapping ? "is-dim" : ""}`}
              aria-label={`${dish.name}, bring to spotlight`}
              onClick={() => advance(faceIdx + n, 1)}
            >
              {/* one framed object, same anatomy as the featured card:
                  photo + plate strip inside the frame, split by the
                  gold rule */}
              <div className="frame spt-small-frame">
                <div className="relative flex-1 overflow-hidden">
                  <div className="spt-sm-inner absolute inset-0">
                    <DishPanel item={dish} small />
                  </div>
                </div>
                <div className="frame-rule spt-sm-plate">
                  <span className="spt-sm-name truncate font-display">
                    {dish.name}
                  </span>
                  <span className="spt-sm-price shrink-0">
                    {formatCents(dish.priceCents)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
