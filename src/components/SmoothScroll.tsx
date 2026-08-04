"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { setLenis, getLenis } from "@/lib/lenisRef";

/**
 * Lenis smooth scrolling wired to ScrollTrigger via the standard
 * gsap-ticker raf pattern (Lenis drives window scroll, so no
 * scrollerProxy is needed). Not initialized at all under
 * prefers-reduced-motion. Elements with `data-lenis-prevent`
 * (e.g. the menu's horizontal category nav) keep native scrolling.
 */
export default function SmoothScroll() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });

    setLenis(lenis);
    // debug handle for headless verification (same as HomeChoreography)
    (window as unknown as { __nmcLenis?: Lenis }).__nmcLenis = lenis;
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      setLenis(null);
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);

  // One Lenis instance spans every route, so a navigation changes the document
  // height under it. Its ResizeObserver on <html> catches that, but only after
  // a 250ms debounce — re-measure immediately so a scroll fired straight after
  // a route change is never clamped to the previous page's height.
  //
  // ⚠️ AND ScrollTrigger.refresh() PUTS THE SCROLL BACK WHERE IT FOUND IT.
  // That is a feature everywhere except here: refreshing mid-page must not
  // yank the reader somewhere, so GSAP records the scroll position, re-measures
  // every trigger, then restores it. On a route change the position it records
  // is the one it cached BEFORE the router moved the page, so it restored the
  // OUTGOING page's offset over the router's scroll-to-top — scroll the
  // homepage to the footer, tap CONTACT, and /contact opened 2838px down (the
  // homepage's 3147, clamped to the shorter page). App Router was doing its job
  // the whole time; this effect undid it one frame later.
  //
  // The fix does not try to work out what kind of navigation this was, because
  // it does not have to. The router does its scrolling in the commit phase, so
  // by the time this passive effect runs the page is already where the
  // navigation wanted it — the top for a forward nav, the element for a #hash.
  // Whatever window.scrollY reads here IS the intent, and the only job is to
  // still be there once the refresh has finished.
  //
  // BACK/FORWARD falls out of that for free, by doing nothing. The browser's
  // own scroll restoration is not JavaScript and does not run on React's
  // schedule: it lands AFTER this effect, so `intended` is 0, nothing has
  // drifted from 0, no correction is written, and the restored offset arrives
  // afterwards untouched. Verified — a back into a page scrolled to 1072
  // still comes back at 1072.
  useEffect(() => {
    const lenis = getLenis();
    if (!lenis) return;
    const intended = window.scrollY;
    lenis.resize();
    ScrollTrigger.refresh();
    if (window.scrollY !== intended) {
      // ⚠️ NOT lenis.scrollTo(intended) — IT NO-OPS HERE. Lenis returns
      // early when the requested target equals its own targetScroll, and
      // its target already IS `intended`: it synced when the router wrote
      // scrollTop, and ScrollTrigger's restore moved the document without
      // telling it. Lenis is already right; the DOM is the thing that
      // drifted, so the DOM is what gets corrected.
      //
      // behavior "auto" is explicit for the same reason MenuCategoryBar
      // passes it: Next leaves an inline scroll-behavior on <html> after
      // hydration, and this must be a jump, not a journey.
      window.scrollTo({ top: intended, left: 0, behavior: "auto" });
    }
  }, [pathname]);

  return null;
}
