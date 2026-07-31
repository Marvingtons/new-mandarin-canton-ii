# Brand motifs

The sheet `motifs-source.svg` (144×96, one canvas, 105 drawable elements)
is the provenance record. It is split into `public/brand/motifs/`, one
file per motif, each cropped to its own tight viewBox.

It lives HERE rather than in `public/` on purpose: everything under
`public/` is copied verbatim into the deploy, and the sheet contains all
three excluded motifs. Serving it would put a red lantern one fetch away
from the site while the rest of this document explains why there isn't
one.

## Files

Every kept motif is emitted twice:

- `<name>.svg` — the artwork as drawn, colours inlined from the sheet's
  per-sheet CSS classes (`.cls-*`), which no longer exist anywhere.
- `<name>-mono.svg` — every fill `currentColor`, for decorative
  placements tinted by a CSS token. The near-white shapes (`#FDFDFD`,
  `#FAF1DA`, `#FFFFFF`, `#FCF3DE`) are dropped from this variant rather
  than recoloured: they are negative space on a light ground, and as
  `currentColor` they would fill in the holes they exist to cut.

Sheet colours are close to the site's palette but are **not** it —
`#25333E` is a cool blue-grey where `--ink` is a warm brown-black, and
`#CC4B3A` is brighter than `--lacquer`. The asset files stay faithful to
the source artwork; anything actually placed on the site is retoned to
tokens (see `HorizonMark.tsx`).

## Inventory

Dimensions are the motif's own viewBox, in sheet units.

| Motif | Depicts | Size | Colours | Placed |
| --- | --- | --- | --- | --- |
| `knot` | Endless knot alone | 19.9 × 6.6 | gold, red | **Yes** — divider ornament, home |
| `crane-standing` | Standing crane, crowned head | 15.9 × 25.14 | ink, white, red | **Yes** — About margin accent |
| `mountains-sun` | Mountain range, rising sun, water | 53.7 × 17.56 | ink, red, gold | **Yes** — 404 |
| `cloud-scroll` | Three-lobed cloud, spiral head | 23.7 × 10.35 | gold | no |
| `cloud-band` | Symmetrical cloud, twin spirals | 25 × 10.22 | red | no |
| `cloud-curl` | Cloud, single spiral head | 21.38 × 9.19 | red | no |
| `cloud-plume` | Cloud with trailing wisps | 25.6 × 10.27 | red | no |
| `cloud-rule-right` | Tapered rule, cloud head right | 34.72 × 6.98 | gold | no |
| `cloud-rule-left` | Tapered rule, cloud head left | 28.5 × 6.91 | red | no |
| `knot-divider` | Twin rules flanking the knot | 55.4 × 6.6 | gold, red | no — see note |
| `corner-bracket-tl` | Rounded frame corner, top-left | 20.04 × 17.45 | red | no |
| `corner-bracket-tr` | Rounded frame corner, top-right | 19.76 × 17.69 | gold | no |
| `bamboo-sprig` | Bamboo stem, five leaves | 17.9 × 18.4 | ink, red | no |
| `leaf-sprig` | Leaf sprig on a slim stem | 13.5 × 16.8 | gold | no |
| `pagoda` | Five-tier pagoda with finial | 24.9 × 27.14 | red | no |
| `folding-fan` | Open folding fan, pivot dot | 26.5 × 18 | red, cream, gold | no |
| `junk-boat` | Chinese junk under battened sail | 31.2 × 20.71 | ink | no |
| `crane-flying` | Crane in flight, wings raised | 18 × 15.5 | ink, white, red | no |

`knot-divider` ships as an asset but is not placed: it draws its own pair
of rules, and the site already has a rule to sit on. The placement uses
`knot` — the centre ornament alone — on `GoldDivider`'s existing hairline,
so there is one rule, not two.

## Excluded — no files emitted

| Motif | Depicts | Size | Why |
| --- | --- | --- | --- |
| lantern | Hanging lantern with tassel | 16.47 × 32 | named in the brief |
| dark cloud | Cloud bank of layered arcs, ink | 25.2 × 11.09 | named in the brief |
| double happiness | 囍 inside a ring | 22.9 × 22.9 | named in the brief |

"The dark/black cloud" is read as the ink-coloured bank of layered arcs at
sheet (31.5, 28.3)–(56.2, 38.9). It is the only dark cloud-mass on the
canvas — every other cloud is gold or red — so nothing else can be meant.
It could equally be described as a stylised wave; excluded either way,
because the cost of wrongly keeping a named exclusion is higher than the
cost of wrongly dropping one motif out of nineteen.

No file is written for any of the three, so they cannot reach the deploy
through `public/`. Verified against the build: the signature path data of
each is absent from `.open-next/` and `.next/`.
