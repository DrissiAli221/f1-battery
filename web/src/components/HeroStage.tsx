import { useLayoutEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "../motion";

/*
 * The hero (DESIGN.md "Hero", ported from the owner's MonarcPulse hero): one viewport tall,
 * two layers. As the hero scrolls out ("top top" to "bottom top"), the trace layer translates
 * 0 to 30 % of its height and the copy layer 0 to 20 %: the copy outruns the trace, so the
 * trace reads as further away. One ScrollTrigger scrub on the GSAP ticker drives both, and
 * writes its progress to `progress` so the straight's cursor runs on the same scroll.
 *
 * It also tells the navbar it is over a hero: `html.has-hero` while mounted, and
 * `html.nav-clear` (transparent bar) until the hero's bottom passes 64 px.
 */
// React 18 does not know `fetchPriority`; the lowercase attribute reaches the DOM as is.
export function HeroStage({
  trace,
  photo,
  children,
  progress,
  label,
}: {
  /** The background layer: the straight at hero size (optional when a photo is given). */
  trace?: ReactNode;
  /** A full-bleed photograph behind the copy, faded into the ground by a scrim. */
  photo?: { src: string; alt: string; webp?: string; webpSmall?: string };
  /** The copy: h1, paragraph, CTA row. Sits bottom-left. */
  children: ReactNode;
  /** Receives the scroll progress over the hero, 0 to 1 (pass to Straight's progress input). */
  progress?: { current: number };
  label?: string;
}) {
  const section = useRef<HTMLElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = section.current;
    if (!el) return;
    const html = document.documentElement.classList;
    html.add("has-hero", "nav-clear");
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: el,
        start: "top bottom",
        end: `bottom ${64}px`,
        onToggle: (self) => html.toggle("nav-clear", self.isActive),
      });
      if (prefersReducedMotion()) return; // both layers stay at 0; the cursor parks at the cut-off
      gsap
        .timeline({
          scrollTrigger: {
            trigger: el,
            start: "top top",
            end: "bottom top",
            scrub: true,
            onUpdate: (self) => {
              if (progress) progress.current = self.progress;
            },
          },
        })
        .fromTo(back.current, { yPercent: 0 }, { yPercent: 30, ease: "none" }, 0)
        .fromTo(front.current, { yPercent: 0 }, { yPercent: 20, ease: "none" }, 0);
    }, el);
    return () => {
      ctx.revert();
      html.remove("has-hero", "nav-clear");
      if (progress) progress.current = 0;
    };
  }, [progress]);

  return (
    <section ref={section} className={photo ? "hero hero--photo" : "hero"} aria-label={label} data-stage>
      <div ref={back} className="hero__back">
        {photo ? (
          <>
            <picture>
              {photo.webp ? (
                <source
                  type="image/webp"
                  srcSet={photo.webpSmall ? `${photo.webpSmall} 1280w, ${photo.webp} 2560w` : photo.webp}
                  sizes="100vw"
                />
              ) : null}
              <img className="hero__photo" src={photo.src} alt={photo.alt} decoding="async" {...{ fetchpriority: "high" }} />
            </picture>
            <div className="hero__scrim" aria-hidden="true" />
          </>
        ) : null}
        {trace}
      </div>
      <div ref={front} className="hero__front">
        <div className="hero__cols" aria-hidden="true">
          <span />
        </div>
        <div className="hero__hline" aria-hidden="true" />
        <div className="hero__copy-wrap">
          <div className="hero__copy">{children}</div>
        </div>
      </div>
    </section>
  );
}
