import { getMenu } from "@/lib/menu/source";
import { CartProvider } from "@/lib/cart/CartContext";
import TestModeBadge from "@/components/TestModeBadge";

/**
 * /menu is the ORDERABLE menu, so it needs the cart.
 *
 * There used to be two menus: this page, which rendered `data/menu.ts` as a
 * printed menu you could only read, and /order, which rendered the same
 * catalogue with an Add button. Same dishes, same prices, two surfaces, and a
 * customer who found the menu first had to be told to go somewhere else to
 * order it. They are one surface now — /order redirects here — and this layout
 * is what carries the cart across.
 *
 * The cart itself lives in sessionStorage (see CartContext), so this provider
 * and the one in the order layout are the same cart: a line added here is
 * still there at /order/checkout.
 */
export default async function MenuLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const menu = await getMenu();
  return (
    <CartProvider menu={menu}>
      {children}
      {/* Server-rendered from the httpOnly cookie, so it cannot be faked or
          dismissed from the page. Now that ordering starts here, a bypassed
          session has to be visible here too. */}
      <TestModeBadge />
    </CartProvider>
  );
}
