/**
 * Site photo manifest.
 *
 * To ship a real photo: put a web-ready file in /public/images/ and set the
 * matching entry's `src`, e.g. src: "/images/altar.jpg". Nothing else needs to
 * change — frames, captions, reveals, and layout all key off this file. Keep
 * src: null to show the designed placeholder slot.
 *
 * WEB-READY MEANS RESIZED. The masters the family supplies are phone and
 * camera originals — the gold Buddha arrived as a 3584x4800 PNG, 19.8 MB, one
 * file heavier than the entire rest of the site. Everything in /public is
 * uploaded as a static asset on every deploy, so the masters live in
 * /photo-originals (gitignored) and only the derivatives are served: long edge
 * 1400–1600px, JPEG q82, ~250–290 KB each. 1400px covers the largest slot on a
 * 2x display with room to spare.
 */

export type SitePhoto = {
  id: string;
  src: string | null;
  alt: string;
  caption: string;
  aspect: "4/5" | "3/4" | "4/3" | "21/9";
};

export const photos = {
  altar: {
    id: "altar",
    src: "/images/altar.jpg",
    alt: "The family altar: a carved shrine with a Guan Yu figure, lit candles, burning incense and a plate of fresh tangerines",
    caption: "The altar — incense & tangerines",
    aspect: "4/5",
  },
  diningRoom: {
    id: "diningRoom",
    // The file the family named "family at work". It is the dining room:
    // guests at every table, staff at the pass behind them. See the note on
    // `family` below for why it landed here rather than there.
    src: "/images/dining-room.jpg",
    alt: "The dining room at service: guests at wooden tables, staff working at the pass behind them",
    caption: "The dining room",
    aspect: "4/5",
  },
  buddha: {
    id: "buddha",
    src: "/images/buddha.jpg",
    alt: "The gold laughing Buddha on the counter, with banknotes tucked into its hands",
    caption: "The gold Buddha",
    aspect: "4/5",
  },
  family: {
    id: "family",
    /**
     * ⚠️ UNFILLED ON PURPOSE, not for want of a candidate.
     *
     * The only photo of the room in service is on `diningRoom` above. It could
     * have gone here instead — the family's own filename for it was "family at
     * work" — but it cannot be in both, and the two slots sit on the same page.
     * The Room is a three-up grid where one empty card is a hole; this is a
     * single frame where a placeholder reads as a placeholder. And the picture
     * is honestly a room shot: the staff are small, in the background.
     *
     * Swap the two `src` lines if the family would rather have it here.
     */
    src: null,
    alt: "The family at work in the restaurant",
    caption: "Family at work",
    aspect: "3/4",
  },
  storefront: {
    id: "storefront",
    src: "/images/storefront.jpg",
    alt: "The New Mandarin Canton II storefront on Telegraph Canyon Road, red lettering on a terracotta facade",
    caption: "543 Telegraph Canyon Rd",
    // 3/4, not the 21/9 this was declared as: the photograph is portrait, and
    // a 21/9 crop of it would be a letterbox slice through the middle of the
    // building with the sign cut off.
    aspect: "3/4",
  },
  /** The About page's third frame. No photograph of the kitchen exists yet. */
  kitchen: {
    id: "kitchen",
    src: null,
    alt: "The kitchen",
    caption: "From the kitchen",
    aspect: "4/3",
  },
  /* Dish photos for the House Favorites wheel. None exist yet — no photograph
     of any dish was supplied, so all six are still the shot list. Drop files
     into /public/images/ and set src, e.g. "/images/dish-honey-walnut-shrimp.jpg" */
  dishMandarinSpecial: {
    id: "dish-mandarin-special",
    src: null,
    alt: "Mandarin House Special",
    caption: "Mandarin House Special",
    aspect: "4/5",
  },
  dishHoneyWalnutShrimp: {
    id: "dish-honey-walnut-shrimp",
    src: null,
    alt: "Honey Walnut Shrimp",
    caption: "Honey Walnut Shrimp",
    aspect: "4/5",
  },
  dishHoneyWalnutChicken: {
    id: "dish-honey-walnut-chicken",
    src: null,
    alt: "Honey Walnut Chicken",
    caption: "Honey Walnut Chicken",
    aspect: "4/5",
  },
  dishKungPaoSanShein: {
    id: "dish-kung-pao-san-shein",
    src: null,
    alt: "Kung Pao San Shein",
    caption: "Kung Pao San Shein",
    aspect: "4/5",
  },
  dishCrispyGameHen: {
    id: "dish-crispy-game-hen",
    src: null,
    alt: "Crispy Game Hen",
    caption: "Crispy Game Hen",
    aspect: "4/5",
  },
  dishPanFriedNoodles: {
    id: "dish-pan-fried-noodles",
    src: null,
    alt: "Upside Down Pan Fried Noodles",
    caption: "Upside Down Pan Fried Noodles",
    aspect: "4/5",
  },
} satisfies Record<string, SitePhoto>;
