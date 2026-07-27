import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

/**
 * Plugin registration and the reduced-motion gate — the two things every
 * animated component would otherwise re-implement (and eventually get
 * subtly wrong).
 */

let registered = false;

/** Registers GSAP plugins exactly once per page load. */
export function registerMotionPlugins(): void {
  if (registered) return;
  gsap.registerPlugin(ScrollTrigger, SplitText);
  registered = true;
}

/** True when the visitor has asked the OS for reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The standard entry point for a scroll-choreographed component:
 *
 *   useIsomorphicLayoutEffect(() => {
 *     const ctx = createMotionContext(() => { ...build scenes... });
 *     return () => ctx?.revert();
 *   }, []);
 *
 * Returns null under prefers-reduced-motion — `build` never runs, so the
 * server-rendered DOM IS the reduced-motion experience and no helper
 * needs its own fallback branch. Every ScrollTrigger and tween created
 * inside `build` is owned by the returned context, so one revert()
 * removes all of them.
 */
export function createMotionContext(
  build: () => void,
  scope?: Element | null,
): gsap.Context | null {
  if (prefersReducedMotion()) return null;
  registerMotionPlugins();
  return gsap.context(build, scope ?? undefined);
}

/** Normalizes the many ways a caller can name targets into a live array. */
export function toElements(
  target: string | Element | Element[] | NodeListOf<Element> | null | undefined,
  scope: ParentNode = document,
): HTMLElement[] {
  if (!target) return [];
  if (typeof target === "string")
    return Array.from(scope.querySelectorAll<HTMLElement>(target));
  if (target instanceof Element) return [target as HTMLElement];
  return Array.from(target) as HTMLElement[];
}
