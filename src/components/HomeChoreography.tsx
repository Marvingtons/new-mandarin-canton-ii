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
 * has no reusable shape (the hero exit scrub).
 *
 * ⚠️ NOTHING ON THIS PAGE PINS, and nothing may. A pinned ScrollTrigger
 * takes its target out of flow and rewrites the document height, which is
 * how this site locked the scroll once already; SCENE 4 was the last one
 * and is now a plain once-trigger entrance at every width. Scrubs stay —
 * a scrub READS the scroll position, a pin CHANGES it, and only the second
 * can strand a thumb.
 *
 * The reduced-motion gate lives in createMotionContext: it returns null
 * and never runs the builder, so no ScrollTrigger and no observer is ever
 * created and the server-rendered DOM IS the reduced-motion experience.
 */
export default function HomeChoreography() {
  // A layout effect rather than useEffect. Nothing here reparents the DOM any
  // more (that was the pin's .pin-spacer), but SplitText still replaces a
  // heading's text node with per-character spans, and revert() has to restore
  // those during React's mutation phase — before React removes the heading on
  // unmount. See useIsomorphicLayoutEffect.
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
          .to("[data-hero-text]", { opacity: 0, duration: 0.6 }, 0);
        // A fifth layer used to ride this scrub: [data-hero-ghost], the
        // 富源 watermark floating over the footage. The seal is down to its
        // two sanctioned uses (divider ornament, placeholder watermark), so
        // the element — and its tween — are gone.

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

      /* ---- SCENE 4: statement band — entrance, NO PIN ----
         RULE, and it is now absolute: nothing on this page pins. See the
         note below the selectors. */
      const band = document.querySelector<HTMLElement>("[data-statement]");
      const line = band?.querySelector<HTMLElement>(".st-line") ?? null;
      const eyebrow = band?.querySelector<HTMLElement>(".st-eyebrow") ?? null;
      const stRule = band?.querySelector<HTMLElement>(".st-rule") ?? null;
      const lockup = band?.querySelector<HTMLElement>("[data-st-lockup]") ?? null;

      /* ⚠️ THE PIN IS GONE, AT EVERY WIDTH.
         This scene used to pin [data-statement] for 80% of the viewport on
         desktop (>=768px) and run a plain entrance below that. A pinned
         trigger is what produced this site's scroll-lock once already, and
         the desktop branch was the last one left: ScrollTrigger's pin takes
         the section out of flow and rebuilds the page's scroll height, so a
         resize, a late-loading image, or a refresh mid-pin can leave the
         document short and the thumb stuck.
         The mobile branch was already the same beats without it — a
         once-trigger timeline in real time rather than thumb time — so this
         is that branch, unconditionally. Nothing was designed away: the line
         wipes, the seal stamps, the rule draws. It just plays on its own
         clock, and the page never stops scrolling. */
      if (band && line && eyebrow && stRule && lockup) {
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
      }

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
           Scrubbed, NOT pinned. A scrub reads the scroll position; a pin
           CHANGES it, by taking its target out of flow and rewriting the
           document height. Only the second one can strand a thumb, which is
           why this survives and the statement-band pin above did not. */
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

      /* ---- SCENE 6 is gone: it stamped a third seal ([data-seal-sig])
         under the story copy as a signature. The seal keeps two uses —
         the divider ornament stamped in SCENE 7, and the placeholder
         watermark — so there is nothing left here to animate. ---- */

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
          /* The rules are ARCS now, so the reveal is a clip travelling
             outward from the ornament rather than a scaleX. Scaling an
             arc on one axis leaves its rise untouched while squeezing its
             width, so a shallow curve becomes a steep hump that unbends
             over the tween — a bent wire straightening, not a line being
             drawn. Clipping never touches the geometry, so the curve is
             identical at every frame.

             The inset is on the side the ornament is NOT on, so each half
             opens from the centre out: the left rule uncovers right-to-
             left, the right rule left-to-right. Same reading as before.

             duration/ease/position are UNCHANGED ON PURPOSE — the chop
             below is nested at a hard 0.45, which only means "lands as
             the two halves are nearly met" while this tween keeps its
             current shape. */
          for (const rule of divider.querySelectorAll<SVGElement>(
            "[data-divider-rule]",
          )) {
            const fromLeft = rule.dataset.dividerSide === "right";
            tl.fromTo(
              rule,
              { clipPath: fromLeft ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)" },
              {
                clipPath: "inset(0 0 0 0)",
                duration: 0.8,
                ease: EASE.soft,
                // The resting state is the finished rule, so hand the
                // element back with no clip at all rather than an
                // inset(0 0 0 0) that would outlive the animation.
                clearProps: "clipPath",
              },
              0,
            );
          }
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

      /* The [data-plain-fade] pass that used to close this out fired on
         the takeout strip and the info band, both of which are gone. The
         contact band that replaced them lives in the footer, i.e. on
         every page, and this choreography only mounts on the homepage —
         animating it here would make the band behave one way on / and
         another way everywhere else, which is the exact inconsistency
         this pass is meant to remove. */
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
