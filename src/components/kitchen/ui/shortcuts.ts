"use client";

import { useEffect, useRef } from "react";

/**
 * Single-key shortcuts for a laptop at the counter. Ignored while typing
 * (inputs, textareas, selects, contenteditable), with a modifier held (so the
 * browser's own Cmd/Ctrl shortcuts are untouched), and while a modal dialog is
 * open (the dialog owns the keyboard then).
 *
 * Keys are matched on KeyboardEvent.key, lowercased for letters, so "?" works
 * with whatever Shift layout produces it.
 */
export type ShortcutMap = Record<string, (event: KeyboardEvent) => void>;

function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "submit", "reset"].includes(type);
  }
  return false;
}

export function useShortcuts(map: ShortcutMap, enabled = true): void {
  // The latest handlers without re-binding the listener on every render.
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingIn(event.target)) return;
      if (document.querySelector("dialog[open]")) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handler = ref.current[key];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
