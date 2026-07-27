"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { setHeaderSolid } from "@/lib/headerState";
import {
  createMotionContext,
  EASE,
  maskWipe,
  parallax,
  revealRise,
  sealStamp,
  smokeDrift,
  START,
  steamRise,
} from "@/lib/motion";
import { useIsomorphicLayoutEffect } from "@/lib/useIsomorphicLayoutEffect";

/**
 * Homepage scroll choreography (GSAP + ScrollTrigger, riding Lenis).
 * Concept: ink, paper, seal — scroll pressure is stamp pressure.
 *
 * Renders nothing; queries the server-rendered DOM by data attributes
 * inside a motion context and reverts everything on unmount. Scenes are
 * built from the shared primitives in lib/motion so the whole page eases
 * with one voice — reach for a raw gsap call only where a scene genuinely
 * has no reusable shape (the hero scrub and the statement pin).
 *
 * The reduced-motion gate lives in createMotionContext: it returns null
 * and never runs the builder, so the server-rendered DOM IS the
 * reduced-motion experience.
 */
export default function HomeChoreography() {
  // MUST be a layout effect, not useEffect. SCENE 4 pins [data-statement],
  // which makes ScrollTrigger wrap that <section> in a .pin-spacer — the
  // section's DOM parent stops being <main>, while React still thinks it is.
  // Only a layout-phase cleanup reverts that before React's mutation phase
  // calls main.removeChild(section). See useIsomorphicLayoutEffect.
  useIsomorphicLayoutEffect(() => {
    const splits: SplitText[] = [];
    const loops: gsap.core.Timeline[] = [];

    const ctx = createMotionContext(() => {
      // debug handles for headless verification
      (window as unknown as { __nmcST?: typeof ScrollTrigger }).__nmcST =
        ScrollTrigger;
      (window as unknown as { __nmcGSAP?: typeof gsap }).__nmcGSAP = gsap;

      const hero = document.querySelector<HTMLElement>("[data-hero]");

      /* ---- SCENE 1: hero exit (scrubbed, tied to the thumb) ----
         Bespoke by necessity: five layers on one scrub at different
         rates is not a reusable shape. */
      if (hero) {
        const exit = gsap.timeline({
          scrollTrigger: {
            trigger: hero,
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
          defaults: { ease: EASE.none },
        });
        exit
          .to("[data-hero-media]", { scale: 1.12, duration: 1 }, 0)
          .to("[data-hero-dark]", { opacity: 0.5, duration: 1 }, 0)
          .to(
            "[data-hero-text]",
            { y: () => -window.innerHeight * 0.5, duration: 1 },
            0,
          )
          // gone by 60% of the exit
          .to("[data-hero-text]", { opacity: 0, duration: 0.6 }, 0)
          .to(
            "[data-hero-ghost]",
            { y: () => window.innerHeight * 0.25, xPercent: 2, duration: 1 },
            0,
          );

        // Header transparent→solid rides the same trigger, not its own
        // scroll listener.
        ScrollTrigger.create({
          trigger: hero,
          start: "bottom 96px",
          onEnter: () => setHeaderSolid(true),
          onLeaveBack: () => setHeaderSolid(false),
        });

        // Incense drifting behind the hero — barely there, the first
        // whisper of the motif the altar section states outright.
        loops.push(...smokeDrift(hero.querySelectorAll("[data-smoke-wisp]")));
      }

      /* ---- SCENE 2: heading reveals (SplitText, once) ----
         Char-level, so it stays hand-rolled; every other section uses
         the shared primitives. */
      document
        .querySelectorAll<HTMLElement>("main [data-bh-text]")
        .forEach((el) => {
          if (el.closest("[data-hero]")) return; // hero has its own settle
          const split = new SplitText(el, { type: "chars" });
          splits.push(split);
          const rule = el.parentElement?.querySelector(".bh-rule") ?? null;
          const tl = gsap.timeline({
            scrollTrigger: { trigger: el, start: START.enter, once: true },
          });
          tl.from(split.chars, {
            y: 24,
            autoAlpha: 0,
            stagger: 0.018,
            duration: 0.6,
            ease: EASE.soft,
          });
          if (rule) {
            tl.fromTo(
              rule,
              { scaleX: 0, transformOrigin: "left center" },
              { scaleX: 1, duration: 0.45, ease: EASE.soft },
              0.1,
            );
          }
        });

      /* ---- SCENE 3: The Room — the altar ----
         Frames breathe on parallax, incense rises behind them, and the
         offering settles into place in front. The candle glow is pure
         CSS (see .candle-glow) — it needs no scroll position, so it has
         no business holding a ScrollTrigger. */
      const room = document.querySelector<HTMLElement>("[data-room]");
      if (room) {
        room
          .querySelectorAll<HTMLElement>("[data-pf-inner]")
          .forEach((inner) => {
            parallax(inner, {
              trigger: room,
              amount: Number(inner.dataset.pfParallax ?? 8),
            });
          });

        // Taller and slower than the hero's: this is the altar itself,
        // so the incense is allowed to actually be visible here.
        loops.push(
          ...smokeDrift(room.querySelectorAll("[data-smoke-wisp]"), {
            rise: -190,
            duration: 17,
            peak: 0.45,
          }),
        );

        // One fruit finds its resting angle as the section arrives —
        // a few degrees, once, and never again.
        const settle = room.querySelector<HTMLElement>(
          "[data-mandarin-settle]",
        );
        if (settle) {
          gsap.from(settle, {
            rotation: -13,
            x: -9,
            // SVG user-space origin — the centre of THIS fruit (cx 95,
            // cy 50 in the cluster's viewBox). A percentage origin does
            // not resolve against a <g>, so GSAP would bake 0,0 and
            // swing the fruit about the artwork's top-left corner.
            svgOrigin: "95 49",
            duration: 1.1,
            ease: EASE.glide,
            clearProps: "all",
            scrollTrigger: { trigger: room, start: START.late, once: true },
          });
        }
      }

      /* ---- SCENE 4: statement band — the one pin (desktop only) ----
         RULE: pinned elements never receive transforms from other
         animations; pin an inner wrapper if a section needs both.
         The section [data-statement] is the pin target and nothing
         else may tween it or any of its ancestors (no transform,
         will-change, filter, or perspective) while pinned — the
         lockup/line/eyebrow tweens all target CHILDREN only. */
      const band = document.querySelector<HTMLElement>("[data-statement]");
      const line = band?.querySelector<HTMLElement>(".st-line") ?? null;
      const eyebrow = band?.querySelector<HTMLElement>(".st-eyebrow") ?? null;
      const stRule = band?.querySelector<HTMLElement>(".st-rule") ?? null;
      const lockup = band?.querySelector<HTMLElement>("[data-st-lockup]") ?? null;

      const mm = gsap.matchMedia();
      mm.add("(min-width: 768px)", () => {
        if (!band || !line || !eyebrow || !stRule || !lockup) return;

        // The stamp is a toggle at 40%, not a scrub — overshoot needs
        // real time, not thumb time. Built paused; the scrub plays it.
        // sealStamp's fromTo renders immediately, so the seal is hidden
        // from the first frame without a separate gsap.set.
        const stamp = sealStamp(eyebrow, {
          paused: true,
          from: 1.4,
          rotation: -2,
        });
        stamp?.eventCallback("onComplete", () =>
          lockup.classList.add("st-shimmer-go"),
        );
        let stamped = false;

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: band,
            start: "top top",
            end: "+=80%", // 80% of the viewport — never outruns the page
            pin: true,
            pinSpacing: true,
            anticipatePin: 1,
            scrub: true,
            onUpdate: (self) => {
              if (self.progress >= 0.4 && !stamped) {
                stamped = true;
                stamp?.play();
              } else if (self.progress < 0.35 && stamped) {
                stamped = false;
                stamp?.reverse();
              }
            },
          },
          defaults: { ease: EASE.none },
        });
        tl.fromTo(
          line,
          { clipPath: "inset(0% 100% 0% 0%)", letterSpacing: "0.04em" },
          {
            clipPath: "inset(0% 0% 0% 0%)",
            letterSpacing: "0em",
            duration: 0.4,
          },
          0,
        )
          .fromTo(
            stRule,
            { scaleX: 0, transformOrigin: "center" },
            { scaleX: 1, duration: 0.2 },
            0.6,
          )
          .to(lockup, { y: -20, duration: 0.2 }, 0.8);

        return () => {
          stamp?.kill();
        };
      });
      // <768px: NO pin (mobile URL-bar resizes make pins jank) — the
      // two-beat entrance runs as a plain once-trigger timeline.
      mm.add("(max-width: 767px)", () => {
        if (!band || !line || !eyebrow || !stRule || !lockup) return;
        const entrance = gsap.timeline({
          scrollTrigger: { trigger: band, start: START.late, once: true },
        });
        entrance
          .fromTo(
            line,
            { clipPath: "inset(0% 100% 0% 0%)", letterSpacing: "0.04em" },
            {
              clipPath: "inset(0% 0% 0% 0%)",
              letterSpacing: "0em",
              duration: 0.7,
              ease: EASE.soft,
            },
            0,
          )
          .fromTo(
            eyebrow,
            { scale: 1.4, rotation: -6, autoAlpha: 0 },
            {
              scale: 1,
              rotation: -2,
              autoAlpha: 1,
              duration: 0.45,
              ease: EASE.stamp,
              onComplete: () => lockup.classList.add("st-shimmer-go"),
            },
            0.7,
          )
          .fromTo(
            stRule,
            { scaleX: 0, transformOrigin: "center" },
            { scaleX: 1, duration: 0.4, ease: EASE.soft },
            0.9,
          );
      });

      /* ---- SCENE 5: Spotlight entrance (once) — rail items stagger,
         the featured card curtain-reveals, small cards follow. ---- */
      const spt = document.querySelector<HTMLElement>("[data-spt]");
      if (spt) {
        revealRise(spt.querySelectorAll("[data-spt-rail-item]"), {
          trigger: spt,
          start: "top 80%",
          y: 16,
          duration: 0.5,
        });
        maskWipe(spt.querySelector("[data-spt-card]"), {
          trigger: spt,
          start: "top 80%",
          duration: 0.7,
          delay: 0.1,
        });
        revealRise(spt.querySelectorAll("[data-spt-small]"), {
          trigger: spt,
          start: "top 80%",
          y: 16,
          duration: 0.5,
          stagger: 0.12,
          delay: 0.22,
        });

        /* The signature-dish moment: the featured plate swells a few
           percent across its own scroll range while steam lifts off it.
           Scrubbed, NOT pinned — this page already spends its one pin on
           the statement band, and a second pin is where mobile jank
           starts. */
        const card = spt.querySelector<HTMLElement>("[data-spt-card]");
        const dish = spt.querySelector<HTMLElement>("[data-spt-photo]");
        if (card && dish) {
          gsap.fromTo(
            dish,
            { scale: 1 },
            {
              scale: 1.06,
              ease: EASE.none,
              scrollTrigger: {
                trigger: card,
                start: "top 85%",
                end: "bottom 40%",
                scrub: 1.2,
              },
            },
          );
        }
        loops.push(...steamRise(spt.querySelectorAll("[data-steam-wisp]")));
      }

      /* ---- SCENE 6: seal signature — the closing echo ---- */
      const sig = document.querySelector<HTMLElement>("[data-seal-sig]");
      if (sig) {
        sealStamp(sig.querySelector("svg"), {
          trigger: sig,
          start: START.enter,
          ring: sig.querySelector("[data-seal-ring]"),
          from: 1.3,
          rotation: -6,
          duration: 0.4,
        });
      }

      /* ---- SCENE 7: gold dividers draw outward from centre, and the
         red chop presses in where the halves meet ---- */
      document
        .querySelectorAll<HTMLElement>("[data-divider]")
        .forEach((divider) => {
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: divider,
              start: "top 90%",
              once: true,
            },
          });
          tl.fromTo(
            divider.querySelectorAll("[data-divider-rule]"),
            { scaleX: 0 },
            { scaleX: 1, duration: 0.8, ease: EASE.soft },
            0,
          );
          const chop = divider.querySelector<HTMLElement>("[data-divider-seal]");
          if (chop) {
            // Built paused so it carries no ScrollTrigger of its own,
            // then un-paused as it is nested — a paused child ignores
            // its parent's playhead.
            const stamp = sealStamp(chop, {
              paused: true,
              ring: divider.querySelector("[data-divider-ring]"),
              from: 1.5,
              rotation: -4,
            });
            if (stamp) tl.add(stamp.paused(false), 0.45);
          }
        });

      /* ---- SCENE 8: everything else enters on the shared rise ---- */
      document
        .querySelectorAll<HTMLElement>("[data-rise]")
        .forEach((group) => {
          // A group animates its children if it has any marked; otherwise
          // it animates itself.
          const marked = group.querySelectorAll<HTMLElement>("[data-rise-item]");
          revealRise(marked.length ? marked : group, { trigger: group });
        });

      /* ---- utility fades: takeout strip + info band (once) ----
         One trigger EACH — a shared trigger would fire the info band
         when the takeout strip scrolled in, half a page earlier. */
      document
        .querySelectorAll<HTMLElement>("[data-plain-fade]")
        .forEach((el) => revealRise(el, { y: 0, start: START.edge }));
    });

    // Re-measure once fonts have swapped in — trigger/pin positions
    // were computed against fallback-font layout. (Triggers are
    // created in this effect, i.e. post-hydration; the hero video is
    // absolutely positioned so its late mount shifts no layout.)
    let cancelled = false;
    if (ctx) {
      void document.fonts.ready.then(() => {
        if (!cancelled) ScrollTrigger.refresh();
      });
    }

    return () => {
      cancelled = true;
      loops.forEach((tl) => tl.kill());
      splits.forEach((s) => s.revert());
      ctx?.revert();
      setHeaderSolid(false);
    };
  }, []);

  return null;
}
