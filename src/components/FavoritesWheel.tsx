"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { SpicyMark } from "@/components/MenuSection";
import { photos } from "@/data/images";
import type { SitePhoto } from "@/data/images";
import { menu } from "@/data/menu";
import type { MenuItem } from "@/data/menu";

const COUNT = 6;
const SWIPE_THRESHOLD = 40;
/** Falloff by |delta| — tuned to the reference art: near-full
    neighbors, washed-but-whole peeks, gentle scale steps. */
const OPACITY_BY_DELTA = [1, 0.9, 0.6];
/** Hover/focus opacity ("pick me" rise on the side cards). */
const HOVER_OPACITY_BY_DELTA = [1, 1, 0.85];
const SCALE_BY_DELTA = [1, 0.9, 0.82, 0.74];
/** How long the positioning transition runs (matches .fw-card CSS). */
const SETTLE_MS = 500;

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

/** Wrap-around shortest-path delta, normalized to [-2..3]. */
const deltaFor = (i: number, active: number): number => {
  let d = (i - active + COUNT) % COUNT;
  if (d > COUNT / 2) d -= COUNT;
  return d;
};

/**
 * Looping photo wheel for the House Favorites. Center-focused, six
 * cards, translateX + scale only (no rotateY — photos stay flat).
 * Explicit controls only: arrows, dots, side-card taps, swipe, and
 * arrow keys while focus is inside the section. Wheel/trackpad events
 * are never touched — page scroll over the stage is native.
 * Placeholder-aware: seal panels until images.ts gets real srcs.
 */
export default function FavoritesWheel() {
  const [active, setActive] = useState(0);
  /** True while cards are in flight — hover effects are suppressed so
      inner transforms never stack on the travel. */
  const [settling, setSettling] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const markSettling = () => {
    setSettling(true);
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setSettling(false), SETTLE_MS);
  };
  const activate = (i: number) => {
    setActive(i);
    markSettling();
  };
  const go = (dir: number) => {
    setActive((a) => (a + dir + COUNT) % COUNT);
    markSettling();
  };

  useEffect(() => () => clearTimeout(settleTimer.current), []);

  // Curtain reveal for any real photos: one stage-level observer adds
  // the pf-revealed ancestor class once, 25% in view (same language as
  // PhotoFrame). Pure transform moves after that.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !stage.querySelector(".pf-media")) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          stage.classList.add("pf-revealed");
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(stage);
    return () => io.disconnect();
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    }
  };

  const activeItem = items[active];
  const activeBlurb = blurbs[activeItem.id];

  return (
    <div
      data-fav-wheel
      data-settling={settling ? "true" : "false"}
      onKeyDown={onKeyDown}
    >
      {/* Stage */}
      <div
        ref={stageRef}
        className="fw-stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <div data-fw-drift className="absolute inset-0">
          {items.map((item, i) => {
            const d = deltaFor(i, active);
            const hidden = Math.abs(d) > 2;
            const photo = dishPhotoByItemId[item.id];
            const centered = d === 0;
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={hidden ? -1 : 0}
                aria-hidden={hidden}
                aria-label={`${item.name}${centered ? "" : " — bring to center"}`}
                className={`fw-card ${centered ? "fw-center" : "fw-side"}`}
                data-hidden={hidden}
                style={
                  {
                    "--d": d,
                    "--s": SCALE_BY_DELTA[Math.abs(d)],
                    // |d|=3 fades fully out before reaching the edge
                    "--o": hidden ? 0 : OPACITY_BY_DELTA[Math.abs(d)],
                    "--oh": hidden ? 0 : HOVER_OPACITY_BY_DELTA[Math.abs(d)],
                    // side cards lean 2px toward the wheel's center
                    "--lean": d > 0 ? "-2px" : d < 0 ? "2px" : "0px",
                    zIndex: 10 - Math.abs(d),
                  } as React.CSSProperties
                }
                onClick={() => !centered && activate(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!centered) activate(i);
                  }
                }}
              >
                {/* double gold frame, PhotoFrame language; the active
                    card gets the stronger gold */}
                <div
                  className={`fw-frame p-[2px] ${centered ? "border-2 border-gold" : "border border-gold/60"}`}
                >
                  <div className="fw-photo relative overflow-hidden border border-gold/45">
                    {/* hover effects live on this inner wrapper so they
                        compose with (never fight) the card's own
                        positioning transform */}
                    <div className="fw-inner absolute inset-0">
                    {photo.src ? (
                      <div className="pf-media absolute inset-0">
                        <Image
                          src={photo.src}
                          alt={photo.alt}
                          fill
                          sizes="260px"
                          className="object-cover"
                        />
                      </div>
                    ) : (
                      <>
                        {/* per-dish tone panel (placeholder-only) */}
                        <div
                          className="absolute inset-0"
                          style={{
                            backgroundColor: photo.tone ?? "var(--paper)",
                          }}
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
                    )}
                    </div>
                  </div>
                </div>
                {/* paper plate strip — name + price on every card,
                    matching the reference art (edge clipping runs
                    through plates; the stage-edge fade softens it) */}
                <div className="min-h-[74px] bg-cream px-3 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`truncate font-display text-ink ${centered ? "text-lg" : "text-base"}`}
                    >
                      {item.name}
                    </span>
                    {item.spicy && <SpicyMark />}
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold text-lacquer">
                      ${item.price.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail + controls row */}
      <div className="mt-6 flex flex-col-reverse items-center gap-4 md:flex-row md:items-start md:justify-between">
        <div aria-live="polite" className="max-w-xl md:min-h-14">
          <div key={active} className="fw-detail-in">
            <p className="text-center font-display text-lg italic leading-snug text-ink/80 md:text-left">
              {activeBlurb}
            </p>
            <p className="mt-1 text-center text-xs uppercase tracking-[0.18em] text-ink/60 md:text-left">
              {activeItem.name} · ${activeItem.price.toFixed(2)}
              {activeItem.spicy && (
                <span className="text-lacquer"> · spicy 辣</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label="Previous dish"
            className="fw-btn fw-btn-prev"
            onClick={() => go(-1)}
          >
            <span className="fw-glyph" aria-hidden="true">
              ←
            </span>
          </button>
          <div className="flex" role="group" aria-label="Choose dish">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-label={item.name}
                aria-current={i === active}
                className="fw-dot-btn"
                onClick={() => activate(i)}
              >
                <span
                  className={`fw-dot ${i === active ? "bg-gold" : "border border-gold/60"}`}
                />
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Next dish"
            className="fw-btn fw-btn-next"
            onClick={() => go(1)}
          >
            <span className="fw-glyph" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
