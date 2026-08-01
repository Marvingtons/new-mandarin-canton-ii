import SectionHeading from "@/components/SectionHeading";
import { SpicyMark } from "@/components/SpicyMark";
import type { MenuCategory, MenuItem } from "@/data/menu";
import { formatCents } from "@/lib/money";

/**
 * The right-hand price. One figure for most dishes; the printed menu's own
 * two-way pricing (Roasted Duck half/whole, Egg Drop Soup cup/bowl) reads as
 * "Half $20.00 / Whole $38.00", exactly as it does on paper.
 */
function ItemPrice({ item }: { item: MenuItem }) {
  const text = item.sizes
    ? item.sizes.map((s) => `${s.label} ${formatCents(s.priceCents)}`).join(" / ")
    : formatCents(item.priceCents);
  return <span className="shrink-0 font-semibold text-lacquer">{text}</span>;
}

function MenuItemRow({ item }: { item: MenuItem }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-ink">{item.name}</span>
        {item.spicy && <SpicyMark />}
        {/* Dotted leader line, classic menu typography */}
        <span
          aria-hidden="true"
          className="mx-1 min-w-6 flex-1 border-b border-dotted border-ink/35"
        />
        <ItemPrice item={item} />
      </div>
      {item.description && (
        <p className="mt-1 max-w-[56ch] text-sm leading-relaxed text-ink/70">
          {item.description}
        </p>
      )}
      {/* Printed add-ons, priced from the same field the cart charges. */}
      {item.modifiers?.map((m) => (
        <p key={m.id} className="mt-1 text-sm italic text-ink/60">
          {m.name} {formatCents(m.priceCents)} extra
        </p>
      ))}
      {item.trayCents !== undefined && (
        <p className="mt-1 text-sm text-ink/55">
          Party tray {formatCents(item.trayCents)}
        </p>
      )}
    </div>
  );
}

interface MenuSectionProps {
  category: MenuCategory;
}

export default function MenuSection({ category }: MenuSectionProps) {
  // tabIndex -1 so a jump to #id moves focus here as well as the viewport,
  // which is the browser's own behaviour for a focusable anchor target.
  return (
    <section id={category.id} tabIndex={-1} className="menu-section">
      <SectionHeading en={category.name} />
      {category.note && (
        <p className="mt-3 text-sm italic text-ink/60">{category.note}</p>
      )}
      <div className="mt-6 grid gap-x-12 gap-y-6 md:grid-cols-2">
        {category.items.map((item) => (
          <MenuItemRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
