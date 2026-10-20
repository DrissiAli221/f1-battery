import { useMemo, useState, type ReactNode } from "react";
import { Card, SectionHead } from "../components/system";
import { Straight, type StraightLabels } from "../instrument/Straight";
import type { Profile } from "../instrument/driver";
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
 * How it is read (DESIGN.md v3 "Pages → Landing"): three short chapters beside the speed
 * trace on a card. No pin and no idle creep: the cursor is parked where the active chapter
 * points (hover, focus or tap a chapter to move it), the first chapter to begin with.
 */
export function HowItIsRead({ profile, labels, pending = false }: { profile: Profile | null; labels: StraightLabels; pending?: boolean }) {
  const [step, setStep] = useState(0);
  const stops = useMemo(() => (profile ? chapterStops(profile) : null), [profile]);

  return (
    <section className="lp-section wrap" aria-labelledby="how-h">
      <SectionHead label="Method" title={<span id="how-h">How it is read</span>}>
        <p>F1 shows speed, not the battery. Three readings of the same trace turn one into the other.</p>
      </SectionHead>

      <div className="how">
        <ol className="how__chapters">
          {CHAPTERS.map((c, i) => (
            <li key={i}>
              <button
                type="button"
                className={`how__chapter ${step === i ? "is-on" : ""}`}
                aria-pressed={step === i}
                onPointerEnter={(e) => e.pointerType === "mouse" && setStep(i)}
                onFocus={() => setStep(i)}
                onClick={() => setStep(i)}
              >
                <span className="how__n num">{String(i + 1).padStart(2, "0")}</span>
                <span className="how__body">
                  <span className="how__title">{c.title}</span>
                  <span className="how__text">{c.text}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <Card className="how__card">
          <Straight profile={profile} pending={pending} size="panel" d={stops ? stops[step] : 0} labels={labels} />
          <p className="how__cap">Median speed per 50&nbsp;m bin over the clean laps of one driver on one straight; the bracket is the cut-off's interval (est.).</p>
        </Card>
      </div>
    </section>
  );
}
