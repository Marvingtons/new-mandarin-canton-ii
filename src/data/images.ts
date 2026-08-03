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
 * file heavier than the entire rest of the site; the dining room arrived as a
 * 5056x3392 PNG, 21 MB. Everything in /public is uploaded as a static asset on
 * every deploy, so the masters live in /photo-originals (gitignored) and only
 * the derivatives are served: long edge 1400–1600px, JPEG q82, ~250–290 KB
 * each. 1400px covers the largest slot on a 2x display with room to spare.
 *
 * THE EXACT PARAMETERS, so the next batch matches this one rather than
 * approximating it (sharp, lanczos3, mozjpeg, progressive):
 *
 *   photographs    resize long edge 1500, quality 82, chroma 4:2:0
 *   illustrations   no resample if already 1400–1600, quality 88, chroma 4:4:4
 *
 * The illustration's settings are not a preference. It is fine ink strokes on
 * flat paper, which is precisely what chroma subsampling smears and what
 * aggressive quantisation rings around. Checked at 86/88/90: q88 is 268 KB, and
 * the paper reads #FCEFDC against the master's #FBF0DB with stdev 0.61 against
 * 0.70 — one level of drift and no banding introduced.
 *
 * NO COLOUR GRADE IS APPLIED TO ANYTHING, and that is a measurement rather
 * than an omission. Whole-image warmth (mean R − mean B) across the site:
 * storefront 31, dining room 38, the three dish photos 46–50, altar 52,
 * buddha 67. The new files land inside the range the site already spans, so a
 * "warm grade" pass here would be inventing a look, not matching one.
 *
 * MASTERS ARE NOT UPSCALED. The three dish photos are 1024x1024 and ship at
 * 1024x1024, under the 1400 guidance: resampling up would add pixels and no
 * detail. The largest box any of them lands in is the spotlight's featured
 * card (aspect 4/3.4, ~40vw), so 1024 is a little short of 2x at 1440 and
 * exactly right everywhere else. Reshoot at 1600 to close that gap.
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
    caption: "The altar · incense & tangerines",
    aspect: "4/5",
  },
  diningRoom: {
    id: "diningRoom",
    /**
     * NEW PHOTOGRAPH, AND DELIBERATELY A NEW FILENAME. This slot used to
     * point at dining-room.jpg — the file the family named "family at
     * work", 1448x1086, the room with two staff small at the pass behind
     * the tables. The replacement is a 5056x3392 master of the same room
     * from further back: every table full, the yellow walls and the framed
     * landscape, and the storefront window with the restaurant's own
     * lettering reading backwards from inside.
     *
     * ⚠️ REUSING dining-room.jpg WAS THE OBVIOUS MOVE AND IT IS A TRAP.
     * Writing new bytes under an unchanged URL means every cache keyed on
     * that URL still holds the old picture. Caught during this pass: the
     * dev server's image optimizer served the OLD photograph from
     * .next/cache/images for a file that had already been replaced on disk,
     * and it took opening the file to disbelieve the browser. A CDN would
     * do the same thing to returning visitors, for longer, with no way to
     * tell from the page. A photograph that is a different picture gets a
     * different filename.
     *
     * The old shot is not deleted, it is retired to /photo-originals as
     * dining-room-staff-at-pass.jpg. It is the better picture OF THE STAFF
     * and the worse picture of the room, and the room is what this slot is
     * captioned. The ink illustration on `family` below is what carries the
     * family now, which is what freed this slot to be a room shot at last.
     */
    src: "/images/dining-room-service.jpg",
    alt: "The dining room during service: guests at every wooden table, framed landscape on the yellow wall, the restaurant's window lettering reading backwards from inside",
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
     * AN ILLUSTRATION, AND PRESENTED AS ONE. Brush-and-ink on cream paper:
     * the father at the wok with the flame up, a daughter plating at the
     * pass, a server carrying dishes out to tables drawn as three strokes
     * of grey. It is not a photograph and does not pretend to be — the
     * caption names the family rather than a place, and the alt text says
     * "ink illustration" so a screen reader is not told it is a picture of
     * the actual kitchen.
     *
     * THIS SLOT WAS THE ONE AMBIGUITY IN THIS FILE, and the illustration
     * settles it. The note that used to sit here explained that the only
     * photograph of the room in service had to choose between this slot and
     * `diningRoom`, and went to `diningRoom` because "the picture is
     * honestly a room shot: the staff are small, in the background". There
     * is no longer a competition: the family is drawn here, the room is
     * photographed there, and each slot has the image it is captioned for.
     *
     * 4/3, not the 3/4 this was declared as. The illustration is landscape
     * and a portrait box would crop the father and the server off opposite
     * ends of it — the same mistake the storefront's comment records.
     *
     * ⚠️ ITS PAPER IS NOT THE PAGE'S CREAM. Measured: the artwork's ground
     * is #FCEFDC against --cream #FCF7EC, so it is 8 levels down in green
     * and 16 in blue — a hair warmer, visible as a tone step if the two met
     * edge to edge. They do not meet: the frame's mount is set to the
     * artwork's own paper at the call site (see app/page.tsx), so the
     * illustration sits on its own sheet inside the gold edge. The artwork
     * is NOT recoloured to the site; the mount is coloured to the artwork.
     */
    src: "/images/family-at-work-ink.jpg",
    alt: "Ink illustration of the family at work: the father tossing a wok over open flame, a daughter plating dishes at the pass, and a server carrying plates out to the tables",
    caption: "The family at work · 一家人",
    aspect: "4/3",
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
  /* ---- DISH PHOTOS ---------------------------------------------------
     Three arrived, and they are one set: the same blue-and-white plate the
     hero video closes on, a linen runner, dark wood, lit from the same
     side, shot square from overhead. They need no crop — `.spt-photo` is
     4/3.4 above 900px, so object-cover takes the top and bottom off a
     square and lands on the plate by itself.

     ⚠️ ONLY ONE OF THE THREE HAS A SURFACE TODAY, and that is a fact about
     data/favorites.ts rather than about these files. The House Favorites
     spotlight is the site's ONE dish-photo surface — the item sheet and the
     menu cards render no image at all — and it shows the six ids in
     favoriteItemIds. Of the three dishes photographed, only the salted
     pepper wings is one of those six. The other two are wired and correct
     and will appear the moment their dish is a favourite; changing which
     six the homepage advertises is the owner's call, not a side effect of
     receiving a photograph. See the report accompanying this commit.

     ⚠️ TWO SLOTS BELOW NAME DISHES THAT ARE NOT ON THE MENU:
     `dishHoneyWalnutChicken` and `dishCrispyGameHen`. Grepped against
     data/menu.ts — the catalogue has Honey Walnut Shrimp and no chicken
     version, and no game hen at all. They predate this pass and are left
     alone rather than quietly deleted, because "was this dish dropped or
     was the slot always wrong" is the owner's question to answer. */
  dishMandarinSpecial: {
    id: "dish-mandarin-special",
    /** Favourite #1. Still the shot list. */
    src: null,
    alt: "Mandarin House Special",
    caption: "Mandarin House Special",
    aspect: "4/5",
  },
  dishSaltedPepperWings: {
    id: "dish-salted-pepper-wings",
    /**
     * Favourite #4 (`salted-pepper-chicken-wings-special`), and the only
     * dish photograph with a live surface today.
     *
     * It also happens to be the dish the hero video ends on, plated on the
     * same blue-and-white pattern — so the first thing a visitor sees and
     * the first dish photograph on the page are the same food on the same
     * china, which is worth more than it sounds.
     *
     * A lower-resolution wings photo used to sit unwired in public/images
     * as chicken.jpg: 640x640, on a black plate over cool white marble.
     * Superseded and gone — it was the same dish shot off-brand.
     */
    src: "/images/dish-salted-pepper-wings.jpg",
    alt: "Salt and pepper chicken wings: crisp golden wings on a blue-and-white plate, scattered with sliced scallion, chopped garlic and red chili flakes",
    caption: "Salted Pepper Chicken Wings",
    aspect: "4/5",
  },
  dishHoneyWalnutShrimp: {
    id: "dish-honey-walnut-shrimp",
    /**
     * Real menu item (`honey-walnut-shrimp`, in Specials) and NOT one of
     * the six favourites, so this photograph is wired and currently
     * unrendered. It is the strongest of the three as a picture.
     */
    src: "/images/dish-honey-walnut-shrimp.jpg",
    alt: "Honey walnut shrimp: shrimp in a glossy honey glaze topped with candied walnuts and sesame, ringed with orange slices on a blue-and-white plate",
    caption: "Honey Walnut Shrimp",
    aspect: "4/5",
  },
  dishHouseSoftNoodle: {
    id: "dish-house-soft-noodle",
    /**
     * `house-soft-noodle`, in Noodles — matched by CONTENT, not filename.
     * The photograph is soft lo-mein-style noodles tossed with pork,
     * shrimp, cabbage and carrot on the oval platter.
     *
     * ⚠️ DELIBERATELY NOT `dishPanFriedNoodles`. That slot is Upside Down
     * Pan Fried Noodles, which is a crisp fried noodle pillow with the
     * stir-fry spooned over it — a different dish that looks nothing like
     * this. The filename said "house noodles" and the picture agrees with
     * the filename, which is the only reason to trust it.
     */
    src: "/images/dish-house-soft-noodle.jpg",
    alt: "House soft noodles: lo mein tossed with pork, shrimp, cabbage and carrot on a blue-and-white oval platter",
    caption: "House Soft Noodle",
    aspect: "4/5",
  },
  dishHoneyWalnutChicken: {
    id: "dish-honey-walnut-chicken",
    /** ⚠️ No such dish in data/menu.ts — see the note above. */
    src: null,
    alt: "Honey Walnut Chicken",
    caption: "Honey Walnut Chicken",
    aspect: "4/5",
  },
  dishKungPaoSanShein: {
    id: "dish-kung-pao-san-shein",
    /** Favourite #5. Still the shot list. */
    src: null,
    alt: "Kung Pao San Shein",
    caption: "Kung Pao San Shein",
    aspect: "4/5",
  },
  dishCrispyGameHen: {
    id: "dish-crispy-game-hen",
    /** ⚠️ No such dish in data/menu.ts — see the note above. */
    src: null,
    alt: "Crispy Game Hen",
    caption: "Crispy Game Hen",
    aspect: "4/5",
  },
  dishPanFriedNoodles: {
    id: "dish-pan-fried-noodles",
    /**
     * Real menu item, not a favourite, and NOT served by the house-soft
     * noodle photograph above — different dish. Still the shot list.
     */
    src: null,
    alt: "Upside Down Pan Fried Noodles",
    caption: "Upside Down Pan Fried Noodles",
    aspect: "4/5",
  },
} satisfies Record<string, SitePhoto>;
