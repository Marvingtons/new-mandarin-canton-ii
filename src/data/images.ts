/**
 * Homepage photo manifest.
 *
 * To ship a real photo: drop the file into /public/photos/ and set the
 * matching entry's `src`, e.g. src: "/photos/altar.jpg". Nothing else
 * needs to change — frames, captions, reveals, and layout all key off
 * this file. Keep src: null to show the designed placeholder slot.
 */

export type SitePhoto = {
  id: string;
  src: string | null;
  alt: string;
  caption: string;
  aspect: "4/5" | "3/4" | "21/9";
  /** Placeholder panel color (dish tone). Ignored once src is set. */
  tone?: string;
};

export const photos = {
  altar: {
    id: "altar",
    src: null,
    alt: "The family altar with incense and fresh tangerines",
    caption: "The altar — incense & tangerines",
    aspect: "4/5",
  },
  diningRoom: {
    id: "diningRoom",
    src: null,
    alt: "The dining room",
    caption: "The dining room",
    aspect: "4/5",
  },
  buddha: {
    id: "buddha",
    src: null,
    alt: "The gold Buddha statue",
    caption: "The gold Buddha",
    aspect: "4/5",
  },
  family: {
    id: "family",
    src: null,
    alt: "The family at work in the restaurant",
    caption: "Family at work",
    aspect: "3/4",
  },
  storefront: {
    id: "storefront",
    src: null,
    alt: "The storefront at 543 Telegraph Canyon Rd",
    caption: "543 Telegraph Canyon Rd",
    aspect: "21/9",
  },
  /* Dish photos for the House Favorites wheel — drop files into
     /public/photos/ and set src, e.g. "/photos/dish-honey-walnut-shrimp.jpg" */
  dishMandarinSpecial: {
    id: "dish-mandarin-special",
    src: null,
    alt: "Mandarin House Special",
    caption: "Mandarin House Special",
    aspect: "4/5",
    tone: "#7e301d",
  },
  dishHoneyWalnutShrimp: {
    id: "dish-honey-walnut-shrimp",
    src: null,
    alt: "Honey Walnut Shrimp",
    caption: "Honey Walnut Shrimp",
    aspect: "4/5",
    tone: "#9e5d28",
  },
  dishHoneyWalnutChicken: {
    id: "dish-honey-walnut-chicken",
    src: null,
    alt: "Honey Walnut Chicken",
    caption: "Honey Walnut Chicken",
    aspect: "4/5",
    tone: "#96261c",
  },
  dishKungPaoSanShein: {
    id: "dish-kung-pao-san-shein",
    src: null,
    alt: "Kung Pao San Shein",
    caption: "Kung Pao San Shein",
    aspect: "4/5",
    tone: "#753433",
  },
  dishCrispyGameHen: {
    id: "dish-crispy-game-hen",
    src: null,
    alt: "Crispy Game Hen",
    caption: "Crispy Game Hen",
    aspect: "4/5",
    tone: "#603c1e",
  },
  dishPanFriedNoodles: {
    id: "dish-pan-fried-noodles",
    src: null,
    alt: "Upside Down Pan Fried Noodles",
    caption: "Upside Down Pan Fried Noodles",
    aspect: "4/5",
    tone: "#2e241d",
  },
} satisfies Record<string, SitePhoto>;
