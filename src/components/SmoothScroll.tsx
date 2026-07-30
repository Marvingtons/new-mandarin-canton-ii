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
  useEffect(() => {
    const lenis = getLenis();
    if (!lenis) return;
    lenis.resize();
    ScrollTrigger.refresh();
  }, [pathname]);

  return null;
}
