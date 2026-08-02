import type { Metadata } from "next";
import { getMenu } from "@/lib/menu/source";
import { publicTenant } from "@/config/tenant.server";
import OrderMenu from "@/components/order/OrderMenu";
import { isLunchService } from "@/lib/order/gates";

export const metadata: Metadata = {
  title: "Menu",
  /* 158 characters. "Order pickup straight from the family" is the
     menu page's own tagline (`menu.intro`), so the search result and
     the page it opens now say the same thing in the same voice. */
  description:
    "The full menu at New Mandarin Canton II in Chula Vista: Mandarin, Szechuan and Cantonese, cooked to order. Order pickup straight from the family, no app fees.",
};

/**
 * THE menu. One surface, browse and order.
 *
 * This page used to render `data/menu.ts` as a printed menu — dish names,
 * prices, no way to order any of it — while /order rendered the same catalogue
 * through `catalogMenu()` with an Add button on every row. Two pages, one
 * menu, and the one people actually find in search was the one that could not
 * take an order.
 *
 * So this now renders the ordering surface itself, and /order redirects here.
 * The hero keeps both calls to action: "View Menu" lands at the top of the
 * page, "Order Takeout" lands on #order — same live menu, different emphasis.
 *
 * ⚠️ THIS PAGE IS NOW SERVER-RENDERED PER REQUEST rather than prerendered at
 * build. Not a choice made here: the layout renders <TestModeBadge/>, which
 * reads an httpOnly cookie, and one cookies() call opts the whole segment out
 * of static generation. That was already true of /order; converging moved it
 * onto the URL search traffic lands on.
 *
 * What matters for that traffic is unaffected — OrderMenu is a client
 * component, but Next renders it on the server for the initial response, so
 * every dish name and price is in the HTML before any JavaScript runs
 * (verified: the markup contains "Kung Pao Chicken" and "$22.50"). The cost is
 * a render per request instead of a cache hit. If that shows up in the
 * numbers, the fix is to move the badge behind its own boundary rather than to
 * split the menu back in two.
 */
export default async function MenuPage() {
  const menu = await getMenu();
  const tenant = publicTenant();
  /* Lunch placement is decided HERE, on the server, and passed down.
     OrderMenu already re-checks on an interval for a page left open, but
     the FIRST paint has to be right: Lunch Specials moves to the top of
     the page during service, and a client-only decision would render the
     off-hours order and then reshuffle the whole menu under the reader.
     This route is already dynamic (the layout reads a cookie), so the
     server clock here is fresh on every request. */
  const lunchOpen = isLunchService(new Date(), {
    timezone: tenant.timezone,
    leadMinutes: tenant.pickupLeadMinutes,
    intervalMinutes: tenant.pickupSlotIntervalMinutes,
  });
  return (
    <OrderMenu
      menu={menu}
      taxRateBps={tenant.taxRateBps}
      timezone={tenant.timezone}
      lunchOpenInitial={lunchOpen}
    />
  );
}
