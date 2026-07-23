"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { getLenis } from "@/lib/lenisRef";
import { useIsomorphicLayoutEffect } from "@/lib/useIsomorphicLayoutEffect";

/** Strong in-out (quart): quick through the middle, gentle landing. */
const easeFlight = (t: number): number =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

/**
 * Menu category-nav behavior:
 * - scroll-spy drives the gold underline on the sticky nav pills
 * - clicking a pill flies the page there via lenis.scrollTo with a
 *   distance-aware duration (clamp(d/3000, 1.0, 1.8)s); the underline
 *   commits to the destination immediately and the spy is suppressed
 *   until landing (or until the user interrupts the flight)
 * - after landing: hash via replaceState, focus moves to the heading
 * - reduced motion / no Lenis: instant jump, same offset and states
 * - category headings get the site's SplitText entrance, which also
 *   fires when arrived at by flight (standard enter detection)
 */
export default function MenuNavigator() {
  // Layout effect, not useEffect: SplitText replaces each heading's text node
  // with per-character spans, so split.revert() has to restore the original
  // nodes during React's mutation phase — before React removes those headings
  // on unmount. See useIsomorphicLayoutEffect.
  useIsomorphicLayoutEffect(() => {
    const nav = document.querySelector<HTMLElement>(
      'nav[aria-label="Menu categories"]',
    );
    if (!nav) return;
    const links = [
      ...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
    ];
    const sections = links
      .map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))))
      .filter((s): s is HTMLElement => s !== null);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let flying = false;
    let flightTimer: ReturnType<typeof setTimeout> | undefined;

    const setActive = (id: string | null) => {
      links.forEach((a) =>
        a.classList.toggle("cat-link-active", a.hash.slice(1) === id),
      );
    };

    /** Land headings just below the sticky nav (the header is static
        on this page and scrolls away, so the nav is the only bar). */
    const offset = () => nav.getBoundingClientRect().height + 16;

    // ---- scroll spy (suppressed while a flight is in progress) ----
    const spy = () => {
      if (flying) return;
      // +20 keeps the line just below both landing offsets (flight:
      // nav+16; deep-link CSS fallback: scroll-margin-top 80px)
      const line = window.scrollY + offset() + 20;
      let current: string | null = null;
      for (const s of sections) if (s.offsetTop <= line) current = s.id;
      setActive(current);
    };
    spy();
    window.addEventListener("scroll", spy, { passive: true });

    // a user interrupt (wheel/touch) cancels the flight lock so the
    // spy resumes; Lenis itself stops the programmatic scroll natively
    const endFlight = () => {
      flying = false;
      clearTimeout(flightTimer);
      window.removeEventListener("wheel", endFlight);
      window.removeEventListener("touchstart", endFlight);
    };

    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a || !links.includes(a as HTMLAnchorElement)) return;
      const id = (a as HTMLAnchorElement).hash.slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();

      // the nav commits immediately; the page follows
      setActive(id);
      a.scrollIntoView({
        inline: "center",
        block: "nearest",
        behavior: reduced ? "auto" : "smooth",
      });

      const targetY =
        target.getBoundingClientRect().top + window.scrollY - offset();
      const land = () => {
        history.replaceState(null, "", `#${id}`);
        const heading =
          target.querySelector<HTMLElement>("[data-bh-text]") ?? target;
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      };

      const lenis = getLenis();
      if (reduced || !lenis) {
        window.scrollTo(0, targetY);
        land();
        return;
      }

      flying = true;
      const distance = Math.abs(targetY - window.scrollY);
      const duration = Math.min(1.8, Math.max(1.0, distance / 3000));
      window.addEventListener("wheel", endFlight, { passive: true });
      window.addEventListener("touchstart", endFlight, { passive: true });
      flightTimer = setTimeout(endFlight, duration * 1000 + 250);
      lenis.scrollTo(targetY, {
        duration,
        easing: easeFlight,
        onComplete: () => {
          endFlight();
          land();
        },
      });
    };
    nav.addEventListener("click", onClick);

    // ---- SplitText entrances for the category headings ----
    let ctx: gsap.Context | undefined;
    const splits: SplitText[] = [];
    if (!reduced) {
      gsap.registerPlugin(ScrollTrigger, SplitText);
      // debug handles for headless verification (same as HomeChoreography)
      (window as unknown as { __nmcST?: typeof ScrollTrigger }).__nmcST =
        ScrollTrigger;
      (window as unknown as { __nmcGSAP?: typeof gsap }).__nmcGSAP = gsap;
      ctx = gsap.context(() => {
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
    }

    // Re-measure trigger positions once fonts have swapped in.
    let cancelled = false;
    if (!reduced) {
      void document.fonts.ready.then(() => {
        if (!cancelled) ScrollTrigger.refresh();
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("scroll", spy);
      nav.removeEventListener("click", onClick);
      endFlight();
      splits.forEach((s) => s.revert());
      ctx?.revert();
    };
  }, []);

  return null;
}
