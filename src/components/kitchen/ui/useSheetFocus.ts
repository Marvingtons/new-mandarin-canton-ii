"use client";

import { useEffect, useRef } from "react";

/**
 * A POS sheet keeps the keyboard: focus starts where `start` says, Tab and
 * Shift+Tab cycle inside the panel, Escape closes it, and focus goes back to
 * whatever opened it. Shared by every sheet the POS draws (the dish sheet,
 * the custom charge), so a sheet cannot ship without the trap.
 *
 * Runs once per opening: a sheet is keyed by what it opened on.
 */
export function useSheetFocus(
  panelRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  start: (panel: HTMLElement) => HTMLElement | null | undefined,
): void {
  const onCloseRef = useRef(onClose);
  const startRef = useRef(start);
  useEffect(() => {
    onCloseRef.current = onClose;
    startRef.current = start;
  });
  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) startRef.current(panel)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const stops = [
        ...panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((el) => el.offsetParent !== null);
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const inside = panel.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [panelRef]);
}
