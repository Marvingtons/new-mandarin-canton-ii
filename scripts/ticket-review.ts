/**
 * Before/after review renders for a ticket change: one PNG per COPY, so each
 * cut piece of paper can be looked at on its own.
 *
 *   npm run ticket:review -- <outDir> <label> <copies>
 *
 * e.g. `npm run ticket:review -- ticket-review/2026-11-14 after 2`. Run it on
 * the old commit with label "before" and on the new one with "after" to get a
 * matched pair for every scenario.
 *
 * The four scenarios are the ones the pickup-time rule turns on: an online
 * ASAP order (no time box), an online order for a chosen slot (PICKUP 5:30
 * PM), a phone order with no name and no time, and a phone order scheduled
 * for 5:30 PM (預訂 SCHEDULED). All four use the everyday four-dish order.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderTicket } from "../src/lib/ticket/render";
import { defaultCopyRoles } from "../src/lib/ticket/copies";
import type { Order } from "../src/lib/orders/types";
import { typicalOrder } from "./fixtures/orders";

const TIMEZONE = "America/Los_Angeles";

// Saturday 14 Nov 2026, 4:05 PM in Los Angeles (UTC-8).
const PLACED = "2026-11-15T00:05:00.000Z";
const ASAP_FROM = "2026-11-15T00:20:00.000Z"; // 4:20 PM
const ASAP_TO = "2026-11-15T00:25:00.000Z"; // 4:25 PM
const SLOT = "2026-11-15T01:30:00.000Z"; // 5:30 PM
const SLOT_TO = "2026-11-15T01:35:00.000Z";

async function scenarios(): Promise<{ name: string; order: Order }[]> {
  const base = await typicalOrder();
  const at = { createdAt: PLACED, updatedAt: PLACED, phoneVerifiedAt: PLACED };
  const asap = { pickupAt: ASAP_FROM, readyFrom: ASAP_FROM, readyTo: ASAP_TO };
  const slot = { pickupAt: SLOT, readyFrom: SLOT, readyTo: SLOT_TO };
  const phone = {
    channel: "phone" as const,
    station: "store" as const,
    orderNumber: "B-004",
  };
  return [
    {
      name: "online-asap",
      order: { ...base, ...at, ...asap, customer: { name: "Weeknight Pickup", phone: "+16195550101" } },
    },
    {
      name: "online-slot",
      order: {
        ...base,
        ...at,
        ...slot,
        customer: { name: "Weeknight Pickup", phone: "+16195550101", scheduledFor: SLOT },
      },
    },
    {
      name: "phone-noname-notime",
      order: { ...base, ...at, ...asap, ...phone, customer: { name: "", phone: "+16195550101" } },
    },
    {
      name: "phone-scheduled",
      order: {
        ...base,
        ...at,
        ...slot,
        ...phone,
        orderNumber: "B-005",
        customer: { name: "", phone: "+16195550101", scheduledFor: SLOT },
      },
    },
  ] as { name: string; order: Order }[];
}

async function main(): Promise<void> {
  const [outDir = "ticket-review", label = "after", copiesArg = "2"] = process.argv.slice(2);
  const copies = Number.parseInt(copiesArg, 10);
  const roles = defaultCopyRoles(copies);
  await mkdir(outDir, { recursive: true });
  for (const { name, order } of await scenarios()) {
    for (let copyIndex = 0; copyIndex < copies; copyIndex++) {
      const png = await renderTicket(order, {
        timezone: TIMEZONE,
        copies,
        copyIndex,
        copyRoles: roles,
      });
      const file = join(outDir, `${label}-${name}-${copyIndex + 1}-${roles[copyIndex]}.png`);
      await writeFile(file, png);
      console.log(`  ${file}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
