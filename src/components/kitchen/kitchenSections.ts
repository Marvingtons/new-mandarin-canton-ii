import type { KitchenKey } from "@/lib/kitchen/i18n";
import type { IconName } from "@/components/kitchen/Icon";

/**
 * The staff app's sections, in nav order. Apart from the shell that renders
 * them so that file exports components only (Fast Refresh keeps its state).
 */

export type KitchenSection = "board" | "pos" | "history";

export const SECTIONS: { id: KitchenSection; path: string; label: KitchenKey; icon: IconName }[] = [
  { id: "board", path: "", label: "nav.board", icon: "columns" },
  { id: "pos", path: "/pos", label: "nav.pos", icon: "plus" },
  { id: "history", path: "/history", label: "nav.history", icon: "history" },
];
