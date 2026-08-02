"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Seal from "@/components/Seal";
import LocaleToggle from "@/components/LocaleToggle";
import { restaurant } from "@/data/restaurant";
import { usePastHero } from "@/lib/headerState";
import { useT } from "@/lib/i18n/LocaleContext";
import type { TranslationKey } from "@/lib/i18n/dictionary";

const links = [
  { href: "/", key: "nav.home" },
  { href: "/menu", key: "nav.menu" },
  { href: "/about", key: "nav.about" },
  { href: "/contact", key: "nav.contact" },
] as const satisfies readonly { href: string; key: TranslationKey }[];

export default function Header() {
  const t = useT();
  const pathname = usePathname();
  const isHome = pathname === "/";
  // Primary signal: the hero-exit ScrollTrigger (see HomeChoreography),
  // OR'd with a plain scroll threshold as the reduced-motion fallback.
  // Lives in lib/headerState so the mobile StickyOrderBar — which appears
  // at the same moment — cannot end up reading a different threshold.
  const pastHero = usePastHero();
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
  const overHero = isHome && !pastHero;

  return (
    <header
      className={`border-b-2 text-ivory transition-colors duration-300 ${
        isHome ? "fixed inset-x-0 top-0 z-50" : ""
      } ${overHero ? "border-transparent bg-transparent" : "border-gold/60 bg-lacquer"}`}
    >
      <div className="container-wide flex flex-col items-center gap-3 py-4 sm:flex-row sm:justify-between">
        {/* ONE link, ONE hover. It was already a single <Link>, but the
            only thing that answered the pointer was the seal's rotate, so
            the name and the 富源 under it read as inert text that happened
            to sit next to a control. Both lines now shift toward gold with
            it (see .brand-link in globals.css), which is what makes the
            three pieces read as one target.

            The stack is explicit — flex column, both lines' leading
            declared — so the pair cannot drift apart the way an inherited
            leading can. Measured before touching it: the seal's centre and
            the text block's centre were both y=42, and both lines already
            began at x=92.2, so the alignment was not what was wrong here.
            Heights are unchanged (30 + 2 + 20 = 52px) on purpose: the
            header is 86px in both states and the hero, the scroll-past
            threshold and the menu page's sticky offsets are all measured
            against that. */}
        <Link href="/" className="brand-link flex items-center gap-3">
          <Seal size={40} className="brand-seal shrink-0" />
          <span className="flex flex-col justify-center text-left">
            <span className="brand-name font-display text-2xl leading-[30px]">
              {restaurant.name}
            </span>
            {restaurant.chineseName && (
              <span
                lang="zh-Hant"
                className="brand-zh mt-0.5 font-chinese text-sm leading-[20px] tracking-[0.4em] text-gold-light"
              >
                {restaurant.chineseName}
              </span>
            )}
          </span>
        </Link>
        {/* gap-8/10 here against the nav's own gap-5/6: the language pill
            sat exactly 24px after CONTACT, the same interval the four
            links use between themselves, which is most of why it read as
            items five and six. 40px at sm puts it outside the rhythm. */}
        <div className="flex items-center gap-8 sm:gap-10">
          <nav aria-label={t("nav.aria")}>
            <ul className="flex gap-5 text-xs uppercase tracking-[0.15em] sm:gap-6 sm:text-sm">
              {links.map(({ href, key }) => {
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
                      {t(key)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <LocaleToggle />
        </div>
      </div>
    </header>
  );
}
