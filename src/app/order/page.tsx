import { redirect } from "next/navigation";

/**
 * /order is now /menu.
 *
 * There were two pages rendering the same catalogue — this one with an Add
 * button on every row, /menu without one — so the page search traffic lands on
 * was the page that could not take an order. They are one surface now.
 *
 * This redirect is kept rather than deleted because /order is in the wild: the
 * hero CTA, the sticky bar and every confirmation page pointed at it for
 * months, and a 404 on the ordering link is the most expensive 404 this site
 * could serve.
 *
 * NOT a permanent redirect: browsers cache a 308 indefinitely, and where
 * ordering lives is a routing decision that has already changed once.
 */
export default function OrderPage(): never {
  redirect("/menu#order");
}
