import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Straight, type StraightLabels } from "../instrument/Straight";
import type { Profile } from "../instrument/driver";
import { ease, prefersReducedMotion } from "../motion";
import { N } from "./recordData";

/** The estimator's crossing level and speed floor (docs/phase4-estimator.md, model A_THRESH). */
const A_THRESH = 0.5;
const V_FLOOR = 250;

/** Where each chapter parks the cursor, read off the profile itself. */
function chapterStops(p: Profile): [number, number, number] {
  const mid = (i: number) => p.bins[i].d_start_m + p.bin_m / 2;
  // 1: the steepest climb (the largest median acceleration).
  let steep = 0;
  p.bins.forEach((b, i) => {
    if (b.a_ms2 > p.bins[steep].a_ms2) steep = i;
  });
  // 2: the first bin above 250 kph where the median acceleration is under 0.5 m/s².
  const under = p.bins.findIndex((b) => b.v_kph > V_FLOOR && b.a_ms2 < A_THRESH);
  const drop = under >= 0 ? mid(under) : (p.cutoff_median_m ?? p.length_m * 0.7);
  // 3: the estimated cut-off (median over laps), where the bracket sits.
  const cut = p.cutoff_median_m ?? drop;
  return [mid(steep), drop, cut];
}

const CHAPTERS: { title: ReactNode; text: ReactNode }[] = [
  {
    title: "The slope is acceleration",
    text: (
      <>
        The line is the median speed in each <N>50</N>&nbsp;m of the straight, over the clean laps. Where it
        climbs steeply the car is gaining speed fast: the power unit, battery included, is pushing.
      </>
    ),
  },
  {
    title: (
      <>
        Below <N>0.5</N>&nbsp;m/s² above <N>250</N>&nbsp;kph
      </>
    ),
    text: (
      <>
        Still flat out, the car stops gaining speed. Above <N>250</N>&nbsp;kph the estimator looks for the
        first point where acceleration falls under <N>0.5</N>&nbsp;m/s²: the sign that deployment is being cut.
      </>
    ),
  },
  {
    title: "Four ticks and the cut-off lands",
    text: (
      <>
        Four <N>0.25</N>&nbsp;s steps in a row under the line and the cut-off is marked. Repeated on every
        clean lap, the median lands here; the bracket is its bootstrap interval. An estimate, drawn as one.
      </>
    ),
  },
];

/*
 * Sticky narrative (DESIGN.md "HOW IT IS READ"): the instrument at panel size sits in a CSS
 * sticky stage (col 5 to 12) while three chapters scroll in col 1 to 4. One ScrollTrigger per
 * chapter tweens the cursor's position in the taper ease; the instrument reads it every tick
 * (its "progress" input), so nothing re-renders per frame. Reduced motion: no sticky stage,
 * each chapter carries its own small trace with the cursor parked.
 */
export function HowItIsRead({ profile, labels }: { profile: Profile | null; labels: StraightLabels }) {
  const [reduced] = useState(() => prefersReducedMotion());
  const [step, setStep] = useState(0);
  const root = useRef<HTMLElement>(null);
  const progress = useRef({ current: 0 }).current;
  const stops = useMemo(() => (profile ? chapterStops(profile) : null), [profile]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || reduced || !profile || !stops) return;
    const L = profile.length_m || 1;
    progress.current = stops[0] / L;
    const ctx = gsap.context(() => {
      el.querySelectorAll<HTMLElement>("[data-chapter]").forEach((ch, i) => {
        ScrollTrigger.create({
          trigger: ch,
          start: "top 62%",
          end: "bottom 62%",
          invalidateOnRefresh: true,
          onToggle: (self) => {
            if (!self.isActive) return;
            setStep(i);
            gsap.to(progress, { current: stops[i] / L, duration: 1.2, ease: ease.taper, overwrite: true });
          },
        });
      });
    }, el);
    return () => ctx.revert();
  }, [profile, stops, reduced, progress]);

  return (
    <section ref={root} className={`how wrap ${reduced ? "how--still" : ""}`} aria-labelledby="how-h">
      <div className="section-intro how__intro">
        <h2 id="how-h" className="section-intro__title" data-reveal>
          How it is read
        </h2>
        <p className="section-intro__text" data-reveal>
          F1 shows speed, not the battery. Three readings of the same trace turn one into the other.
        </p>
      </div>

      {reduced ? (
        <ol className="how__still">
          {CHAPTERS.map((c, i) => (
            <li key={i} className="how__still-item">
              <h3 className="how__title">{c.title}</h3>
              <p className="how__text">{c.text}</p>
              <div className="how__mini" data-step={i}>
                <Straight profile={profile} size="panel" readout="none" d={stops ? stops[i] : 0} labels={i === 2 ? labels : undefined} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="how__grid">
          <ol className="how__chapters">
            {CHAPTERS.map((c, i) => (
              <li key={i} data-chapter className={`how__chapter ${step === i ? "is-on" : ""}`} aria-current={step === i ? "step" : undefined}>
                <div data-reveal>
                  <h3 className="how__title">{c.title}</h3>
                  <p className="how__text">{c.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="how__stage" data-step={step}>
            <Straight profile={profile} size="panel" d={{ mode: "progress", progress }} labels={labels} />
          </div>
        </div>
      )}
    </section>
  );
}
