"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ARC_VIEWBOX, HEM_D } from "@/lib/brand/arc";
import {
  FRAME_D,
  FRAME_LENGTH,
  FU_DS,
  SEAL_GOLD_FILL,
  SEAL_GOLD_STROKE,
  SEAL_RED,
  VIEWBOX_FULL,
  YUAN_DS,
} from "@/lib/brand/seal";
import { restaurant } from "@/data/restaurant";
import {
  INTRO_SESSION_KEY,
  introWillPlay,
  signalIntroLifted,
} from "@/lib/introSignal";

/**
 * THE SEAL STAMP — the homepage's first-visit-per-session opening.
 *
 * A chop is pressed, not drawn, so the whole moment is built around one
 * physical hit rather than a sequence of reveals:
 *
 *   0.00-0.45  the frame DRAWS. One continuous stroke on the bracket
 *              path, dasharray/offset, measured (FRAME_LENGTH) rather
 *              than guessed. The path's own start point sits at the top
 *              edge, so running the offset to zero lands the last units
 *              back at the top — the flourish before the press happens
 *              where the eye already is.
 *   0.45-0.53  the PRESS. Red ground and both characters snap 0 -> 1 in
 *              80ms together — one object arriving, not three fading —
 *              while the whole mark settles 1.06 -> 1.00 and -0.6deg -> 0
 *              on power4.out. No elastic: a stamp does not bounce back,
 *              it stops.
 *   0.45-0.75  the INK. A displaced duplicate of the red ground at 15%,
 *              gone over ~300ms, so the hit is rough and the rest clean.
 *   0.75-1.10  the WORDMARK letterpresses up 6px in the display face.
 *   ready      the CURTAIN lifts, its leading edge the hero's own hem
 *              (HEM_D) — the ink screen tears away along exactly the line
 *              the hero settles on. The mark rides up with the screen; it
 *              never fades on its own.
 *
 * WHAT IT REFUSES: progress %, tagline, sound, particles, spinner, and —
 * the one that matters — a minimum display time. The old version of this
 * file held for 1350ms whether or not the page was ready, which is a toll
 * gate wearing a gift's clothes. Nothing here waits on the clock; the
 * clock only ever cuts the wait short (CAP_MS).
 *
 * HOMEPAGE ONLY. This mounts from the root layout, so without the
 * pathname guard the first visit to /menu or an order route got gated
 * too. Ordering food is not a moment for ceremony.
 */

/** Hard cap. Reveal regardless — the poster covers whatever is missing. */
const CAP_MS = 1800;
/** The timeline's own length, press to wordmark settled. */
const READY_AT_MS = 1150;
/** Curtain. */
const WIPE_MS = 600;
/** Reduced motion gets the finished mark, faded, over the same gating. */
const RM_FADE_MS = 300;

const emptySubscribe = (): (() => void) => () => {};

/**
 * Readiness: the poster is painted, the fonts are in, and the video is
 * BUFFERING HEALTHILY — readyState >= HAVE_CURRENT_DATA, not
 * canplaythrough. Waiting for the whole file would hold the curtain over
 * a video that is already able to move, and the poster is the video's own
 * closing frame at the same 1920x1080, so an early reveal costs nothing
 * even when the decode is a beat behind.
 *
 * Every leg resolves rather than rejects, and the caller races the whole
 * thing against CAP_MS, so a stalled font or a missing poster can only
 * ever cost time, never the reveal.
 */
function whenReady(): Promise<void> {
  const poster = new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = "/hero-poster-plate.jpg";
  });

  const fonts = document.fonts
    ? document.fonts.ready.then(() => undefined).catch(() => undefined)
    : Promise.resolve();

  // Under reduced motion HeroVideo never mounts a video at all — those
  // visitors keep the poster — so waiting on one would park every single
  // reduced-motion visitor on the 1.8s cap, every time. Measured: 1834ms
  // hold with the video leg starved, against ~1.2s when it resolves. The
  // poster leg above is the whole of readiness for them.
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return Promise.all([poster, fonts]).then(() => undefined);

  const video = new Promise<void>((resolve) => {
    // HeroVideo mounts the element on its own schedule, so poll briefly
    // for it rather than assuming it is in the DOM yet.
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      resolve();
    };
    const check = () => {
      const el = document.querySelector<HTMLVideoElement>("[data-hero-primary]");
      if (!el) return;
      // HAVE_CURRENT_DATA: there is a frame to show and more is coming.
      if (el.readyState >= 2) {
        done();
        return;
      }
      el.addEventListener("loadeddata", done, { once: true });
      el.addEventListener("canplay", done, { once: true });
      el.addEventListener("error", done, { once: true });
      clearInterval(poll);
    };
    const poll = setInterval(check, 60);
    check();
  });

  return Promise.all([poster, fonts, video]).then(() => undefined);
}

export default function LoadingOverlay() {
  // introWillPlay() already answers "homepage, not seen this session", but
  // it reads location once and memoises. usePathname is what makes a
  // client-side route change away from / unmount this immediately rather
  // than at the next full load.
  const pathname = usePathname();
  const isHome = pathname === "/";
  const play = useSyncExternalStore(emptySubscribe, introWillPlay, () => false);
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");
  const rootRef = useRef<HTMLDivElement>(null);
  const active = isHome && play && phase !== "gone";

  // Mark the session the moment we commit to showing it. Safe to write
  // here despite introWillPlay reading the same key: that answer is
  // memoised on first call, which has already happened by now.
  useEffect(() => {
    if (!active) return;
    try {
      sessionStorage.setItem(INTRO_SESSION_KEY, "1");
    } catch {
      // best effort
    }
  }, [active]);

  // Scroll lock, for exactly as long as the overlay is up.
  //
  // The padding is not a nicety. `overflow: hidden` on the body takes the
  // scrollbar away, the viewport gets 15px wider, and every centred thing
  // on the page moves — measured at CLS 0.590 in one shift sourced to
  // BODY, which is most of a 0.603 total against 0.012 for the same page
  // without the overlay. Holding the gutter open with padding costs one
  // line and puts the whole first-visit CLS back where the repeat visit
  // already was.
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
    };
  }, [active]);

  // The timeline, and the gate that ends it.
  useEffect(() => {
    if (!active || phase !== "in") return;
    const root = rootRef.current;
    if (!root) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let cancelled = false;
    let disposed = false;
    let tl: { kill: () => void } | undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Reduced motion: no timeline at all. The finished mark is simply
    // there, and the same gating decides when it leaves.
    if (reduced) {
      root.classList.add("stamp-rm");
      Promise.race([
        whenReady(),
        new Promise<void>((r) => timers.push(setTimeout(r, CAP_MS))),
      ]).then(() => {
        if (cancelled) return;
        // let the fade-in land before the fade-out starts
        timers.push(
          setTimeout(() => {
            if (!cancelled) setPhase("out");
          }, RM_FADE_MS),
        );
      });
      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
      };
    }

    void import("gsap").then(({ gsap }) => {
      if (disposed || cancelled) return;
      const frame = root.querySelector<SVGPathElement>(".stamp-frame");
      const press = root.querySelectorAll(".stamp-press");
      const mark = root.querySelector<SVGSVGElement>(".stamp-mark");
      const ink = root.querySelector<SVGGElement>(".stamp-ink");
      const word = root.querySelector<HTMLElement>(".stamp-word");

      const t = gsap.timeline();
      tl = t;

      if (frame) {
        gsap.set(frame, {
          strokeDasharray: FRAME_LENGTH,
          strokeDashoffset: FRAME_LENGTH,
          opacity: 1,
        });
        t.to(frame, {
          strokeDashoffset: 0,
          duration: 0.45,
          ease: "power2.inOut",
        });
      }

      // THE PRESS — everything that makes the mark a mark, at once.
      //
      // immediateRender: false on all three. GSAP applies a fromTo's
      // from-state the moment the tween is CREATED, not when it is due,
      // so without this the rough ink layer sat at 0.15 through the whole
      // draw — a red ghost under a frame that has not been pressed yet —
      // and the mark drew at 1.06 and then shrank. Measured, not guessed:
      // the ink layer read 0.15 at t+94ms against a press at t+450ms.
      t.to(press, { opacity: 1, duration: 0.08, ease: "none" }, 0.45);
      if (mark) {
        t.fromTo(
          mark,
          { scale: 1.06, rotate: -0.6 },
          {
            scale: 1,
            rotate: 0,
            duration: 0.5,
            ease: "power4.out",
            transformOrigin: "50% 50%",
            immediateRender: false,
          },
          0.45,
        );
      }
      if (ink) {
        t.fromTo(
          ink,
          { opacity: 0.15 },
          {
            opacity: 0,
            duration: 0.3,
            ease: "power2.out",
            immediateRender: false,
          },
          0.45,
        );
      }
      if (word) {
        t.fromTo(
          word,
          { opacity: 0, y: 6 },
          {
            opacity: 1,
            y: 0,
            duration: 0.35,
            ease: "power2.out",
            immediateRender: false,
          },
          0.75,
        );
      }
    });

    // The gate. The timeline and the download race; whichever finishes
    // last decides, and CAP_MS overrules both.
    const settled = new Promise<void>((r) =>
      timers.push(setTimeout(r, READY_AT_MS)),
    );
    const capped = new Promise<void>((r) => timers.push(setTimeout(r, CAP_MS)));
    Promise.race([
      Promise.all([settled, whenReady()]).then(() => undefined),
      capped,
    ]).then(() => {
      if (!cancelled) setPhase("out");
    });

    return () => {
      cancelled = true;
      disposed = true;
      tl?.kill();
      timers.forEach(clearTimeout);
    };
  }, [active, phase]);

  // The curtain, then gone.
  useEffect(() => {
    if (!active || phase !== "out") return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const t = setTimeout(
      () => {
        setPhase("gone");
        signalIntroLifted();
      },
      reduced ? RM_FADE_MS : WIPE_MS,
    );
    return () => clearTimeout(t);
  }, [active, phase]);

  if (!isHome || !play || phase === "gone") return null;

  return (
    <div
      ref={rootRef}
      aria-busy="true"
      className={`stamp${phase === "out" ? " stamp-out" : ""}`}
    >
      {/* The ink screen's leading edge is the hero's hem, so the curtain
          tears along the line the page is about to settle on. */}
      <svg
        aria-hidden="true"
        className="stamp-hem"
        viewBox={ARC_VIEWBOX}
        preserveAspectRatio="none"
      >
        <path d={HEM_D} fill="var(--ink)" />
      </svg>

      <div className="stamp-stack">
        <svg
          aria-hidden="true"
          className="stamp-mark"
          viewBox={VIEWBOX_FULL}
          fill="none"
        >
          <defs>
            {/* One filter, on one small element, alive for ~300ms. See the
                cost note beside .stamp in globals.css. */}
            <filter
              id="stamp-rough"
              x="-10%"
              y="-10%"
              width="120%"
              height="120%"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9"
                numOctaves="2"
                seed="7"
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="2.2"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
          {/* Red ground: the artwork declares #77151A and draws it
              nowhere, so the chop's field is the frame path, filled. */}
          <path
            className="stamp-press"
            d={FRAME_D}
            fill={SEAL_RED}
            opacity="0"
          />
          {/* The rough duplicate, alive only across the hit. */}
          <g className="stamp-ink" opacity="0">
            <path d={FRAME_D} fill={SEAL_RED} filter="url(#stamp-rough)" />
          </g>
          <path
            className="stamp-frame"
            d={FRAME_D}
            fill="none"
            stroke={SEAL_GOLD_STROKE}
            strokeWidth="1.3632"
            strokeMiterlimit="10"
            opacity="0"
          />
          <g className="stamp-press" fill={SEAL_GOLD_FILL} opacity="0">
            {FU_DS.map((d, i) => (
              <path key={`fu-${i}`} d={d} />
            ))}
            {YUAN_DS.map((d, i) => (
              <path key={`yuan-${i}`} d={d} />
            ))}
          </g>
        </svg>

        <p className="stamp-word">{restaurant.name}</p>
      </div>

      {/* Without JS nothing ever dismisses this — never show it at all. */}
      <noscript>
        <style>{`.stamp{display:none}`}</style>
      </noscript>
    </div>
  );
}
