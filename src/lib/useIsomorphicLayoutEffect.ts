import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * WHY THIS EXISTS — effect-phase timing, not aesthetics.
 *
 * GSAP mutates DOM that React owns: ScrollTrigger's `pin` wraps the pinned
 * element in a `.pin-spacer` div (reparenting it), and SplitText replaces a
 * heading's text node with per-character spans. React still believes those
 * nodes live where it originally put them.
 *
 * React unmounts in two phases:
 *   mutation phase  — host nodes are removed (`parent.removeChild(node)`)
 *   passive phase   — `useEffect` cleanups finally run
 *
 * A `useEffect` cleanup that calls `ctx.revert()` therefore runs AFTER React
 * has already tried to remove the reparented node, which throws:
 *   NotFoundError: Failed to execute 'removeChild' on 'Node':
 *   The node to be removed is not a child of this node.
 *
 * `useLayoutEffect` cleanups run during the MUTATION phase, before those
 * removals — so GSAP puts the DOM back exactly where React expects it just in
 * time. This is the same reason GSAP's own `useGSAP()` hook is built on a
 * layout effect.
 *
 * The server fallback avoids React's "useLayoutEffect does nothing on the
 * server" warning; these effects are client-only anyway.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
