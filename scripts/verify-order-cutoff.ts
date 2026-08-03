/**
 * The per-day online-order cutoff, pinned at the boundary minute on EVERY
 * day of the week.
 *
 * WHAT CHANGED, AND WHY THIS FILE GREW. The cutoff used to run ahead of
 * closing time, which made two days interesting: Sunday, the one day where
 * cutoff equalled close, and Saturday, where an 8:30 PM cutoff against a
 * 9:30 PM close left a full hour with the doors open and the website shut.
 * The owner has since set the cutoff TO the closing time on every day, so:
 *
 *  EVERY DAY IS THE ZERO-BUFFER DAY. An order can be placed in the same
 *  minute the doors lock, on any day, and the prep range then wants to
 *  quote 15–20 minutes past it (20–30 for a tray or a family dinner).
 *  readyWindow()'s cap at closing time is the ONLY thing preventing the
 *  site promising a pickup after close, seven nights a week. If someone
 *  removes it, this file fails rather than a customer arriving at a locked
 *  door.
 *
 *  THE GAP IS GONE. There is no longer a minute where the website refuses
 *  an order while the dining room is open, so the branch of closedMessage
 *  that covered it is unreachable by construction. That is asserted here
 *  too — as a property of the CONFIG, not of the copy — so that a future
 *  buffer is a test failure that points at the branch rather than a silent
 *  return of "we're closed" over a lit dining room.
 *
 * Run: npm run verify:order-cutoff
 */
import { restaurant } from "@/data/restaurant";
import type { DayOfWeek } from "@/data/restaurant";
import {
  hoursForDay,
  isAcceptingOrders,
  isOpenNow,
  pickupSlots,
  type PickupOptions,
} from "@/lib/order/pickup";
import { readyWindow } from "@/lib/order/readyWindow";
import { closedMessage } from "@/lib/order/gates";
import { todaysCutoff } from "@/lib/hours";

const OPTS: PickupOptions = {
  timezone: restaurant.timezone,
  leadMinutes: 20,
  intervalMinutes: 15,
};

/** A real instant at the given restaurant-local wall clock on a given date. */
function at(dateIso: string, hh: number, mm: number): Date {
  // The dates below are chosen so the weekday is what the label says in
  // America/Los_Angeles, and PDT (-07:00) is in force for all of them.
  return new Date(
    `${dateIso}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-07:00`,
  );
}

/**
 * One real date per weekday, all inside PDT. Every day is now a boundary
 * case, so every day needs a date to probe at.
 */
const DATE: Record<DayOfWeek, string> = {
  sunday: "2026-08-02",
  monday: "2026-08-03",
  tuesday: "2026-08-04",
  wednesday: "2026-08-05",
  thursday: "2026-08-06",
  friday: "2026-08-07",
  saturday: "2026-08-01",
};

const WEEK = Object.keys(DATE) as DayOfWeek[];

let pass = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail: string) {
  if (ok) {
    pass++;
  } else {
    failures.push(`  ${name}\n     ${detail}`);
  }
}

function minutesLocal(d: Date): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: restaurant.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) =>
    Number.parseInt(p.find((x) => x.type === t)?.value ?? "0", 10);
  return (get("hour") % 24) * 60 + get("minute");
}

/** The instant one minute before the day's cutoff. */
function justInside(day: DayOfWeek, lastOrder: number): Date {
  return at(DATE[day], Math.floor((lastOrder - 1) / 60), (lastOrder - 1) % 60);
}

/* ---------------------------------------------------- config sanity -- */

for (const day of WEEK) {
  const w = hoursForDay(day);
  if (!w) continue;
  check(
    `${day}: lastOrder within [open, close]`,
    w.lastOrder >= w.open && w.lastOrder <= w.close,
    `open=${w.open} lastOrder=${w.lastOrder} close=${w.close}`,
  );
  check(
    `${day}: the cutoff IS the closing time (owner-confirmed, no buffer)`,
    w.lastOrder === w.close,
    `lastOrder=${w.lastOrder} close=${w.close} — a buffer reappeared; the` +
      ` unreachable branch in closedMessage is live again and its copy needs review`,
  );
  check(
    `${day}: opens at 11:00 AM`,
    w.open === 11 * 60,
    `open=${w.open} minutes past midnight`,
  );
}

/* -------------------------- THE BOUNDARY MINUTE, ON EVERY DAY -------- */

for (const day of WEEK) {
  const w = hoursForDay(day);
  if (!w) continue;
  const probe = justInside(day, w.lastOrder);
  const label = `${day} ${Math.floor((w.lastOrder - 1) / 60)}:${String((w.lastOrder - 1) % 60).padStart(2, "0")}`;

  check(
    `${label} still accepts an order (one minute inside the cutoff)`,
    isAcceptingOrders(probe, OPTS),
    "the last orderable minute of the day was refused",
  );

  const slots = pickupSlots(probe, OPTS);
  check(
    `${label} offers slots, none of them after close`,
    slots.length > 0 &&
      slots.every(
        (s) =>
          s.value === "asap" ||
          Number.parseInt(s.value.slice(0, 2), 10) * 60 +
            Number.parseInt(s.value.slice(3), 10) <=
            w.close,
      ),
    `slots=${JSON.stringify(slots.map((s) => s.value))} close=${w.close}`,
  );

  // Standard prep: 15–20 minutes past a one-minute-to-close order.
  const std = readyWindow(probe, OPTS, false, null);
  check(
    `${label} standard ready window is clamped to close`,
    minutesLocal(std.to) <= w.close,
    `window ends at ${minutesLocal(std.to)}, close is ${w.close}`,
  );
  check(
    `${label} standard window is not backwards`,
    std.to.getTime() >= std.from.getTime(),
    `from=${std.from.toISOString()} to=${std.to.toISOString()}`,
  );

  // Long prep is the harsher case: 20–30 minutes past the same order.
  const long = readyWindow(probe, OPTS, true, null);
  check(
    `${label} LONG-PREP ready window is clamped to close`,
    minutesLocal(long.to) <= w.close,
    `window ends at ${minutesLocal(long.to)}, close is ${w.close}`,
  );
  check(
    `${label} long-prep window is not backwards`,
    long.to.getTime() >= long.from.getTime(),
    `from=${long.from.toISOString()} to=${long.to.toISOString()}`,
  );
  check(
    `${label} long-prep window is pinned at close, not merely under it`,
    minutesLocal(long.from) === w.close && minutesLocal(long.to) === w.close,
    `from=${minutesLocal(long.from)} to=${minutesLocal(long.to)} close=${w.close}`,
  );

  // One minute past the cutoff: refused, and no slots to tempt anyone.
  const past = at(DATE[day], Math.floor(w.close / 60), (w.close % 60) + 1);
  check(
    `${day} one minute past close no longer accepts`,
    !isAcceptingOrders(past, OPTS),
    "an order was accepted after closing time",
  );
  check(
    `${day} one minute past close offers no slots`,
    pickupSlots(past, OPTS).length === 0,
    "slots were offered after closing time",
  );
  check(
    `${day} one minute past close reports the doors shut`,
    !isOpenNow(past, OPTS),
    "isOpenNow disagreed with the closing time",
  );
}

/* ------------------------------- Saturday is the late day now -------- */

{
  const sat = hoursForDay("saturday");
  const fri = hoursForDay("friday");
  check(
    "saturday closes later than the rest of the week",
    !!sat && !!fri && sat.close > fri.close,
    `saturday close=${sat?.close} friday close=${fri?.close}`,
  );
  // 8:31 PM Saturday is past every OTHER day's cutoff and inside Saturday's.
  const satLate = at(DATE.saturday, 20, 31);
  check(
    "saturday 20:31 still accepts (its cutoff is 9:00 PM)",
    isAcceptingOrders(satLate, OPTS),
    "saturday's later cutoff is not being read",
  );
  check(
    "friday 20:31 refuses (its cutoff is 8:30 PM)",
    !isAcceptingOrders(at(DATE.friday, 20, 31), OPTS),
    "a weekday accepted an order past its cutoff",
  );
}

/* ---------------------------- the gap is gone, and stays gone -------- */

for (const day of WEEK) {
  const w = hoursForDay(day);
  if (!w) continue;
  check(
    `${day}: no minute exists where the site refuses and the doors are open`,
    w.lastOrder >= w.close,
    `cutoff ${w.lastOrder} is before close ${w.close}, so the gap is back`,
  );
  // Past close on any day, the refusal is the closed one and it names the
  // day's own hours rather than a hardcoded time.
  const msg = closedMessage(at(DATE[day], 22, 0), OPTS);
  const closeLabel = `${((Math.floor(w.close / 60) + 11) % 12) + 1}:${String(w.close % 60).padStart(2, "0")} PM`;
  check(
    `${day}: the post-close refusal names ${closeLabel} and invites a call`,
    msg.includes(closeLabel) && /call/i.test(msg),
    `message was: ${msg}`,
  );
}

/* -------------------- what the display surfaces are handed ----------- */

for (const day of WEEK) {
  const w = hoursForDay(day);
  if (!w) continue;
  const c = todaysCutoff(at(DATE[day], 12, 0));
  const expected = restaurant.hours[day].lastOnlineOrder;
  check(
    `${day}: todaysCutoff() reports ${expected}`,
    c?.label === expected,
    `got ${JSON.stringify(c)}`,
  );
  check(
    `${day}: the 中文 half gets the same clock without a meridiem`,
    !!c && c.bare === expected.replace(/\s*(AM|PM)$/i, "") && !/M$/.test(c.bare),
    `bare=${JSON.stringify(c?.bare)}`,
  );
}

const total = pass + failures.length;
console.log(`order cutoff: ${pass}/${total} checks passed`);
if (failures.length > 0) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
