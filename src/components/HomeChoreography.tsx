"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { setHeaderSolid } from "@/lib/headerState";

/**
 * Homepage scroll choreography (GSAP + ScrollTrigger, riding Lenis).
 * Concept: ink, paper, seal — scroll pressure is stamp pressure.
 * Renders nothing; queries the server-rendered DOM by data attributes
 * inside a gsap.context and reverts everything on unmount.
 *
 * Eases map to the motion tokens: --ease-out-soft ≈ power1.out,
 * --ease-stamp ≈ back.out(1.7).
 */
export default function HomeChoreography() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger, SplitText);
    // debug handles for headless verification
    (window as unknown as { __nmcST?: typeof ScrollTrigger }).__nmcST =
      ScrollTrigger;
    (window as unknown as { __nmcGSAP?: typeof gsap }).__nmcGSAP = gsap;

    const splits: SplitText[] = [];

    const ctx = gsap.context(() => {
      const hero = document.querySelector<HTMLElement>("[data-hero]");

      /* ---- SCENE 1: hero exit (scrubbed, tied to the thumb) ---- */
      if (hero) {
        const exit = gsap.timeline({
          scrollTrigger: {
            trigger: hero,
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
          defaults: { ease: "none" },
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
      }

      /* ---- SCENE 2: heading reveals (SplitText, once) ---- */
      document
        .querySelectorAll<HTMLElement>("main [data-bh-text]")
        .forEach((el) => {
          if (el.closest("[data-hero]")) return; // hero has its own settle
          const split = new SplitText(el, { type: "chars" });
          splits.push(split);
          const rule = el.parentElement?.querySelector(".bh-rule") ?? null;
          const tl = gsap.timeline({
            scrollTrigger: { trigger: el, start: "top 85%", once: true },
          });
          tl.from(split.chars, {
            y: 24,
            autoAlpha: 0,
            stagger: 0.018,
            duration: 0.6,
            ease: "power1.out",
          });
          if (rule) {
            tl.fromTo(
              rule,
              { scaleX: 0, transformOrigin: "left center" },
              { scaleX: 1, duration: 0.45, ease: "power1.out" },
              0.1,
            );
          }
        });

      /* ---- SCENE 3: The Room — frames breathe (scrub: 1) ---- */
      const room = document.querySelector<HTMLElement>("[data-room]");
      if (room) {
        room
          .querySelectorAll<HTMLElement>("[data-pf-inner]")
          .forEach((inner) => {
            const amp = Number(inner.dataset.pfParallax ?? 8);
            gsap.fromTo(
              inner,
              { yPercent: -amp },
              {
                yPercent: amp,
                ease: "none",
                scrollTrigger: {
                  trigger: room,
                  start: "top bottom",
                  end: "bottom top",
                  scrub: 1,
                },
              },
            );
          });
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

        gsap.set(eyebrow, { scale: 1.4, rotation: -6, autoAlpha: 0 });

        // The stamp is a toggle at 40%, not a scrub — overshoot needs
        // real time, not thumb time.
        const stamp = gsap.timeline({ paused: true }).to(eyebrow, {
          scale: 1,
          rotation: -2,
          autoAlpha: 1,
          duration: 0.45,
          ease: "back.out(1.7)",
          onComplete: () => lockup.classList.add("st-shimmer-go"),
        });
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
                stamp.play();
              } else if (self.progress < 0.35 && stamped) {
                stamped = false;
                stamp.reverse();
              }
            },
          },
          defaults: { ease: "none" },
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
          stamp.kill();
        };
      });
      // <768px: NO pin (mobile URL-bar resizes make pins jank) — the
      // two-beat entrance runs as a plain once-trigger timeline.
      mm.add("(max-width: 767px)", () => {
        if (!band || !line || !eyebrow || !stRule || !lockup) return;
        const entrance = gsap.timeline({
          scrollTrigger: { trigger: band, start: "top 75%", once: true },
        });
        entrance
          .fromTo(
            line,
            { clipPath: "inset(0% 100% 0% 0%)", letterSpacing: "0.04em" },
            {
              clipPath: "inset(0% 0% 0% 0%)",
              letterSpacing: "0em",
              duration: 0.7,
              ease: "power1.out",
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
              ease: "back.out(1.7)",
              onComplete: () => lockup.classList.add("st-shimmer-go"),
            },
            0.7,
          )
          .fromTo(
            stRule,
            { scaleX: 0, transformOrigin: "center" },
            { scaleX: 1, duration: 0.4, ease: "power1.out" },
            0.9,
          );
      });

      /* (Scene 5 retired with the wheel — the spotlight grid's
         featured/plate/up-next transitions carry this section now.) */

      /* ---- SCENE 6: seal signature — the closing echo ---- */
      const sig = document.querySelector<HTMLElement>("[data-seal-sig]");
      if (sig) {
        const seal = sig.querySelector("svg");
        const ring = sig.querySelector<HTMLElement>("[data-seal-ring]");
        const tl = gsap.timeline({
          scrollTrigger: { trigger: sig, start: "top 85%", once: true },
        });
        if (seal)
          tl.from(seal, {
            scale: 1.3,
            autoAlpha: 0,
            rotation: -6,
            duration: 0.4,
            ease: "back.out(1.7)",
          });
        if (ring)
          tl.fromTo(
            ring,
            { scale: 1, autoAlpha: 0.7 },
            { scale: 1.35, autoAlpha: 0, duration: 0.5, ease: "power1.out" },
            0.35,
          );
      }

      /* ---- utility fades: takeout strip + info band (once) ---- */
      document
        .querySelectorAll<HTMLElement>("[data-plain-fade]")
        .forEach((el) => {
          gsap.from(el, {
            autoAlpha: 0,
            duration: 0.7,
            ease: "power1.out",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          });
        });
    });

    // Re-measure once fonts have swapped in — trigger/pin positions
    // were computed against fallback-font layout. (Triggers are
    // created in this effect, i.e. post-hydration; the hero video is
    // absolutely positioned so its late mount shifts no layout.)
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) ScrollTrigger.refresh();
    });

    return () => {
      cancelled = true;
      splits.forEach((s) => s.revert());
      ctx.revert();
      setHeaderSolid(false);
    };
  }, []);

  return null;
}
