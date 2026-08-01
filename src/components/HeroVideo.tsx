"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import IncenseSmoke from "@/components/IncenseSmoke";
import OpenNowChip from "@/components/OpenNowChip";
import OrderTakeout from "@/components/OrderTakeout";
import PhoneLinks from "@/components/PhoneLinks";
import { useT } from "@/lib/i18n/LocaleContext";
import { onIntroLifted } from "@/lib/introSignal";
import { restaurant } from "@/data/restaurant";

/**
 * Hero footage, served from R2 rather than /public: 10.04s muted loop,
 * 1920x1080 h264 24fps, 5,525,614 bytes. Keeping 5.5 MB of video out of
 * the Worker bundle is the point — it was in `public/` until this moved.
 *
 * The loop is one dish being made: floured wings lifted from the bowl,
 * a wok flare, then ~2s holding the plated salt-and-pepper wings on the
 * blue-and-white plate. Set to null to fall back to the poster-only hero
 * without requesting the file.
 *
 * POSTER IS NOT FRAME 0. /public/hero-poster-plate.jpg is t=9.8 — the
 * held plate. The previous file used frame 0 so the poster-to-video
 * handoff was invisible; that is deliberately given up here, because the
 * poster is what a prefers-reduced-motion visitor keeps FOREVER, and
 * frame 0 of this loop is raw chicken in flour. A still hero should be
 * the finished dish. The handoff is nearly always hidden anyway: the
 * preloader covers it, and this copy is preload="auto" so it is buffered
 * before the overlay lifts. The two files are both 1920x1080, so the
 * swap costs no layout shift either way.
 */
const HERO_VIDEO_SRC: string | null =
  "https://pub-364f647b29874b09922e1889f267c323.r2.dev/newmandarin-hero.mp4";

/** The held-plate still: poster, reduced-motion hero, and load fallback. */
const HERO_POSTER = "/hero-poster-plate.jpg";

/**
 * After the preloader lifts, the footage plays full-bleed with no text
 * for this beat before the copy fades in.
 */
const TEXT_DELAY_MS = 1200;

/** Loop-seam crossfade duration (seconds). */
const CROSSFADE_S = 0.6;

/**
 * Full-bleed video hero (100svh). While there is no video — if it fails to
 * load, or under prefers-reduced-motion, where one is never mounted — the
 * hero shows the poster still with a slow Ken Burns drift. Text staggers
 * in only after the intro overlay lifts (or immediately without one).
 */
export default function HeroVideo() {
  const t = useT();
  /** True the moment the intro overlay lifts (or at once without one). */
  const [unveiled, setUnveiled] = useState(false);
  const [ready, setReady] = useState(false);
  const [video, setVideo] = useState<"pending" | "on" | "failed">("pending");
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);

  // Choreography step 1: detect the unveil. Safety timeout so a
  // stalled overlay can never strand the hero.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let unsubscribe: (() => void) | undefined;
    if (document.querySelector(".loading-overlay")) {
      unsubscribe = onIntroLifted(() => setUnveiled(true));
      timers.push(setTimeout(() => setUnveiled(true), 12000));
    } else {
      timers.push(setTimeout(() => setUnveiled(true), 0));
    }
    return () => {
      unsubscribe?.();
      timers.forEach(clearTimeout);
    };
  }, []);

  // Step 2: the video buffers behind the preloader (preload="auto")
  // but only starts playing — from frame 0 — at the unveil. Two
  // stacked copies crossfade over the loop seam: when the active one
  // nears its end, the standby starts from 0 and fades in on top,
  // then they swap roles. If duration is unknown or the standby's
  // play() is refused, nothing happens and the active video's own
  // `loop` attribute keeps it running (visible seam, but never broken).
  useEffect(() => {
    if (!unveiled || video !== "on") return;
    const a = videoARef.current;
    const b = videoBRef.current;
    if (!a) return;
    a.currentTime = 0;
    void a.play().catch(() => {
      // autoplay refused — the poster frame stays, which is fine
    });
    if (!b) return;

    let active = a;
    let standby = b;
    let fading = false;
    let swapTimer: ReturnType<typeof setTimeout> | undefined;

    const onTime = () => {
      const d = active.duration;
      if (fading || !Number.isFinite(d) || d < CROSSFADE_S * 2) return;
      if (active.currentTime < d - CROSSFADE_S) return;
      fading = true;
      const from = active;
      const to = standby;
      to.currentTime = 0;
      void to
        .play()
        .then(() => {
          to.style.zIndex = "2";
          from.style.zIndex = "1";
          to.style.opacity = "1";
          swapTimer = setTimeout(
            () => {
              from.style.opacity = "0";
              from.pause();
              from.removeEventListener("timeupdate", onTime);
              active = to;
              standby = from;
              active.addEventListener("timeupdate", onTime);
              fading = false;
            },
            CROSSFADE_S * 1000 + 50,
          );
        })
        .catch(() => {
          fading = false; // degrade to the single-video loop
        });
    };

    active.addEventListener("timeupdate", onTime);
    return () => {
      clearTimeout(swapTimer);
      a.removeEventListener("timeupdate", onTime);
      b.removeEventListener("timeupdate", onTime);
    };
  }, [unveiled, video]);

  // Step 3: after a clean text-free beat of footage, fade the copy in.
  useEffect(() => {
    if (!unveiled) return;
    const t = setTimeout(() => setReady(true), TEXT_DELAY_MS);
    return () => clearTimeout(t);
  }, [unveiled]);

  // Mount the video client-side only, never under prefers-reduced-motion
  // (those visitors keep the poster still).
  useEffect(() => {
    if (!HERO_VIDEO_SRC) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setVideo("on"), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <section data-hero className="relative h-svh overflow-hidden bg-ink text-ivory">
      {/* All media surfaces share one wrapper so the hero-exit scrub
          can push into them together */}
      <div data-hero-media className="absolute inset-0">
      {/* Poster still. This is also, unchanged, what a
          prefers-reduced-motion visitor sees: no video is ever mounted for
          them (see the gate below) and .hero-kenburns has its animation
          removed, so the hero resolves to this static frame.

          A 32svh 富源 watermark used to float on the right here. The seal
          now has exactly two homes — the divider ornament and the
          placeholder watermark — and a floating mark over the footage was
          neither. The lockup in the header is a few pixels above it. */}
      <div aria-hidden="true" className="absolute inset-0">
        <div
          className="hero-kenburns absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('${HERO_POSTER}')` }}
        />
      </div>

      {video === "on" && HERO_VIDEO_SRC && (
        <>
          {/* autoPlay is the belt to the effect's braces: the unveil
              effect is what starts playback from frame 0, but if that
              effect never runs the footage still plays rather than
              freezing on the poster. preload="auto" is required here —
              this copy must be buffered by the time the overlay lifts
              (~1.35s), and "metadata" would stall the unveil. */}
          <video
            ref={videoARef}
            className="hero-video absolute inset-0 h-full w-full object-cover"
            src={HERO_VIDEO_SRC}
            poster={HERO_POSTER}
            muted
            loop
            autoPlay
            playsInline
            preload="auto"
            onError={() => setVideo("failed")}
          />
          {/* Standby copy for the loop-seam crossfade; absolute, so
              mounting it causes no layout shift. Not needed until the
              first seam ~9.4s in, so it only takes metadata up front —
              one 5.5 MB fetch on load, not two. No autoPlay: this copy
              is played by the crossfade, and playing it on mount would
              run both videos at once. */}
          <video
            ref={videoBRef}
            className="hero-video absolute inset-0 h-full w-full object-cover"
            src={HERO_VIDEO_SRC}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            tabIndex={-1}
            style={{ opacity: 0 }}
          />
        </>
      )}

      {/* Brand tint, last inside the media wrapper so it multiplies with
          the poster and the footage and nothing else. z-[3] is load
          bearing: being last in the DOM is not enough, because the
          crossfade hands the two videos z-index 1 and 2, and a positioned
          element with a z-index paints over one with `auto` whatever the
          source order. At `auto` the tint would work until the first loop
          seam and then silently stop. */}
      <div aria-hidden="true" className="hero-tint absolute inset-0 z-[3]" />
      </div>

      {/* Incense, barely there — the altar's blessing reaching the front
          of house. Sits above the scrim so it isn't washed out, but at
          a fraction of the altar section's intensity: here it should
          register as atmosphere, never as an effect. z-[11] keeps it
          under the darkening layer and well under the copy. */}
      <IncenseSmoke
        count={2}
        intensity={0.22}
        className="z-[11] hidden sm:block"
      />

      {/* Scrim — legibility over video or placeholder alike. z-10 keeps
          it above the crossfading videos (which juggle z-index 1/2). */}
      <div aria-hidden="true" className="hero-scrim absolute inset-0 z-10" />
      {/* Deepens 0 → 0.5 during the hero-exit scrub */}
      <div
        data-hero-dark
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[12] bg-ink opacity-0"
      />

      {/* The hem into the cream section below. Outside the media wrapper
          on purpose: this is a page boundary, so it must not ride along
          with the hero-exit scrub that pushes the footage. Above the
          darkening layer (z-12) so it stays cream through the scrub. */}
      <svg
        aria-hidden="true"
        className="hero-hem pointer-events-none absolute inset-x-0 bottom-0 z-[13] w-full"
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
      >
        <path
          d="M0 0C25 0 25 10 50 10C75 10 75 0 100 0L100 10L0 10Z"
          fill="var(--cream)"
        />
      </svg>

      {/* Content — z-20, always above videos and scrim */}
      <div
        data-hero-text
        className={`absolute inset-x-0 bottom-0 z-20 ${ready ? "hero-ready" : ""}`}
      >
        <div className="container-wide flex flex-col items-center gap-4 pb-16 text-center sm:items-start sm:text-left">
          {restaurant.chineseName && (
            <span
              lang="zh-Hant"
              className="hero-item font-chinese text-lg font-bold tracking-[0.5em] text-gold-light"
            >
              {restaurant.chineseName}
            </span>
          )}
          <h1
            className="hero-item font-display text-4xl leading-tight sm:text-6xl"
            style={{ transitionDelay: "120ms" }}
          >
            {restaurant.name}
          </h1>
          <p
            className="hero-item -mt-1 max-w-xl text-sm uppercase leading-relaxed tracking-[0.12em] text-ivory/85"
            style={{ transitionDelay: "240ms" }}
          >
            {t("hero.tagline")}
          </p>
          <div
            className="hero-item mt-3 flex flex-wrap justify-center gap-4 sm:justify-start"
            style={{ transitionDelay: "360ms" }}
          >
            <OrderTakeout className="inline-flex min-h-12 items-center justify-center rounded-lg bg-gold px-7 py-3 font-semibold text-ink transition-colors hover:bg-gold-light">
              {t("hero.orderTakeout")}
            </OrderTakeout>
            <Link
              href="/menu"
              className="hero-cta-ghost inline-flex min-h-12 items-center justify-center rounded-lg border border-ivory/60 px-7 py-3 font-semibold text-ivory"
            >
              {t("hero.viewMenu")}
            </Link>
          </div>
          <p
            className="hero-item text-xs uppercase tracking-[0.12em] text-ivory/75"
            style={{ transitionDelay: "420ms" }}
          >
            {t("hero.orderDirect")} ·{" "}
            <PhoneLinks
              prefix={`${t("hero.call")} `}
              separator=" · "
              className="whitespace-nowrap font-semibold text-gold-light underline decoration-gold/60 underline-offset-2 hover:text-gold"
            />
          </p>
          <div className="hero-item" style={{ transitionDelay: "480ms" }}>
            <OpenNowChip />
          </div>
        </div>
      </div>
      {/* Without JS the ready flag never flips — show the text */}
      <noscript>
        <style>{`.hero-item{opacity:1;transform:none}`}</style>
      </noscript>
    </section>
  );
}
