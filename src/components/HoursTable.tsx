"use client";

import { useSyncExternalStore } from "react";
import { restaurant } from "@/data/restaurant";
import type { DayOfWeek } from "@/data/restaurant";

const week: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** Index matches Date.prototype.getDay() (0 = Sunday). */
const byJsDay: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const label: Record<DayOfWeek, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const emptySubscribe = (): (() => void) => () => {};

/** Today's day of week — null on the server so hydration stays consistent. */
function useToday(): DayOfWeek | null {
  return useSyncExternalStore(
    emptySubscribe,
    () => byJsDay[new Date().getDay()],
    () => null,
  );
}

interface HoursTableProps {
  /** "light" for paper/cream pages, "dark" for the ink footer. */
  tone?: "light" | "dark";
  /** Compact rows, for the footer column. */
  dense?: boolean;
  className?: string;
}

/**
 * Weekly hours from `restaurant.hours` with today's row highlighted
 * (resolved client-side so the server render can't bake a stale day).
 *
 * This is the site's only per-day hours table. The footer used to keep a
 * second hand-rolled copy of the same loop.
 */
export default function HoursTable({
  tone = "light",
  dense = false,
  className = "",
}: HoursTableProps) {
  const today = useToday();
  const dark = tone === "dark";
  const pad = dense ? "py-1.5" : "py-2.5";
  // Every row the same height whatever it holds, so the week reads as a
  // rhythm and the highlighted row doesn't nudge the ones under it.
  const rowH = dense ? "h-9" : "h-12";

  return (
    <table className={`w-full border-collapse text-sm ${className}`}>
      <caption className="sr-only">Weekly opening hours</caption>
      <tbody>
        {week.map((day) => {
          const h = restaurant.hours[day];
          const isToday = day === today;
          return (
            <tr
              key={day}
              className={`${rowH} ${dark ? "border-ivory/10" : "border-ink/10"} border-b ${
                isToday ? "bg-gold/15" : ""
              }`}
            >
              <th
                scope="row"
                className={`${pad} pl-2 pr-4 text-left font-semibold ${
                  isToday
                    ? dark
                      ? "text-gold-light"
                      : "text-lacquer"
                    : dark
                      ? "text-ivory"
                      : "text-ink"
                }`}
              >
                {dense ? label[day].slice(0, 3) : label[day]}
                {isToday && !dense && (
                  <span className="ml-2 rounded-sm border border-gold px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-lacquer">
                    Today
                  </span>
                )}
              </th>
              <td
                className={`${pad} whitespace-nowrap pr-2 text-right tabular-nums ${dark ? "text-ivory/80" : "text-ink/80"}`}
              >
                {h.closed ? "Closed" : `${h.open} – ${h.close}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
