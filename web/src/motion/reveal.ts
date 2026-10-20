/*
 * Declarative entries (DESIGN.md "Motion language"): everything enters along x, the distance
 * axis, and decelerates; nothing fades up from below.
 *
 *   data-intro          plays with the page intro, once the curtain has uncovered the page
 *   data-reveal         plays when it scrolls into view (batched, so neighbours stagger)
 *   data-delay="0.2"    extra delay in seconds (intro entries)
 *
 * The hidden state is applied by GSAP inside a layout effect, before the first paint, so
 * nothing is hidden by CSS: an element no scan reached simply shows without an entry, and
 * reduced motion skips the scan entirely (everything visible, nothing moves). Never put
 * data-reveal on an element that other code moves with GSAP; wrap it instead.
 */
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ENTRY_DURATION, ENTRY_STAGGER, ENTRY_X, ease, prefersReducedMotion } from "./env";

const vars = (el: Element): gsap.TweenVars => ({
  delay: parseFloat((el as HTMLElement).dataset.delay || "0"),
});

/**
 * Wire the reveals inside `root` that `seen` has not handled yet. Returns the intro timeline
 * (paused) for the caller to play when the page is uncovered. Call inside a gsap.context.
 */
export function initReveals(root: ParentNode, seen: WeakSet<Element>) {
  const intro = gsap.timeline({ paused: true });
  if (prefersReducedMotion()) return intro;

  const fresh = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)].filter((el) => !seen.has(el) && (seen.add(el), true));

  const introEls = fresh("[data-intro]");
  if (introEls.length) {
    gsap.set(introEls, { x: -ENTRY_X, autoAlpha: 0 });
    introEls.forEach((el, i) => {
      intro.to(
        el,
        {
          x: 0,
          autoAlpha: 1,
          duration: ENTRY_DURATION,
          ease: ease.out,
          ...vars(el),
        },
        i * ENTRY_STAGGER,
      );
    });
  }

  const scrollEls = fresh("[data-reveal]:not([data-intro])");
  if (scrollEls.length) {
    gsap.set(scrollEls, { x: -ENTRY_X, autoAlpha: 0 });
    ScrollTrigger.batch(scrollEls, {
      start: "top 92%",
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, {
          x: 0,
          autoAlpha: 1,
          duration: ENTRY_DURATION,
          ease: ease.out,
          stagger: ENTRY_STAGGER,
          overwrite: true,
        }),
    });
  }
  return intro;
}
