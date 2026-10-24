import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger, CustomEase);

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Touch-first device: no smooth scroll, no idle creep, no pointer nudge. */
export const isTouch = () => matchMedia('(hover: none), (pointer: coarse)').matches;

/*
 * The ease family (DESIGN.md "Motion language"). The motion verb is "run down the straight":
 * fast off the line, tapering to a plateau. `taper` is that curve, registered once here and
 * used by name for anything that runs along the distance axis.
 */
CustomEase.create('taper', 'M0,0 C0.1,0.9 0.3,1 1,1');

export const ease = {
  out: 'expo.out', // entries
  inOut: 'expo.inOut', // the curtain
  taper: 'taper', // anything that runs down the straight
  soft: 'power3.out', // small UI feedback
} as const;

/** Entries slide along x by this many px (24 to 48), never up. */
export const ENTRY_X = 36;
export const ENTRY_DURATION = 1.15;
export const ENTRY_STAGGER = 0.04;
