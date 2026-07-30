# Design Audit — New Mandarin Canton II (富源)

Audited 2026-07-27 against `main` @ `f8fb804`, dev server at 1440px and 390px.

---

## ⚠️ Methodology limitation — read this first

**I could not take screenshots.** The Browser pane was not displayed in this
session, so the page never composited frames and every screenshot attempt timed
out. Everything below comes from the live DOM: computed styles, resolved font
stacks, canvas-resolved contrast ratios, layout rects, and the source.

**What that means for you.** Measurable things — type sizes, palette, contrast,
overflow, spacing, motion timings, tap targets — are solid; I measured them
rather than guessed. **Composition is not.** Whether the hero *looks* balanced,
whether the spotlight *reads* as elegant or empty, whether the gold-leaf intro
feels expensive or slow — I cannot tell you, and I have not pretended to. Where
a judgement needed eyes I have said so explicitly rather than inventing a verdict.

Two further cautions, because I got things wrong mid-audit and corrected them:

- **My CSS-rule scanner is unreliable here.** It cannot see reliably into
  Tailwind v4's `@layer` blocks. It reported "zero `:focus` rules" and "no
  `.bg-lacquer` rule" — both false; the source has them. Every finding below is
  sourced from `getComputedStyle` (reliable) or a direct source grep, never
  from that scanner.
- I initially concluded the Chinese font was falling through to a system
  default. **That was wrong** — see §3.3. I verified and withdrew it.

---

## 1. Verdict

**No — it does not read as premium today, and the reason is content, not design.**
The design system underneath is genuinely considered: a real token system, a
palette that mostly dodges the template clusters, orchestrated (not scattered)
scroll choreography, and unusually thorough `prefers-reduced-motion` support.

**The single biggest thing holding it back: there are zero photographs on a
restaurant website.** All 12 image slots render placeholder panels; the homepage
serves `0` `<img>` elements. Worse, the marquee "House Favorites" component is
architected photo-first — so the empty state is *actively worse* than a design
that had honestly assumed no photography.

Second: the site is monolingual English wearing a Chinese logotype. The only
CJK anywhere on the homepage is 富源 / 富 / 源 — the brand mark. Bilingual is a
costume here, not a feature.

---

## 2. Content vs. design

| # | Weakness | Class | Notes |
|---|---|---|---|
| 1 | 12/12 photo slots empty; 0 `<img>` on homepage | **CONTENT** | [images.ts](../src/data/images.ts). No CSS fixes this |
| 2 | House Favorites is built around a photo and renders the literal label "Photo" | **BOTH — design dominates** | [FavoritesSpotlight.tsx:86](../src/components/FavoritesSpotlight.tsx#L86). Needs a real photo-less mode |
| 3 | 3× `[PASTE REAL GOOGLE REVIEW]` live on the homepage | **CONTENT** | [reviews.ts:19,24,29](../src/data/reviews.ts#L19). Ships visible by design |
| 4 | 中文 on 34/138 dishes; zero Chinese in the marketing UI | **CONTENT** | Translation, then a design decision about where it surfaces |
| 5 | Scrolled header background does not paint | **DESIGN** | §7.1 — measured, cause not isolated |
| 6 | 1,350 ms gate before first paint of content | **DESIGN** | [LoadingOverlay.tsx:20](../src/components/LoadingOverlay.tsx#L20) |
| 7 | Party trays invisible outside a 4-clicks-deep modal | **DESIGN** | §5.4 — the commercial miss |
| 8 | 9 text elements at 9.6–9.92px | **DESIGN** | §3.5 |
| 9 | 4 real contrast failures | **DESIGN** | §4.4 |
| 10 | Playfair Display + Lora — the default "warm restaurant" pairing | **DESIGN** | §3.4 |
| 11 | Hero is headline + subhead + two buttons | **DESIGN** | §5.1 |
| 12 | Duplicate `<h2>` ("Hours", "Find Us") | **DESIGN** | Trivial |

### The ceiling with zero food photography

**Competent and characterful. Never appetizing. Call it 70%.**

I want to be blunt about this because it decides where your money goes. A
restaurant site's job is to make someone hungry, and hunger is not a
typographic effect. Type, color, and motion can establish *this place is real,
it has been here a long time, these people know what they're doing* — and this
site is genuinely well-built to do that. That is worth a lot, and it happens to
match your brief exactly.

What it cannot do is make someone want the orange chicken. No amount of design
work moves that number. And the current build makes it worse than it needs to
be: the spotlight is a photo frame with the word "Photo" in it, so the most
prominent section of the homepage is an apology for missing content.

**Spend on photography before you spend another hour on CSS.** With 12–20 real
dish photographs this design reaches genuinely good. Without them it has a hard
ceiling, and roughly half the polish already in the codebase is invisible.

---

## 3. Typography

**3.1 Faces loaded** — three, via `next/font/google` ([layout.tsx:10-29](../src/app/layout.tsx#L10)):

| Face | Role | Weights |
|---|---|---|
| Playfair Display | `--font-display`, headings | default axis (variable) |
| Lora | `--font-body`, body | default axis (variable) |
| Noto Serif TC | `--font-chinese` | 500, 700 |

**3.2 Type scale.** There is a scale, and it is mostly Tailwind's. Measured:
`h1` 60px/75px (1.25), `h2` 36px/36px (**1.0**), body 16px/24px. The `h2`
leading of exactly 1.0 is too tight for Playfair, whose descenders are long —
that is a real typographic error, not a preference.

**3.3 The Chinese question — it passes, and I was wrong about it.**

My first read said the CJK was falling through to a system serif, because
`layout.tsx` requests `subsets: ["latin"]` on a Traditional Chinese face and the
first `@font-face` rules I sampled covered only Latin/Cyrillic/Vietnamese.

That was wrong, and I checked before writing it up. There are **217**
`@font-face` rules for Noto Serif TC, including full CJK ranges (U+3401,
U+63EC, U+8C6D…), and the browser confirms directly:

```
document.fonts.check('700 288px "Noto Serif TC"', '富源')  →  true
```

The bilingual pairing is **deliberate, not accidental**: a Traditional Chinese
serif against a Latin serif, with `font-display: swap` and glyph chunks loading
on demand. The comment in `layout.tsx` is accurate. Credit where due — most
sites genuinely do get this wrong.

Leading is handled sensibly where it matters: the 288px lockup runs 0.95
leading (tight, correct for a two-character display mark), the 14px marks run
1.43. CJK tracking is heavy — 0.4em–0.5em — but on a two-character logotype
that is 疏排, a legitimate device, not a mistake.

The real Chinese problem is not typographic. **There is no Chinese content to
set.** See §6.6.

**3.4 Is the display face doing work?** Honestly: no.

Playfair Display is the single most over-used "premium restaurant" serif on the
web — the default answer, not a decision. Paired with Lora it is the stock
"warm, established, family-run" combination that a hundred template sites ship.
Nothing here is *wrong*; the pairing is competent and readable. But it takes
zero risk, and it is the main reason the site can read as templated even though
the code underneath is not. This is the one typographic change I would make.

**3.5 Type too small.** Nine elements at **9.6px and 9.92px** — "Est. 1995",
"30+ years on Telegraph Canyon", and the photo captions. Sub-10px is below a
comfortable floor on any screen and unreadable for the older regulars who are a
real part of this audience. Body copy at 16px/24px is fine.

---

## 4. Color, space, and the templated-defaults check

**4.1 Palette** — a proper token system, `:root` → `@theme inline`
([globals.css:27-58](../src/app/globals.css#L27)). No duplicated inline hexes
found. This is done well.

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#1e150f` | Hero bg, footer, body text |
| `--ivory` | `#f8efd9` | Page background, text on dark |
| `--cream` | `#fcf5e6` | Alternating sections |
| `--paper` | `#eedfc0` | Third section tone |
| `--gold` | `#cfa52e` | Rules, seal, accents |
| `--gold-light` | `#e8c660` | Hover, 富源 mark |
| `--lacquer` | `#96261c` | Headings, solid header, CTA band |

**4.2 Calibration check — the honest answer: partially yes, but rescued.**

You are sitting in **cluster 1** (cream `#f8efd9` ≈ the `#F4F1EA` tell, plus a
high-contrast serif) and adjacent to **cluster 4** (red-and-gold Chinese
signifiers). On a palette-swatch-and-font-list basis this is a recognisable
template look, and I am not going to pretend otherwise.

What pulls it out — and this is real, not consolation:

- **No dragons, no ornamental borders, no script face, no faux-brush lettering.**
  The decorative vocabulary of cluster 4 is absent.
- **The red and gold have a referent.** Lacquer red and gold leaf are not "Chinese
  restaurant colors" here; they are the seal, the altar, the gold Buddha — actual
  objects in the actual room, named in the photo captions
  ([images.ts:52](../src/data/images.ts#L52)). That is meaning, not decoration,
  and it is the difference between this and a template.
- **The copy is specific.** "The altar — incense & tangerines", "30+ years on
  Telegraph Canyon", "Cooked the way it's always been." Nobody writes that for a
  template.

So: the *ingredients* are templated, the *reasoning* is not. Swap Playfair and
the accusation mostly evaporates.

**4.3 Spacing.** Consistent. Content sections are uniformly `py-16` (64px);
containers are `max-w-5xl` with `px-4`. Wide elements use dedicated
`--container-wide-*` tokens. I found no one-off margin soup.

**4.4 Contrast failures (WCAG AA).** Canvas-resolved, alpha composited:

| Text | Size | Ratio | Needs | |
|---|---|---|---|---|
| "30+ years on Telegraph Canyon" | 9.6px | **1.51** | 4.5 | ✗ |
| "Est. 1995" | 9.6px | **2.02** | 4.5 | ✗ |
| "Website by Norvix" | 12px | **3.50** | 4.5 | ✗ |
| Photo captions ×4 | 9.92px | **4.48** | 4.5 | ✗ marginal |

Gold `#cfa52e` on ivory `#f8efd9` is the recurring offender — it is a ~2:1
pairing and cannot carry text at any size. Use it for rules and the seal, never
for words.

*Not* failures, despite an early false positive in my own tooling: all footer
and hero text on `--ink`, which passes comfortably.

---

## 5. Hero and signature

**5.1 The hero is the stock arrangement.** 富源 watermark, `h1` "New Mandarin
Canton II", subhead "MANDARIN, SZECHUAN & CANTONESE CUISINE IN CHULA VISTA",
then two buttons ("Order Takeout" / "View Menu"). That is the textbook layout.

It is a *well-executed* stock arrangement — there is a video layer, a scrim, a
giant seal watermark, and the h1 is properly the restaurant name. But it opens
with the restaurant's *name*, which every restaurant site does, rather than with
the most characteristic thing about this restaurant. It does not open with food,
with the room, with the family, or with thirty years.

**5.2 Signature element — yes, there is one, and it is in the wrong place.**

The gold-leaf loading overlay ([LoadingOverlay.tsx](../src/components/LoadingOverlay.tsx)):
the 富源 seal appears debossed in a textured lacquer field, fills with gold via a
sweeping feathered mask, catches a single glint, then the sheet lifts. That is a
genuinely distinctive, memorable, describable thing. It is the one element on
this site nobody else has.

It also plays **once per session, before the customer can see anything**, with a
**1,350 ms floor** — so its entire budget is spent taxing a hungry person. The
signature is real; its placement is backwards. (Caveat: I could not watch it. I
am judging the concept and the timings from source, not the execution.)

**5.3 Structural devices are honest.** I looked specifically for decorative
`01/02/03` numbering on non-sequences and **found none** — a common tell, absent
here. The eyebrows and captions ("THE ALTAR — INCENSE & TANGERINES", "FAMILY AT
WORK") name real things. The gold dividers are ornament, but restrained and
consistent. No complaints.

**5.4 Party trays — the commercial miss, and the most valuable finding here.**

Party trays appear **nowhere on the marketing site**. Grepping the homepage,
`/menu`, `MenuSection`, and `MenuCombos` for tray pricing returns **zero hits**.

They surface in exactly one place: the item modal in the order flow, behind a
`sizes.length > 1` conditional ([ItemSheet.tsx:133](../src/components/order/ItemSheet.tsx#L133)),
reachable only via land → Order → find item → tap item → read the size toggle.
That is four interactions deep, on **12 of 138 items**, with no signposting anywhere.

Your highest-ticket item — a $75–$100 tray against a $19.95 entrée — is
functionally invisible to anyone who does not already know to look. The dual
pricing is not "buried"; on the marketing site it does not exist. `/menu` shows
individual prices only, because `menu.ts` only carries individual prices and
tray pricing lives in a separate file the marketing pages never import.

---

## 6. Motion and the order path

**6.1 Motion is orchestrated, not scattered — this is a strength.** The
homepage runs a single GSAP `ScrollTrigger` timeline
([HomeChoreography.tsx](../src/components/HomeChoreography.tsx)) with shared
easing tokens (`--ease-out-soft`, `--ease-stamp`) and shared durations
(`--t-fast` .15s, `--t-med` .3s, `--t-slow` .7s, `--t-ambient` 2.4s). This is
**not** the reveal-on-scroll-everything tell. Someone thought about it.

**6.2 `prefers-reduced-motion` is respected properly** — 7 CSS media blocks plus
JS guards in every motion component, and `createMotionContext()` returns `null`
so timelines never build. Better than most production sites.

**6.3 The load gate is a real cost.** `MIN_SHOW_MS = 1350` with `MAX_WAIT_MS =
8000` and a 400ms fade. First-visit-per-session only, and skipped under reduced
motion — both good decisions. But on a takeout site, 1.35s of enforced animation
between a hungry person and the menu is a conversion tax, and it applies on
`/order` too, not just the homepage.

**6.4 Order path.** Landing → "Order Takeout" (1) → `/order` (all 138 items) →
tap item (2) → sheet → Add (3) → cart → Checkout (4) → phone → send code (5) →
enter code (6) → Place order (7). Roughly **4 clicks to a cart, 7 to submitted** —
reasonable, no dark patterns, prices recomputed server-side.

**6.5 Phone.** Tappable `tel:+16196566888`, and above the fold on mobile at
y=285. But the tap target is **14px tall**. For an audience where a large share
will call rather than order online, that is the wrong size — it should be the
most confident target on the screen. 13 tap targets sit under 44px overall.

**6.6 Bilingual is not real, and it is inconsistent in a revealing way.**

The customer-facing UI is **English-only**. Labels, nav, menu, hours, buttons —
all English. `MenuSection.tsx:5-8` states the position explicitly: the menu is
English-only by design, the spicy marker was deliberately changed *away* from 辣
so guests who cannot read Chinese still get the warning. That is a defensible
call, honestly reasoned.

But the *error strings* are bilingual — "請先驗證電話號碼。", "電話號碼與已驗證的號碼不符。"
— and the kitchen ticket is Chinese-**primary**. So the system speaks Chinese to
staff and in failure messages, and English to customers everywhere else.

**There is no language toggle.** A 60-year-old regular who reads Chinese more
comfortably than English can navigate nothing, read no dish name, and understand
no button — until something goes wrong, at which point the error is bilingual.
That is the inversion, and it is the strongest argument for either committing to
a real toggle or dropping the bilingual error strings.

**6.7 Empty and error states.** The cart empty state is designed
([CartDrawer.tsx:67](../src/components/order/CartDrawer.tsx#L67), "Your cart is
empty" in the display face). Checkout errors are handled in component state and
rendered as styled text — not raw browser output. Fine.

---

## 7. Craft floor

**7.1 The scrolled header background does not paint — needs your eyes.**

Reproducible on a fresh load at 1440px. Scrolling past the hero correctly flips
the class to `bg-lacquer`, but the computed background stays fully transparent
and the nav links stay ivory `#f8efd9`:

| State | class | computed background | nav color |
|---|---|---|---|
| Fresh load, y=0 | `bg-transparent` | `rgba(0,0,0,0)` | `#f8efd9` ✅ over dark hero |
| Scrolled, y=2600 | **`bg-lacquer`** | **`rgba(0,0,0,0)`** | `#f8efd9` ⚠️ over `#f8efd9` |

A shallow **clone of that same header with identical classes** renders
`rgb(150,38,28)` correctly. So the utility exists and works — it is not applying
to the live element. I ruled out inline styles (none), GSAP (`_gsap` absent),
pseudo-elements (both transparent), and the class logic (correct).

**I could not isolate the cause, and I could not see the page.** If it renders
as measured, the entire primary nav is ivory-on-cream (≈1.1:1) on every light
section — the worst defect on the site. It may also be a Turbopack dev-server
artifact. **Check it in a production build (`next build && next start`) before
touching anything.** I flag it because the downside is severe and the check is
five minutes.

**7.2 Responsive at 390px — passes.** No horizontal scroll, zero overflowing
elements, `scrollWidth === clientWidth === 390`. (An earlier reading of 1425px
was a stale-layout artifact from resizing without a reload; I re-tested on a
fresh load and it is clean.)

**7.3 Keyboard focus — passes.** `globals.css:68-72` sets a global
`:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px }`, plus
focus-visible parity for the spotlight controls and reduced-motion variants.
Gold-on-ivory makes for a ~2:1 ring, which is weak against WCAG 2.2 focus
appearance — but it is deliberate and present.

**7.4 Headings.** Sane order, one `h1`. Two duplicate `h2` pairs ("Hours",
"Find Us" — page and footer). Minor.

**7.5 Alt text.** Not assessable — there are no images. `PhotoFrame` accepts
`alt`, and `images.ts` carries real alt strings ready for when photos land.

**7.6 LCP / CLS — not measured.** No Lighthouse in this environment. Structurally
the LCP element is likely the `h1` or hero video poster; the 1,350ms overlay sits
in front of it. Worth a real measurement.

**7.7 Meta — all present, none default.** Title template, description, full OG
set (`og:title`, `og:description`, `og:image` + type/width/height/alt), and
generated `/icon` + `/apple-icon` routes. **No JSON-LD** — no `Restaurant` or
`Menu` schema anywhere, which for a local restaurant is the highest-value SEO
gap on the site.

---

## 8. Top 5 changes by impact-per-hour

**1. Verify and fix the scrolled header background — 1h**
Check in a production build first (§7.1). If it reproduces, the primary nav is
invisible on every light section. Highest severity, near-zero cost to check.

**2. Make the loading overlay home-only and cut the floor to ~600ms — 1h**
`MIN_SHOW_MS = 1350` ([LoadingOverlay.tsx:20](../src/components/LoadingOverlay.tsx#L20)),
and it currently gates `/order` too. Keep the gold-leaf sequence on the homepage
where it is a signature; remove it from every path a hungry returning customer
takes. Direct conversion win.

**3. Surface party trays on the marketing menu and the order menu — 5h**
Right now 12 items carry tray pricing and it appears only inside a modal four
interactions deep. Concretely: import `party-trays.ts` into `MenuSection`, print
a second price line — "Party Tray $75 · feeds 8–10" — under those 12 items on
`/menu`; add a "Party Trays" filter chip to `OrderMenu`; add a homepage band
between Favorites and The Room. This is the only item on this list that makes
money rather than saving embarrassment.

**4. Raise the type floor to 12px and fix the four contrast failures — 2h**
Nine elements at 9.6–9.92px. Retire gold `#cfa52e` as a *text* color on ivory
(it is 2:1) and keep it for rules and the seal; move "Est. 1995" and "30+ years
on Telegraph Canyon" to `--ink` at 70% opacity, 12px. Also fix `h2` leading from
1.0 to ~1.15.

**5. Give House Favorites a real photo-less mode — 6h**
Today the marquee homepage section renders a frame containing the word "Photo"
([FavoritesSpotlight.tsx:86](../src/components/FavoritesSpotlight.tsx#L86)) — the
design is built for photography that does not exist, so the empty state is worse
than a text-first design would have been. Until photos land, lead with the dish
name set large in the display face, the description, and the price, with the
seal as a watermark. This is the highest-impact *visual* change available with
zero new content.

*Deliberately not in the top 5: replacing Playfair Display (≈3h).* It is the
right call and it is what most de-templates the site — but it changes nothing
functional, so it ranks below the five above.

---

## 9. What only money fixes

| Need | Why | Rough cost |
|---|---|---|
| **Food photography — 12–20 dishes** | The binding constraint. Nothing else moves the ceiling | **$1,200–2,500** for a half-day shoot with a local food photographer |
| **Room/atmosphere photography — 3–5 frames** | The altar, the dining room, the gold Buddha, family at work. Captions are already written for these exact shots | Usually included in the same half-day |
| **Three real Google reviews** | Currently `[PASTE REAL GOOGLE REVIEW]` on the live homepage | **Free** — copy from your Google listing. Do this today |
| **中文 for 104 remaining dishes** | 34/138 today. Also unblocks the kitchen ticket printing Chinese instead of `⚠ EN` | **$300–600** professional, or free if the family does it |
| **Family review of size/modifier 中文** | Standard trade terms, unreviewed, printing on kitchen tickets | Free — one sitting |
| **Party-tray prices from the printed menu** | 12 unverified estimates; blocks change #3 above | Free — one hour with the menu |

The reviews and the tray prices cost nothing and unblock real work. Do those
first.

---

## 10. Design direction

**The current direction is fundamentally sound. It needs execution, not
replacement — and I would not accept a redesign if someone offered you one.**

Here is why I am confident despite not seeing it: the things that are hard to
get right are already right. The palette is derived from real objects in the
actual room rather than from "Chinese restaurant" as a category. The copy is
specific in the way only someone who visited writes. The motion is a single
orchestrated timeline with shared tokens, not scattered scroll-reveals.
Reduced-motion is handled better than most commercial sites. There is a genuine
signature element. Spacing is on a scale. Tokens are not duplicated.

You do not buy that with a redesign. You buy it once, and it is bought.

**The one change I would make** is replacing **Playfair Display**. It is the
default premium-restaurant serif, and it is doing more than anything else in the
CSS to make considered work read as templated. Two directions worth testing,
both keeping Lora for body and Noto Serif TC for 中文:

- **Fraunces** (optical-size axis, `SOFT`/`WONK` axes) — warmer, slightly odd,
  reads as *made* rather than *specified*. Set the optical size low for a
  chunkier, less Vogue-ish feel.
- **Newsreader** or **Source Serif 4** — quieter, editorial, less contrast;
  pairs more naturally with a Chinese serif because the stroke modulation is
  closer to Noto Serif TC's.

Fraunces is the braver pick and the better match for "family-run, thirty years,
good at it." Playfair says *fine dining*; Fraunces says *this place is real*.

Everything else — the ivory/lacquer/gold triad, the seal, the choreography —
keep.

---

## 11. What NOT to change

A redesign would break these, and they are working:

1. **The token system** (`globals.css:27-58`). Clean `:root` → `@theme inline`.
2. **The motion architecture.** One GSAP timeline, shared easing/duration
   tokens. Do not let anyone replace it with per-section scroll-reveals.
3. **`prefers-reduced-motion` coverage.** 7 CSS blocks + JS guards. Genuinely
   above standard.
4. **The gold-leaf seal sequence itself.** Move it, shorten it, do not delete it
   — it is the only thing here nobody else has.
5. **The Chinese font wiring.** Noto Serif TC is correctly loaded with on-demand
   CJK chunks and `font-display: swap`. Most sites get this wrong; this one does
   not. Do not "simplify" it.
6. **English-only spicy markers.** `MenuSection.tsx:5-8` — a heat warning is
   functional UI and a guest who cannot read 辣 gets no warning. Correct call.
7. **The specific copy.** "The altar — incense & tangerines", "Cooked the way
   it's always been", "30+ years on Telegraph Canyon". This is the least
   templated thing on the site.
8. **`:focus-visible` styling** (`globals.css:68-72`). Strengthen the ring's
   contrast if you like; do not remove it.
9. **Server-recomputed prices in the order path.** Not design, but any
   "simplification" that trusts client totals is a regression.
