"use client";

import { useEffect, useRef } from "react";

/**
 * Single-key shortcuts for a laptop at the counter (J K A C P X, 1 2 3, ?, and
 * the shell's N B H M). They do NOTHING while:
 *
 *   - focus is in any input (every type: a checkbox or a number field is
 *     still somewhere a key press means something to), a textarea, a select,
 *     or anything contenteditable;
 *   - any dialog is open: a native <dialog open>, or an ARIA dialog
 *     (role="dialog" / "alertdialog", or aria-modal), such as the POS item
 *     sheet. The dialog owns the keyboard then;
 *   - a modifier is held, so the browser's own Cmd/Ctrl shortcuts are
 *     untouched.
 *
 * Both the event's target and document.activeElement are checked: a key can
 * be dispatched at the window while focus sits in a field.
 *
 * Keys are matched on KeyboardEvent.key, lowercased for letters, so "?" works
 * with whatever Shift layout produces it.
 */
export type ShortcutMap = Record<string, (event: KeyboardEvent) => void>;

const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const OPEN_DIALOG = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

function typingIn(node: EventTarget | Element | null): boolean {
  if (!(node instanceof Element)) return false;
  if (node instanceof HTMLElement && node.isContentEditable) return true;
  return node.closest(TYPING) !== null;
}

/** Exported for the help overlay's own key handling and for tests. */
export function shortcutsSuppressed(event: Pick<KeyboardEvent, "target">): boolean {
  if (typingIn(event.target) || typingIn(document.activeElement)) return true;
  for (const el of document.querySelectorAll<HTMLElement>(OPEN_DIALOG)) {
    // A dialog element in the DOM but hidden is not open.
    if (el.hidden || el.getAttribute("aria-hidden") === "true") continue;
    if (el instanceof HTMLDialogElement && !el.open) continue;
    return true;
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
      if (shortcutsSuppressed(event)) return;
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
