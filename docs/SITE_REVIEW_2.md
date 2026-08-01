# SITE REVIEW 2 — New Mandarin Canton II

**Method: DESCRIBED FROM RENDER, not from screenshots.**

The Browser pane in this session does not composite frames. Two consequences,
both verified before any finding was written:

- `computer{action:"screenshot"}` fails ("the page is not compositing frames").
- `document.timeline.currentTime` is frozen at **0** and never advances
  (measured: `t0 = 0`, `t1 = 0` across a 600 ms wait). **No CSS transition or
  keyframe animation ever runs.** Anything whose visible resting state is
  reached *by* a transition reads as stuck. The cart drawer, for example,
  reports `class="… translate-x-0"`, `aria-hidden="false"`, `--tw-translate-x: 0`
  and *still* computes `translate: 100%` with a `CSSTransition` in state
  `running, currentTime 0`. Same for `.hero-item` (opacity 0) and every
  `data-rise` group (`visibility: hidden`). **None of those are site bugs and
  none are reported as such.**

So: everything below about **layout, geometry, the DOM, the accessibility tree,
computed colour, contrast, tab order, network, and strings** is measured live at
1440×900 and 390×844. Everything about **motion, reveals, the preloader and the
drawer/sheet slide** is read from source. Where a claim rests on source rather
than observation it says so.

Server clock during the audit: **Sat 1 Aug 2026, 11:12 AM PT** — so the menu was
observed with **lunch service ON**. The lunch-OFF layout is described from
`OrderMenu.tsx` / `gates.ts`, not observed.

Baselines taken before the review: `tsc --noEmit` **clean**;
`eslint src scripts/*.ts` **clean**.

---

## 1. Verdict — 5 lines, blunt

1. It reads as one designed thing. The radius scale holds absolutely — **zero
   off-scale radii on any page, zero square-cornered interactive elements** —
   and the type scale is equally clean (0 off-scale font sizes on /menu). That
   is rare and it is the single best thing about this pass.
2. The menu page is a **wall, not a welcome**: at 390 px the first orderable
   dish sits at **y = 831 on an 844 px viewport**. A customer opening the menu
   on a phone sees no food at all before scrolling. At 1440 it is 627 of 900.
3. The Spanish half is **half-built, and the seams are on the pages that matter
   least to you and most to the customer**: /contact renders "Find Us / Call /
   Hours / Open 7 days a week" in English beside a fully Spanish hours table;
   searching "pollo" returns **0 of 38** chicken dishes while "chicken" returns
   38; nine correctly-translated dictionary keys sit **unused** while the exact
   English strings they were written for are hardcoded three files away.
4. Two things are quietly broken rather than merely rough: while a filter is
   active **11 of 14 category pills point at anchors that no longer exist**
   (and the zero-result message literally says "try the category list"), and the
   **checkout's primary button renders disabled with no explanation anywhere on
   the page** — the exact problem the item sheet already solved for itself.
5. Nothing here delays launch. The closest call is the privacy page, which says
   every cookie "cannot be read by JavaScript in your browser" — the language
   toggle added one that can, and never added it to the list.

---

## 2. Findings, ranked by impact-per-hour

### LAUNCH-BLOCKER

**None.** See §4 for why the privacy-page inaccuracy is not one.

---

### FIX-NOW — Stage B's work queue

---

**F1 — Nine translated dictionary keys exist and are never used; the English
they were written for is hardcoded elsewhere.**

Verified by diffing `t("…")` call sites against `dictionary.ts`:

| key | ES value already written | where the English is hardcoded |
| --- | --- | --- |
| `hero.tagline` | "Cocina mandarina, sichuanesa y cantonesa en Chula Vista" | `HeroVideo.tsx:256` |
| `menu.spicy` | "Picante" | `MenuSection.tsx:14` (`SpicyMark`) |
| `fav.intro` | "Los platillos por los que regresan nuestros clientes." | `FavoritesSpotlight.tsx:69` |
| `fav.seeFullMenu` | "Ver el menú completo" | `FavoritesSpotlight.tsx:79` |
| `fav.previousDish` | "Platillo anterior" | `FavoritesSpotlight.tsx:191` |
| `fav.nextDish` | "Platillo siguiente" | `FavoritesSpotlight.tsx:201` |
| `cart.closeCart` | "Cerrar el carrito" | `CartDrawer.tsx:49, 67` |
| `cart.decreaseItem` | "Quitar un {name}" | `CartDrawer.tsx:115` |
| `cart.increaseItem` | "Agregar un {name}" | `CartDrawer.tsx:127` |

No new copy, no new keys, both languages already reviewed-pending. Pure wiring.

*Note:* `SpicyMark` lives in `MenuSection.tsx`, whose default export is dead
code (see P7). It is imported only by client components, so it can take
`useT()`; it gets its own client module rather than adding a hook to a file
that also exports a server-shaped component.

---

**F2 — The connector between the two phone numbers is hardcoded English on
every bilingual surface.**

`PhoneLinks` takes `separator` and `prefix` as literals. Observed on the
Spanish menu, Spanish checkout and Spanish 404:

> ¿Alergias a algún alimento? Llámenos antes de ordenar · 食物過敏請先致電
> (619) 656-6888 **or** (619) 656-6787

Six call sites pass `" or "`; `Confirmation` also passes `prefix="Call "`.
Needs two new key pairs (`ui.or`, `ui.callPrefix`). Sites: `OrderMenu.tsx:202`,
`Checkout.tsx:570`, `confirmation/page.tsx:121-122`, `not-found.tsx:56`,
`privacy/page.tsx:223`, `terms/page.tsx:147`.

---

**F3 — "Add +" is 2.91:1. It is the affordance label on all 137 dish rows.**

`text-ink/45` on `bg-cream` at 12 px. Needs 4.5:1. Measured with a canvas-
resolved oklab composite, not estimated. `text-ink/60` clears it and is a value
already used elsewhere in the same component.

---

**F4 — The Contact page's three section labels are gold-on-ivory at 2.02:1.**

`text-xs … text-gold` for "Find Us", "Call" and "Hours" (`contact/page.tsx:21,
31, 62`). The identical treatment in the **Footer** sits on `bg-ink` and
measures **7.76:1** — fine there. It is only the light-ground copy that fails.
`text-lacquer` on ivory measures **7.08:1** and is already the site's heading
colour on light surfaces.

---

**F5 — Footer legal links are 3.5:1.**

`text-ivory/40` on `bg-ink` at 12 px: "Privacy", "Terms", "Website by Norvix".
The component's own comment says these "have to be FINDABLE, not prominent —
somebody deciding whether to hand over a phone number needs to be able to reach
the privacy page without hunting." At 3.5:1 that intent is not met. `/60`
measures ≈5.2:1 and is still visibly quieter than the ivory/60 line above it.

---

**F6 — The inactive language button is 4.24:1.**

`LocaleToggle`, `text-ivory/70` on lacquer at 12 px. The *inactive* one is the
only tap target in the pair. `/85` clears 4.5.

---

**F7 — `ORDER_DIRECT_NOTE` is English on the Spanish hero.**

Observed: "**ORDER DIRECT · NO DELIVERY-APP FEES** · LLAMAR (619) 656-6888".
One string in `data/order.ts:26`, one call site (`HeroVideo.tsx:276`).

---

**F8 — The cart's long-prep notice names only party trays, and fires for
family dinners.**

`hasLongPrep` is `item.longPrep === true || size.id === "party-tray"`
(`CartDrawer.tsx:38-41`), but `PARTY_TRAY_PREP_NOTE` reads "Party trays: ready
in 20–30 minutes". Observed with a Family Dinner No. 2 (6 people) and **no
tray** in the cart: the customer is told about party trays they did not order.
The confirmation page already gets this right (`conf.longPrepNote`: "Party
trays & family dinners need a little longer"). The string is also outside the
dictionary, so it is English on the Spanish cart.

This is the one place Stage B touches English wording. It is a factual
correction of a two-word noun to match the condition that renders it, not a
rewrite, and it is the only way to add the missing Spanish.

---

**F9 — The confirmation page hardcodes 中文 inline instead of using a key.**

`confirmation/page.tsx:109` renders `· 過敏問題請致電` as a literal. It is the
only place on the site that does — every other 中文 half of the two-part
convention comes from the dictionary. Same characters as
`checkout.allergyWarnZh`.

---

**F10 — Two elements are announced "Close" in the item sheet, and one of them
is a full-screen invisible button.**

`ItemSheet.tsx:148` renders the scrim as `<button aria-label="Close">` covering
`inset-0`; `:161` renders the visible ×. Confirmed in the accessibility tree:
`dialog "Mongolian Beef"` contains `button "Close"` twice. Same shape in
`CartDrawer.tsx:49`. The scrim should be `aria-hidden` + `tabIndex={-1}`; the ×
and Escape both already close.

---

**F11 — The closed cart drawer is `aria-hidden="true"` with a focusable child.**

Measured with the drawer closed: `aria-hidden="true"`, `visibility: visible`,
`x = 390` (fully off-screen), and its close button still in the tab order —
a direct ARIA violation (focusable content inside `aria-hidden`). With a
populated cart it is every quantity and Remove control. `inert={!open}` on the
`<aside>` is the correct fix and React 19 supports the attribute natively.

---

**F12 — The Contact page is the site's worst mixed-language surface.**

Observed with ES on, verbatim:

> Visit Us / **FIND US** / 543 Telegraph Canyon Rd / **CALL** /
> **Call** (619) 656-6888 / **Takeout orders welcome by phone.** /
> **HOURS** / Horario de la semana / Lunes … Sábado**HOY** /
> ABIERTO · HASTA LAS 9:30 PM / **Open 7 days a week.**

Seven English strings interleaved with a correctly Spanish hours table and
status chip. Three of them can reuse keys that already exist
(`footer.findUs`, `footer.hours`, `hero.call`); four need new pairs. The page
is a server component and the route is already dynamic, so `getT()` drops in.

---

**F13 — `npm run lint` is not usable as a gate.**

`eslint.config.mjs` ignores `.next/`, `out/`, `build/` but **not** `.open-next/`
or `scripts/stubs/`. Running the project's own `lint` script reports
**22,446 problems (750 errors)** — every one of them in generated bundle output
or a binary stub. `npx eslint src scripts/*.ts` is clean. Nobody can use a gate
that is 750 errors red on a clean tree.

---

### PROPOSE — precise enough to become a future prompt, not executed

---

**P1 — The privacy policy no longer describes the site's cookies. (Highest
priority in this list.)**

Two statements are now false:

- *"Every cookie this site sets is strictly functional, first-party, and
  **cannot be read by JavaScript in your browser**."* — `nmc_lang` is set with
  `document.cookie` from `LocaleToggle.tsx:44` and is deliberately not httpOnly
  (`lib/i18n/locale.ts:26-35` explains why, correctly).
- The bulleted cookie list names the 15-minute verification cookie, the 90-day
  remember cookie, and "two staff-only cookies". `nmc_lang` — a **one-year**
  cookie set for **every** customer who touches the toggle — is absent.

The page's own header comment says "WHEN THE CODE CHANGES, THIS PAGE IS PART OF
THE CHANGE." The trilingual commit changed the code and not the page.

Suggested shape (owner/counsel to approve the wording): soften the blanket
JavaScript claim to "every cookie is strictly functional and first-party; the
ones that protect anything cannot be read by JavaScript", and add a fourth
bullet: "One that remembers whether you are reading the site in English or
Spanish. It holds nothing but a language code and lasts a year."

Not executed here because it is legal copy.

---

**P2 — The menu header is a wall. The consolidation that fixes it is
structural, and every version that fits Stage B's rules saves under 60 px.**

Measured, 390×844, EN, lunch ON:

| block | top | height |
| --- | --- | --- |
| header | 0 | 114 |
| h1 "Menu" | 146 | 40 |
| intro paragraph | 198 | 52 |
| gold banner (3 lines, 2 hairlines) | 266 | **246** |
| House-favourites strip | 536 | 62 |
| sticky search + spicy + 14 pills | 622 | 87 |
| first category heading | 749 | ~42 |
| **first orderable dish** | **831** | — |

At 1440×900 the same chain puts the first dish at **627**.

Pure-spacing tightening (`pt-8`→`pt-5`, two `mt-6`→`mt-4`, `pt-10`→`pt-6`, the
banner's `mt-1.5/pt-1.5` hairline gaps →`mt-1/pt-1`) recovers ~52 px of 831.
That is churn for no perceptual change, so it is not in the queue.

What actually moves the number, in descending order:

1. **Demote the banner to one line plus a persistent second line.** Lines 1
   and 2 ("Pickup only · ready in 15–20 minutes. Party trays and family dinners
   take 20–30. Pay at the counter…" and "Online orders until 8:30 PM · … The
   kitchen is open later, so please call after that.") are both *when/how*
   information and merge into one paragraph with a `·` join, deleting no words.
   The allergy line stays its own line, and per P4 should get *more* weight, not
   less. **≈ −70 px at 390.**
2. **Fold the h1 + intro into the banner's ledger.** "Pickup only at 543
   Telegraph Canyon Rd." (intro) and "Pickup only · ready in 15–20 minutes"
   (banner line 1) state *Pickup only* twice within 100 px. Merging them is a
   copy edit, which is why it is here. **≈ −60 px.**
3. **Move the House-favourites strip below the first category section.** It is
   a shortcut for people who do not know what they want; it currently sits
   between them and the food. Nothing is deleted, it moves. **≈ −86 px.**
4. **Drop the first section's `pt-10` to `pt-4` when it is the first visible
   section.** **≈ −24 px.**

All four together: first dish at ≈ **590 of 844** — food on the fold.

---

**P3 — While a filter is active, 11 of 14 category pills are dead links; with
zero results, all 14 are, and the empty state points at them.**

`OrderMenu.tsx` renders the pill nav from `categories` (unfiltered) and the
sections from `visible` (filtered). Verified by resolving every pill's `href`
against the live DOM:

- query `"mongolian"` → sections rendered: Specials, Beef, Family Dinners.
  Dead pills: Lunch Specials, Appetizers, Soup, Chicken, Seafood, Pork,
  Sizzling Hot Pot, Vegetables, Fried Rice, Noodles, Big Family Dinner Special.
- query `"zzzqqq"` → 0 sections, **14/14 pills dead**, and the status message
  reads *"No matches, try the category list · 沒有符合的項目，請用分類選單"*.

Two defensible fixes and choosing between them is taste, which is why this is
not FIX-NOW:
(a) render the nav from `visible`, and hide the bar entirely at zero results
(the empty state's own "Clear the filter" button then becomes the only way out,
and its copy needs to change);
(b) keep all 14 pills and have a pill tap clear the filter before jumping.

(b) is probably right — the pill row is also how you *escape* a filter — but it
changes what a link does, so it is your call.

---

**P4 — The allergy message has three different weights on one order path.**

The notice grammar is otherwise good and consistent: **gold** border/tint =
information, **lacquer** border/tint = warning, `rounded-md`, `·` separating
English from 中文. Applied by meaning, not by accident. One exception, and it
is the message that matters most:

| surface | treatment | reads as |
| --- | --- | --- |
| menu banner | `border-gold/40 bg-gold/5`, third line of a shared box | information |
| item sheet | **no container at all**, `text-xs text-ink/60` under the textarea | fine print |
| checkout | `border-lacquer/40 bg-lacquer/5 rounded-md` | warning |
| confirmation | `border-lacquer/40 bg-lacquer/5 rounded-md` | warning |

The site decides twice that this is a warning and twice that it is not. Pick
one — almost certainly the lacquer warning treatment everywhere — and apply it.
Touches the item sheet's layout, so not FIX-NOW.

Notice count from landing to order-placed, for the record: **11 distinct notice
surfaces** (hero value line, open-now chip, menu banner ×3 lines, lunch chip,
sheet allergy note, sheet unmet-group strip, cart long-prep strip, cart
pickup-only line, checkout pay-at-counter, checkout allergy, checkout
notice/error, confirmation allergy, plus the two persistent footer lines). That
is a lot, but each one is load-bearing and none is a duplicate of another *on
the same screen*. Not a fatigue problem; a weight-consistency problem.

---

**P5 — The checkout's primary button is disabled with no reason given
anywhere.**

Observed on a populated cart with an empty form: `<button disabled>Place pickup
order · $159.20 at pickup</button>`, no `aria-describedby`, no `title`, no
adjacent hint. The gates are name + verified phone + a slot, and the page says
none of that. The "Verify" button has the same shape (`disabled` until
`code.length >= 4`).

The site already solved this exact problem one screen earlier — `ItemSheet.tsx`
renders *"Please choose **rice** to add this to your cart"* above its Add
button precisely because "a disabled Add to Cart used to be its own
explanation, which it never was". Port that component and that reasoning to
checkout. New copy + order-flow surface, so: proposed, not done.

---

**P6 — Spanish search finds nothing.**

`itemMatches` builds its haystack from `nameEn`, `nameZh`, the **English**
`description`, and the English category name. The Spanish descriptions in
`data/menu-descriptions-es.ts` are rendered but never searched. Measured with
ES on:

| query | results |
| --- | --- |
| `pollo` | **0** |
| `camaron` | **0** |
| `picante` | **0** |
| `chicken` | 38 |
| `shrimp` | 26 |

Fix is to thread the locale into `itemMatches` and append `describeItem(...)`
to the haystack. The design question is whether Spanish terms should also match
when EN is on (probably yes — a bilingual household shares one phone), and
whether category names get Spanish aliases. Decision needed, so: proposed.

---

**P7 — Five orphaned components and ~150 lines of orphaned CSS.**

Zero import sites anywhere in `src`: `MenuCategoryBar.tsx`, `MenuCombos.tsx`,
`MenuHeadings.tsx`, `Reveal.tsx`, `motifs/MandarinMark.tsx`, plus the default
export of `MenuSection.tsx` (only `SpicyMark` is imported from it).

Their CSS in `globals.css` goes with them: `--menu-bar-h`, `.cat-bar`,
`.cat-scroller` + its mask rules, `.cat-chevron*`, `.menu-section`, `.reveal*`,
`.lacquer-vignette` (0 uses), `.settle-1/3/4` (only `settle-2` is used),
`.spt-ghost` (0 uses in TSX). The statement-band rules (`.st-eyebrow`,
`.st-rule`, `.st-shimmer-go`) are reached only by `HomeChoreography` SCENE 4,
which is deliberately kept alive against a null lookup so the band can be
restored — **leave those**.

Not FIX-NOW because the CSS comments still describe `MenuCategoryBar`'s
scrollspy as live ("driven by the scroll-spy / flight commit in
MenuNavigator"), which suggests somebody may want it back. One clean commit
with the comments updated, or a decision to keep them. Your call.

---

**P8 — The focus ring fails non-text contrast on every light surface.**

`:focus-visible { outline: 2px solid var(--gold) }`. Measured against the
palette:

| ground | ratio | 3:1? |
| --- | --- | --- |
| ivory `#f8efd9` | **2.02** | ✗ |
| cream `#fcf5e6` | **2.13** | ✗ |
| paper `#eedfc0` | **1.76** | ✗ |
| ink | 7.76 | ✓ |
| lacquer | 3.50 | ✓ |

No single palette colour clears 3:1 on both grounds (lacquer on ink is 2.21).
The answers are a dual ring (`outline` gold + `box-shadow` ink hairline, so
there is always an edge against something), a ground-aware `--focus-ring`
token, or thickening to 3 px with an offset. All three are palette/design
decisions, so this is proposed rather than guessed at.

Everything else about the keyboard walk is sound: the ring is present on every
interactive element I tabbed to (confirmed with real `Tab` presses, not
programmatic `.focus()`), including all the new ones — spicy toggle, category
pills, favourites chips, back-to-top, the rice radios, the language buttons.
`outline-none` on the six order-flow inputs does **not** kill it: the global
rule is unlayered and outranks Tailwind's `@layer utilities`.

---

**P9 — The item sheet claims modality it does not implement.**

`role="dialog" aria-modal="true"`, and:

- Focus is never moved into it. Measured immediately after opening Mongolian
  Beef: `document.activeElement` is `BODY`. A keyboard user must tab through
  the entire page behind the sheet to reach it.
- No focus trap and no focus restore on close.
- The page behind still scrolls: with the sheet open, `window.scrollBy(0, 300)`
  moved the document from 0 to 300. On a phone, dragging on the sheet's header
  or footer scrolls the menu underneath it. (`data-lenis-prevent` covers the
  scroll body only.)

This is the highest-impact accessibility item on the site, and it is a genuine
behaviour change in the order flow, so it needs its own pass.

---

**P10 — "Both" is unreadable in the cart.**

In the sheet the rice option renders *"Both 白飯+炒飯 · 各一半, half steamed and
half fried"*. In the cart and the checkout summary it renders as the bare word
**"Both"**, because `CartDrawer` prints `line.modifiers.map(m => m.nameEn)`
with no group name. Observed line, verbatim:

> Family Dinner No. 2 / 6 people / **Both** / "peanut allergy for one person" / $137.70

Both *what*. Printing the group name for single-select groups
("Rice: Both") — or the `nameZh` the ticket already carries — fixes it.
Order-flow presentation, so: proposed.

---

**P11 — Free rice does not say it is free.**

The rice group renders with `minRequired: 1` and a "· required" tag, and no
price on any option (correct — `priceCents: 0` is gated out by
`m.priceCents > 0`). So it does not read as an *upsell*. But nothing says
*included* either, and the only proof is that the Add button's total does not
move when you switch. A first-timer choosing between a required option with no
price and one that might be an extra will hesitate. One word on the legend
("Rice · required · included") closes it. Copy, so: proposed.

---

**P12 — Long-form Spanish is absent from Home, About and the legal bodies.**

Not a defect — a scope boundary that should be stated. With ES on, the
following stay English: the homepage Our Story paragraph, "Read our story →",
"The Room", "Come in. The room is part of the meal.", the altar pull-quote, all
six photo captions ("The altar · incense & tangerines", "Family at work", …),
the whole About page including its pull-quote and three paragraphs,
`restaurant.tagline`, `weeklyOpeningSummary` ("Open 7 days from 11:00 AM"),
`Established` ("EST. 1995", "30+ YEARS ON TELEGRAPH CANYON"), the pickup-slot
`ASAP (~20–30 min)` label, and both legal bodies (documented TODO(family)).

Translating marketing prose is authorship, not string wiring, and the file
header is explicit that these are pending native review. It belongs in one
deliberate pass with the family, not in a consistency sweep.

---

**P13 — Every server-side customer-facing message is EN·中文 with no Spanish.**

`lib/phone.ts` (nine rejection messages), `lib/order/gates.ts`
(`closedMessage`, `lunchClosedMessage`), `api/otp/start`, `api/orders`. A
Spanish customer who mistypes a phone number or hits the cutoff gets English
and Chinese. The server can read `nmc_lang` the same way the layout does, but
this is server code and Stage B's rules exclude it beyond string additions.

---

**P14 — Smaller items, batched.**

- **Menu search announces nothing.** `resultCount` is computed in
  `OrderMenu.tsx:126` and used only for the zero case. A screen-reader user
  typing in the search box hears nothing about 38 → 3 → 0.
- **`/order/confirmation` and `not-found` both render the homepage's `<title>`.**
  Observed: "New Mandarin Canton II | Chinese Restaurant in Chula Vista, CA" on
  a 404 and on the confirmation screen.
- **The Spanish legal date is half-translated:** "ACTUALIZADO EL 31 JULY 2026" —
  `LAST_UPDATED` is an English literal interpolated into a Spanish sentence.
- **The sticky category bar does not reach the page edges, asymmetrically.**
  `-mx-4` (16 px) against `container-wide`'s `clamp(1.25rem, 4vw, 4rem)`
  padding: measured gaps of 4 px / 4 px at 390 and **42 px / 57 px** at 1440.
  Its `border-y` hairline stops short on both sides, so the one sticky surface
  on the page reads as unanchored.
- **Eight letter-spacing values with no documented scale**: 0.075 / 0.12 / 0.15
  / 0.18 / 0.25 / 0.4 em plus two Chinese trackings. The radius scale got four
  values and a manifesto; tracking got none. Low stakes, but it is the one
  place the "one designed thing" discipline is not written down.
- **Two stale comments now assert the opposite of the truth.** `Footer.tsx:145`
  ("The customer-facing site carries no functional 中文 — 富源 is its one
  Chinese moment") and `MenuSection.tsx:9` / `SectionHeading.tsx:6` ("the menu
  is English-only by design", "富源 is now the site's only Chinese"). The site
  has since put 中文 on every functional notice, every rice option and every
  legal heading.
- **`public/fonts/*.ttf` (250 KB) ship as static assets** and are never
  requested by any page — they are build inputs for `emit-font-module.ts`,
  which base64s them into `font-data.ts`. Harmless, but worth a note in the
  build docs so nobody "optimises" the wrong copy.

---

## 3. Things that are right, measured

Recording these so the findings above are not read as "the site is bad".

- **Radius: perfect.** Home, menu, checkout, legal — `offCount: 0` off-scale
  values everywhere, and the only element with all-square corners that draws
  any box is the Call half of the mobile order bar, which is correct by
  construction (its sibling carries the one corner that touches). Histogram on
  /menu: 146 × 11 px, 77 × 9999 px, 7 × 18 px, 1 × 6 px. Four values, no fifth.
- **Type: perfect.** Zero off-scale font sizes on /menu across ~630 text nodes.
- **No horizontal scroll** at 390 or 1440 on any page (`scrollWidth === 390`).
- **Full-page scroll is intact** at both widths — the regression the pinned
  ScrollTrigger caused is gone. Home: reaches 5840 of 5840. Menu: 15391 of
  15391. Footer bottom lands in view.
- **The ticket font never reaches the client.** Fetched all 23 scripts served on
  /menu (4.4 MB dev-instrumented) and scanned for `AAEAAA` / `TICKET_FONT` /
  `NotoSansTC-Ticket`: **zero hits**. Import graph confirms it —
  `lib/ticket/*` is reachable only from API routes, and `render.ts` carries
  `import "server-only"`.
- **Console clean, no asset 404s, no third-party requests** on /menu. The Google
  Maps iframe is `loading="lazy"` and had not fired — which is what /privacy
  promises.
- **Seal discipline holds on every page but one**, and that one is a
  placeholder artefact: /menu, /contact, /privacy, /terms = 2 (header + footer
  lockups). /about = 2 + one 6 %-opacity placeholder ghost + the crane. Home =
  2 lockups + **1** sanctioned divider ornament + **4** ghosts at 6 % opacity,
  all of them `PhotoPlaceholder` watermarks standing in for photography that
  has not arrived. **Do not "fix" this by removing placeholders** — it resolves
  itself the day the dish photos land.
- **Motif discipline holds.** About = crane only. 404 = one full-colour
  horizon, which the file argues for well. Home = knot + seal on the two
  dividers, mandarin cluster gated at `lg`. Nothing decorative on menu,
  checkout, confirmation or the legal pages.
- **The two-part `EN · 中文` convention is applied everywhere it should be** and
  nowhere it shouldn't: every functional notice on the order path carries it;
  no marketing heading does.
- **Escape closes both the sheet and the drawer**; `aria-live="polite"` on the
  quantity readout and the spotlight counter; `aria-pressed` on the spicy
  toggle; `aria-current` on nav and on the active language; the inactive
  language button is `disabled` rather than a no-op control. All correct.
- **Radio and checkbox accessible names resolve** through their wrapping
  `<label>` — verified directly (`"Steamed Rice白飯"`, `"Party Tray· feeds
  15–20$75.00"`), despite the a11y-tree dump flattening them.
- **The regular's path is 9 taps and 3 text entries** from landing to placed
  order (Order Takeout → favourites chip *Mongolian Beef* → Fried Rice → Add →
  View Cart → Checkout → Text me a code → Verify → Place order). For a site
  with no saved cards and no accounts, that is good.

---

## 4. What NOT to touch

1. **The radius scale and its manifesto in `globals.css`.** Four values, no
   fifth, `@theme` not `@theme inline` so utilities and hand-written CSS read
   the same variable. It is the reason this site still looks like one thing.
2. **`.frame`.** One anatomy — mount, edge, hairline, caption plate — for every
   framed object on the site, with `overflow: hidden` doing the corner work so
   no child needs a matching inner radius. Do not add a second framed treatment.
3. **The no-pin rule in `HomeChoreography`.** A pin caused this site's scroll
   lock once. Scrubs read the scroll position; pins rewrite the document
   height. The comment says it better than I can. Never re-pin.
4. **`.pf-armed` / "the resting state is the finished state".** Photos are
   visible without JavaScript and under `prefers-reduced-motion`; only the
   *hiding* is added by script. Any reveal added later must be built the same
   way round.
5. **The order-flow trust model.** Prices recomputed server-side from ids and
   quantities only; the order filed under the phone number in the httpOnly
   cookie, not the one in the form; verification *derived* (`verifiedPhone ===
   phoneCheck.e164`) rather than stored, so editing the number silently
   un-verifies; the server's `reason` code — never the prose — driving the
   badge reset. Do not "simplify" any of it.
6. **`isLunchService` seeded on the server and re-checked on an interval.** The
   first paint has lunch in the right place and the whole page does not
   reshuffle after mount. That is the correct trade for a dynamic route.
7. **The `es` typing (`Record<TranslationKey, string>`).** A missing Spanish
   string is a compile error, not a silent English fallback. Every Spanish gap
   in this report exists *because the string was never routed through the
   dictionary at all* — which is exactly the failure mode this design cannot
   catch and a lint rule could. Keep the typing; consider adding the rule.
8. **The rice group's `priceCents: 0` invariance and `verify:rice`.** The
   comment explaining why a $0.00 would be worse than no price at all is right.
9. **The `PhotoPlaceholder` seal watermarks.** See §3 — they are the reason the
   home page shows 7 seals, and stripping them to satisfy a decoration rule
   would leave empty gold rectangles.
10. **`orderTarget()`'s single-source pattern, `data/favorites.ts`'s literal
    ids, `sharedLastOnlineOrder` returning null rather than one number for a
    week with two.** Three small pieces of "state it once, derive the rest"
    discipline that later passes should copy, not erode.

---

## 5. STAGE B — what was executed

Thirteen FIX-NOW items, thirteen commits, none reverted, none reclassified
mid-edit. `tsc --noEmit`, `tsc -p tsconfig.worker.json`, `npm run lint` and
`npm run build:cf` all clean at the end; full-page scroll re-verified at both
widths; `verify:rice` (257/257), `verify:allergy-hint` (17/17) and
`verify:order-cutoff` (28/28) all pass.

| # | status | before → after |
| --- | --- | --- |
| F1 | **done** | Nine translated keys unused, their English hardcoded → all nine wired. 51 "Spicy" on /menu became 51 "Picante"; the Spanish hero got its Spanish tagline. `SpicyMark` moved to its own client module (its old home also exports a server-shaped component). One key added, `fav.bringToSpotlight`, for the last English aria-label in the Spotlight. |
| F2 | **done** | `(619) 656-6888 **or** (619) 656-6787` on six Spanish surfaces → `**o**`. One new key, `ui.or`, beside the `ui.and` that exists for the same reason. `prefix="Call "` reuses `hero.call`. |
| F3 | **done** | "Add +" 2.91:1 → **4.55:1** on all 143 dish rows. |
| F4 | **done** | Contact's Find Us / Call / Hours 2.02:1 → **7.08:1**. Gold keeps every dark-surface label it had. |
| F5 | **done** | Footer Privacy / Terms / credit 3.5:1 → **6.25:1**; hover /60 → /85. |
| F6 | **done** | Inactive language button 4.24:1 → **5.53:1**. |
| F7 | **done** | "ORDER DIRECT · NO DELIVERY-APP FEES · LLAMAR (619)…" → one language per line. `hero.orderDirect`. |
| F8 | **done** | Cart said "Party trays: ready in 20–30 minutes" to a customer holding a family dinner and no tray → "Party trays & family dinners: ready in 20–30 minutes", and in the dictionary, so it is no longer English on the Spanish cart. **The one place Stage B edited English wording** — a two-word noun corrected to match the condition that renders it, because there is no way to add the missing Spanish for a sentence that is wrong in English. |
| F9 | **done** | `· 過敏問題請致電` written inline in JSX — the only hardcoded 中文 on the site → `conf.allergyHeadingZh`. |
| F10 | **done** | Item sheet and cart each announced two "Close" buttons, one a full-viewport invisible scrim → scrims are `aria-hidden` + `tabIndex={-1}`. Tap-outside-to-close re-verified working. |
| F11 | **done** | Closed cart drawer: 11 focusable children inside `aria-hidden="true"`, all reachable by Tab → `inert={!open}`. Measured after: 0 focusable while closed, all 11 focusable the moment it opens. |
| F12 | **done** | Contact page: seven English strings wrapped around a Spanish hours table → fully Spanish. Three labels reuse `footer.findUs` / `hero.call` / `footer.hours`; four keys are new. English output byte-for-byte unchanged. |
| F13 | **done** | `npm run lint`: **22,446 problems / 750 errors → 1 warning, exit 0.** Restating `globalIgnores` replaces eslint-config-next's defaults rather than extending them, so nothing this project generates was excluded. |

All new and changed `es` strings are flagged `TODO(confirm)` for native review
along with the rest of the file. Nine keys are new in total: `ui.or`,
`hero.orderDirect`, `cart.longPrep`, `conf.allergyHeadingZh`,
`fav.bringToSpotlight`, `contact.title`, `contact.callNumber`,
`contact.phoneWelcome`, `contact.open7`.

### Re-measured after the fixes

- Off-scale radii on /menu at 1440: **0**. Off-scale font sizes: **0**.
- Full-page scroll: home, menu and contact all reach the bottom exactly at
  both 390 and 1440; no horizontal overflow anywhere.
- Console: no errors, no warnings beyond React DevTools/HMR notices. Network:
  no 404s (the only one is a deliberate `/zzz-404` probe), no third-party
  requests.
- Order flow re-walked end to end: sheet opens → adds → closes; cart opens
  with `inert` lifted; quantity stepper works and announces "Increase Lunch
  Special".

### The PROPOSE list, final — this is the post-launch backlog

Unchanged from §2 and still accurate, in priority order:

1. **P1** — privacy policy no longer describes the site's cookies *(do this
   one first; it is the only published inaccuracy)*
2. **P5** — checkout's disabled primary button explains nothing
3. **P9** — item sheet claims `aria-modal` it does not implement
4. **P3** — dead category pills under an active filter
5. **P2** — menu-header consolidation
6. **P4** — the allergy message's three different weights
7. **P6** — Spanish search finds nothing
8. **P10** — "Both" is unreadable in the cart
9. **P8** — focus ring fails 3:1 on light grounds
10. **P11** — free rice never says it is free
11. **P13** — server-side errors have no Spanish
12. **P12** — long-form Spanish (Home, About, legal bodies) — needs the family
13. **P7** — dead components and their CSS
14. **P14** — the batched smalls

One addition to **P14**, found during Stage B verification: page `<meta
name="description">` and the OpenGraph description are English in both
locales — "…Open 7 days at 543 Telegraph Canyon Rd. Call (619) 656-6888 or
(619) 656-6787." is served to Spanish readers and to search engines
regardless of `nmc_lang`. Metadata is untranslated site-wide, which is
consistent, but it means the Spanish half of the site is invisible to
Spanish search.

### Launch-blocker line

**Ship, then polish.** Nothing on the PROPOSE list stops a customer placing an
order or the kitchen printing it. P1 is the only item I would put a date on
rather than a queue position — a privacy policy that describes cookies the
site no longer has is a published inaccuracy, not a rough edge — but it is a
paragraph the owner has to approve either way, and the site can be live while
that happens.

### Where reality contradicted the prompt — the code wins

1. **Screenshots were not available.** The Browser pane does not composite
   frames in this session, so `screenshot` fails and `document.timeline`
   never advances. Every finding is measured from geometry, DOM, computed
   style, the a11y tree and the network — see the method note at the top. The
   brief's "or describe from render — say which at the top" is what happened.
2. **The lunch-OFF menu state was not observed.** The audit ran at 11:12 AM
   local, i.e. inside the 11–3 window, and lunch placement is decided by the
   server clock. The OFF layout is described from `OrderMenu.tsx` and
   `gates.ts`.
3. **Lighthouse was not run.** No Lighthouse runner is available here, and a
   dev-mode measurement (HMR-instrumented, 4.4 MB of scripts on /menu) would
   have been a number worth nothing. The one structural perf finding I can
   stand behind without it: the home page's LCP element is the hero poster,
   painted as a CSS `background-image` on a `div` rather than an `<img>`, so
   Next cannot prioritise or preload it and the browser cannot discover it in
   the preload scanner. That is in P14's territory and needs a real Lighthouse
   run to size.
4. **The menu-header consolidation was proposed rather than executed.** The
   brief permitted it "IF your Stage A plan is purely compositional". Every
   version I could build inside that constraint recovered under 60 px of an
   831 px wall; the versions that actually help delete a duplicated phrase or
   move a section, which are copy and layout. Per the brief's own "unsure
   means PROPOSE", it is specced in P2 with pixel estimates instead of
   half-done.
5. **F8 edited English.** The rules say copy rewrites are out. The cart's
   long-prep notice was factually wrong for the case it renders in, and it
   also had to move into the dictionary to get its Spanish. Correcting the
   noun was the only way to do the second thing honestly. Flagged here so it
   is a one-line revert if you disagree.
6. **`build:cf` failed once for an environment reason, not a code one.** The
   first run hit `EPERM` removing `.open-next/assets` — a Windows file lock
   held by the running dev server. Stopping the preview and re-running gave a
   clean build. Worth knowing before someone debugs it as a real failure.

---
