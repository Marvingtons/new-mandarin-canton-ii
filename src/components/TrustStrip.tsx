import { restaurant } from "@/data/restaurant";

/**
 * A quiet band of trust signals under the hero. It renders ONLY facts we
 * can stand behind: some are derived from confirmed data (open 7 days,
 * cuisines), the rest are gated behind `restaurant.features` and stay
 * dark until the owner confirms them — we never print an amenity or a
 * score the restaurant hasn't verified. Fill in a value in restaurant.ts
 * and its chip appears here on its own.
 */

/** "N+ years" bucketed down to a round decade, or a plain fallback. */
function tenureLabel(foundingYear: number | null): string {
  if (foundingYear == null) return "Family-run";
  const years = new Date().getFullYear() - foundingYear;
  if (years < 1) return "Family-run";
  const bucket = Math.floor(years / 10) * 10;
  return bucket >= 10 ? `Family-run · ${bucket}+ years` : "Family-run";
}

function openEveryDay(): boolean {
  return (Object.values(restaurant.hours) as { closed?: boolean }[]).every(
    (h) => !h.closed,
  );
}

export default function TrustStrip() {
  const f = restaurant.features;

  // Order matters: derived/confirmed facts first, gated facts after.
  const facts: string[] = [
    tenureLabel(f.foundingYear),
    ...(openEveryDay() ? ["Open 7 days"] : []),
    restaurant.cuisines.join(" · "),
    ...(f.healthScore != null ? [`Health Score ${f.healthScore}/100`] : []),
    ...(f.beerWine === true ? ["Beer & Wine"] : []),
    ...(f.freeParking === true ? ["Free Parking"] : []),
    ...(f.familyFriendly === true ? ["Family-friendly"] : []),
    ...(f.takesReservations === true ? ["Reservations welcome"] : []),
  ];

  return (
    <section
      aria-label="At a glance"
      className="border-b border-gold/30 bg-cream"
    >
      <ul className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 py-4 text-[0.7rem] uppercase tracking-[0.18em] text-ink/70 sm:text-xs">
        {facts.map((fact, i) => (
          <li key={fact} className="flex items-center gap-3">
            {i > 0 && (
              <span aria-hidden="true" className="text-gold">
                ·
              </span>
            )}
            <span>{fact}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
