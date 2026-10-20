/*
 * Route transitions (DESIGN.md v3): none. The curtain sweep of v2 was removed with the rest
 * of the drawn-in motion; a route change swaps the page and the new page's reveals play.
 * The API is kept so the engine and the pages need no change.
 */
import { startScroll } from "./scroll";

/** Called by the app once the new route's DOM is in place. */
export function enterPage(): Promise<void> {
  startScroll();
  return Promise.resolve();
}

/** Resolves at once: nothing covers the page. */
export const whenEntered = () => Promise.resolve();

export function initTransitions() {
  return () => {};
}
