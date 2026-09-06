# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: takeout customers in Chula Vista, California.** Phone-first, and
frequently ordering in conditions that are not a desk: driving, parked outside,
on a break at work, standing in a loud room. Assume one thumb, partial
attention, and an interruption at any point in the flow. Many are repeat guests
who already know what they want and are trying to re-place a familiar order, not
browse. The family's own history records guests who first came as children and
now bring their own children, so the audience spans three generations and a wide
range of comfort with ordering online.

**Secondary: the family and kitchen staff.** They read the kitchen screen
(`src/components/kitchen/KitchenBoard.tsx`, route `src/app/[kitchenSlug]/`) and
the printed ticket during service. Their situation is the hardest one in the
product: hands busy, noise, heat, glancing at a screen across a room while
cooking. They are not customers and the screen is not marketing. Correctness and
legibility at a glance beat everything else there.

## Product Purpose

Let a hungry person in Chula Vista place a correct takeout order from their
phone in as few steps as possible, and put that order in front of the kitchen
accurately. Success is a completed, correct order and a ticket the kitchen can
work from without a phone call to clarify it. Success is not time on site,
scroll depth, or pages viewed.

## Positioning

A family restaurant that has been on Telegraph Canyon Road since 1995, taking
its own orders on its own site. The mechanism a neighboring restaurant cannot
truthfully copy is the specific history: thirty-plus years in one room, three
generations of the same families at the tables, and the family's own written
account of it. The ordering flow is first-party rather than a delivery-app
listing, so the restaurant keeps the relationship, the margin, and the ability
to say things in its own voice.

## Operating Context

**Two modes, and the split is a product fact, not a style choice.**

- **Operate (nearly everything).** The menu, the item sheet, the cart, checkout,
  the confirmation page, and the kitchen screen exist to complete and transmit
  an order. Nobody arriving at checkout needs to be persuaded; they have already
  decided. Every element on these surfaces earns its place by moving the order
  forward or preventing a mistake. Decoration that costs a tap, a scroll, or a
  moment of doubt is a defect here.
- **Persuade (the homepage, above the fold, and only there).** The hero is the
  one place whose job is to establish that this is a real, old, family-run
  room worth ordering from. Below the fold the homepage returns to Operate and
  routes to the menu.

Ordering is gated by a per-day `lastOnlineOrder` cutoff held in
`src/data/restaurant.ts` alongside the published hours, deliberately so the API
gate and the printed promise can only move together. Orders reach the kitchen as
a printed ticket and on the kitchen board. Pickup only.

## Capabilities and Constraints

- Next.js on Cloudflare (OpenNext), React 19, Tailwind v4 with tokens in
  `src/app/globals.css`.
- Menu, item sheet with modifier groups, cart, checkout, OTP verification,
  confirmation, kitchen board, thermal ticket printing.
- Bilingual EN and 中文 throughout, plus ES. Traditional characters
  (`lang="zh-Hant"`) where Chinese renders.
- Pricing, rice logic, preparation choices, print codes and cutoffs are all
  covered by `scripts/verify-*.ts`. Behavior changes there are verifiable and
  should stay that way.
- Content rule already enforced in the codebase: no invented facts. Fields that
  are not confirmed (health score, some photos) stay null and their UI drops
  rather than printing a guess.

## Brand Commitments

- **Name and seal.** New Mandarin Canton II / 富源. The seal artwork
  (`public/fu-yuan-logo.svg`) is printed and on the door. It is the fixed point
  the palette was reconciled to, not a logo that can be re-tinted to taste.
- **Voice.** Plain, warm, first-person-plural, concrete. It states what happened
  and what the family does, and it does not reach for adjectives. The binding
  sample is the family's own story on the About page
  (`about.storyP1` through `about.storyP3` in `src/lib/i18n/dictionary.ts`):

  > "Many of our guests came here as children, holding their parents' hands.
  > Today they're grown, married, with families of their own, and they bring
  > their children back to our tables."

  Note what that sentence does not contain: no "authentic", no "experience", no
  "journey", no superlative. New copy matches that register or it is wrong.

- **No em dashes** in site copy or in project documentation.
- **Bilingual conventions.** EN and 中文 pairing is a signature, not decoration;
  Chinese that carries no meaning on a page is an ornament and is removed (see
  the standing note on the About page).

### Anti-references (things this product is explicitly not)

- Red-and-gold "Chinese restaurant" clipart, and the whole visual vocabulary of
  oyster pails, dragons, fortune cookies, chopstick lettering, and paper
  lanterns as decoration.
- Delivery-app aesthetics: dense promo tiles, urgency badges, discount confetti,
  a carousel of upsells at checkout.
- Glassmorphism, purple or violet gradients, neon accents, generic SaaS gloss.
- Stock-photo food. Photography is of this room and this kitchen or the slot
  stays a placeholder.

## Evidence on Hand

- The family's written history, in Chinese, converted to English and preserved
  verbatim in `src/app/about/page.tsx` and the dictionary. This is the strongest
  content asset in the project and the source of the founding year.
- Confirmed founding year 1995, on the owner's written record.
- The official seal artwork, `public/fu-yuan-logo.svg`.
- Real hero video of a dish being made, and real photography slots in
  `src/data/images.ts`.
- **Absences that must not be filled by invention:** health-inspection score
  (null until confirmed), any testimonial or review copy, any award or press
  claim, any nutrition or allergen guarantee beyond what the kitchen states.

## Product Principles

1. **The order is the product.** Every surface past the homepage is judged on
   whether it completes a correct order faster and with fewer mistakes.
2. **Assume a thumb, a moving car, and a half-second of attention.** Tap
   targets, contrast, and label clarity are correctness requirements, not polish.
3. **Never decide for the customer what the counter would ask.** A required
   choice with no sensible default (protein, for instance) opens unselected with
   a named reason, rather than being preselected on their behalf.
4. **Say only what is true.** Unconfirmed facts drop their UI. No invented
   reviews, scores, or history.
5. **The kitchen is a user.** Ticket and board legibility under real service
   conditions outrank visual consistency with the customer-facing site.

## Accessibility & Inclusion

- Bilingual EN / 中文 / ES is an access requirement for this neighborhood, not a
  feature.
- Contrast is treated as arithmetic and is already documented per token in
  `globals.css`. Every pairing the site renders clears WCAG AA, and there is a
  written floor (`--ivory-muted`) below which no text may sit on ink.
- Gold on a light ground measures about 2.1:1 and is therefore unavailable for
  text. Labels on light surfaces use lacquer.
- `prefers-reduced-motion` is honored: the loading overlay is skipped entirely
  and the hero mounts no video.
- Responsive floor is 375px.
