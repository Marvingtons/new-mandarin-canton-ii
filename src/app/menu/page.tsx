import type { Metadata } from "next";
import SectionHeading from "@/components/SectionHeading";
import MenuCategoryBar from "@/components/MenuCategoryBar";
import MenuHeadings from "@/components/MenuHeadings";
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
      <MenuHeadings />
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

      {/* Category jump nav — sticks under the top of the viewport. The header
          is static on this page and scrolls away, so this is the only bar. */}
      <MenuCategoryBar
        items={[...menu, ...combos].map(({ id, name }) => ({ id, name }))}
      />

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
