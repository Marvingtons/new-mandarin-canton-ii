/**
 * The per-day online-order cutoff, pinned at the two days that can break.
 *
 * Two failure modes this exists to catch:
 *
 *  SUNDAY is the zero-buffer day. The doors shut at 8:30 PM and the cutoff
 *  is also 8:30 PM, so an order may be placed in the same minute the
 *  restaurant closes. Nothing may quote a pickup after close, and the only
 *  thing standing between us and that is readyWindow()'s cap. If someone
 *  removes the cap, this file fails rather than a customer arriving at a
 *  locked door.
 *
 *  SATURDAY is the opposite: doors until 9:30 PM, cutoff at 8:30 PM, so
 *  there is a full HOUR where the site refuses orders and the restaurant is
 *  open. Nothing in that hour may tell the customer we are closed.
 *
 * Run: npm run verify:order-cutoff
 */
import { restaurant } from "@/data/restaurant";
import {
  hoursForDay,
  isAcceptingOrders,
  isOpenNow,
  pickupSlots,
  type PickupOptions,
} from "@/lib/order/pickup";
import { readyWindow } from "@/lib/order/readyWindow";
import { closedMessage } from "@/lib/order/gates";

const OPTS: PickupOptions = {
  timezone: restaurant.timezone,
  leadMinutes: 20,
  intervalMinutes: 15,
};

/** A real instant at the given restaurant-local wall clock on a given date. */
function at(dateIso: string, hh: number, mm: number): Date {
  // The dates below are chosen so the weekday is what the label says in
  // America/Los_Angeles, and PDT (-07:00) is in force for all of them.
  return new Date(`${dateIso}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-07:00`);
}

/** 2026-08-02 is a Sunday; 2026-08-01 a Saturday; 2026-08-03 a Monday. */
const SUNDAY = "2026-08-02";
const SATURDAY = "2026-08-01";
const MONDAY = "2026-08-03";

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

/* ---------------------------------------------------- config sanity -- */

for (const day of Object.keys(restaurant.hours)) {
  const w = hoursForDay(day as keyof typeof restaurant.hours);
  if (!w) continue;
  check(
    `${day}: lastOrder within [open, close]`,
    w.lastOrder >= w.open && w.lastOrder <= w.close,
    `open=${w.open} lastOrder=${w.lastOrder} close=${w.close}`,
  );
  check(
    `${day}: a customer ordering one minute before the cutoff cannot be quoted a pickup after close`,
    (() => {
      const probe = at(
        day === "saturday" ? SATURDAY : day === "sunday" ? SUNDAY : MONDAY,
        Math.floor((w.lastOrder - 1) / 60),
        (w.lastOrder - 1) % 60,
      );
      const win = readyWindow(probe, OPTS, true, null);
      return minutesLocal(win.to) <= w.close;
    })(),
    `long-prep window overran close on ${day}`,
  );
}

/* ------------------------------------------------------ SUNDAY 8:30 -- */

{
  const justBefore = at(SUNDAY, 20, 29);
  check(
    "sunday 20:29 still accepts an order",
    isAcceptingOrders(justBefore, OPTS),
    "expected the zero-buffer day to accept right up to the cutoff",
  );

  const slots = pickupSlots(justBefore, OPTS);
  check(
    "sunday 20:29 offers ASAP and no post-close slot",
    slots.length > 0 &&
      slots.every((s) => s.value === "asap" || s.value <= "20:30"),
    `slots=${JSON.stringify(slots.map((s) => s.value))}`,
  );

  // The whole point: an ASAP order here would naturally land at 20:49.
  const w = readyWindow(justBefore, OPTS, false, null);
  check(
    "sunday ASAP ready window never passes closing",
    minutesLocal(w.to) <= 20 * 60 + 30,
    `window ends at ${minutesLocal(w.to)} min, close is ${20 * 60 + 30}`,
  );
  check(
    "sunday ASAP window is not backwards",
    w.to.getTime() >= w.from.getTime(),
    `from=${w.from.toISOString()} to=${w.to.toISOString()}`,
  );

  // Long prep is the harsher case: 20-30 minutes past a 20:29 order.
  const long = readyWindow(justBefore, OPTS, true, null);
  check(
    "sunday long-prep ready window never passes closing",
    minutesLocal(long.to) <= 20 * 60 + 30,
    `window ends at ${minutesLocal(long.to)} min`,
  );

  check(
    "sunday 20:31 no longer accepts",
    !isAcceptingOrders(at(SUNDAY, 20, 31), OPTS),
    "past close and past cutoff",
  );
}

/* ---------------------------------------------------- SATURDAY hour -- */

{
  const inTheGap = at(SATURDAY, 21, 0);
  check(
    "saturday 21:00 refuses online orders",
    !isAcceptingOrders(inTheGap, OPTS),
    "8:30 PM cutoff should already have passed",
  );
  check(
    "saturday 21:00 the doors are still open",
    isOpenNow(inTheGap, OPTS),
    "saturday closes at 9:30 PM",
  );
  check(
    "saturday 21:00 offers no slots",
    pickupSlots(inTheGap, OPTS).length === 0,
    "past the cutoff nothing is offerable",
  );

  // The copy shown in that hour must not claim the restaurant is closed.
  const msg = closedMessage(inTheGap, OPTS);
  check(
    "saturday gap message does not say we are closed",
    !/we're closed/i.test(msg),
    `message was: ${msg}`,
  );
  check(
    "saturday gap message names the cutoff and invites a call",
    msg.includes("8:30 PM") && /call/i.test(msg),
    `message was: ${msg}`,
  );
}

/* -------------------------------------------------- ordinary weekday -- */

{
  check(
    "monday 20:29 still accepts (cutoff 8:30, close 9:00)",
    isAcceptingOrders(at(MONDAY, 20, 29), OPTS),
    "",
  );
  check(
    "monday 20:31 refuses",
    !isAcceptingOrders(at(MONDAY, 20, 31), OPTS),
    "",
  );
  const msg = closedMessage(at(MONDAY, 20, 45), OPTS);
  check(
    "monday gap message does not say we are closed",
    !/we're closed/i.test(msg),
    `message was: ${msg}`,
  );
}

const total = pass + failures.length;
console.log(`order cutoff: ${pass}/${total} checks passed`);
if (failures.length > 0) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
