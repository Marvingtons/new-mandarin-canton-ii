"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import IncenseSmoke from "@/components/IncenseSmoke";
import OpenNowChip from "@/components/OpenNowChip";
import OrderTakeout from "@/components/OrderTakeout";
import { ARC_VIEWBOX, HEM_D } from "@/lib/brand/arc";
import { useT } from "@/lib/i18n/LocaleContext";
import { introWillPlay, onIntroLifted } from "@/lib/introSignal";
import { primaryPhone, restaurant, telHref } from "@/data/restaurant";

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
 * Everything an autoplay policy checks, applied as DOM PROPERTIES.
 *
 * `<video muted>` in JSX sets the muted PROPERTY and does not write the
 * ATTRIBUTE — a React behaviour old enough to have its own folklore — and
 * the property is set after the element exists. Chrome and Safari decide
 * eligibility from the element's state at the moment play() is attempted,
 * so the window is usually harmless and occasionally is not: an element
 * the browser sampled before React got to it is an unmuted autoplaying
 * video, which is exactly what the policy exists to refuse.
 *
 * `defaultMuted` is the property that writes the attribute, so this makes
 * the markup honest as well as the object. playsInline is set both ways
 * for the same reason — without it iOS takes the video fullscreen instead
 * of refusing it, which is a louder failure than not playing.
 *
 * Called from a ref callback, i.e. the first moment the element exists,
 * before any effect and before the browser's own autoplay attempt.
 */
function primeForAutoplay(el: HTMLVideoElement | null): void {
  if (!el) return;
  el.defaultMuted = true;
  el.muted = true;
  el.playsInline = true;
  el.volume = 0;
}

/**
 * Play, and say whether it took. Never throws — a refusal is a normal
 * outcome here, not an error: iOS Low Power Mode blocks autoplay at the
 * OS level and no amount of retrying changes that.
 */
async function tryPlay(el: HTMLVideoElement | null): Promise<boolean> {
  if (!el) return false;
  primeForAutoplay(el);
  try {
    await el.play();
    return true;
  } catch {
    return false;
  }
}

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
  /**
   * Whichever copy is on screen. The crossfade swaps the two, and the
   * resume paths below must never restart the standby — it is paused on
   * purpose, and playing it would run both at once.
   */
  const activeRef = useRef<HTMLVideoElement | null>(null);

  // Choreography step 1: detect the unveil. Safety timeout so a
  // stalled overlay can never strand the hero.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let unsubscribe: (() => void) | undefined;
    if (introWillPlay()) {
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
    activeRef.current = a;
    a.currentTime = 0;
    void tryPlay(a);
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
              activeRef.current = active;
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

  /**
   * BELT AND BRACES: keep the footage moving.
   *
   * `autoPlay` on the element is the belt and the unveil effect is the
   * braces, and both can still lose. A tab restored from the background
   * comes back with the video paused; a first play() can be refused for
   * reasons that stop applying a moment later; a bfcache restore lands on
   * a paused element with no load event to hang anything off.
   *
   * So: try on mount, try whenever the page becomes visible again, and —
   * only if a try has actually been REFUSED — try once more on the first
   * touch or scroll, which is a user gesture and clears every policy
   * there is. The listener is `once`, so it costs one call and then
   * unregisters itself; arming it unconditionally would mean every
   * visitor's first scroll called play() on a video already playing.
   *
   * NO MANUAL PLAY BUTTON, deliberately. iOS Low Power Mode refuses
   * autoplay at the OS level and will refuse this too; when it does, the
   * poster is the hero — it is the footage's own closing frame at the
   * same 1920x1080 — and a play triangle over a restaurant's front page
   * is an apology for something the visitor did not ask for.
   */
  useEffect(() => {
    if (!unveiled || video !== "on") return;
    let disposed = false;
    let armed = false;

    const onGesture = () => {
      armed = false;
      void tryPlay(activeRef.current);
    };
    const arm = () => {
      if (armed || disposed) return;
      armed = true;
      window.addEventListener("touchstart", onGesture, {
        once: true,
        passive: true,
      });
      window.addEventListener("scroll", onGesture, {
        once: true,
        passive: true,
      });
    };

    const resume = () => {
      const el = activeRef.current ?? videoARef.current;
      if (!el || disposed) return;
      // Already running: nothing to do, and no gesture listener to arm.
      if (!el.paused && !el.ended) return;
      void tryPlay(el).then((ok) => {
        if (!ok) arm();
      });
    };

    resume();
    const onVisible = () => {
      if (document.visibilityState === "visible") resume();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("scroll", onGesture);
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
            ref={(el) => {
              videoARef.current = el;
              // Before any effect, before the browser's own autoplay
              // attempt: muted/playsInline as PROPERTIES, not just the
              // JSX attributes React may not have written yet.
              primeForAutoplay(el);
              if (el && !activeRef.current) activeRef.current = el;
            }}
            // The preloader gates its wipe on THIS element's readyState —
            // it is the copy that plays first, so it is the one whose
            // buffering decides whether the reveal lands on motion. The
            // attribute is the whole contract; see LoadingOverlay.
            data-hero-primary=""
            className="hero-video absolute inset-0 h-full w-full object-cover"
            src={HERO_VIDEO_SRC}
            poster={HERO_POSTER}
            muted
            loop
            autoPlay
            playsInline
            // Nothing here is a broadcast. AirPlay/Cast on a background
            // loop offers a route to a living-room television for footage
            // with no sound and no controls, and on iOS the route picker
            // draws itself over the poster.
            disableRemotePlayback
            x-webkit-airplay="deny"
            disablePictureInPicture
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
            ref={(el) => {
              videoBRef.current = el;
              primeForAutoplay(el);
            }}
            className="hero-video absolute inset-0 h-full w-full object-cover"
            src={HERO_VIDEO_SRC}
            muted
            loop
            playsInline
            disableRemotePlayback
            x-webkit-airplay="deny"
            disablePictureInPicture
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
        viewBox={ARC_VIEWBOX}
        preserveAspectRatio="none"
      >
        <path d={HEM_D} fill="var(--cream)" />
      </svg>

      {/* Content — z-20, always above videos and scrim.

          THREE BLOCKS, READ TOP TO BOTTOM: say → act → details. On a 390px
          phone this stack used to present eight competing tap targets in
          one viewport (two CTAs side by side, two inline phone numbers, a
          status pill, and the sticky order bar's own Order + Call sitting
          on top of the whole thing). It now presents three decisions —
          order, see the menu, call — and everything else recedes into one
          caption.

          The spacing is a ladder with two rungs and no third: 12px inside
          a block, 28px between blocks. The container's old `gap-4` is gone
          for exactly that reason — a single gap cannot say "these three
          lines are one thing and that button is another".

          The rungs are OPTICAL, which is why the caption block's top
          margin reads 16px in the markup: its first row is a 44px tap
          target around 16px of text, so the target contributes 14px of
          its own space above the glyphs and 16 + 14 lands that text on
          the same ~28px interval every other block boundary uses. Set to
          a literal 28 it measured 42 and the caption fell off the page's
          rhythm. */}
      <div
        data-hero-text
        className={`absolute inset-x-0 bottom-0 z-20 ${ready ? "hero-ready" : ""}`}
      >
        <div className="container-wide flex flex-col items-center pb-16 text-center sm:items-start sm:text-left">
          {/* ---- SAY ---- */}
          {restaurant.chineseName && (
            <span
              lang="zh-Hant"
              className="hero-item font-chinese text-lg font-bold tracking-[0.5em] text-gold-light"
            >
              {restaurant.chineseName}
            </span>
          )}
          <h1
            className="hero-item mt-3 font-display text-4xl leading-tight sm:text-6xl"
            style={{ transitionDelay: "120ms" }}
          >
            {restaurant.name}
          </h1>
          <p
            className="hero-item mt-3 max-w-xl text-sm uppercase leading-relaxed tracking-[0.12em] text-ivory/85"
            style={{ transitionDelay: "240ms" }}
          >
            {t("hero.tagline")}
          </p>

          {/* ---- ACT — the two primary decisions, one rhythm.
                  Full-width and stacked on a phone: side by side they came
                  out 167px and 143px, so the two most important controls
                  on the site were both under half the screen, unequal, and
                  neither of them was where a thumb rests. From `sm` up they
                  go back to a content-width row, which is the desktop hero
                  unchanged. Same min-height and the same --radius-lg on
                  both, so the pair reads as one control group. ---- */}
          <div
            className="hero-item mt-7 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-start sm:gap-4"
            style={{ transitionDelay: "360ms" }}
          >
            {/* border-transparent is not decoration — the ghost button
                below carries a 1px hairline, so without a border here the
                two "consistent height" CTAs measured 48px and 50px. */}
            <OrderTakeout className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-transparent bg-gold px-7 py-3 font-semibold text-ink transition-colors hover:bg-gold-light sm:w-auto">
              {t("hero.orderTakeout")}
            </OrderTakeout>
            <Link
              href="/menu"
              className="hero-cta-ghost inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-ivory/60 px-7 py-3 font-semibold text-ivory sm:w-auto"
            >
              {t("hero.viewMenu")}
            </Link>
          </div>

          {/* ---- DETAILS — ONE caption, not three bands.

                  The call row is the hero's third decision and its
                  quietest: a single tel: link, one number, sized as text
                  rather than as a button. It carries min-h-11 so the tap
                  target clears 44px without the visual growing to match —
                  the two 16px-tall phone numbers it replaces were the
                  smallest targets on the page.

                  ONE number here is deliberate and costs nothing: both
                  lines are still listed, tappable, on /contact and in the
                  footer contact band of every page, which is where a
                  caller who cannot get through looks next.

                  The value line and the status pill then sit in the same
                  block on the same 12px rhythm, so the pill is part of the
                  caption instead of a floating island under it. ---- */}
          <div
            className="hero-item mt-4 flex flex-col items-center gap-3 sm:items-start"
            style={{ transitionDelay: "420ms" }}
          >
            <a
              href={telHref}
              className="token-colors inline-flex min-h-11 items-center text-sm font-semibold uppercase tracking-[0.12em] text-gold-light underline decoration-gold/60 underline-offset-4 hover:text-gold"
            >
              {t("hero.callUs")} · {primaryPhone}
            </a>
            <p className="text-xs uppercase tracking-[0.12em] text-ivory/75">
              {t("hero.orderDirect")}
            </p>
            <OpenNowChip compactOnMobile />
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
