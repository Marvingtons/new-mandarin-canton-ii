# Design Plan — New Mandarin Canton II

The site should feel like the dining room: red lacquer, brushed gold,
aged paper, calligraphy on the wall. Traditional and lived-in — not a
SaaS template, not minimalist, not "Asian fusion."

## Signature element: bilingual headings

Every section heading pairs English with its Chinese characters — the
Chinese set large, ghosted in gold, sitting behind/above the English
like calligraphy on a wall. Implemented once as `<BilingualHeading>`
and reused on all four pages so the device stays consistent.

- Chinese: Noto Serif TC, bold, gold at ~25–35% opacity, `aria-hidden`
  (decorative duplicate of the English), `lang="zh-Hant"`
- English: Playfair Display, lacquer red on light surfaces / ivory on dark
- A short 48px gold rule under each heading finishes the mark

## Palette (tokens in globals.css)

| Token          | Value     | Use                                              |
| -------------- | --------- | ------------------------------------------------ |
| `lacquer`      | `#8e1f1f` | Primary surfaces: header, hero, primary buttons  |
| `lacquer-dark` | `#6b1414` | Hover states, vignette edges                     |
| `gold`         | `#c9a227` | Accents ONLY: rules, ghost text, small-caps labels, one button |
| `gold-light`   | `#e2c568` | Gold hover, Chinese name in header/footer        |
| `ink`          | `#1c1512` | Body text, footer, info placard                  |
| `ivory`        | `#f6efe0` | Page background                                  |
| `cream`        | `#fcf8ee` | Cards on paper surfaces                          |
| `paper`        | `#ede1c8` | NEW — aged-paper neutral for cards & alternating sections |

Gold restraint rule: gold appears as thin rules, ghost characters,
small-caps labels, and at most one filled button per page.

## Typography

- **Display** — Playfair Display (`font-display`): headings only
- **Body** — Lora (`font-body`): warm, readable serif for everything else
- **Chinese** — Noto Serif TC (`font-chinese`): bilingual headings,
  dish names, the 辣 spicy mark

## Per-page layout

**Home** — full-bleed 100svh video hero (`HeroVideo.tsx`): newmandarin-hero.mp4,
served from R2 — a 10s loop of one dish being made, ending on the plated
salt-and-pepper wings. Two stacked copies crossfade over the loop seam.
The poster (`/hero-poster-plate.jpg`) is that closing plate frame, not
frame 0; it is also what a reduced-motion visitor keeps, under a 30s Ken
Burns drift, and no video is mounted for them at all.

Three overlay layers marry the amber footage to the deep-red/cream/gold
palette, all tuned by compositing them over every frame and reading WCAG
contrast under the real text boxes (see `.hero-scrim` in globals.css for
the measurements): an 8% `--lacquer` multiply tint over the whole frame;
a short `--lacquer-dark` top ramp (0.82 → 0 by 15%) that carries the
header's own red down over the footage so the transparent-header state
has no seam; and an ink bottom ramp (0 at 42% → 0.88) that guarantees
the copy its contrast. The hero then hands off to the first cream
section through a shallow arc hem sharing the divider rules' curve
grammar — deepest at the two page edges, nothing at the centre.

Text (富源, name, tagline, View Menu +
Call CTAs) staggers in 80ms apart only after the loading overlay lifts
(coordinated via `src/lib/introSignal.ts`). Header floats transparent
over the hero and turns solid lacquer on scroll past it (home only).
Then: House Favorites strip on `paper` (chef's specials + items tagged
house special/popular, 4–6 cream cards), a centered Our Story teaser,
and an ink placard info band (Hours / Find Us / Call) with a double
gold frame.

**Menu** — physical-menu typography: bilingual category headings,
dotted leader lines from dish name to price, Chinese dish names inline
and muted, 辣 mark for spicy items. Two-column items ≥ md, single
column below. Sticky category nav (anchor links) under the header.

**About** — pull-quote opening line (Playfair italic, gold left rule),
2–3 TODO paragraphs, three framed photo slots on paper
with ghost glyphs (堂 / 香 / 廚) and captions.

**Contact** — two columns: address + large tap-friendly call button /
hours table with today's row highlighted client-side (gold tint +
"Today" chip). Full-width framed Google Maps embed below.

## Motion & accessibility

- Loading overlay: first visit per session, a gold-leaf reveal — the
  textured lacquer field settles in from black, the 富源 lockup
  (fu-yuan-logo.svg, recolored via CSS filter only) appears as a
  debossed impression, fills with gold via a feathered mask sweep, and
  catches one glint before the sheet lifts (~3.4s once the page has
  loaded, 8s hard cap). Plays once, no loop; skipped entirely on repeat
  visits in the session and under `prefers-reduced-motion`. Fires the
  intro signal the hero's text entrance listens to. (Supersedes the
  earlier stroke-writing preloader and StampIntro seal press.)
- One orchestrated in-page moment: hero elements settle upward on load
  (staggered ~120ms), disabled under `prefers-reduced-motion`
- Global `:focus-visible` outline in gold
- No scroll-jacking, no particles, nothing else animates
- Responsive floor: 375px (menu page checked explicitly)
- No invented facts — TODO markers stay until real content arrives
