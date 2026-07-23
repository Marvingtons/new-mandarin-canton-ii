import Link from "next/link";
import { orderTarget } from "@/data/order";

/**
 * The site's single "Order Takeout" control. Its destination is decided
 * entirely by `orderTarget()` (see src/data/order.ts): an internal Link
 * to /order today, an external new-tab link to Clover hosted ordering
 * once that's configured. Every caller — hero, sticky mobile bar — reuses
 * this, so flipping ordering modes never touches the callers.
 *
 * Styling is fully delegated via `className` so it can be a big gold hero
 * button or a flat bar segment without variants baked in here.
 */
interface OrderTakeoutProps {
  className?: string;
  children?: React.ReactNode;
}

export default function OrderTakeout({
  className = "",
  children = "Order Takeout",
}: OrderTakeoutProps) {
  const target = orderTarget();

  if (target.kind === "external") {
    return (
      <a
        href={target.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={target.href} className={className}>
      {children}
    </Link>
  );
}
