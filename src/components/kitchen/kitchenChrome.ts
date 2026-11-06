"use client";

import { createContext, useContext } from "react";
import type { KitchenKey } from "@/lib/kitchen/i18n";

/**
 * The staff area's sections and the shell's shared chrome, apart from the
 * components that render them (KitchenShell, PosTopBar), so those files
 * export components only and Fast Refresh can keep their state.
 */

export type KitchenSection = "board" | "pos" | "history" | "printers";

export const SECTIONS: { id: KitchenSection; path: string; label: KitchenKey }[] = [
  { id: "board", path: "", label: "nav.board" },
  { id: "pos", path: "/pos", label: "nav.pos" },
  { id: "history", path: "/history", label: "nav.history" },
  { id: "printers", path: "/printers", label: "nav.printers" },
];

/**
 * What a screen that draws its own top bar (the POS) needs from the shell:
 * where the other sections live, and the per-device 大字 switch.
 */
export interface KitchenChrome {
  basePath: string;
  active: KitchenSection;
  largeText: boolean;
  toggleLargeText: () => void;
}

export const KitchenChromeContext = createContext<KitchenChrome | null>(null);

export function useKitchenChrome(): KitchenChrome {
  const chrome = useContext(KitchenChromeContext);
  if (!chrome) throw new Error("useKitchenChrome outside KitchenShell");
  return chrome;
}
