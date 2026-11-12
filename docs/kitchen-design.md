# Kitchen POS design spec

The staff POS at `/{kitchen}/pos`: order entry and the dine-in floor plan, on a 13" iPad
(1376 × 1032 landscape, 1032 × 1376 portrait) with a 大字 (large text) mode.

Static mockups: `docs/kitchen-mockups/` (`order.html`, `floor.html`). Screenshots and QA:
`node docs/kitchen-mockups/shoot.mjs` → `docs/kitchen-mockups/shots/`.
Tokens: the POS now uses the staff app's shared tokens (`--color-staff-*`, `--text-staff-*`,
`--radius-staff-*`, `--spacing` in `globals.css`), mixed only from the five seal values, so it
matches the orders board and history. The mockups' `tokens.css` (white surfaces, green "added")
records the earlier v2 palette and is superseded where it differs. Layout, zones and sizes
below still apply.

**Patterns borrowed.** Toast, Square for Restaurants and Lightspeed all treat the floor plan
as the dine-in home screen: tables carry their status (colour plus elapsed time), the
order is a live basket in a fixed side panel, and tapping an occupied table opens its
details beside the room instead of jumping straight into the order. The craft rules come
from Linear and Stripe: one surface, a strict text hierarchy, colour only for meaning, and
space instead of borders.

---

## Revision 2: minimal, colour-coded (review feedback)

Feedback: "not good to use… should have color coded… don't need details, only names…
minimalistic." Where this section conflicts with §1–§2 below, **this section wins**.

- **Category colour.** Each of the 15 categories has a light tint (`--cat-*` in
  tokens.css). The tint fills that category's dish tiles. A deeper marker of the same hue
  (`--c-ink`, derived with `oklch(from …)`) is the rail swatch and the stripe on each
  ticket line. This relaxes "colour for meaning only": category is now a meaning too.
  Brand red, green and amber keep their single jobs.
- **Dish tiles show names only.** Chinese 22 (up to 2 lines) and English 15 (2 lines, or
  1 when the Chinese takes 2). No prices and no size labels. All tiles are 112 tall and
  flat (tint plus a hairline, no shadow), 3 across in landscape and 2 in portrait.
  Tapping the tile adds the first size. A second size (餐盤, 一隻) is a white 44-tall chip
  in the corner. The green quantity badge stays.
- **Ticket line** = stripe · qty · name (with a size tag only when it isn't the regular
  size) · price. There's no stepper on every line: tapping a line marks it as editing
  (ground fill) and reveals a 56 stepper plus 備註 Note. Notes show under the name.
- **Ticket header:** order type plus customer on one line, Clear as a quiet trash icon,
  and the phone / Add customer button below.
- **Ticket footer:** subtotal and tax collapse into one 15 caption line, then Total 32,
  then Print 88. Pay at counter and the order-level Notes button are removed.
- **Rail:** 56/4 rows (decided earlier) with the 4-wide swatch. 鐵板 becomes **Hot Pot**,
  so no English is cut.
- **Floor plan:** each open-table row shows the table number (32) and its time only; the
  amber pill appears past 60 min. Tables show the number and minutes (`24′`), with no
  guest count. The details pane drops English and "since 6:41 PM". The guest sheet title
  is 幾位? · Guests.

## 1. Tokens

### Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f5f1ea` | Warm off-white app background |
| `--surface` | `#ffffff` | Cards, ticket, panes, sheets. The only surface. |
| `--control` | `#ebe5da` | Fill of every secondary control and segmented track |
| `--control-press` | `#ddd5c7` | Pressed secondary |
| `--floor` | `#ece5d9` | The room's floor plane |
| `--scrim` | ink at 45% | Behind sheets |
| `--text-1` | `#1c1917` | Names, totals, numbers |
| `--text-2` | `#36302b` | Secondary labels, notes |
| `--text-3` | `#4f4943` | English under Chinese, captions |
| `--text-faint` | `#a39a8e` | **Decoration only**: walls, chairs, dashed lines. Never text. |
| `--brand` | `#77151a` | The site's lacquer red. Primary action and selection only. |
| `--brand-press` | `#5e1015` | Pressed primary |
| `--added` | `#185c31` | "Added" feedback only (the dish quantity badge) |
| `--amber` | `#f2b33d` | "Seated over 60 min" only, as a fill with ink text |

No other colours. There is no danger red: a destructive action (Clear table) is a
secondary button followed by a confirm step, and the confirm is the primary button.

**Contrast**, measured by `shoot.mjs` on every rendered text node against its real
background: the lowest in any mockup is **7.08:1** (text-3 on `--control`). The pairings:

| Text | on bg | on surface | on control |
|---|---|---|---|
| text-1 | 15.5 | 17.5 | 14.0 |
| text-2 | 11.6 | 13.0 | 10.4 |
| text-3 | 7.9 | 8.9 | 7.1 |
| white on brand | | 11.0 | |
| white on added | | 8.0 | |
| text-1 on amber | | 9.4 | |
| text-3 on floor (landmark labels) | | 7.1 | |

### Type

One family: the system UI face (SF Pro on iPad), with `PingFang TC` → `Noto Sans TC`
as the CJK fallback, so Chinese and Latin come from the same OS stack.

| Token | Size | Use |
|---|---|---|
| `--t-32` | 32 | Total, ticket order type (外賣/堂食), table numbers in lists, guest keys |
| `--t-26` | 26 | Section headings, Print label, sheet titles |
| `--t-22` | 22 | Chinese dish names, rail Chinese, segmented Chinese |
| `--t-18` | 18 | Body, English names on cards, prices, buttons |
| `--t-15` | 15 | English under a 22px Chinese name, captions, tags |

- **Chinese is always one step larger than its English**: 22/18 on cards, 22/15 in the
  ticket and rail (15 is the small step used under the 22s).
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) on every price, quantity,
  table number and time.
- **Counts inside a name** (`春卷（2條）`) are rendered one step smaller and never split
  across lines (`.cnt`). The count is data, not part of the name.
- Table numbers on the floor plan are 40px, the one size outside the scale. It is a
  pictogram, not text.

### Space, shape, depth, motion

- Space: 4px grid, only `4 / 8 / 12 / 16 / 24 / 32 / 48`.
- Radius: **16** for cards, sheets and panes; **12** for every control.
- Shadow: **one**, `0 1px 2px ink/6%, 0 8px 20px -6px ink/16%`. Used by cards, the lifted
  selected table, the Combine chip, sheets.
- Motion: **150ms ease-out**, on background changes, press scale (0.98) and table lift.
- Hit targets: 56 (`--h-control`), 64 (`--h-tile`), 88 (`--h-hero`).
- Hierarchy comes from space and ground. The ticket's left edge is the only line on the
  order screen (1px `--control`, as the brief asked). Everything else is separated by a
  gap or by white on off-white.

### 大字

The root font size goes from 16px to 20px. Every token is in rem, so type, spacing, hit
targets **and the zones** (rail, ticket, list pane) all grow by 1.25 together. Grids
reflow: dishes go from 3 columns to 2 (landscape) or 1 (portrait). The brand name in the
top bar hides, leaving the seal.

---

## 2. Components

### Buttons: three styles, nothing else

| Style | Look | Used for |
|---|---|---|
| **Primary** | brand fill, white text | Print, Add items, the confirm in a confirm step. At most one per screen region. |
| **Secondary** | `--control` fill, ink text | Every other action: steppers, Clear, Notes, Add customer, card price segments, guest keys, top-bar icons, Combine |
| **Quiet** | no fill, ink text; `--control` when pressed | Rail rows, list rows, Cancel, Back |

- **Selected** is not a fourth style. It is the brand fill applied to a quiet or segmented
  item (active rail row, chosen segment).
- **Disabled** is an empty slot: no fill, a 2px inset `--control` outline, text-3. It
  can't be mistaken for a secondary button, which a dimmed fill could.
- `shoot.mjs` counts every `<button>` by style and fails a mockup with any unstyled one.

### Segmented control

Track: `--control`, 56 tall, radius 12, 4px inset. Segments: quiet, text-2. Chosen segment:
brand fill, white. Chinese 22 + English 18 per segment. It looks exactly like this
everywhere it appears. Today that is only the 外賣/堂食 switch.

### Top bar (72 tall: 56 controls, 8 above and below)

- **Left**: the 富源 seal (40 tall), "New Mandarin Canton II · Kitchen" (18, "· Kitchen" in
  text-3). The name hides in 大字.
- **Center**: 外賣 Takeout | 堂食 Dine-in segmented.
- **Right**, all 56 × 56 secondary, radius 12: Search, language (shows the language you'd
  switch *to*: "EN" in Chinese mode, "中" in English), overflow ⋯.
- **Overflow menu** (a sheet anchored to ⋯, quiet rows 56 tall): 出單板 Board, 記錄 History,
  午餐時段 Lunch hours, 大字 Large text (with a check), 登出 Sign out.

### Category rail (176 wide; 220 in 大字)

- Rows are fixed at 56 tall (`--h-control`) with a 4 gap, radius 12, quiet. Chinese 22 on one line,
  English 15 on one line, truncated with an ellipsis.
- Active row: brand fill, both lines white.
- Labels: 大家庭 **Big Family** (short for "Big Family Dinner Special"), 鐵板 Sizzling Hot
  Pot, 家庭餐 Family Dinners. Nothing wraps at either size.
- Fit: 15 × 56 + 14 × 4 = 896px, inside landscape's 936px under the top bar, so all 15
  show in landscape and portrait. In landscape 大字 (70px rows) 12 fit: the rail scrolls,
  and a "↓ N more 類" secondary bar covers from the end of the last whole row down, the
  same rule as the ticket lines. A half-cut row is never shown. (Decided in review: 56/4.)

### Dish card

- Fixed **176 tall** (11rem), white, radius 16, the one shadow. Every card in a row is the
  same size because the height is fixed and the content is clamped.
- **Name block** (88 tall): Chinese 22 on one line, then English 18 on up to 2 lines.
  When the Chinese doesn't fit on one line, it takes two and the English drops to one,
  so the block stays 88 either way.
- **Price bar** across the bottom (8 inset): one 64-tall secondary segment per size, equal
  widths, 4 apart. Each segment shows the size ("**例** Regular", "**餐盤** Tray", "**半隻**
  Half", "**杯** Cup") at 15 and the price at 18 bold tabular. A single-price dish gets one
  full-width segment, "加 Add / $3.50". **The segment is the tap target and the size.**
  There is no card-level tap and no size dialog.
- **Quantity badge**: when the dish is in the ticket, a green (`--added`) pill in the top
  right corner shows its total quantity. The Chinese name reserves room for it only when
  it's there.

### Ticket (420 wide; 400 portrait; 525 in 大字)

White, full height, 1px `--control` left edge. Three rows: header, lines (scrolls), footer
(pinned).

**Header.** The strongest element on the panel:
`外賣` (32 bold) `Takeout` (22) `·` `Walk-in` / customer name (22, truncates).
Dine-in: `堂食` (32) `桌 4 · 3 位` (22). Directly below, a full-width 56 secondary:
"+ 加客人 Add customer", "(626) 555-0148 · Change customer", or "換桌 Change table".

**Line.** Two columns: name block | stepper.
- Name block row 1: Chinese 22 (one line, ellipsis) and the line price at 18 semibold
  tabular, right-aligned against the stepper. The prices form a column.
- Row 2: the size tag (`餐盤`, `例`; a 15 semibold chip on `--control`), then English 15
  text-3, one line.
- Row 3, if any: the note, 15 text-2, prefixed ✎.
- Stepper: 56 tall, − and + 48 wide secondary, quantity 22 bold between them.
- Tapping the name block opens that line's note sheet.
- Lines are 16 apart. There are no dividers.
- **Overflow**: when lines don't fit (long orders, 大字), the list scrolls. Below the last
  whole line, a full-width secondary bar reads "還有 3 項 · 3 more below ↓". A half-cut line
  is never shown bare. New lines scroll into view when added.

**Footer.** Pinned, top to bottom:
1. Subtotal and tax: two rows, label and value both right-aligned, 18, values tabular.
2. **Total**: "合計 Total" left (22/18), amount right at **32 bold**. One row, no wrap.
3. "Pay at counter" caption, 15 text-3, right-aligned under the total.
4. 清除 Clear | 備註 Notes: two equal 56 secondaries in one row.
5. **Print**: 88 tall, full width. Enabled: primary, "列印 Print" left and the total
   right. Disabled: the empty-slot style, "加菜才能列印 Add a dish to print", centered.

### Floor plan (the dine-in home)

**Panes.** Landscape: open-tables list 320 (400 in 大字) | the room. Portrait: the room on
top at full width and its own aspect, the list below in two columns.

**Open-tables list.** Title "開檯 Open tables" with a count. Rows are quiet buttons, sorted
by longest seated: table label (32 bold) | "4 位" (22) and amount (18, right) on row one;
minutes and dish count (15 text-3) on row two. Minutes over 60 go in an amber pill.

**Room.**
- Drawn as a room: a `--floor` plane, walls as a 2px `--text-faint` outline, a gap in the
  wall for the door. Scaled to fill the pane and centered.
- **Landmarks** come from config (`FLOOR_LANDMARKS`, proposed): a dashed outline with a
  label (櫃檯 Counter, 神檯 Altar), or a door gap (入口 Entrance). Positions in the mockup
  are placeholders.
- **Chairs**: 26-unit circles in `--text-faint` at 55%, 8 units off the table edge, from a
  per-side count in config (`chairs: { t, r, b, l }`, proposed). They show capacity,
  so tables carry no seat-count text.
- **Tables**: radius 14 units. Number 40 bold.
  - Free: white.
  - Seated: brand fill, white text, "3 位 · 12 min" (15 semibold). On narrow tables the
    two parts stack.
  - Seated over 60 min: the minutes become an amber pill.
  - Selected: a 3px white gap, then a 4px ring (brand on a free table, ink on a seated
    one, since brand on brand would vanish), the shadow, and a 3px lift.
- **Combinable pairs** (4+5, 7+8): one long table with a dashed split line. Each half is
  its own tap target. A secondary "併桌 Combine" chip (44 tall) sits on the split line while
  both halves are free. Once combined, the pair is drawn as one table with one label
  ("4+5"), and its state, ring and lift apply to the whole table.

**Flows.**
- Tap a **free** table: the guest-count sheet opens. Pick a number to go straight to the
  order screen with `堂食 桌 N · G 位` set.
- Tap a **seated** table (or its list row): the list pane becomes that table's details.
  Back ("‹ 所有桌 All tables", quiet), "桌 1" (32), "2 位 · 24 min · since 6:41 PM", the
  dishes, the total, then **加菜 Add items** (primary, 88), 換桌 Move | 清桌 Clear
  (secondary). Clear asks for confirmation, and the confirm is the primary button.

### Guest-count sheet

Centered, 560 wide, radius 16, over the scrim. Title "桌 2 · 幾位?" (26) "How many
guests?" (18 text-3). A 4 × 3 grid of 88-tall secondary keys, 1 to 12 (32 bold). Below
them, a full-width 88 "13+ 更多 More", which opens a stepper. Then "取消 Cancel", quiet,
on the right. The tapped table stays selected behind the scrim.

---

## 3. Quality bar, and how it's checked

`shoot.mjs` renders all 5 states × 4 sizes (landscape, portrait, 大字 landscape, 大字
portrait) and fails a shot on any of these:
- horizontal page scroll, or text outside the viewport or outside its row
- a button label or segment that wraps or overflows
- a `<button>` that isn't primary, secondary or quiet
- top-bar controls of different heights
- any text below 7:1 against its actual background

Current result: **20/20 pass, 0 problems.** The only truncations are intentional ones
(ellipsis or line clamp on English names).

The squint test is checked by eye on the screenshots: the order type, the lines, then
Print.

---

## 4. Open questions for review

1. ~~**The rail doesn't fit landscape.**~~ Decided: 56px rows with a 4px gap. See the
   category rail spec.
2. **Search** wasn't in the brief's top bar. Today's POS has it (dish name or menu number),
   so it stays visible as a 56 icon button rather than going into the overflow menu.
3. **Chair reference image**: the attached reference did not come through. Chairs are
   drawn from the per-side counts above. Send it again and I'll match it.
4. **Landmark positions** and the **chair counts** per table are placeholders until the
   owner places them. Both are config, not code.
5. **The dish pane shows one category at a time** (the rail selects it), instead of
   today's single long scroll with headings. That fits the fixed-card grid and the Toast
   model better. Say if you want the continuous scroll kept.
6. **Tax** is shown at 8.75% in the mockups. The app uses the tenant's `taxRateBps`.
