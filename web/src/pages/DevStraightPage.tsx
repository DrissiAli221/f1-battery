import { useRef, useState } from "react";
import { HeroStage } from "../components/HeroStage";
import { Cta, CtaGhost } from "../components/Cta";
import { Readout } from "../components/Readout";
import { Rule, SectionIntro } from "../components/Section";
import { Straight } from "../instrument/Straight";
import { REGIME_WORD, type Reading } from "../instrument/driver";
import { MONZA_MAIN_FIXTURE, MONZA_MAIN_FIXTURE_LABELS } from "../instrument/fixture";
import { href } from "../lib/router";
import { usePage } from "../motion";

/*
 * TEMPORARY dev preview (#/dev/straight, dev server only): the hero as the landing will use
 * it, on the FIXTURE profile, so the instrument can be judged before real data and the pages
 * exist. The copy is a placeholder. Delete this page once the landing ships.
 */
export function DevStraightPage() {
  const progress = useRef({ current: 0 });
  const [reading, setReading] = useState<Reading | null>(null);
  const page = usePage<HTMLDivElement>();
  const p = MONZA_MAIN_FIXTURE;

  return (
    <div ref={page}>
      <HeroStage
        progress={progress.current}
        label="The question"
        trace={
          <Straight
            profile={p}
            size="hero"
            readout="float"
            d={{ mode: "progress", progress: progress.current }}
            labels={MONZA_MAIN_FIXTURE_LABELS}
            onReading={setReading}
          />
        }
      >
        <h1 className="hero-q" data-intro>
          Does a defender's energy management before an attack predict being passed?
        </h1>
        <p className="hero-p" data-intro>
          Fixture preview. Invented Monza numbers shaped like a real profile, for judging the instrument.
        </p>
        <div className="hero-ctas" data-intro>
          <Cta href={href.findings}>Read the finding</Cta>
          <CtaGhost href={href.sessions()}>Open the explorer</CtaGhost>
        </div>
      </HeroStage>

      <section className="wrap section">
        <SectionIntro title="The same instrument, at panel size">
          Pointer and arrow keys move the cursor; it creeps on its own while nobody touches it.
        </SectionIntro>
        <div className="mt-grid-top" data-reveal>
          <Straight profile={p} size="panel" labels={MONZA_MAIN_FIXTURE_LABELS} />
        </div>
        <Rule className="my-stack" />
        <p className="text-ui text-muted" data-reveal>
          Row size, for the season index:
        </p>
        <div className="mt-3 grid max-w-[480px] grid-cols-2 gap-6" data-reveal>
          <Straight profile={p} size="row" />
          <Straight profile={p} size="row" active />
        </div>
      </section>

      {reading && (
        <Readout label="Cursor readout">
          <p>
            {Math.round(reading.d).toLocaleString("en-GB")} m · {p.bins[reading.bin].v_kph} kph
          </p>
          <p style={{ color: `var(--regime-${reading.regime})` }}>{REGIME_WORD[reading.regime]}</p>
        </Readout>
      )}
    </div>
  );
}
