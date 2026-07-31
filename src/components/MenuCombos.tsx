import SectionHeading from "@/components/SectionHeading";
import type { ComboSection, ComboSet } from "@/data/menu";
import { formatCents } from "@/lib/money";

/**
 * Renders a prix-fixe / combination section (Lunch Specials, Family
 * Dinners, Big Family Dinner). These sets don't fit the single-price
 * MenuItem row — each carries a "served with" line, a choose-your-entrée
 * list, labeled courses, or a fixed dish list — so they get their own
 * card layout here rather than being forced into MenuSection.
 */

function Price({ set }: { set: ComboSet }) {
  return (
    <span className="shrink-0 font-semibold text-lacquer">
      {formatCents(set.priceCents)}
      {set.priceUnit && (
        <span className="ml-1 text-sm font-normal text-ink/60">
          {set.priceUnit}
        </span>
      )}
    </span>
  );
}

function ComboCard({ set }: { set: ComboSet }) {
  return (
    <div className="rounded-md border border-gold/40 bg-cream px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl text-ink">{set.name}</h3>
        <Price set={set} />
      </div>
      {set.serves && (
        <p className="mt-1 text-sm text-ink/60">{set.serves}</p>
      )}

      {set.sides && set.sides.length > 0 && (
        <p className="mt-3 text-sm leading-relaxed text-ink/75">
          Served with {set.sides.join(", ")}.
        </p>
      )}

      {set.courses && (
        <dl className="mt-3 space-y-1 text-sm leading-relaxed">
          {set.courses.map((course) => (
            <div key={course.label} className="flex gap-2">
              <dt className="shrink-0 font-semibold text-ink">
                {course.label}:
              </dt>
              <dd className="text-ink/75">{course.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {set.dishes && (
        <ul className="mt-3 space-y-1 text-sm leading-relaxed text-ink/75">
          {set.dishes.map((dish) => (
            <li key={dish}>{dish}</li>
          ))}
        </ul>
      )}

      {set.choices && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/55">
            Choose your entrée
          </p>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm text-ink/80 sm:grid-cols-2">
            {set.choices.map((choice) => (
              <li key={choice.name}>
                {choice.name}
                {/* The printed menu's "Except Noodle & Rice" rule, shown
                    against the entrées it actually applies to. */}
                {choice.noRiceSide && (
                  <span className="text-ink/55"> — no rice side</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {set.addOns && (
        <dl className="mt-3 space-y-1 border-t border-gold/30 pt-3 text-sm">
          {set.addOns.map((addOn) => (
            <div key={addOn.label} className="flex gap-2">
              <dt className="shrink-0 text-ink/60">{addOn.label}, add:</dt>
              <dd className="font-medium text-ink/80">{addOn.dish}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

interface MenuCombosProps {
  section: ComboSection;
}

export default function MenuCombos({ section }: MenuCombosProps) {
  return (
    <section id={section.id} tabIndex={-1} className="menu-section">
      <SectionHeading en={section.name} />
      {section.note && (
        <p className="mt-3 max-w-2xl text-sm italic text-ink/60">
          {section.note}
        </p>
      )}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {section.sets.map((set) => (
          <ComboCard key={set.id} set={set} />
        ))}
      </div>
    </section>
  );
}
