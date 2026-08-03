// TODO(confirm): es strings pending native review (Marvin)
//
// Register: Chula Vista Mexican Spanish. Usted-neutral throughout — this
// is a counter conversation with a customer, not a friend. "Para llevar"
// rather than the Iberian "comida para llevar", "Recoger" for pickup,
// "Ordenar" rather than "pedir" because that is what the neighbourhood
// says of a restaurant. No voseo, no peninsular vocabulary (no "coger",
// no "móvil" — it is "celular").
//
// ⚠️ EVERY KEY MUST EXIST IN BOTH LANGUAGES. `es` is typed as
// Record<TranslationKey, string> where TranslationKey is derived from
// `en`, so a missing Spanish string is a COMPILE ERROR rather than a
// silent English fallback. That is the point: a fallback would hide the
// gap, and half-translated UI reads worse than none.

import type { Locale } from "@/lib/i18n/locale";

/**
 * English is the source of truth for the key set.
 *
 * Interpolated values are `{name}` placeholders rather than string
 * concatenation, because Spanish does not put the number, the currency
 * or the clause in the same place English does.
 */
export const en = {
  /* ---- header / nav ---- */
  "nav.home": "Home",
  "nav.menu": "Menu",
  "nav.about": "About",
  "nav.contact": "Contact",
  "nav.aria": "Main",
  "lang.label": "Language",
  "lang.en": "EN",
  "lang.es": "ES",
  "lang.switchToEs": "Cambiar a español",
  "lang.switchToEn": "Switch to English",

  /* ---- hero ---- */
  "hero.orderTakeout": "Order Takeout",
  "hero.viewMenu": "View Menu",
  "hero.call": "Call",
  /* The hero's THIRD and last decision, and the reason it is a phrase
     rather than the bare "Call" the sticky bar uses: it is one row of
     small text under two large buttons, so it has to say what it is
     before it says the number. Rendered "Call us · (619) 656-6888" —
     middot separating the label from the number, the site's own
     convention. The hero shows ONE number; the second is on /contact and
     in the footer band, both of which list every line. */
  "hero.callUs": "Call us",
  /* The value line under the hero CTAs. It used to be ORDER_DIRECT_NOTE in
     data/order.ts, which meant a Spanish hero read "ORDER DIRECT · NO
     DELIVERY-APP FEES · LLAMAR (619) …" — half the line translated and half
     not, inside one sentence. */
  "hero.orderDirect": "Order direct · no delivery-app fees",

  /* ---- menu page ---- */
  "menu.title": "Menu",
  /* Half of a one-line tagline joined by a middot: "{intro} · {pickupOnlyAt}".
     It used to end "…, not a delivery app." and wrap to two lines at 1440.
     The no-delivery-app claim still leads the homepage hero
     (hero.orderDirect) and "no delivery" is in the footer of every page. */
  "menu.intro": "Order straight from the family",
  "menu.pickupOnlyAt": "Pickup only at {street}.",
  "menu.cart": "Cart",
  "menu.search": "Search dishes…",
  "menu.searchLabel": "Search the menu",
  "menu.spicyOnly": "Spicy only",
  /* "Favorites", US spelling, matching the homepage's "House Favorites".
     The two surfaces show the same six dishes from the same list and used
     to spell the label two different ways. */
  "menu.favourites": "House Favorites",
  "menu.categoriesAria": "Menu categories",
  "menu.noMatches": "No matches, try the category list",
  "menu.noMatchesZh": "沒有符合的項目，請用分類選單",
  "menu.clearFilter": "Clear the filter",
  "menu.addPlus": "Add +",
  "menu.from": "from {price}",
  "menu.unavailable": "Currently unavailable",
  "menu.lunchOnly": "Lunch specials are served 11:00 AM – 3:00 PM",
  "menu.lunchUntil": "until 3:00 PM",
  "menu.lunchUntilZh": "至下午三時",
  "menu.lunchWindowOnly": "11 AM–3 PM only",

  /* ---- the ONE notice card on the menu page: two lines, no internal rules.
     Line 1 is logistics, line 2 is the clock and the allergy line.
     Middots separate TOPICS inside a line; a 中文 half follows its English
     directly, set in font-chinese and muted, which is what distinguishes it.
     Only the two lead fragments are bold. ---- */
  "banner.pickupLead": "Pickup only",
  "banner.logistics":
    "ready in 15–20 min · party trays & family dinners 20–30 · pay at the counter",
  /* {time} is TODAY's cutoff, not the week's — 8:30 PM Sun–Fri, 9:00 PM
     Saturday. The 中文 half took a hardcoded "8:30" until the owner moved
     Saturday, at which point it was the only string on the site that
     could contradict the English beside it. It interpolates the same
     lookup now (see todaysCutoff), and takes the BARE clock because 晚上
     already says which half of the day it is. */
  "banner.onlineUntil": "Online orders until {time}",
  "banner.onlineUntilZh": "網上訂餐至晚上{time}",
  "banner.allergy": "Allergies? Call us first",
  "banner.allergyZh": "食物過敏請先致電",

  /* ---- item sheet ---- */
  "sheet.size": "Size",
  "sheet.required": "required",
  "sheet.specialInstructions": "Special instructions",
  "sheet.instructionsPlaceholder": "e.g. extra spicy, sauce on the side",
  "sheet.allergyCall": "Allergies: please call us instead",
  "sheet.allergyCallZh": "過敏請致電",
  "sheet.allergyNote":
    "This note only reaches the kitchen when your ticket prints.",
  "sheet.chooseToAdd": "Please choose {groups} to add this to your cart.",
  "sheet.addToCart": "Add to Cart",
  "sheet.close": "Close",
  "sheet.decreaseQty": "Decrease quantity",
  "sheet.increaseQty": "Increase quantity",

  /* ---- cart ---- */
  "cart.title": "Your Pickup Order",
  "cart.empty": "Your cart is empty",
  "cart.emptyHint": "Add a few dishes to start your pickup order.",
  "cart.remove": "Remove",
  "cart.subtotal": "Subtotal",
  "cart.tax": "Tax",
  "cart.taxAtCheckout": "calculated at checkout",
  "cart.total": "Total",
  "cart.checkout": "Checkout",
  "cart.items": "items",
  "cart.item": "item",
  "cart.pickupOnly": "Pickup only · no delivery",
  "cart.viewCart": "View Cart",
  "cart.everythingElse": "Everything else is 15–20 minutes.",
  /* Shown when anything in the cart pushes the whole order to 20–30. The
     condition is `item.longPrep || size.id === "party-tray"`, so a family
     dinner with no tray in it triggers it — and the string it used to show
     was PARTY_TRAY_PREP_NOTE, "Party trays: ready in 20–30 minutes", which
     told that customer about food they had not ordered. Named for what the
     condition actually covers, the way conf.longPrepNote already is. */
  "cart.longPrep": "Party trays & family dinners: ready in 20–30 minutes",

  /* ---- checkout ---- */
  "checkout.title": "Checkout",
  "checkout.pickupOnlyAt": "Pickup only · {street}",
  "checkout.payAtCounter": "Pay when you pick up.",
  "checkout.noOnlinePayment":
    "We don't take payment online. Cash or card at the counter.",
  "checkout.pickupDetails": "Pickup details",
  "checkout.name": "Name",
  "checkout.mobile": "Mobile number",
  "checkout.pickupTime": "Pickup time",
  "checkout.verifyLegend": "Verify your number",
  "checkout.verifyWhy":
    "We text you a code so the kitchen knows the order is real, and so we can reach you when it's ready.",
  "checkout.verified": "Number verified.",
  "checkout.verifiedZh": "號碼已驗證。",
  "checkout.textMeCode": "Text me a code",
  "checkout.resendCode": "Resend code",
  "checkout.sending": "Sending…",
  "checkout.codeLabel": "6-digit code",
  "checkout.verify": "Verify",
  "checkout.checking": "Checking…",
  "checkout.placeOrder": "Place pickup order · {total} at pickup",
  "checkout.placing": "Placing pickup order…",
  "checkout.payAtCounterShort": "Pickup only · pay at the counter",
  "checkout.yourOrder": "Your order",
  "checkout.dueAtPickup": "Due at pickup",
  "checkout.taxAtPickup": "added at pickup",
  "checkout.editOrder": "Edit order",
  "checkout.backToMenu": "Back to menu",
  "checkout.emptyTitle": "Your cart is empty",
  "checkout.emptyHint": "Add a few dishes to start a pickup order.",
  "checkout.allergyWarn":
    "Please call for allergy questions, do not rely on order notes",
  "checkout.allergyWarnZh": "過敏問題請致電，請勿只依賴備註",
  "checkout.closedFallback":
    "We're closed for online orders right now. Please call us.",

  /* ---- checkout errors (client-side) ---- */
  "err.enterName": "Please enter your name.",
  "err.verifyFirst": "Please verify your phone number first.",
  "err.verifyFirstZh": "請先驗證電話號碼。",
  "err.choosePickup": "Please choose a pickup time.",
  "err.noReachServer": "We couldn't reach the server. Please try again.",
  "err.noReachServerZh": "無法連線，請重試。",
  "err.noPlaceOrder": "We couldn't place your order. Please try again.",
  "err.noPlaceOrderZh": "無法送出訂單，請重試。",
  "err.codeWrong": "That code isn't right.",
  "err.codeNotSent": "We couldn't send a code.",
  "otp.codeSent": "Code sent to ••••{last4}. It expires in 10 minutes.",

  /* ---- confirmation ---- */
  "conf.title": "Order confirmed",
  "conf.thanks": "Thank you. Your order is with the kitchen. This is a",
  "conf.pickupOrder": "pickup order",
  "conf.collectAndPay": ": collect it at the counter and pay when you do.",
  "conf.orderNumber": "Order number",
  "conf.readyAround": "Ready around",
  "conf.longPrepNote": "Party trays & family dinners need a little longer",
  "conf.pickupLocation": "Pickup location",
  "conf.backToMenu": "Back to the menu",
  "conf.noOrder": "No recent order",
  "conf.noOrderHint": "Start a new pickup order from the menu.",
  "conf.orderPickup": "Order pickup",
  "conf.allergyHeading": "You mentioned something we should hear about by phone.",
  /* The 中文 half of the two-part line. It was written inline in the JSX —
     the one place on the site that hardcoded Chinese instead of reading it
     from here — so it was also the one place a 中文 correction would not be
     found by searching this file. Same characters as checkout.allergyWarnZh,
     which is the same sentence one screen earlier. */
  "conf.allergyHeadingZh": "過敏問題請致電",
  "conf.allergyBody":
    "An order note reaches the kitchen only when your ticket prints, so please call and tell us directly.",

  /* ---- footer ---- */
  /* The brand board's cuisine line, under the footer lockup's gold rule.
     Middots, per the site's separator convention. The founding year is
     NOT here — <Established /> states it two lines below. */
  "footer.cuisineLine": "Mandarin · Szechuan · Cantonese",
  "footer.hours": "Hours",
  "footer.findUs": "Find Us",
  "footer.getDirections": "Get Directions",
  "footer.pickupOnly": "Takeout pickup only · no delivery",
  "footer.allergyQuestions": "Questions about allergies? Call us.",
  /* ⚠️ THE SECOND SENTENCE HAD TO GO. It read "The dining room stays open
     past it, so please call to order after that", which was true while the
     cutoff ran ahead of closing — up to an hour ahead on a Saturday. The
     owner has since set the cutoff TO the closing time on every day, so
     there is no "past it" left to call during: when online ordering stops,
     the restaurant is closing. Leaving the sentence would have sent people
     to a phone nobody is answering.

     {time} is today's cutoff (see todaysCutoff), because the week no
     longer shares one. */
  "footer.lastOnlineOrder": "Last online order {time}, when we close.",
  "footer.privacy": "Privacy",
  "footer.terms": "Terms",
  "footer.today": "Today",
  "footer.closed": "Closed",
  /* ---- the holiday line, under the hours (footer + /contact) ----
     One line, the quiet style, and NOT a third banner on the menu page —
     the notice-fatigue rule stands and the menu card stays at two lines.
     "call ahead" is the site's tappable-number treatment: the words are
     the tel: link, because a phone number spelled out here would be a
     third copy of it in one footer.
     The 中文 half follows its English directly with no middot of its own,
     per the separator convention on banner.allergy. */
  "hours.holidayLead": "Holiday hours may differ",
  "hours.holidayCall": "please call ahead",
  "hours.holidayZh": "節假日營業時間或有不同，請來電確認",

  /* ---- contact page ----
     Its three section labels reuse footer.findUs / hero.call / footer.hours
     rather than adding near-duplicates: they are the same three words about
     the same three things, and the footer had already had them translated.
     Only what is unique to this page is new. */
  "contact.title": "Visit Us",
  "contact.callNumber": "Call {phone}",
  /* Was "Takeout orders welcome by phone." — the passive "welcome by"
     of a hotel sign, and the only sentence on the marketing pages with
     nobody in it. The family speaks in the first person plural
     throughout their history; so does this now. The Spanish already
     said exactly this and did not change. */
  "contact.phoneWelcome": "We take takeout orders by phone too.",
  "contact.open7": "Open 7 days a week.",

  /* ---- THE SIGNATURE LINE ----
     The one phrase the family's history gave the site, and the only
     thing in here that is allowed to be a phrase rather than a
     sentence. It appears in EXACTLY TWO PLACES — the homepage story
     section and the About pull-quote — and that is the whole budget. It
     is not in the hero (the hero has its line), not in the footer, and
     not repeated down a page until it stops meaning anything. A
     signature that appears everywhere is a slogan.

     Both halves are the family's own: 三代人 is the phrase they used.
     The 中文 half renders only on About, where the 中文 story follows it
     — the homepage carries no other Chinese, and one floating line of it
     there would be an ornament rather than a translation.
     ⚠️ TODO(confirm): Traditional wording, with the rest of the 中文. */
  "story.threeGenerations": "Three generations at our tables",
  "story.threeGenerationsZh": "三代人，同一張餐桌",

  /* ---- homepage prose ----
     Hardcoded in app/page.tsx until now, which meant a Spanish reader
     got the whole homepage in English. Moved here as part of the voice
     pass, since the copy was being rewritten anyway. Closes the Home
     half of P12 in docs/SITE_REVIEW_2.md alongside About.

     The one string on this page that is still English by design is
     House Favorites' heading: it is a module-scope constant that GSAP's
     SplitText owns after mount (see FavoritesSpotlight). */
  "home.storyTitle": "Our Story",
  /* Was: "…cooked the way they have always been. No reinvention. Just
     the food." That last pair is a copywriter's cadence, not the
     family's — they say "we'll keep cooking every dish the way we always
     have", in full sentences. Same claim, their rhythm, and the 1995
     they confirmed now stands here too. */
  "home.storyBody":
    "New Mandarin Canton II is a family-run Chinese restaurant on Telegraph Canyon Road: calligraphy on the walls, an altar by the door with incense and fresh tangerines. We opened in 1995, and we cook Mandarin, Szechuan and Cantonese dishes the way we always have.",
  "home.readOurStory": "Read our story",
  "home.roomTitle": "The Room",
  "home.roomIntro": "Come in. The room is part of the meal.",
  "home.altar":
    "The altar by the door watches over the kitchen: oranges for fortune, incense for family.",

  /* ---- the heritage lockup (footer on every page, and About) ----
     The phrasing moved here from a hardcoded English return in
     data/restaurant.ts, which put an English line immediately above the
     Spanish story on /about. `{decades}` is rounded down by
     `tenureDecades()`, so this stays true without a yearly edit.
     "Est. 1995" itself is not translated and does not need to be: it is
     a year in a bracket. */
  "established.tenure": "{decades}+ years on Telegraph Canyon",
  /* Under ten years open. Unreachable today and kept anyway, because the
     branch that picks it is cheaper than the bug if it is ever removed. */
  "established.tenureShort": "Family-run on Telegraph Canyon",
  /* No confirmed founding year: keep the warmth, drop the number. */
  "established.tenureNoYear": "Family-run on Telegraph Canyon for decades",

  /* ---- ABOUT PAGE: THE FAMILY'S STORY ----
     ⚠️ AUTHORITATIVE COPY. These paragraphs are the family's own written
     history, supplied by them in Chinese with an approved English
     translation. They are not marketing copy and must not be "improved"
     — a rewrite here is putting words in their mouth. Punctuation was
     the only thing touched on integration: the approved English used em
     dashes, and this site does not (see commit 2680106), so three of
     them became commas.

     ⚠️ THE `*Zh` KEYS ARE NO LONGER RENDERED ANYWHERE. The 中文 story
     came off the About page; the English story is the story. The strings
     stay — both locales, unchanged — because they are the family's own
     history converted Simplified → Traditional, and putting the block
     back should be uncommenting a div rather than retyping three
     paragraphs. The Simplified source-of-truth is still in
     app/about/page.tsx, and docs/ABOUT_REMOVED_CONTENT.md records what
     came off and how to restore it.

     The "Traditional conversion pending family review" flag is CLOSED
     with them: nothing is waiting on that review while nothing renders.
     It comes back with the block if the block does.

     `{yearsCap}` / `{years}` are filled from data/restaurant.ts's
     `yearsOpen()`, so the count never goes stale. English takes the
     capitalised form because its sentence opens with it and Spanish's
     does not. "More than thirty years" stays a static phrase in all
     three languages: it is the family's own rounding and it stays true
     without help. */
  "about.title": "About Us",
  /* The pull-quote over the story: the signature line (see
     `story.threeGenerations`). It used to read "The people have changed.
     The cooking hasn't." — written for the family before they had said
     anything, and a good line about the wrong thing. What they actually
     wrote about is the guests who came in holding a parent's hand and
     come back now holding their own child's. */
  "about.pullQuote": "Three generations at our tables",
  "about.storyP1":
    "Our restaurant opened its doors in 1995. For more than thirty years, we've held to one belief: cook every dish with care, to the tastes our guests love most, and in doing so create a flavor that is entirely our own.",
  "about.storyP1Zh":
    "我們的餐廳創立於1995年。三十多年來，我們始終堅持一個信念：按照客人最喜愛的口味，用心烹製每一道菜，創造出屬於我們自己的獨一無二的美食風味。",
  /* Its own key because it is the one sentence carrying a computed
     value. Split out rather than duplicated, so an unconfirmed founding
     year drops this sentence and the paragraph still reads. */
  "about.storyP2Lead": "{yearsCap} years have passed since we first opened.",
  "about.storyP2LeadZh": "從開業至今，我們已經走過了{years}年的歲月。",
  "about.storyP2":
    "Many of our guests came here as children, holding their parents' hands. Today they're grown, married, with families of their own, and they bring their children back to our tables. To walk beside a family through three generations is our greatest honor, and the treasure we hold most dear.",
  "about.storyP2Zh":
    "許多客人小時候跟著父母來到這裡用餐，如今長大成人、結婚成家，又帶著自己的孩子回到我們的餐廳。能夠陪伴一個家庭走過三代人的美好時光，是我們最大的榮幸，也是我們最珍惜的財富。",
  "about.storyP3":
    "Times have changed over thirty years. Our devotion to quality, to flavor, and to every guest who walks through our door has not. We'll keep cooking every dish the way we always have, and welcoming every guest the way we always have, so this familiar taste, and this warmth, carry on.",
  "about.storyP3Zh":
    "三十多年來，時代在變化，但我們對品質的堅持、對味道的執著、對每一位客人的用心從未改變。未來，我們也將繼續秉持初心，堅持做好每一道菜、服務好每一位客人，讓這份熟悉的味道和溫暖一直傳承下去。",
  /* ⚠️ NOT the family's words, and NO LONGER RENDERED. Drafted here
     before their history arrived.

     Its flag — "family to choose: story alone, or story + memorial" — is
     CLOSED, and closed with an answer rather than retired: story alone.
     A paragraph about someone's death, written by a stranger and never
     approved by the people it is about, does not get to sit on their
     About page while a question mark hangs over it.

     The string stays for the same reason it was written cautiously in
     the first place: if the family reads it and says yes, it goes back
     up. See docs/ABOUT_REMOVED_CONTENT.md. No 中文 half on purpose:
     inventing Chinese for unapproved English would make it harder, not
     easier, for them to say no. */
  "about.memorial":
    "A restaurant open this long outlives some of the people who built it. When one of the original owners passed away, someone who had worked here since the early days became an owner and kept it open. The kitchen carried on as it was.",

  /* ---- FAQ (contact page) ----
     ⚠️ EVERY ANSWER IS A FACT THIS REPO ALREADY HOLDS, and each one is
     the same fact some other surface already states — the notice card,
     the checkout, the footer, the hours table. Nothing here is new
     information, which is the test a FAQ has to pass: it is the
     questions people actually ask, answered where an answer engine can
     read them, not a place to make claims that appear nowhere else.

     WHAT IS DELIBERATELY NOT ASKED: parking, reservations, beer & wine,
     high chairs, catering radius, health score. Every one of those is a
     `null` in data/restaurant.ts, and a plausible-sounding answer to any
     of them would be exactly the invented fact this codebase spends its
     comments refusing to print. They are on the list for the family.

     These strings are rendered visibly AND emitted as FAQPage schema
     from the same keys — Google requires the two to match, and sharing
     the key is the only way that stays true.

     No 中文 halves: the answers restate lines that have them
     (banner.allergy, banner.onlineUntil) and lines that do not, so a
     half-Chinese FAQ would be worse than none. The 中文 belongs to the
     notices these answers point back to. */
  "faq.title": "Questions we get asked",
  "faq.q.delivery": "Do you deliver?",
  "faq.a.delivery":
    "No. We are takeout pickup only, and we are not on any delivery app. You order here or by phone, then collect it at the counter.",
  "faq.q.howLong": "How long does an order take?",
  "faq.a.howLong":
    "Most orders are ready in 15 to 20 minutes. Party trays and family dinners take 20 to 30.",
  "faq.q.pay": "How do I pay?",
  "faq.a.pay":
    "At the counter when you pick up, by cash or card. We do not take payment online.",
  "faq.q.phone": "Can I order by phone?",
  "faq.a.phone":
    "Yes. Call (619) 656-6888 or (619) 656-6787. Both lines are staffed.",
  /* ⚠️ REWRITTEN TWICE OVER by one hours change. "every day" is no longer
     true — Saturday's cutoff is 9:00 PM against 8:30 the rest of the
     week — and neither is "the dining room stays open past that", because
     the cutoff IS closing time now. Both halves of the old answer were
     confidently wrong.

     It names TODAY's cutoff rather than enumerating the week, and that is
     a source-of-truth decision rather than a copy one: spelling out
     "8:30 Sun–Fri, 9:00 Sat" here would put the hours in a translation
     file, which is precisely the straggler this pass exists to remove.
     The per-day week is published by the hours table, which derives from
     the same record. */
  "faq.q.onlineCutoff": "How late can I order online?",
  "faq.a.onlineCutoff":
    "Until we close, which is {time} today. Holiday hours may differ, so please call ahead.",
  "faq.q.food": "What kind of food do you cook?",
  "faq.a.food":
    "Mandarin, Szechuan and Cantonese, cooked to order. The family has been cooking it here since 1995.",
  "faq.q.where": "Where are you?",
  "faq.a.where":
    "543 Telegraph Canyon Rd, Chula Vista, CA 91910. We are open 7 days a week from 11:00 AM.",
  "faq.q.allergies": "I have a food allergy. What should I do?",
  "faq.a.allergies":
    "Please call us before you order rather than leaving a note. An order note only reaches the kitchen when your ticket prints, and an allergy is not something we want to find out that late.",

  /* ---- legal page headers ---- */
  "legal.privacy": "Privacy",
  "legal.terms": "Terms",
  "legal.lastUpdated": "Last updated {date}",

  /* ---- 404 ---- */
  "notFound.title": "Page not found",
  "notFound.body":
    "That link has wandered off. The menu and the hours are all still here. The kitchen never moved.",
  "notFound.viewMenu": "View the menu",
  "notFound.backHome": "Back home",
  "notFound.orCall": "Or just call",

  /* ---- misc chrome ---- */
  "backToTop.aria": "Back to top",
  "backToTop.title": "Back to top · 回到頂部",
  "chip.openUntil": "Open · until {time}",
  "chip.closedOpensAt": "Closed · opens {time}",

  /* ---- days, for the weekly hours table ---- */
  "day.monday": "Monday",
  "day.tuesday": "Tuesday",
  "day.wednesday": "Wednesday",
  "day.thursday": "Thursday",
  "day.friday": "Friday",
  "day.saturday": "Saturday",
  "day.sunday": "Sunday",
  "hours.caption": "Weekly opening hours",

  /* ---- fragments that get spliced into other sentences ----
     `ui.and` exists because ItemSheet joins group names inside a
     translated sentence. Joining with a hardcoded " and " produced
     "Elija arroz and salsa para agregar…" — an English conjunction in
     the middle of a Spanish clause. A fragment is not a great thing to
     translate in isolation, but it is far better than that. */
  "ui.and": "and",
  /* Joins the two phone numbers wherever PhoneLinks renders them. It was a
     hardcoded " or " passed in at six call sites, which put an English
     conjunction between two numbers on the Spanish menu, checkout, 404,
     privacy and terms — the same problem `ui.and` above exists to solve. */
  "ui.or": "or",
  "menu.spicy": "Spicy",
  "hero.tagline": "Mandarin, Szechuan & Cantonese cuisine in Chula Vista",
  "cart.closeCart": "Close cart",
  "cart.decreaseItem": "Decrease {name}",
  "cart.increaseItem": "Increase {name}",
  "fav.intro": "The dishes our regulars come back for.",
  "fav.seeFullMenu": "See the full menu",
  "fav.previousDish": "Previous dish",
  "fav.nextDish": "Next dish",
  "fav.bringToSpotlight": "{name}, bring to spotlight",
} as const;

/** Every key the UI can ask for. Derived from `en`, never written by hand. */
export type TranslationKey = keyof typeof en;

/**
 * Spanish. Typed as a total record over the English key set, so omitting
 * one fails `tsc` with the missing key named.
 */
export const es: Record<TranslationKey, string> = {
  /* ---- header / nav ---- */
  "nav.home": "Inicio",
  "nav.menu": "Menú",
  "nav.about": "Nosotros",
  "nav.contact": "Contacto",
  "nav.aria": "Principal",
  "lang.label": "Idioma",
  "lang.en": "EN",
  "lang.es": "ES",
  "lang.switchToEs": "Cambiar a español",
  "lang.switchToEn": "Switch to English",

  /* ---- hero ---- */
  "hero.orderTakeout": "Ordenar para llevar",
  "hero.viewMenu": "Ver el menú",
  "hero.call": "Llamar",
  /* Usted-neutral, like the rest of the register. "Llámenos", not
     "llámanos". */
  "hero.callUs": "Llámenos",
  "hero.orderDirect": "Ordene directo · sin cargos de apps de entrega",

  /* ---- menu page ---- */
  "menu.title": "Menú",
  "menu.intro": "Ordene directamente con la familia",
  "menu.pickupOnlyAt": "Solo para recoger en {street}.",
  "menu.cart": "Carrito",
  "menu.search": "Buscar platillos…",
  "menu.searchLabel": "Buscar en el menú",
  "menu.spicyOnly": "Solo picante",
  // Unchanged: Spanish was already spelling this one way.
  "menu.favourites": "Favoritos de la casa",
  "menu.categoriesAria": "Categorías del menú",
  "menu.noMatches": "No hay resultados, use la lista de categorías",
  "menu.noMatchesZh": "沒有符合的項目，請用分類選單",
  "menu.clearFilter": "Quitar el filtro",
  "menu.addPlus": "Agregar +",
  "menu.from": "desde {price}",
  "menu.unavailable": "No disponible por ahora",
  "menu.lunchOnly": "Los especiales de almuerzo se sirven de 11:00 AM a 3:00 PM",
  "menu.lunchUntil": "hasta las 3:00 PM",
  "menu.lunchUntilZh": "至下午三時",
  "menu.lunchWindowOnly": "solo de 11 AM a 3 PM",

  /* ---- the menu page's one notice card ---- */
  "banner.pickupLead": "Solo para recoger",
  "banner.logistics":
    "listo en 15–20 min · charolas y cenas familiares 20–30 · pague en el mostrador",
  "banner.onlineUntil": "Órdenes en línea hasta las {time}",
  "banner.onlineUntilZh": "網上訂餐至晚上8:30",
  "banner.allergy": "¿Alergias? Llámenos primero",
  "banner.allergyZh": "食物過敏請先致電",

  /* ---- item sheet ---- */
  "sheet.size": "Tamaño",
  "sheet.required": "obligatorio",
  "sheet.specialInstructions": "Instrucciones especiales",
  "sheet.instructionsPlaceholder": "p. ej. más picante, salsa aparte",
  "sheet.allergyCall": "Alergias: por favor llámenos",
  "sheet.allergyCallZh": "過敏請致電",
  "sheet.allergyNote":
    "Esta nota llega a la cocina solo cuando se imprime su ticket.",
  "sheet.chooseToAdd": "Elija {groups} para agregar esto al carrito.",
  "sheet.addToCart": "Agregar al carrito",
  "sheet.close": "Cerrar",
  "sheet.decreaseQty": "Quitar uno",
  "sheet.increaseQty": "Agregar uno",

  /* ---- cart ---- */
  "cart.title": "Su orden para recoger",
  "cart.empty": "Su carrito está vacío",
  "cart.emptyHint": "Agregue unos platillos para empezar su orden.",
  "cart.remove": "Quitar",
  "cart.subtotal": "Subtotal",
  "cart.tax": "Impuesto",
  "cart.taxAtCheckout": "se calcula al pagar",
  "cart.total": "Total",
  "cart.checkout": "Pagar",
  "cart.items": "artículos",
  "cart.item": "artículo",
  "cart.pickupOnly": "Solo para recoger · sin entrega a domicilio",
  "cart.viewCart": "Ver carrito",
  "cart.everythingElse": "Todo lo demás está listo en 15–20 minutos.",
  "cart.longPrep":
    "Charolas para fiesta y cenas familiares: listas en 20–30 minutos",

  /* ---- checkout ---- */
  "checkout.title": "Pagar",
  "checkout.pickupOnlyAt": "Solo para recoger · {street}",
  "checkout.payAtCounter": "Pague cuando recoja.",
  "checkout.noOnlinePayment":
    "No aceptamos pagos en línea. Efectivo o tarjeta en el mostrador.",
  "checkout.pickupDetails": "Datos para recoger",
  "checkout.name": "Nombre",
  "checkout.mobile": "Número de celular",
  "checkout.pickupTime": "Hora para recoger",
  // The one tú in the file, and it is deliberate: the brief named this
  // exact string. Everything else stays usted. Flagged for the native
  // review so the reviewer decides rather than discovers.
  "checkout.verifyLegend": "Verifica tu número",
  "checkout.verifyWhy":
    "Le enviamos un código por mensaje para que la cocina sepa que la orden es real, y para poder avisarle cuando esté lista.",
  "checkout.verified": "Número verificado.",
  "checkout.verifiedZh": "號碼已驗證。",
  "checkout.textMeCode": "Envíenme un código",
  "checkout.resendCode": "Reenviar código",
  "checkout.sending": "Enviando…",
  "checkout.codeLabel": "Código de 6 dígitos",
  "checkout.verify": "Verificar",
  "checkout.checking": "Verificando…",
  "checkout.placeOrder": "Enviar la orden · {total} al recoger",
  "checkout.placing": "Enviando la orden…",
  "checkout.payAtCounterShort": "Solo para recoger · pague en el mostrador",
  "checkout.yourOrder": "Su orden",
  "checkout.dueAtPickup": "A pagar al recoger",
  "checkout.taxAtPickup": "se agrega al recoger",
  "checkout.editOrder": "Editar la orden",
  "checkout.backToMenu": "Volver al menú",
  "checkout.emptyTitle": "Su carrito está vacío",
  "checkout.emptyHint": "Agregue unos platillos para empezar una orden.",
  "checkout.allergyWarn":
    "Para preguntas sobre alergias, llámenos; no dependa solo de las notas",
  "checkout.allergyWarnZh": "過敏問題請致電，請勿只依賴備註",
  "checkout.closedFallback":
    "Por ahora no tomamos órdenes en línea. Por favor llámenos.",

  /* ---- checkout errors (client-side) ---- */
  "err.enterName": "Por favor escriba su nombre.",
  "err.verifyFirst": "Por favor verifique su número primero.",
  "err.verifyFirstZh": "請先驗證電話號碼。",
  "err.choosePickup": "Por favor elija una hora para recoger.",
  "err.noReachServer": "No pudimos conectar con el servidor. Intente de nuevo.",
  "err.noReachServerZh": "無法連線，請重試。",
  "err.noPlaceOrder": "No pudimos enviar su orden. Intente de nuevo.",
  "err.noPlaceOrderZh": "無法送出訂單，請重試。",
  "err.codeWrong": "Ese código no es correcto.",
  "err.codeNotSent": "No pudimos enviar el código.",
  "otp.codeSent": "Código enviado al ••••{last4}. Vence en 10 minutos.",

  /* ---- confirmation ---- */
  "conf.title": "Orden confirmada",
  "conf.thanks": "Gracias. Su orden ya está con la cocina. Es una",
  "conf.pickupOrder": "orden para recoger",
  "conf.collectAndPay": ": recójala en el mostrador y pague ahí mismo.",
  "conf.orderNumber": "Número de orden",
  "conf.readyAround": "Lista alrededor de",
  "conf.longPrepNote":
    "Las charolas y cenas familiares tardan un poco más",
  "conf.pickupLocation": "Dónde recoger",
  "conf.backToMenu": "Volver al menú",
  "conf.noOrder": "No hay ninguna orden reciente",
  "conf.noOrderHint": "Empiece una orden nueva desde el menú.",
  "conf.orderPickup": "Ordenar para recoger",
  "conf.allergyHeading": "Mencionó algo que necesitamos escuchar por teléfono.",
  "conf.allergyHeadingZh": "過敏問題請致電",
  "conf.allergyBody":
    "Una nota en la orden llega a la cocina solo cuando se imprime su ticket, así que por favor llámenos y díganos directamente.",

  /* ---- footer ---- */
  // Cuisine names are the same three words in Spanish; only the accent moves.
  "footer.cuisineLine": "Mandarín · Szechuan · Cantonés",
  "footer.hours": "Horario",
  // Two distinct things: the heading over the map, and the button that
  // opens Google Maps. They were the same Spanish string, which made the
  // footer column read "Cómo llegar" twice.
  "footer.findUs": "Dónde estamos",
  "footer.getDirections": "Cómo llegar",
  "footer.pickupOnly": "Solo para llevar · sin entrega a domicilio",
  "footer.allergyQuestions": "¿Preguntas sobre alergias? Llámenos.",
  /* Second sentence dropped, like the English: the cutoff is closing time
     now, so there is no "sigue abierto después". */
  "footer.lastOnlineOrder":
    "Última orden en línea a las {time}, cuando cerramos.",
  "footer.privacy": "Privacidad",
  "footer.terms": "Términos",
  "footer.today": "Hoy",
  "footer.closed": "Cerrado",
  /* ---- the holiday line ----
     "días festivos" is what the neighbourhood says; "llame antes" keeps
     the usted-neutral register the rest of this table uses. Pending the
     same native review as every string here (see the flag at the top). */
  "hours.holidayLead": "El horario puede cambiar en días festivos",
  "hours.holidayCall": "por favor llame antes",
  "hours.holidayZh": "節假日營業時間或有不同，請來電確認",

  /* ---- contact page ---- */
  "contact.title": "Visítenos",
  "contact.callNumber": "Llamar al {phone}",
  "contact.phoneWelcome": "También tomamos órdenes para llevar por teléfono.",
  "contact.open7": "Abierto los 7 días de la semana.",

  /* ---- the signature line ---- */
  "story.threeGenerations": "Tres generaciones en nuestras mesas",
  "story.threeGenerationsZh": "三代人，同一張餐桌",

  /* ---- homepage prose ----
     "El comedor", not "el salón": in Chula Vista the room with the
     tables in it is the comedor. */
  "home.storyTitle": "Nuestra historia",
  "home.storyBody":
    "New Mandarin Canton II es un restaurante chino familiar en Telegraph Canyon Road: caligrafía en las paredes, un altar junto a la puerta con incienso y mandarinas frescas. Abrimos en 1995, y cocinamos comida mandarina, sichuanesa y cantonesa como siempre lo hemos hecho.",
  "home.readOurStory": "Lea nuestra historia",
  "home.roomTitle": "El comedor",
  "home.roomIntro": "Pase. El comedor es parte de la comida.",
  "home.altar":
    "El altar junto a la puerta cuida la cocina: naranjas para la fortuna, incienso para la familia.",

  /* ---- the heritage lockup ---- */
  "established.tenure": "{decades}+ años en Telegraph Canyon",
  "established.tenureShort": "Restaurante familiar en Telegraph Canyon",
  "established.tenureNoYear":
    "Restaurante familiar en Telegraph Canyon desde hace décadas",

  /* ---- ABOUT PAGE: THE FAMILY'S STORY ----
     A faithful translation of the approved English, in the same plain
     first-person-plural register the family wrote in. Usted-neutral for
     the guest ("cada cliente que cruza nuestra puerta"), nosotros for
     the family, no marketing adjectives added.
     ⚠️ Flagged for the native review like every string in this table.
     The 中文 halves are identical to the English side's by design: the
     Chinese never moves, only the half beside it does — and neither the
     `*Zh` keys nor `about.memorial` render anywhere now. See the English
     table for why they are kept. */
  "about.title": "Sobre nosotros",
  "about.pullQuote": "Tres generaciones en nuestras mesas",
  "about.storyP1":
    "Nuestro restaurante abrió sus puertas en 1995. Por más de treinta años nos hemos mantenido fieles a una sola idea: cocinar cada platillo con cuidado, al gusto que más quieren nuestros clientes, y crear así un sabor que es enteramente nuestro.",
  "about.storyP1Zh":
    "我們的餐廳創立於1995年。三十多年來，我們始終堅持一個信念：按照客人最喜愛的口味，用心烹製每一道菜，創造出屬於我們自己的獨一無二的美食風味。",
  "about.storyP2Lead":
    "Han pasado {years} años desde que abrimos por primera vez.",
  "about.storyP2LeadZh": "從開業至今，我們已經走過了{years}年的歲月。",
  "about.storyP2":
    "Muchos de nuestros clientes llegaron aquí de niños, de la mano de sus papás. Hoy ya son grandes, casados, con sus propias familias, y traen a sus hijos de vuelta a nuestras mesas. Acompañar a una familia por tres generaciones es nuestro mayor honor, y el tesoro que más apreciamos.",
  "about.storyP2Zh":
    "許多客人小時候跟著父母來到這裡用餐，如今長大成人、結婚成家，又帶著自己的孩子回到我們的餐廳。能夠陪伴一個家庭走過三代人的美好時光，是我們最大的榮幸，也是我們最珍惜的財富。",
  "about.storyP3":
    "En treinta años los tiempos han cambiado. Nuestra entrega a la calidad, al sabor y a cada cliente que cruza nuestra puerta, no. Vamos a seguir cocinando cada platillo como siempre lo hemos hecho, y recibiendo a cada cliente como siempre lo hemos hecho, para que este sabor tan conocido, y esta calidez, perduren.",
  "about.storyP3Zh":
    "三十多年來，時代在變化，但我們對品質的堅持、對味道的執著、對每一位客人的用心從未改變。未來，我們也將繼續秉持初心，堅持做好每一道菜、服務好每一位客人，讓這份熟悉的味道和溫暖一直傳承下去。",
  "about.memorial":
    "Un restaurante abierto tanto tiempo sobrevive a algunas de las personas que lo levantaron. Cuando uno de los dueños originales falleció, alguien que trabajaba aquí desde los primeros años se hizo dueño y lo mantuvo abierto. La cocina siguió igual.",

  /* ---- FAQ (contact page) ----
     Same register as the rest: usted for the guest, nosotros for the
     family. "Solo para recoger" and "pague en el mostrador" are the
     exact phrases the cart and checkout already use, so a customer who
     reads the FAQ and then orders sees the same words twice. */
  "faq.title": "Preguntas que nos hacen",
  "faq.q.delivery": "¿Hacen entregas a domicilio?",
  "faq.a.delivery":
    "No. Somos solo para recoger, y no estamos en ninguna app de entrega. Ordene aquí o por teléfono, y recoja en el mostrador.",
  "faq.q.howLong": "¿Cuánto tarda una orden?",
  "faq.a.howLong":
    "La mayoría de las órdenes están listas en 15 a 20 minutos. Las charolas para fiesta y las cenas familiares tardan de 20 a 30.",
  "faq.q.pay": "¿Cómo puedo pagar?",
  "faq.a.pay":
    "En el mostrador cuando recoja, con efectivo o tarjeta. No aceptamos pagos en línea.",
  "faq.q.phone": "¿Puedo ordenar por teléfono?",
  "faq.a.phone":
    "Sí. Llame al (619) 656-6888 o al (619) 656-6787. Las dos líneas están atendidas.",
  "faq.q.onlineCutoff": "¿Hasta qué hora puedo ordenar en línea?",
  "faq.a.onlineCutoff":
    "Hasta que cerramos, que hoy es a las {time}. El horario puede cambiar en días festivos, así que por favor llame antes.",
  "faq.q.food": "¿Qué tipo de comida preparan?",
  "faq.a.food":
    "Comida mandarina, sichuanesa y cantonesa, hecha al momento. La familia lleva cocinándola aquí desde 1995.",
  "faq.q.where": "¿Dónde están?",
  "faq.a.where":
    "543 Telegraph Canyon Rd, Chula Vista, CA 91910. Abrimos los 7 días de la semana desde las 11:00 AM.",
  "faq.q.allergies": "Tengo una alergia alimentaria. ¿Qué hago?",
  "faq.a.allergies":
    "Por favor llámenos antes de ordenar, en lugar de dejar una nota. Una nota llega a la cocina solo cuando se imprime su ticket, y una alergia no es algo que queramos saber tan tarde.",

  /* ---- legal page headers ---- */
  "legal.privacy": "Privacidad",
  "legal.terms": "Términos",
  "legal.lastUpdated": "Actualizado el {date}",

  /* ---- 404 ---- */
  "notFound.title": "Página no encontrada",
  "notFound.body":
    "Ese enlace se perdió. El menú y el horario siguen aquí. La cocina nunca se movió.",
  "notFound.viewMenu": "Ver el menú",
  "notFound.backHome": "Volver al inicio",
  "notFound.orCall": "O simplemente llame al",

  /* ---- misc chrome ---- */
  "backToTop.aria": "Volver arriba",
  "backToTop.title": "Volver arriba · 回到頂部",
  "chip.openUntil": "Abierto · hasta las {time}",
  "chip.closedOpensAt": "Cerrado · abre a las {time}",

  /* ---- days, for the weekly hours table ---- */
  "day.monday": "Lunes",
  "day.tuesday": "Martes",
  "day.wednesday": "Miércoles",
  "day.thursday": "Jueves",
  "day.friday": "Viernes",
  "day.saturday": "Sábado",
  "day.sunday": "Domingo",
  "hours.caption": "Horario de la semana",

  /* ---- fragments spliced into other sentences ---- */
  "ui.and": "y",
  "ui.or": "o",
  "menu.spicy": "Picante",
  "hero.tagline": "Cocina mandarina, sichuanesa y cantonesa en Chula Vista",
  "cart.closeCart": "Cerrar el carrito",
  "cart.decreaseItem": "Quitar un {name}",
  "cart.increaseItem": "Agregar un {name}",
  "fav.intro": "Los platillos por los que regresan nuestros clientes.",
  "fav.seeFullMenu": "Ver el menú completo",
  "fav.previousDish": "Platillo anterior",
  "fav.nextDish": "Platillo siguiente",
  "fav.bringToSpotlight": "{name}, mostrar en grande",
};

const TABLES: Record<Locale, Record<TranslationKey, string>> = {
  en,
  es,
};

/**
 * A translator bound to one locale.
 *
 * `vars` fills `{placeholder}` slots. Interpolation rather than
 * concatenation because Spanish will not put the number, the currency or
 * the clause where English does — "$24.95 at pickup" is "{total} al
 * recoger", and a component that glued strings together would have no
 * way to express that.
 */
export type Translate = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

export function translator(locale: Locale): Translate {
  const table = TABLES[locale];
  return (key, vars) => {
    const raw = table[key];
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in vars ? String(vars[name]) : whole,
    );
  };
}

/** Key count, for the report and for the parity check. */
export const TRANSLATION_KEY_COUNT = Object.keys(en).length;
