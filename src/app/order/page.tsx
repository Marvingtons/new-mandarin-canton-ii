import { permanentRedirect } from "next/navigation";

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
 * PERMANENT (308) since the SEO pass. It was a 307 on the grounds that
 * browsers cache a 308 indefinitely and where ordering lives had already
 * moved once. The owner chose 308: /menu is where ordering lives, and a
 * permanent redirect is what tells a search engine to credit /menu with
 * any link still pointing here. If ordering ever moves again, /menu is the
 * page that has to forward, not this one.
 */
export default function OrderPage(): never {
  permanentRedirect("/menu#order");
}
