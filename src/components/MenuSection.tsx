import BilingualHeading from "@/components/BilingualHeading";
import type { MenuCategory, MenuItem } from "@/data/menu";

// Chinese pairings for category headings (presentational copy only —
// generic culinary words, not dish names). TODO: have the family verify.
const categoryZh: Record<string, string> = {
  chicken: "雞類",
  beef: "牛類",
  pork: "豬類",
  seafood: "海鮮",
  vegetables: "蔬菜",
  "fried-rice": "炒飯",
  noodles: "麵類",
  "mandarin-specialties": "招牌菜",
};

/** Small 辣 mark for spicy dishes, the way Chinese menus do it. */
export function SpicyMark() {
  return (
    <span
      title="Spicy"
      lang="zh-Hant"
      className="inline-flex shrink-0 items-center self-center border border-lacquer/40 px-1 font-chinese text-[0.65rem] leading-4 text-lacquer"
    >
      辣<span className="sr-only"> (spicy)</span>
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
      <BilingualHeading en={category.name} zh={categoryZh[category.id]} />
      <div className="mt-6 grid gap-x-12 gap-y-6 md:grid-cols-2">
        {category.items.map((item) => (
          <MenuItemRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
