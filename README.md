# New Mandarin Canton II

Website for New Mandarin Canton II — a traditional Cantonese/Mandarin Chinese
restaurant at 543 Telegraph Canyon Rd, Chula Vista, CA 91910 · (619) 656-6888.
Classic red-and-gold, old-school family feel (not a modern minimal template).

## What's built

- **Routes**: `/` (home), `/menu`, `/about`, `/contact`
- **Components**: `Header`, `Footer`, `Hero`, `MenuSection`, `BilingualHeading`,
  `HoursTable`, `Seal` (the 富源 chop, also the favicon via `app/icon.svg`),
  and `LoadingOverlay` (first-visit gold-leaf reveal of the 富源 logo,
  `public/fu-yuan-logo.svg`) in `src/components/` (`StampIntro` is
  retained but unmounted)
- **Data models**:
  - `src/data/menu.ts` — typed `MenuItem` / `MenuCategory` with example items
    per category (Appetizers, Soups, Chow Mein, Fried Rice, Seafood, Chef's Specials)
  - `src/data/restaurant.ts` — real name, address, phone, and hours
    (`chineseName` is `null` until verified from the restaurant's sign)
- **Design tokens** in `src/app/globals.css` (Tailwind v4 `@theme`):
  deep lacquer red, imperial gold, ink black, warm ivory/cream, aged paper
  (`lacquer`, `lacquer-dark`, `gold`, `gold-light`, `ink`, `ivory`, `cream`, `paper`)
- **Fonts** via `next/font`: Playfair Display (`font-display`, headings),
  Lora (`font-body`, body copy), Noto Serif TC (`font-chinese`, bilingual
  headings and Chinese dish names)
- Header/Footer render on all pages via `src/app/layout.tsx`

## Design

See [DESIGN.md](DESIGN.md) for the design plan. Highlights:

- Signature bilingual headings (`src/components/BilingualHeading.tsx`) —
  English paired with large ghosted gold Chinese characters, used on all pages
- Home: lacquer hero with settle-on-load moment, House Favorites strip,
  About teaser, placard-style info band
- Menu: physical-menu typography — dotted leader lines, inline Chinese
  dish names, 辣 spicy marks, sticky category nav, two columns ≥ md
- About: pull-quote opening + three framed photo slots (real photos TODO)
- Contact: hours table with today's row highlighted client-side,
  large tap-friendly call button, Google Maps embed + directions link
- Gold focus rings, `prefers-reduced-motion` respected, responsive to 375px

## TODO

- [ ] Replace example menu items with the real menu
- [ ] Verify Chinese translations for category headings (`MenuSection.tsx`)
- [ ] Real About copy (opening line + paragraphs) and photos for the
      three photo slots
- [ ] Photos, favicon, and Open Graph images

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
