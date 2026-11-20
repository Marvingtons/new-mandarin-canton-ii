# POS and ticket changes, 2026-11-20

Eight commits on `main`, one per numbered item, on top of `034b7c0`. Nothing
pushed, nothing deployed, no migration.

| # | Commit | What |
|---|---|---|
| 1 | `532b8ba` | No 廚房 KITCHEN / 收銀 REGISTER bands on either copy; a filled `$` badge, the order number's height, top right on the B-001 row, on the register copy only |
| 2 | `32fa920` | 中文 dish name 30 regular to 38 bold (the English is 34 bold); 備註 NOTE label 22 to 18, the note itself 27 regular to 34 bold |
| 3 | `e24ec2b` | 自訂 Custom tile and sheet; 加價 Add charge on a dish line; stored in the existing `items` jsonb |
| 4 | `ffa4b12` | Landscape (1000px and wider) is the primary layout: chip row, one-row strip, 4 / 5 columns, 340px ticket, one-line banners |
| 5 | `46265c4` | Portrait (under 1000px): 中文-only rail, two columns, ticket as a bottom bar that opens into a sheet |
| 6 | `6e44cff` | No sideways page scroll; nested sheets keep the keyboard; 44px floor everywhere |
| 7 | `7b0123f` | Browser tests; staff ticket route can return one copy as text |
| 8 | this commit | Screenshots, this report, three tile fixes found while taking them |

## A. Ticket

Before and after for the owner's order (B-001, phone, 陳皮雞 with fried rice
and 加辣, 2 x Beef with Broccoli with 一辣), one PNG per copy as it is cut:

| | Kitchen copy | Register copy |
|---|---|---|
| Before | [before-phone-notes-1-kitchen.png](../ticket-review/2026-11-20/before-phone-notes-1-kitchen.png) | [before-phone-notes-2-register.png](../ticket-review/2026-11-20/before-phone-notes-2-register.png) |
| After | [after-phone-notes-1-kitchen.png](../ticket-review/2026-11-20/after-phone-notes-1-kitchen.png) | [after-phone-notes-2-register.png](../ticket-review/2026-11-20/after-phone-notes-2-register.png) |

The other four review scenarios (online ASAP, online slot, phone with no
name, phone scheduled) are in the same folder, before and after.
Regenerate with `npm run ticket:review -- ticket-review/2026-11-20 after 2`.

**Glyphs.** `verify:ticket-glyphs`: zero missing across every source that can
reach a ticket. The badge is a Latin `$`; the 加價 chips (加飯 加蝦 加肉 加辣)
are already in the subset. 其他 Other is not a name and never prints. A name
typed freely on the custom sheet behaves exactly like a typed note: a
character outside the subset prints as a box and is logged.

**Raster limit.** One StarPRNT job is capped at 512 KB, which at 576px is
7278 rows. Per-copy heights from `ticket:heights` (kitchen + register):

| Fixture | Before | After |
|---|---|---|
| typical (A-001 shape) | 876 + 1138 = 2014px | 814 + 1083 = 1897px |
| baseline sample | 1240 + 1454 = 2694px | 1275 + 1496 = 2771px |
| 12-line party tray | 1936 + 2240 = 4176px | 1952 + 2261 = 4213px |
| full-menu breadth (tallest) | 2663 + 2966 = 5629px | 2707 + 3016 = 5723px |

The tallest fixture is 79% of one job; `ticket:sample` round-trips every
fixture through the StarPRNT encoder with 0 mismatches and every payload under
the cap, and `verify:print-split` passes 88/88.

## B. Custom charge

- **自訂 Custom** is the first tile in 招牌菜 Specials and answers a search for
  "custom" (or 自訂). Its sheet: a name (this tablet's last one, or a chip:
  加飯 Extra rice, 加蝦 Extra shrimp, 加肉 Extra meat, 加辣 Extra spicy; 其他
  Other clears the field for typing), a cents-first keypad (3, 0, 0 is $3.00;
  $0.00 allowed), quantity, note.
- **加價 Add charge** is a section of every dish's sheet (amount and label,
  per unit), so the dish stays one line. The register copy prints the side
  line as `● 加蝦 / Extra shrimp +$3.00`; the kitchen copy without the price.
- **Storage, no schema change.** A custom line is an ordinary `OrderLine` in
  `items` with `itemId: "custom"` and `custom: true`; a surcharge is one more
  entry in the line's `modifiers` (`id: "surcharge"`), already included in
  `unitCents`. Board, history and the CSV read both as normal lines.
- **Only staff can send a price.** The staff schema gained `amountCents` on
  these two shapes (max $1,000.00). The web checkout schema is unchanged and
  still refuses any money field; `verify:staff-orders` asserts a web order
  carrying a custom line is a 400. The server still multiplies, sums and taxes.

## C. Layout screenshots

Taken by `npx tsx scripts/pos-screens.ts` against the throwaway e2e server,
with both printers checking in. The 6-line ticket is five dishes (one at 2)
and a 自訂 加蝦 $3.00.

| Size | Empty ticket | 6-line ticket | Also |
|---|---|---|---|
| 1024x768 (iPad landscape) | [empty](pos-landscape/pos-1024x768-1-empty.png) | [six lines](pos-landscape/pos-1024x768-2-six-lines.png) | [custom sheet](pos-landscape/pos-1024x768-3-custom-sheet.png) |
| 768x1024 (iPad portrait) | [empty](pos-landscape/pos-768x1024-1-empty.png) | [six lines, sheet open](pos-landscape/pos-768x1024-2-six-lines.png) | [bar, sheet closed](pos-landscape/pos-768x1024-4-bar.png), [custom sheet](pos-landscape/pos-768x1024-3-custom-sheet.png) |
| 1366x1024 | [empty](pos-landscape/pos-1366x1024-1-empty.png) | [six lines](pos-landscape/pos-1366x1024-2-six-lines.png) | [custom sheet](pos-landscape/pos-1366x1024-3-custom-sheet.png) |

Worst case checked by hand at 1024x768: both printers offline and the sound
prompt up still leaves three full rows (12 tiles) above the fold, because the
printer alerts and the sound prompt are now one line each.

## D. Checks

- `npm run lint`, `typecheck`, `typecheck:worker`: clean.
- 23 of 24 `verify:*` scripts pass, including `verify:staff-orders` (118/118,
  with the new custom and surcharge checks), `verify:ticket-glyphs`,
  `verify:kitchen-i18n` (314 keys in both languages, no em dashes),
  `verify:pricing`, `verify:orders`, `verify:print-split`.
- `verify:station-migrations` fails with `relation "printer_status" does not
  exist`. It fails identically on the untouched `034b7c0`; nothing here
  touches migrations. Pre-existing, not fixed here.
- Playwright: 55 passed, 0 failed (12 new in `kitchen-pos-layout.spec.ts`).
- `npm run build:cf`: OpenNext build complete.

## Diff, `034b7c0..HEAD`, grouped

| Group | Files | Lines |
|---|---|---|
| Ticket (`src/lib/ticket`, ticket scripts and fixtures) | 7 code + 20 PNG | +117 / -74 |
| POS (components, order schema and compose, ticket route, globals, screenshot script) | 15 code + 10 PNG | +1295 / -209 |
| i18n (`src/lib/kitchen/i18n.ts`) | 1 | +42 |
| Tests (`kitchen-pos-layout.spec.ts`, speed spec, `verify-staff-orders`) | 3 | +365 / -3 |

## Migration

None. No file under `src/lib/db/migrations/` and not `src/lib/db/schema.sql`
changed. Custom charges and surcharges live in the existing `items` jsonb.
