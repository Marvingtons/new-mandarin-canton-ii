"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import type { Menu, MenuItem, MenuModifier, MenuSize } from "@/lib/menu/types";
import { indexItems, isAvailable, itemSizes } from "@/lib/menu/types";
import { groupsForSize } from "@/lib/menu/rice";
import { resolveLinePrice } from "@/lib/cart/pricing";

/**
 * Cart state — client only. Lines store IDs, never prices: the price is always
 * derived from the menu (here for display, on the server for the charge). This
 * is what makes a tampered client cart harmless.
 */
export interface CartLine {
  lineId: string;
  itemId: string;
  sizeId: string;
  modifierIds: string[];
  quantity: number;
  specialInstructions?: string;
}

interface CartState {
  lines: CartLine[];
}

type Action =
  | { type: "rehydrate"; lines: CartLine[] }
  | { type: "add"; line: CartLine }
  | { type: "updateQuantity"; lineId: string; quantity: number }
  | { type: "remove"; lineId: string }
  | { type: "clear" };

/**
 * BUMPED v1 -> v2 when rice became a required choice on most of the menu.
 *
 * A cart is JSON in sessionStorage and is rehydrated without revalidation
 * against the current menu, so a tab left open across the deploy would
 * hold lines built before the rice group existed. Those lines carry no
 * rice id, and the server now refuses them (lib/orders/modifierRules) —
 * correct, but the customer would meet that refusal at the Place Order
 * button with no idea why. Changing the key drops the stale cart at the
 * door instead, which is the cheaper of the two disappointments.
 */
const STORAGE_KEY = "nmc-cart-v2";

/** Stable signature for merging identical configurations. */
function lineSignature(
  line: Pick<CartLine, "itemId" | "sizeId" | "modifierIds" | "specialInstructions">,
): string {
  return [
    line.itemId,
    line.sizeId,
    [...line.modifierIds].sort().join(","),
    line.specialInstructions?.trim() ?? "",
  ].join("|");
}

function reducer(state: CartState, action: Action): CartState {
  switch (action.type) {
    case "rehydrate":
      return { lines: action.lines };
    case "add": {
      const sig = lineSignature(action.line);
      const existing = state.lines.find((l) => lineSignature(l) === sig);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.lineId === existing.lineId
              ? { ...l, quantity: l.quantity + action.line.quantity }
              : l,
          ),
        };
      }
      return { lines: [...state.lines, action.line] };
    }
    case "updateQuantity": {
      const quantity = Math.max(0, Math.floor(action.quantity));
      if (quantity === 0) {
        return { lines: state.lines.filter((l) => l.lineId !== action.lineId) };
      }
      return {
        lines: state.lines.map((l) =>
          l.lineId === action.lineId ? { ...l, quantity } : l,
        ),
      };
    }
    case "remove":
      return { lines: state.lines.filter((l) => l.lineId !== action.lineId) };
    case "clear":
      return { lines: [] };
    default:
      return state;
  }
}

/** A cart line joined to its menu item, with resolved display prices. */
export interface DetailedLine extends CartLine {
  item: MenuItem;
  size: MenuSize;
  modifiers: MenuModifier[];
  unitCents: number;
  lineCents: number;
}

interface CartContextValue {
  lines: CartLine[];
  detailedLines: DetailedLine[];
  itemCount: number;
  subtotalCents: number;
  hydrated: boolean;
  addItem: (input: Omit<CartLine, "lineId">) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  remove: (lineId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

let lineCounter = 0;
function nextLineId(): string {
  lineCounter += 1;
  return `line_${Date.now().toString(36)}_${lineCounter}`;
}

export function CartProvider({
  menu,
  children,
}: {
  menu: Menu;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, { lines: [] });
  const [hydrated, setHydrated] = useState(false);

  // Rehydrate from sessionStorage once, after mount. Initial client render
  // matches the server (empty cart), so there is no hydration mismatch.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CartLine[];
        if (Array.isArray(parsed)) dispatch({ type: "rehydrate", lines: parsed });
      }
    } catch {
      /* corrupt storage — start empty */
    }
    // Loading persisted cart state after mount is the hydration-safe pattern:
    // the server and first client render are both empty, and we flip to the
    // stored cart only post-hydration. Reading storage in a useState
    // initializer would instead cause an SSR/client mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  // Persist on every change, once the initial hydrate pass has completed.
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.lines));
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [state.lines, hydrated]);

  const itemIndex = useMemo(() => indexItems(menu), [menu]);

  const detailedLines = useMemo<DetailedLine[]>(() => {
    const out: DetailedLine[] = [];
    for (const line of state.lines) {
      const item = itemIndex.get(line.itemId);
      if (!item || !isAvailable(item)) continue; // drop 86'd/removed items
      const size =
        itemSizes(item).find((s) => s.id === line.sizeId) ?? itemSizes(item)[0];
      // Size-filtered, so a tray line built before rice became
      // individual-only does not sit in the cart promising a rice the
      // kitchen will never bag. The order route strips the same ids from
      // the payload (see lib/menu/rice); this is the half the customer can
      // see, and the two read one rule.
      const offered = groupsForSize(item, size.id).flatMap((g) => g.modifiers);
      const modifiers = offered.filter((m) =>
        line.modifierIds.includes(m.id),
      );
      let priced;
      try {
        priced = resolveLinePrice(item, size.id, line.modifierIds, line.quantity);
      } catch {
        priced = { unitCents: size.priceCents, lineCents: size.priceCents * line.quantity };
      }
      out.push({
        ...line,
        item,
        size,
        modifiers,
        unitCents: priced.unitCents,
        lineCents: priced.lineCents,
      });
    }
    return out;
  }, [state.lines, itemIndex]);

  const value = useMemo<CartContextValue>(() => {
    const itemCount = detailedLines.reduce((n, l) => n + l.quantity, 0);
    const subtotalCents = detailedLines.reduce((n, l) => n + l.lineCents, 0);
    return {
      lines: state.lines,
      detailedLines,
      itemCount,
      subtotalCents,
      hydrated,
      addItem: (input) =>
        dispatch({ type: "add", line: { ...input, lineId: nextLineId() } }),
      updateQuantity: (lineId, quantity) =>
        dispatch({ type: "updateQuantity", lineId, quantity }),
      remove: (lineId) => dispatch({ type: "remove", lineId }),
      clear: () => dispatch({ type: "clear" }),
    };
  }, [state.lines, detailedLines, hydrated]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
