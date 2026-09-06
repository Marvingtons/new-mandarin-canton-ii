---
name: New Mandarin Canton II
description: The dining room rendered as a website: lacquer red, brushed gold, aged paper, calligraphy on the wall.
colors:
  lacquer: "#77151a"
  lacquer-dark: "#5e1015"
  gold: "#da9f52"
  gold-light: "#eabd62"
  ink: "#1e1510"
  ivory: "#f8f1e3"
  cream: "#fcf7ec"
  paper: "#eedfc0"
  ivory-muted: "color-mix(in srgb, #f8f1e3 55%, #1e1510)"
typography:
  display:
    fontFamily: "Playfair Display, serif"
    fontSize: "clamp(1.5rem, 5vw, 3.75rem)"
    lineHeight: 1.1
  body:
    fontFamily: "Lora, serif"
    fontSize: "1rem"
    lineHeight: 1.6
  chinese:
    fontFamily: "Noto Serif TC, serif"
    fontWeight: 500
  label:
    fontFamily: "Lora, serif"
    fontSize: "0.875rem"
    fontWeight: 600
    letterSpacing: "0.15em"
rounded:
  sm: "6px"
  md: "11px"
  lg: "18px"
  full: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.lacquer}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.lg}"
    padding: "0 1.25rem"
    height: "3rem"
  button-primary-hover:
    backgroundColor: "{colors.lacquer-dark}"
  button-gold:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 1.5rem"
    height: "3rem"
  button-gold-hover:
    backgroundColor: "{colors.gold-light}"
  card:
    backgroundColor: "{colors.cream}"
    rounded: "{rounded.md}"
    padding: "1.25rem"
  chip:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "0.375rem 0.75rem"
---

# Design System: New Mandarin Canton II

<!-- Documentation pass. This file records the system as implemented in
     src/app/globals.css, src/lib/brand/ and src/lib/motion/. It proposes
     nothing. Where prose and code disagreed, code won. -->

## Overview

**Creative North Star: "The Dining Room, Printed"**

The site is the room it belongs to, set in type. Red lacquer, brushed gold,
aged paper, calligraphy on a wall. It reads as something printed and hung
rather than something rendered: a menu card, a seal pressed into paper, a
framed photograph on a painted wall. It is traditional and lived in.

The system is unusually disciplined for its warmth. Every color is reconciled
to one physical object (the seal artwork at `public/fu-yuan-logo.svg`, which is
printed and on the door), every corner resolves to one of four radius values,
and every curved boundary on the site is generated from a single cubic in
`src/lib/brand/arc.ts`. Decoration is budgeted rather than sprinkled. The
restraint is what keeps the warmth from tipping into pastiche.

Confirmed rejections: red-and-gold restaurant clipart, oyster pails, dragons,
fortune cookies, delivery-app density, glassmorphism, purple gradients, stock
photography, and SaaS minimalism.

**Key Characteristics:**

- One red, two golds by role, one ink, one cream family
- Contrast treated as arithmetic, with the measurements written beside the tokens
- Four radius steps and no fifth
- One arc definition, two shapes, every consumer
- Gold is structure and emphasis, never body text on a light ground
- Bilingual EN and 中文 pairing as the signature device

## Colors

Warm, low-chroma, and lifted directly off a printed seal rather than chosen on
screen. Five of these are the brand's own colors. Three are derived roles that
the artwork does not contain and that exist to carry structure.

### Primary

- **Seal Lacquer** (`#77151a`): The seal's own red. Header, hero, primary
  buttons, headings on light grounds, and any label that must sit on cream,
  ivory or paper. Measures 7.08:1 on ivory.
- **Pressed Lacquer** (`#5e1015`): The same red darkened. Button hovers and the
  hero's top ramp. Derived, and explicitly not a second red.

### Secondary

- **Imperial Gold** (`#da9f52`): STRUCTURE. Rules, borders, dividers, frame
  edges, quiet accents. Never text on a light ground.
- **Lit Gold** (`#eabd62`): EMPHASIS. Text on dark surfaces, active states,
  filled controls. Its home is ink (10.22:1) and lacquer.

### Neutral

- **Ink** (`#1e1510`): Body text, footer, the info placard, the preloader ground.
- **Ivory** (`#f8f1e3`): The page background.
- **Cream** (`#fcf7ec`): A card sitting on the page. Derived role, not in the artwork.
- **Aged Paper** (`#eedfc0`): The alternating section band. Derived role, not in the artwork.
- **Muted Ivory** (`color-mix(in srgb, ivory 55%, ink)`): The single sanctioned
  quiet text color on ink, at 5.56:1.

### Named Rules

**The Seal Rule.** The palette is the seal's, not a taste. The mark is printed
and on the door, so a near-miss around it reads as a second brand. Colors change
in `globals.css` or they do not change.

**The No Gold On Light Rule.** Every gold in the palette measures about 2.1:1 on
cream, ivory and paper, and no other gold fixes it. A label that must sit on a
light ground uses lacquer. Gold's home is ink and lacquer.

**The Floor Rule.** Nothing quieter than `--ivory-muted` may carry text on ink.
If a line must recede further, change the face or the size. The color has no
room left underneath it.

**The Six Appearances Rule.** The seal appears in six sanctioned places and
there is no seventh: header lockup, footer lockup, preloader stamp, confirmation
signature, favicon and app icon, and the OG card. The `GoldDivider` ornament
(budgeted at two per page) and the `PhotoPlaceholder` watermark at 6% are
protected extensions rather than exceptions.

**The Gold Budget Rule.** Gold appears as thin rules, ghost characters,
small-caps labels, and at most one filled button per page.

## Typography

**Display Font:** Playfair Display (serif fallback)
**Body Font:** Lora (serif fallback)
**Chinese Font:** Noto Serif TC, weights 500 and 700

**Character:** Three serifs and no sans anywhere. Playfair carries the printed
menu card's authority, Lora keeps long reading warm rather than austere, and
Noto Serif TC sits beside them without a register change. The absence of a sans
face is the decision that keeps the site from reading as a template.

### Hierarchy

- **Display** (Playfair, `text-4xl` to `text-6xl`, tight leading): Page titles
  and the hero name. Headings only.
- **Headline** (Playfair, `text-2xl` to `text-3xl`): Section headings, the item
  sheet title, pull quotes (italic).
- **Title** (Playfair, `text-xl`): Card titles, dish names in feature strips.
- **Body** (Lora, `1rem`, relaxed leading): All running copy. Reading column
  capped at `max-w-3xl`.
- **Label** (Lora, `text-xs` to `text-sm`, semibold, uppercase, `0.15em`
  tracking): Small caps labels, status lines, meta rows.
- **Chinese** (Noto Serif TC, `lang="zh-Hant"`): Bilingual headings, dish names
  inline and muted, the 辣 spicy mark.

### Named Rules

**The Bilingual Heading Rule.** Section headings pair English with their Chinese
characters, the Chinese set large and ghosted in gold behind the English like
calligraphy on a wall, `aria-hidden` because it is a decorative duplicate, with
`lang="zh-Hant"`. Implemented once and reused, so the device stays one device.

**The Ornament Rule.** Chinese that carries no meaning on a page is an ornament
and comes off. A single line of 中文 on a page with no other Chinese does not
earn its place.

## Layout

A centered reading column with two deliberately separate container widths. The
site-wide reading width is `max-w-5xl` (`max-w-3xl` for prose pages such as
About), and a wider container (`--container-wide-max: 1520px`, padding
`clamp(1.25rem, 4vw, 4rem)`) is reserved for the nav and the hero alone, so the
logo can anchor top-left and the hero text finds a sensible left margin on wide
screens.

Sections alternate between ivory, cream and aged paper to create the vertical
rhythm; the alternation is the rhythm, which is why cream and paper cannot be
collapsed into one neutral. Menu items are two columns at `md` and above, single
column below. The responsive floor is 375px. Safe-area insets are paid on every
element pinned to the bottom edge (the sticky cart bar, the item sheet's add bar),
with the surface extending under the home indicator and the control stopping
above it.

Touch targets are a correctness requirement, not polish: interactive elements
carry `min-h-11` (44px) or `min-h-12`, and a `.tap` utility supplies a 44px
minimum hit area via a centered pseudo-element for controls that must render
smaller than they are pressed.

## Elevation & Depth

**This system is essentially flat, and depth is carried by tonal layering and
line rather than by shadow.** The vocabulary is: a change of ground (ivory to
cream to paper to ink), a gold rule or border, and the frame's mount-and-hairline
construction. There is no documented shadow scale and no ambient shadow on
resting surfaces.

Two shadow uses exist in the implementation and both are functional rather than
decorative:

- **Focus halo** (`box-shadow: 0 0 0 6px rgba(var(--ink-rgb), 0.45)`): an ink
  halo outside the gold focus ring, so that one of the two always clears 3:1 on
  any ground. Dropped on ink surfaces and in the footer, where it has nothing
  to say.
- **Overlay elevation**: the item sheet, cart drawer, back-to-top button and
  test badge use Tailwind's default `shadow-lg` / `shadow-xl`. These are
  untokenized and neutral-black rather than ink-derived. See Do's and Don'ts.

### Named Rules

**The Flat Ground Rule.** Surfaces at rest cast nothing. Depth comes from
changing the ground or drawing a gold line. A shadow on the page is either a
focus affordance or a floating overlay, and never an ambient decoration.

## Shapes

The reference tradition curves: eaves lift at the corner, a moon gate is a
circle, nothing structural meets at a raw 90 degrees. That is expressed as one
idea in two mechanisms.

**The radius scale is four values and nothing else.** `sm` 6px (chips, tags,
small inputs, the code field), `md` 11px (cards, framed images, panels, notice
banners), `lg` 18px (CTAs, the cart drawer, the item sheet, large feature
frames), `full` 9999px (genuine pills and circles). The steps are deliberately
not a doubling series: 6 to 11 to 18 keeps each tier visibly distinct at the
sizes they are actually used at, where 4 to 8 to 16 would make `sm` and `md`
indistinguishable on a 32px chip. They live in `@theme` so one declaration
redefines Tailwind's `rounded-*` utilities and resolves `var(--radius-*)` in
hand-written CSS, which is what stops a utility and a stylesheet rule from
drifting apart.

**The arc is one definition with two shapes**, authored in a 100 by 10 box and
stretched with `preserveAspectRatio="none"`, so it is a proportion rather than a
fixed radius. Both are cubics with a horizontal tangent at both ends, so a curve
meets the page edge flat and meets its mirror flat at the centre with no kink.

- `HEM_D`: a closed boundary between two fills, deepest at the two page edges
  and nothing at the centre. Consumed by the hero's bottom edge and the
  preloader's wipe, which are the same edge at two moments.
- `HEM_SKIRT_D`: the same cubic filled on the other side, for the lifting curtain.
- `RULE_D(side)`: an open rule, one half at a time, cresting where the divider's
  ornament sits. Consumed by `GoldDivider`'s `ArcRule`.

**The frame** is the site's other signature silhouette: a 2px mount in cream, a
1px gold edge at 60% opacity, and an inner hairline at 45% drawn as an inset
outline rather than a nested element, with `overflow: hidden` clipping the
contents to the curve.

### Named Rules

**The Four Values Rule.** Every rounded corner resolves to `sm`, `md`, `lg` or
`full`. A one-off `rounded-[3px]` is the thing the scale exists to prevent.

**The One Curve Rule.** A change to the house curve is a change to
`src/lib/brand/arc.ts`. Retyping the geometry at a call site is how three "same"
arcs become three approximations.

**The One Gold Edge Rule.** The frame's three variables are the whole signature.
Nothing else on the site may draw a gold edge.

## Components

### Buttons

- **Shape:** Generously curved (`lg`, 18px). Height `min-h-12` (48px).
- **Primary:** Lacquer ground, ivory text, `hover:bg-lacquer-dark`, with a
  `transition-colors` only.
- **Gold (the one filled gold control per page):** Gold ground, ink text,
  `hover:bg-gold-light`.
- **Outline (on ink):** Gold border at 60%, gold-light text, inverting to a gold
  ground with ink text on hover.
- **Disabled:** `opacity-50` and `cursor-not-allowed`. A required choice with no
  sensible default leaves the button dead and names the reason rather than
  preselecting on the customer's behalf.
- **Focus:** 2px gold outline at 2px offset, plus the ink halo (see Elevation).

### Chips

- **Style:** Fully rounded (`full`), cream ground, gold border at 50%, ink text,
  semibold, `min-h-11` on mobile.
- **State:** Selected chips take a gold-tinted ground; category nav links take a
  transparent border that fills to gold at 60% on hover.

### Cards / Containers

- **Corner Style:** `md` (11px).
- **Background:** Cream on ivory or paper grounds; `bg-ink/60` on the kitchen board.
- **Shadow Strategy:** None at rest. See Elevation.
- **Border:** 1px gold at 40%, or the frame construction for anything holding a
  photograph.
- **Internal Padding:** `px-5 py-3` for list rows, `px-5 py-5` for panels.

### Inputs / Fields

- **Style:** Gold stroke on cream, `sm` or `md` radius depending on size.
- **Focus:** The global gold ring and ink halo. No color change on the field itself.

### Navigation

- **Style:** Playfair for the lockup, Lora small caps for links. The header
  floats transparent over the hero and turns solid lacquer on scroll past it,
  on the home route only. A sticky category bar with anchor links sits under
  the header on the menu.

### Signature Components

- **`BilingualHeading` / `SectionHeading`:** The English and Chinese pairing plus
  a short 48px gold rule. Used on every page so the device stays consistent.
- **`GoldDivider`:** The arc rule with a centered seal ornament. Budgeted at two
  per page.
- **`Seal`:** The 富源 mark, with a `tone="chop"` variant that renders lacquer on
  ivory at 7.08:1 for the confirmation signature.
- **`PhotoFrame` / `PhotoPlaceholder`:** The frame construction, with a ghost
  glyph and a 6% seal watermark when no photograph has arrived. Placeholders stay
  until real photography exists.

## Do's and Don'ts

### Do:

- **Do** change colors only in `src/app/globals.css`. Components inherit.
- **Do** use `lacquer` for any label that must sit on cream, ivory or paper.
- **Do** resolve every corner to one of the four radius steps.
- **Do** import the arc from `src/lib/brand/arc.ts` rather than retyping a cubic.
- **Do** derive overlays and tints from `--ink-rgb` or `color-mix` on an existing
  token, the way `--frame-edge` and `--ivory-muted` do.
- **Do** keep `prefers-reduced-motion` paths real: the loading overlay is skipped
  entirely and the hero mounts no video at all.
- **Do** leave a placeholder standing when a fact or a photograph has not arrived.

### Don't:

- **Don't** put any gold on a light ground as text. It measures about 2.1:1 and
  no other gold fixes it.
- **Don't** introduce a third gold, a second red, or a fourth neutral.
- **Don't** add a fifth radius value or an arbitrary `rounded-[Npx]`.
- **Don't** draw a gold edge anywhere except through the frame's three variables.
- **Don't** hardcode a color that a token already names. `rgba(201,162,77,0.25)`
  in `KitchenOrderCard.tsx` is the one place this has happened and it is a
  defect, not a precedent.
- **Don't** reach for Tailwind's default `shadow-*` on a new surface. The system
  is flat, and the four existing uses are neutral-black on a warm palette rather
  than ink-derived.
- **Don't** animate with bounce or overshoot. `--ease-stamp` exists for the seal's
  press and nothing else bounces.
- **Don't** use em dashes in copy.
- **Don't** add a seventh sanctioned appearance of the seal.

## Per-Page Surfaces

<!-- Retained deliberately. The DESIGN.md spec has no home for surface
     composition, but this is real documentation of the incumbent build and
     deleting it to satisfy the schema would lose information. -->

**Home** (persuade above the fold, operate below). Full-bleed 100svh video hero
(`HeroVideo.tsx`), a 10s loop ending on the plated salt-and-pepper wings, served
from R2. Three overlay layers marry the amber footage to the palette, each tuned
by reading WCAG contrast under the real text boxes: an 8% lacquer multiply tint
over the frame, a lacquer-dark top ramp (0.82 to 0 by 15%) carrying the header's
red down over the footage so the transparent-header state has no seam, and an
ink bottom ramp (0 at 42% to 0.88) guaranteeing the copy its contrast. The hero
hands off to the first cream section through the shallow arc hem. Reduced-motion
visitors keep the poster frame under a 30s Ken Burns drift and no video is
mounted. Below: House Favorites on paper, an Our Story teaser, and an ink placard
info band with a double gold frame.

**Menu.** Physical-menu typography: bilingual category headings, dotted leader
lines from dish name to price, Chinese dish names inline and muted, the 辣 mark
for spicy items. Sticky category nav under the header.

**Item sheet.** Bottom sheet on phones (`rounded-t-lg`, ending at the physical
bottom edge with safe-area padding), centered dialog at `sm` and up. Quantity
stepper at 44px per control. The add bar shows the resolved price.

**Checkout.** Two columns at `lg` (form, then a sticky summary aside), stacked
and summary-first below. Empty-cart state is its own branch with its own `h1`.

**Confirmation.** Centered, opening with the seal at `tone="chop"` as the
signature the transaction ends with. Order number, pickup window as clock time
rather than a countdown, and the amount due. An allergy note surfaces only when
the order notes looked allergy-shaped, and it never blocks anything.

**About.** Pull quote in Playfair italic with a gold left rule, the family's own
story, a crane mark (鶴, long life) in the left margin at gold 30%, gated at
`xl` where the gutter can hold it, and three framed photo slots.

**Kitchen board.** Not a customer surface and deliberately louder: ink ground,
4px borders, a `text-5xl` order number, and a ring on the freshest ticket.
Legibility across a hot room outranks consistency with the customer-facing site.

## Motion

- **Loading overlay:** first visit per session only. A gold-leaf reveal, the
  textured lacquer field settling in from black, the 富源 lockup appearing as a
  debossed impression, filling with gold through a feathered mask sweep, one
  glint, then the sheet lifts along `HEM_SKIRT_D` (roughly 3.4s once loaded, 8s
  hard cap). Skipped entirely on repeat visits and under reduced motion.
- **Tokens:** `--t-fast` 150ms, `--t-med` 300ms, `--t-slow` 700ms, `--t-ambient`
  2.4s. `--ease-out-soft` is the site's voice. `--ease-stamp` is the seal's
  overshoot and has exactly one consumer. GSAP mirrors these in
  `src/lib/motion/tokens.ts` and the two halves must change together.
- **One orchestrated moment:** hero elements settle upward on load, staggered
  about 80 to 120ms, only after the loading overlay lifts.
- No scroll-jacking, no particles, nothing else animates.
