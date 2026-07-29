import type { Metadata } from "next";
import SectionHeading from "@/components/SectionHeading";
import MenuNavigator from "@/components/MenuNavigator";
import MenuSection from "@/components/MenuSection";
import MenuCombos from "@/components/MenuCombos";
import { menu, combos } from "@/data/menu";
import PhoneLinks from "@/components/PhoneLinks";

export const metadata: Metadata = {
  title: "Menu",
};

export default function MenuPage() {

  return (
    <>
      <MenuNavigator />
      <div className="mx-auto max-w-5xl px-4 pb-5 pt-8">
        <SectionHeading as="h1" en="Menu" />
        {/* TODO: current items are examples — swap in the real menu (later pass) */}
        <p className="mt-4 text-sm italic text-ink/60">
          Prices and availability subject to change — please call{" "}
          <PhoneLinks
            separator=" or "
            className="whitespace-nowrap text-lacquer underline decoration-gold underline-offset-2 transition-colors hover:text-lacquer-dark"
          />
          .
        </p>
      </div>

      {/* Category jump nav — sticks under the top of the viewport */}
      <nav
        aria-label="Menu categories"
        className="sticky top-0 z-40 border-y border-gold/40 bg-ivory/95 backdrop-blur"
      >
        <ul
          data-lenis-prevent
          className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 py-3 text-sm"
        >
          {[...menu, ...combos].map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="cat-link token-colors whitespace-nowrap border border-transparent px-3 py-1 font-semibold text-lacquer hover:border-gold/60"
              >
                {section.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mx-auto max-w-5xl px-4 pb-20">
        {menu.map((category) => (
          <MenuSection key={category.id} category={category} />
        ))}
        {combos.map((section) => (
          <MenuCombos key={section.id} section={section} />
        ))}
      </div>
    </>
  );
}
