import findings from "../content/findings.json";
import notes from "../content/findings-notes.json";
import { Cta } from "../components/Cta";
import { Card, SectionHead, Stat } from "../components/system";
import { fixed, int } from "../lib/format";
import { href } from "../lib/router";
import { N } from "./recordData";

/** Frozen date of the hypothesis: from the curated findings notes, else the date HYPOTHESIS.md was frozen. */
export const FROZEN_ISO: string = (notes as { frozen?: string }).frozen ?? "2026-10-18";
export const frozenText = () =>
  new Date(`${FROZEN_ISO}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/*
 * The verdict (DESIGN.md v3 "Pages → Landing"): four stat tiles and one sentence. Every
 * number is read from src/content/findings.json (the committed findings), never typed here.
 * The odds ratio is an estimate, so its tile carries the 95 % interval.
 */
export function Verdict() {
  const run = findings.runs.point;
  const s = findings.sample;
  return (
    <section id="verdict" className="lp-section wrap" aria-labelledby="verdict-h">
      <SectionHead
        label={
          <>
            The verdict · frozen <span className="num">{frozenText()}</span>
          </>
        }
        title={
          <span id="verdict-h" tabIndex={-1}>
            No effect.
          </span>
        }
        aside={<p className="verdict__caveat">{notes.caveat}</p>}
      >
        <p className="verdict__p">{notes.verdict_sentence}</p>
      </SectionHead>

      <Card className="verdict" as="div">
        <div className="verdict__stats" data-reveal>
          <Stat
            className="verdict__stat"
            label="Odds ratio (est.)"
            value={<N>{fixed(run.or, 2)}</N>}
            note={
              <>
                <N>{`${fixed(run.lo, 2)}–${fixed(run.hi, 2)}`}</N> interval, 95&nbsp;%
              </>
            }
          />
          <Stat className="verdict__stat" label="Passes tested" value={<span className="num">{int(s.events_tested)}</span>} note="Events in the model" />
          <Stat
            className="verdict__stat"
            label="Non-passes tested"
            value={<span className="num">{int(s.non_events_tested)}</span>}
            note="Close following, no pass"
          />
          <Stat className="verdict__stat" label="Sessions" value={<span className="num">{int(s.sessions_in_model)}</span>} note="Sessions in the model" />
        </div>
        <div className="verdict__foot">
          <p className="verdict__line">
            Odds of being passed per standard deviation earlier cut-off. The interval spans <N>1.0</N>, no effect.
          </p>
          <Cta href={href.findings} size="sm">
            Read the findings
          </Cta>
        </div>
      </Card>
    </section>
  );
}
