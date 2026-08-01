"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n/LocaleContext";
import { getLenis } from "@/lib/lenisRef";

/** How far down the page the button earns its place. */
const THRESHOLD_VIEWPORTS = 1.5;

/**
 * Scroll position as an external store, so the button reads it without
 * ever setting state from an effect.
 *
 * The kitchen check is deliberately SECOND in the predicate. The board
 * covers the site chrome with its own fixed surface rather than removing
 * it (see [kitchenSlug]/page.tsx), so this button is still in that page's
 * DOM, sitting behind a z-100 panel — invisible, but reachable by Tab.
 * Short-circuiting on the scroll test first means the DOM query only runs
 * on pages that have actually been scrolled past the threshold.
 */
function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  window.addEventListener("resize", onChange);
  return () => {
    window.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}

function getSnapshot() {
  return (
    window.scrollY > window.innerHeight * THRESHOLD_VIEWPORTS &&
    !document.querySelector("[data-kitchen-surface]")
  );
}

/** The server renders the resting state: not shown, nothing reserved. */
function getServerSnapshot() {
  return false;
}

/**
 * Back to top. Fixed bottom-RIGHT, and that side is not a preference —
 * bottom-left already holds [[TestModeBadge]], which is deliberately not
 * dismissible and must never be covered.
 *
 * Appears past 1.5 viewports, which is far enough down that it is answering
 * a question the visitor has actually started to ask. It is `fixed` and
 * always in the tree, so showing it can never move a pixel of the page;
 * hidden it is `invisible`, which also takes it out of the tab order rather
 * than leaving an invisible stop for keyboard users.
 *
 * z-[55] is chosen, not arbitrary: above the sticky order bar (z-50) so it
 * is never buried, below the cart backdrop (z-[60]) and the item sheet
 * (z-[70]) so it can never float over a modal.
 *
 * The scroll home goes through Lenis when Lenis exists. Under
 * prefers-reduced-motion SmoothScroll never initialises, so getLenis()
 * returns null and the fallback runs with behavior "auto" — an instant
 * jump, matching the instant show/hide the same media query gives the
 * button's own transition.
 */
export default function BackToTop() {
  const t = useT();
  const visible = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const toTop = useCallback(() => {
    const lenis = getLenis();
    if (lenis) {
      lenis.scrollTo(0);
      return;
    }
    // No Lenis means reduced motion (or no JS-driven smoothing at all):
    // go straight there rather than animating something the visitor has
    // asked the OS not to animate.
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  return (
    <button
      type="button"
      onClick={toTop}
      // One language for the accessible name; the bilingual pairing rides
      // in the tooltip, where a mixed-script string is read by eyes rather
      // than announced letter-by-letter by a screen reader. The 回到頂部
      // half is carried by the dictionary in both locales.
      aria-label={t("backToTop.aria")}
      title={t("backToTop.title")}
      // bottom-16 on mobile clears the sticky order bar, exactly as
      // TestModeBadge does on the other side; sm:bottom-3 once that bar
      // is gone. `.btt` owns the transition, the hidden state, the
      // reduced-motion switch and the print rule — see globals.css for
      // why that cannot be done with utility classes here.
      className={`btt fixed bottom-16 right-3 z-[55] flex h-11 w-11 items-center justify-center rounded-full border border-gold/60 bg-ink text-gold-light shadow-lg hover:border-gold hover:bg-gold hover:text-ink sm:bottom-3 ${
        visible ? "" : "btt-hidden"
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 14.5 12 8.5l6 6" />
      </svg>
    </button>
  );
}
