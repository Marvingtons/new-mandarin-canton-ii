# Post-launch backlog

One list. Nothing here blocks a customer placing an order or the kitchen
printing it. Size is rough effort: S under an hour, M a focused session, L
needs a decision or someone outside the codebase.

Sources merged here: the Impeccable audit (2026-09-06), the PROPOSE list from
`SITE_REVIEW_2.md`, and the small gaps already on record. Those lists are now
closed; add new items here instead.

## Priority

`P1` first. It is the only published inaccuracy on the site.

## Design system (Impeccable audit)

| ID | What and why | Size |
| --- | --- | --- |
| R3 | `text-[11px]` (LocaleToggle:84, OpenNowChip:57, TestModeBadge:61) and `text-[0.7rem]` (Footer:121) are the same intended size spelled two ways, both off the scale. Unify onto one documented step. | S |
| R4 | `shadow-lg` / `shadow-xl` (ItemSheet:192, CartDrawer:72, BackToTop:110, TestModeBadge:80) are Tailwind's neutral-black defaults on a warm palette, and the system has no shadow vocabulary. Derive an elevation token from `--ink-rgb` and use it. | M |
| R5 | `.lacquer-vignette` (globals.css:303-304) uses raw `rgba(0,0,0,.3)` and `rgba(255,216,130,.07)` where every other overlay derives from a token. | S |

Rejected during that audit and recorded so they are not re-raised: the seal's
bounce easing (`--ease-stamp`, one consumer, deliberate), the `#000` inside
`mask-image` (an alpha value, not a colour), and the `#fff4d6` shimmer
(specular highlight, comment added at the declaration).

## Site review PROPOSE list

| ID | What and why | Size |
| --- | --- | --- |
| P1 | Privacy policy no longer describes the site's cookies: the blanket "cannot be read by JavaScript" claim is false for `nmc_lang`, and that one-year cookie is missing from the list. Legal copy, so owner or counsel approves the wording. | S |
| P5 | Checkout's disabled primary button explains nothing, so a blocked customer cannot tell what is missing. | S |
| P9 | Item sheet claims `aria-modal` it does not implement, so focus is not actually trapped for keyboard and screen reader users. | M |
| P3 | While a filter is active, 11 of 14 category pills are dead links; at zero results all 14 are, and the empty state points at them. Needs a taste call between two fixes. | M |
| P2 | Menu header is a wall: first orderable dish sits at 831px of 844 on a phone. The fix that actually moves it is structural and touches copy. | L |
| P4 | The allergy message carries three different visual weights on one order path. | S |
| P6 | Spanish search finds nothing, because the index is English only. | M |
| P10 | "Both" is unreadable in the cart. | S |
| P8 | Focus ring fails 3:1 on light grounds. | M |
| P11 | Free rice never says it is free. | S |
| P13 | Server-side errors have no Spanish. | M |
| P12 | Long-form Spanish for Home, About and the legal bodies. Needs the family, not a translator. | L |
| P7 | Dead components and their CSS, including `MenuSection.tsx`'s unused default export. | S |
| P14 | The batched smalls from the review. | M |
| P14a | `<meta name="description">` and the OpenGraph description are English in both locales, so the Spanish half of the site is invisible to Spanish search. | M |

## Known small gaps

| ID | What and why | Size |
| --- | --- | --- |
| G1 | Phone numbers join with " or ", which reads awkwardly aloud and does not follow Spanish's o/u rule. | S |
| G2 | `SpicyMark`'s badge is not translatable. | S |
| G3 | Page titles are not locale aware, so a Spanish reader gets an English `<title>`. Overlaps P14a; do them together. | M |
| G4 | The `bf-cache` no-store and Suspense-boundary item: `no-store` is missing on `api/orders` and `api/otp/*`, and a back-forward restore can land on stale state. | M |

## Impeccable hooks

Disabled for launch. `.impeccable/config.json` holds `hook.enabled: false`,
and it is committed, so the hook is off for everyone rather than just one
machine.

To turn it back on after launch:

```
.claude/skills/impeccable/scripts/impeccable hooks on
```

Then restart the agent session, because hooks are read at session start. To
check the current state at any time, `impeccable hooks status`. A one-off
override without editing config is `IMPECCABLE_HOOK_DISABLED=1`.

The engine binary itself is gitignored (`.claude/skills/impeccable/scripts/bin/`)
and the committed launcher downloads a checksum-verified one per platform on
first use, so nothing needs vendoring for a teammate on another OS.
