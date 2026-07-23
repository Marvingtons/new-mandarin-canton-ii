"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { SpicyMark } from "@/components/MenuSection";
import { photos } from "@/data/images";
import type { SitePhoto } from "@/data/images";
import { menu } from "@/data/menu";
import type { MenuItem } from "@/data/menu";

const COUNT = 6;
/** Curtain-wipe duration — the transaction commits when it ends. */
const WIPE_MS = 620;
/** Plate/counter/smalls swap their content at this point of the wipe. */
const SWAP_MS = 220;

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

/* ---- static rail pieces, hoisted so re-renders bail out of their
   subtrees (SplitText owns the heading's DOM after mount) ---- */

const railHead = (
  <div className="spt-head">
    <h2
      data-bh-text
      className="relative font-display text-3xl text-lacquer sm:text-4xl"
    >
      House Favorites
    </h2>
    <span aria-hidden="true" className="bh-rule spt-rule" />
  </div>
);

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
      href="/menu#mandarin-specialties"
      className="arrow-link token-colors font-semibold text-lacquer underline decoration-gold underline-offset-4 hover:text-lacquer-dark"
    >
      See the full menu <span className="arrow">→</span>
    </Link>
  </p>
);

/** Photo or tone-panel placeholder, filling its positioned parent. */
function DishPanel({ item, small = false }: { item: MenuItem; small?: boolean }) {
  const photo = dishPhotoByItemId[item.id];
  if (photo.src) {
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
        className={`absolute inset-0 flex select-none items-center justify-center font-chinese font-bold text-ivory/10 ${
          small ? "text-3xl tracking-[0.2em]" : "text-6xl tracking-[0.3em]"
        }`}
      >
        富源
      </div>
      {!small && (
        <span className="absolute bottom-2 left-3 text-[0.6rem] uppercase tracking-[0.22em] text-ivory/60">
          Photo
        </span>
      )}
    </>
  );
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
              className="spt-count-in text-[26px] leading-none"
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
        className="spt-card"
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
        <div className="spt-plate">
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
              ${face.price.toFixed(2)}
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
              aria-label={`${dish.name} — bring to spotlight`}
              onClick={() => advance(faceIdx + n, 1)}
            >
              {/* one framed object, same anatomy as the featured card:
                  photo + plate strip inside the frame, split by the
                  gold rule */}
              <div className="spt-small-frame">
                <div className="relative flex-1 overflow-hidden">
                  <div className="spt-sm-inner absolute inset-0">
                    <DishPanel item={dish} small />
                  </div>
                </div>
                <div className="spt-sm-plate">
                  <span className="spt-sm-name truncate font-display">
                    {dish.name}
                  </span>
                  <span className="spt-sm-price shrink-0">
                    ${dish.price.toFixed(2)}
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
