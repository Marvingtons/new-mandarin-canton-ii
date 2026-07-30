"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useIsomorphicLayoutEffect } from "@/lib/useIsomorphicLayoutEffect";

/**
 * The site's SplitText entrance, applied to each menu category heading as it
 * comes into view. Nothing here touches scrolling — the category bar is a
 * separate concern (see MenuCategoryBar).
 */
export default function MenuHeadings() {
  // Layout effect, not useEffect: SplitText replaces each heading's text node
  // with per-character spans, so split.revert() has to restore the original
  // nodes during React's mutation phase — before React removes those headings
  // on unmount. See useIsomorphicLayoutEffect.
  useIsomorphicLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const sections = [
      ...document.querySelectorAll<HTMLElement>(".menu-section"),
    ];
    if (!sections.length) return;

    gsap.registerPlugin(ScrollTrigger, SplitText);
    // debug handles for headless verification (same as HomeChoreography)
    (window as unknown as { __nmcST?: typeof ScrollTrigger }).__nmcST =
      ScrollTrigger;
    (window as unknown as { __nmcGSAP?: typeof gsap }).__nmcGSAP = gsap;

    const splits: SplitText[] = [];
    const ctx = gsap.context(() => {
      sections.forEach((s) => {
        const el = s.querySelector<HTMLElement>("[data-bh-text]");
        if (!el) return;
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
    });

    // Re-measure trigger positions once fonts have swapped in.
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) ScrollTrigger.refresh();
    });

    return () => {
      cancelled = true;
      splits.forEach((s) => s.revert());
      ctx.revert();
    };
  }, []);

  return null;
}
