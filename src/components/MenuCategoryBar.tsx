"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface MenuCategoryBarItem {
  id: string;
  name: string;
}

const prefersReduced = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Sticky category bar for the menu page.
 *
 * Jumping to a category is the browser's own scroll: scrollIntoView honours
 * the section's scroll-margin-top (see .menu-section), so the landing offset
 * lives in CSS and nothing here computes one. Wheel and touch are never
 * touched. Beyond that the component owns the bar itself — which pill reads
 * as active, keeping that pill in view inside its own horizontal scroller,
 * and the edge fades and chevrons that say there is more bar that way.
 *
 * The one piece of state that isn't purely derived: after a pill is clicked
 * the active mark commits to the destination straight away and the spy is
 * held off until the scroll settles, so the highlight doesn't flick through
 * every category the page passes on the way down.
 */
export default function MenuCategoryBar({
  items,
}: {
  items: MenuCategoryBarItem[];
}) {
  const navRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLUListElement>(null);
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  // Set on click, cleared once the scroll settles or the user takes over.
  const spyHeldRef = useRef(false);

  // ---- edge affordances: is there more bar to the left / right? ----
  const measureEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 1);
    // max <= 1 means it all fits: both edges are "at" and no chevrons show.
    setAtEnd(el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measureEdges();
    el.addEventListener("scroll", measureEdges, { passive: true });
    window.addEventListener("resize", measureEdges);
    const ro = new ResizeObserver(measureEdges);
    ro.observe(el);
    // Pill widths move when the display face swaps in, which changes
    // scrollWidth without changing the scroller's own box — the observer
    // above would never see it.
    void document.fonts?.ready.then(measureEdges);
    return () => {
      el.removeEventListener("scroll", measureEdges);
      window.removeEventListener("resize", measureEdges);
      ro.disconnect();
    };
  }, [measureEdges]);

  // ---- scroll spy: the last section whose top has passed under the bar ----
  useEffect(() => {
    let idle: ReturnType<typeof setTimeout> | undefined;

    const spy = () => {
      const nav = navRef.current;
      if (!nav) return;
      const line = nav.getBoundingClientRect().bottom + 8;
      let current = items[0]?.id ?? "";
      for (const { id } of items) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      setActiveId(current);
    };

    const onScroll = () => {
      if (!spyHeldRef.current) spy();
      // Whether held or not, a pause in scrolling ends the hold.
      clearTimeout(idle);
      idle = setTimeout(() => {
        spyHeldRef.current = false;
        spy();
      }, 140);
    };
    // A deliberate gesture takes the highlight back immediately.
    const release = () => {
      spyHeldRef.current = false;
    };

    spy();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", spy);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchstart", release, { passive: true });
    return () => {
      clearTimeout(idle);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", spy);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchstart", release);
    };
  }, [items]);

  // ---- keep the active pill in view, inside the scroller only ----
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !activeId) return;
    const pill = el.querySelector<HTMLElement>(`[data-cat="${activeId}"]`);
    if (!pill) return;
    // Deliberately not scrollIntoView: that walks up the ancestor chain and
    // would scroll the page as well as the bar.
    const max = el.scrollWidth - el.clientWidth;
    const centred = pill.offsetLeft - (el.clientWidth - pill.offsetWidth) / 2;
    const left = Math.max(0, Math.min(centred, max));
    if (Math.abs(left - el.scrollLeft) < 2) return;
    el.scrollTo({ left, behavior: prefersReduced() ? "auto" : "smooth" });
  }, [activeId]);

  const jumpTo = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    // Leave modified clicks alone — open-in-new-tab and friends still work.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    // Commit the mark now; the page is still travelling.
    spyHeldRef.current = true;
    setActiveId(id);
    // The section's own scroll-margin-top is the whole landing offset.
    // behavior is passed explicitly because Next leaves an inline
    // `scroll-behavior: auto` on <html> after hydration, which would
    // otherwise decide this for us.
    target.scrollIntoView({
      behavior: prefersReduced() ? "auto" : "smooth",
      block: "start",
    });
    history.replaceState(null, "", `#${id}`);
    // The section is tabIndex -1, so this is where a keyboard user resumes.
    target.focus({ preventScroll: true });
  };

  const page = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * el.clientWidth * 0.7,
      behavior: prefersReduced() ? "auto" : "smooth",
    });
  };

  return (
    <nav
      ref={navRef}
      aria-label="Menu categories"
      className="cat-bar sticky top-0 z-40 bg-background"
    >
      <div className="relative mx-auto flex h-full max-w-5xl items-center px-4">
        <ul
          ref={scrollerRef}
          // Lenis would otherwise swallow the wheel here; letting it through
          // is what lets a wheel over the bar scroll the bar.
          data-lenis-prevent
          data-at-start={atStart}
          data-at-end={atEnd}
          // min-w-0 so the flex item may shrink below its content width —
          // without it the row would push the bar wide instead of scrolling.
          className="cat-scroller flex min-w-0 flex-1 gap-1 text-sm"
        >
          {items.map(({ id, name }) => {
            const active = id === activeId;
            return (
              <li key={id}>
                <a
                  href={`#${id}`}
                  data-cat={id}
                  aria-current={active ? "true" : undefined}
                  onClick={(e) => jumpTo(e, id)}
                  className={`cat-link token-colors whitespace-nowrap px-3 py-1 font-semibold text-lacquer ${
                    active ? "cat-link-active" : ""
                  }`}
                >
                  {name}
                </a>
              </li>
            );
          })}
        </ul>

        {/* Pointer affordances only: every category these reach is already a
            tab stop in the list above, so they stay out of the a11y tree
            rather than duplicating the whole nav for screen readers. */}
        <Chevron dir={-1} hidden={atStart} onClick={() => page(-1)} />
        <Chevron dir={1} hidden={atEnd} onClick={() => page(1)} />
      </div>
    </nav>
  );
}

function Chevron({
  dir,
  hidden,
  onClick,
}: {
  dir: -1 | 1;
  hidden: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-hidden="true"
      tabIndex={-1}
      onClick={onClick}
      className={`cat-chevron ${dir === -1 ? "cat-chevron-start" : "cat-chevron-end"} ${
        hidden ? "cat-chevron-off" : ""
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={dir === -1 ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
      </svg>
    </button>
  );
}
