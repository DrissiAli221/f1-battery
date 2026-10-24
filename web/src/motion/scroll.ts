/*
 * Scroll on one clock. Lenis is driven from gsap.ticker (lag smoothing off) and feeds
 * ScrollTrigger; on touch devices and under reduced motion the page scrolls natively and
 * ScrollTrigger reads it directly. Either way the rest of the app hears about scroll through
 * one feed, `onScroll`, published by a single ScrollTrigger: no scroll listeners of our own.
 */
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { isTouch, prefersReducedMotion } from './env';

export type ScrollState = { y: number; direction: 1 | -1; velocity: number };

let lenis: Lenis | null = null;
let feed: ScrollTrigger | null = null;
const state: ScrollState = { y: 0, direction: 1, velocity: 0 };
const listeners = new Set<(s: ScrollState) => void>();

export function initScroll() {
  if (feed) return;
  if (!prefersReducedMotion() && !isTouch()) {
    lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis?.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  // One page-independent trigger that spans the whole document; created outside any page
  // context, so route changes never revert it.
  feed = ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      state.y = self.scroll();
      state.direction = self.direction === -1 ? -1 : 1;
      state.velocity = self.getVelocity();
      listeners.forEach((fn) => fn(state));
    },
  });
}

export const onScroll = (fn: (s: ScrollState) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const scrollState = () => state;
export const stopScroll = () => lenis?.stop();
export const startScroll = () => lenis?.start();

export function resetScroll() {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo(0, 0);
  state.y = 0;
  state.velocity = 0;
}

/**
 * Same-page scrolling. The hash is the router, so in-page links never use href="#id":
 * they call this with an element or a selector.
 */
export function scrollToTarget(target: string | HTMLElement | number, offset = 0) {
  if (lenis) {
    lenis.scrollTo(target, {
      offset,
      duration: 1.2,
      easing: (t) => 1 - Math.pow(1 - t, 4),
    });
    return;
  }
  const el =
    typeof target === 'string'
      ? document.querySelector<HTMLElement>(target)
      : typeof target === 'number'
        ? null
        : target;
  const top = el ? el.getBoundingClientRect().top + window.scrollY + offset : (target as number);
  window.scrollTo({
    top,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}
