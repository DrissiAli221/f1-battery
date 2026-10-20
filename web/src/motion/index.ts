/*
 * The motion engine, adapted to React 18 + the hash router (see the awwwards engine's adapter
 * contract): `bootMotion()` once on first load; `usePage()` in each page so every tween and
 * ScrollTrigger it makes is reverted when the route changes; `useRouteChange()` in the app
 * shell for the scroll reset, focus move and curtain uncover.
 *
 * One clock: gsap.ticker drives Lenis, ScrollTrigger, the instrument's cursor and anything
 * else that moves. Nothing here starts its own requestAnimationFrame loop.
 */
import { useEffect, useLayoutEffect, useRef, type DependencyList } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { initScroll, onScroll, resetScroll } from "./scroll";
import { initReveals } from "./reveal";
import { enterPage, initTransitions, whenEntered } from "./transition";
import { prefersReducedMotion } from "./env";

export { onScroll, scrollState, scrollToTarget, stopScroll, startScroll } from "./scroll";
export { whenEntered } from "./transition";
export { ease, isTouch, prefersReducedMotion, ENTRY_X } from "./env";

let booted = false;

/** First load, client only. Idempotent (StrictMode runs effects twice). */
export function bootMotion() {
  if (booted) return;
  booted = true;
  document.documentElement.classList.toggle("motion", !prefersReducedMotion());
  initScroll();
  initTransitions();
  initStepAside();
}

/*
 * The fixed readout steps aside on scroll down and returns on scroll up (patterns.md 6). A
 * class on <html> drives a CSS `translate` transition, so it never fights a GSAP transform.
 */
function initStepAside() {
  let last = 0;
  onScroll(({ y }) => {
    if (Math.abs(y - last) < 4) return;
    document.documentElement.classList.toggle("readout-away", y > 160 && y > last);
    last = y;
  });
}

export type PageFn = (page: { root: HTMLElement; intro: gsap.core.Timeline }) => void | (() => void);

/**
 * Page lifecycle for one page component. Attach the returned ref to the page root.
 *
 * - Reveals (`data-intro`, `data-reveal`) inside the root are wired on mount and again whenever
 *   `deps` change (pass the page's data, so elements rendered after a fetch get their entry);
 *   an element is only ever wired once.
 * - `fn` runs inside a gsap.context scoped to the root: every tween and ScrollTrigger it
 *   creates is reverted when deps change and when the page unmounts (a route change).
 *   Return a function to undo anything else (listeners on window).
 * - After each deps change, ScrollTrigger.refresh() runs once, so triggers measure the layout
 *   the data produced.
 * - The intro plays once the curtain has uncovered the page.
 */
export function usePage<T extends HTMLElement = HTMLElement>(fn?: PageFn, deps: DependencyList = []) {
  const ref = useRef<T>(null);
  const page = useRef<{
    ctx: gsap.Context;
    seen: WeakSet<Element>;
    alive: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const state = {
      ctx: gsap.context(() => {}, root),
      seen: new WeakSet<Element>(),
      alive: true,
    };
    page.current = state;
    return () => {
      state.alive = false;
      state.ctx.revert();
      page.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const root = ref.current;
    const state = page.current;
    if (!root || !state) return;
    let intro: gsap.core.Timeline | null = null;
    state.ctx.add(() => {
      intro = initReveals(root, state.seen);
    });
    let cleanup: void | (() => void);
    const run = gsap.context(() => {
      if (intro) cleanup = fn?.({ root, intro });
    }, root);
    void whenEntered().then(() => {
      if (state.alive) intro?.play();
    });
    return () => {
      if (typeof cleanup === "function") cleanup();
      run.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    ScrollTrigger.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

/**
 * Route-change behaviour for the app shell: on a new path (not a query-only change) scroll to
 * the top, move focus to <main> for screen readers, and uncover the curtain if a leave ran.
 */
export function useRouteChange(path: string, main: React.RefObject<HTMLElement>) {
  // The previous path, not a "first run" flag: StrictMode runs layout effects twice on mount.
  const last = useRef(path);
  useLayoutEffect(() => {
    bootMotion();
    if (last.current === path) return;
    last.current = path;
    resetScroll();
    main.current?.focus({ preventScroll: true });
    void enterPage();
  }, [path, main]);
}
