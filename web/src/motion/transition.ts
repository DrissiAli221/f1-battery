/*
 * The page curtain (DESIGN.md "Motion language"): the cursor line sweeps left to right across
 * the viewport and draws the ground-2 panel behind it (leave, 0.8 s), the route swaps under
 * the cover, then the line sweeps on and uncovers the new page (enter, 0.8 s). Both halves use
 * expo.inOut. Under reduced motion there is no curtain: the route swaps at once.
 *
 * The hash router changes routes on `location.hash`. Internal links stay plain anchors; a
 * capturing click handler holds the hash change until the cover is drawn. Back/forward and
 * typed URLs skip the curtain (no leave ran), and query-only changes are not route changes.
 */
import { gsap } from "gsap";
import { ease, prefersReducedMotion } from "./env";
import { stopScroll, startScroll } from "./scroll";

const SWEEP = 0.8;

let covered = false;
let busy = false;
let entered = Promise.resolve();
let releaseEntered: (() => void) | null = null;

const curtain = () => document.getElementById("curtain");

function pathOf(hash: string) {
  return (hash.replace(/^#/, "") || "/").split("?")[0];
}

function leave(): Promise<void> {
  const c = curtain();
  if (!c || prefersReducedMotion()) return Promise.resolve();
  const panel = c.querySelector(".curtain__panel");
  const line = c.querySelector(".curtain__line");
  stopScroll();
  entered = new Promise((r) => (releaseEntered = r));
  return new Promise((resolve) => {
    gsap
      .timeline({ onComplete: () => ((covered = true), resolve()) })
      .set(c, { autoAlpha: 1 })
      .set(line, { x: 0 })
      .fromTo(panel, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: SWEEP, ease: ease.inOut }, 0)
      .to(line, { x: () => window.innerWidth, duration: SWEEP, ease: ease.inOut }, 0);
  });
}

/** Called by the app once the new route's DOM is in place. Uncovers if a leave ran. */
export function enterPage(): Promise<void> {
  const c = curtain();
  if (!covered || !c) {
    startScroll();
    return Promise.resolve();
  }
  covered = false;
  const panel = c.querySelector(".curtain__panel");
  const line = c.querySelector(".curtain__line");
  return new Promise((resolve) => {
    gsap
      .timeline({
        onComplete: () => {
          startScroll();
          releaseEntered?.();
          releaseEntered = null;
          resolve();
        },
      })
      .set(line, { x: 0 })
      .fromTo(panel, { clipPath: "inset(0% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 100%)", duration: SWEEP, ease: ease.inOut }, 0)
      .to(line, { x: () => window.innerWidth, duration: SWEEP, ease: ease.inOut }, 0)
      .set(c, { autoAlpha: 0 });
  });
}

/** Resolves when no curtain covers the page (page intros wait for it). */
export const whenEntered = () => entered;

/** Intercepts internal route links so the curtain can cover before the hash changes. */
export function initTransitions() {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a");
    const href = a?.getAttribute("href");
    if (!a || !href || !href.startsWith("#/") || (a.target && a.target !== "_self")) return;
    if (pathOf(href) === pathOf(window.location.hash)) return; // same page: query state only
    if (prefersReducedMotion() || !curtain()) return; // plain navigation
    e.preventDefault();
    if (busy) return;
    busy = true;
    leave().then(() => {
      busy = false;
      window.location.hash = href;
    });
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
