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

/** Weekly hours with today's row highlighted (resolved client-side). */
export default function HoursTable() {
  const today = useToday();

  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">Weekly opening hours</caption>
      <tbody>
        {week.map((day) => {
          const h = restaurant.hours[day];
          const isToday = day === today;
          return (
            <tr
              key={day}
              className={`border-b border-ink/10 ${isToday ? "bg-gold/15" : ""}`}
            >
              <th
                scope="row"
                className={`py-2.5 pl-2 pr-4 text-left font-semibold ${isToday ? "text-lacquer" : "text-ink"}`}
              >
                {label[day]}
                {isToday && (
                  <span className="ml-2 border border-gold px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-lacquer">
                    Today
                  </span>
                )}
              </th>
              <td className="py-2.5 pr-2 text-right text-ink/80">
                {h.closed ? "Closed" : `${h.open} – ${h.close}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
