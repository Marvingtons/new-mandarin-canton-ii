"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import Seal from "@/components/Seal";
import { restaurant } from "@/data/restaurant";
import { getHeaderSolid, subscribeHeaderSolid } from "@/lib/headerState";

const links = [
  { href: "/", label: "Home" },
  { href: "/menu", label: "Menu" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;

const subscribeScroll = (cb: () => void): (() => void) => {
  window.addEventListener("scroll", cb, { passive: true });
  window.addEventListener("resize", cb);
  return () => {
    window.removeEventListener("scroll", cb);
    window.removeEventListener("resize", cb);
  };
};

/** True once the viewport has scrolled past (most of) the 100svh hero. */
function useScrolledPastHero(): boolean {
  return useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > window.innerHeight - 96,
    () => false,
  );
}

export default function Header() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const scrolledPast = useScrolledPastHero();
  // Primary signal: the hero-exit ScrollTrigger (see HomeChoreography).
  // The plain scroll threshold stays as the reduced-motion fallback,
  // where no triggers run; the two are OR'd and always agree.
  const triggerSolid = useSyncExternalStore(
    subscribeHeaderSolid,
    getHeaderSolid,
    () => false,
  );
  // ONE behaviour, two states: transparent while it floats over the hero,
  // solid lacquer with a gold hairline everywhere else — scrolled past the
  // hero, or on any subpage, which is the same state reached two ways.
  //
  // Both states are the same height by construction: py-4, border-b-2 in
  // both (transparent, not absent, over the hero), and the same lockup, so
  // the transition is a pure colour change with nothing to reflow.
  //
  // Positioning is the one thing that differs by route: fixed on the home
  // page, where the 100svh hero is meant to run under it, and static
  // elsewhere, where a fixed header would sit on top of the menu page's
  // own sticky category nav.
  const overHero = isHome && !scrolledPast && !triggerSolid;

  return (
    <header
      className={`border-b-2 text-ivory transition-colors duration-300 ${
        isHome ? "fixed inset-x-0 top-0 z-50" : ""
      } ${overHero ? "border-transparent bg-transparent" : "border-gold/60 bg-lacquer"}`}
    >
      <div className="container-wide flex flex-col items-center gap-3 py-4 sm:flex-row sm:justify-between">
        <Link href="/" className="brand-link flex items-center gap-3">
          <Seal size={40} className="brand-seal shrink-0" />
          <span className="text-left">
            <span className="block font-display text-2xl leading-tight">
              {restaurant.name}
            </span>
            {restaurant.chineseName && (
              <span
                lang="zh-Hant"
                className="mt-0.5 block font-chinese text-sm tracking-[0.4em] text-gold-light"
              >
                {restaurant.chineseName}
              </span>
            )}
          </span>
        </Link>
        <nav aria-label="Main">
          <ul className="flex gap-5 text-xs uppercase tracking-[0.15em] sm:gap-6 sm:text-sm">
            {links.map(({ href, label }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`nav-link token-colors ${
                      active
                        ? "nav-link-active text-gold-light"
                        : "hover:text-gold-light"
                    }`}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
