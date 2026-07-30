"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import IncenseSmoke from "@/components/IncenseSmoke";
import OpenNowChip from "@/components/OpenNowChip";
import OrderTakeout from "@/components/OrderTakeout";
import PhoneLinks from "@/components/PhoneLinks";
import { onIntroLifted } from "@/lib/introSignal";
import { restaurant } from "@/data/restaurant";
import { ORDER_DIRECT_NOTE } from "@/data/order";

/**
 * Hero footage, served from R2 rather than /public: 10s muted loop,
 * 1920x1080 h264, 3,680,241 bytes, faststart. Keeping 3.7 MB of video
 * out of the Worker bundle is the point — it was in `public/` until
 * this moved.
 *
 * /public/hero-poster.jpg is frame 0 of THIS file (verified: same
 * 1920x1080, same wok-flame frame), so the poster-to-video handoff is
 * seamless and nothing shifts when the video arrives. Set to null to
 * fall back to the poster-only hero without requesting the file.
 */
const HERO_VIDEO_SRC: string | null =
  "https://pub-364f647b29874b09922e1889f267c323.r2.dev/newmandarincanton-hero.mp4";

/**
 * After the preloader lifts, the footage plays full-bleed with no text
 * for this beat before the copy fades in.
 */
const TEXT_DELAY_MS = 1200;

/** Loop-seam crossfade duration (seconds). */
const CROSSFADE_S = 0.6;

/**
 * Full-bleed video hero (100svh). While there is no video — or if it
 * ever fails to load — the hero shows the poster still with a slow
 * Ken Burns drift and a giant 富源 watermark. Text staggers in only
 * after the intro overlay lifts (or immediately if it isn't mounted).
 */
export default function HeroVideo() {
  /** True the moment the intro overlay lifts (or at once without one). */
  const [unveiled, setUnveiled] = useState(false);
  const [ready, setReady] = useState(false);
  const [video, setVideo] = useState<"pending" | "on" | "failed">("pending");
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  // The ghost watermark's scroll drift now lives in HomeChoreography's
  // hero-exit scrub ([data-hero-ghost]).

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
      {/* Placeholder still — also sits beneath the video when enabled */}
      <div aria-hidden="true" className="absolute inset-0">
        <div
          className="hero-kenburns absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/hero-poster.jpg')" }}
        >
          {restaurant.chineseName && (
            <span
              data-hero-ghost
              lang="zh-Hant"
              className="absolute right-[4%] top-1/2 -translate-y-1/2 select-none font-chinese font-bold leading-[0.95] text-ivory/5"
              style={{ fontSize: "32svh" }}
            >
              {[...restaurant.chineseName].map((char, i) => (
                <span key={i} className="block">
                  {char}
                </span>
              ))}
            </span>
          )}
        </div>
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
            poster="/hero-poster.jpg"
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
              one 3.7 MB fetch on load, not two. No autoPlay: this copy
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
            Mandarin, Szechuan &amp; Cantonese cuisine in Chula Vista
          </p>
          <div
            className="hero-item mt-3 flex flex-wrap justify-center gap-4 sm:justify-start"
            style={{ transitionDelay: "360ms" }}
          >
            <OrderTakeout className="inline-flex min-h-12 items-center justify-center bg-gold px-7 py-3 font-semibold text-ink transition-colors hover:bg-gold-light">
              Order Takeout
            </OrderTakeout>
            <Link
              href="/menu"
              className="hero-cta-ghost inline-flex min-h-12 items-center justify-center border border-ivory/60 px-7 py-3 font-semibold text-ivory"
            >
              View Menu
            </Link>
          </div>
          <p
            className="hero-item text-xs uppercase tracking-[0.12em] text-ivory/75"
            style={{ transitionDelay: "420ms" }}
          >
            {ORDER_DIRECT_NOTE} ·{" "}
            <PhoneLinks
              prefix="Call "
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
