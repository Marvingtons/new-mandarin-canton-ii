import SectionHeading from "@/components/SectionHeading";
import type { MenuCategory, MenuItem } from "@/data/menu";

/**
 * Spicy indicator. Deliberately NOT the 辣 character it used to be:
 * a heat warning is functional UI, and a guest who can't read it gets
 * no warning at all. Dish names below keep their 中文 — that reads as
 * provenance, not as an untranslated label.
 */
export function SpicyMark() {
  return (
    <span className="inline-flex shrink-0 items-center self-center border border-lacquer/40 px-1 text-[0.55rem] uppercase leading-4 tracking-[0.12em] text-lacquer">
      Spicy
    </span>
  );
}

function MenuItemRow({ item }: { item: MenuItem }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-ink">{item.name}</span>
        {item.chineseName && (
          <span
            lang="zh-Hant"
            className="shrink-0 font-chinese text-sm text-ink/55"
          >
            {item.chineseName}
          </span>
        )}
        {item.spicy && <SpicyMark />}
        {/* Dotted leader line, classic menu typography */}
        <span
          aria-hidden="true"
          className="mx-1 min-w-6 flex-1 border-b border-dotted border-ink/35"
        />
        <span className="shrink-0 font-semibold text-lacquer">
          ${item.price.toFixed(2)}
        </span>
      </div>
      {item.description && (
        <p className="mt-1 max-w-[56ch] text-sm leading-relaxed text-ink/70">
          {item.description}
        </p>
      )}
    </div>
  );
}

interface MenuSectionProps {
  category: MenuCategory;
}

export default function MenuSection({ category }: MenuSectionProps) {
  return (
    <section id={category.id} className="scroll-mt-20 pt-12">
      <SectionHeading en={category.name} />
      <div className="mt-6 grid gap-x-12 gap-y-6 md:grid-cols-2">
        {category.items.map((item) => (
          <MenuItemRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
