import findings from "../content/findings.json";
import notes from "../content/findings-notes.json";
import { fixed } from "../lib/format";
import { href } from "../lib/router";
import { N } from "./recordData";

/** Frozen date of the hypothesis: from the curated findings notes, else the date HYPOTHESIS.md was frozen. */
export const FROZEN_ISO: string = (notes as { frozen?: string }).frozen ?? "2026-10-18";
export const frozenText = () =>
  new Date(`${FROZEN_ISO}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// The axis under the odds ratio: wide enough for the interval, 1.0 (no effect) and the bar.
const LO = 0.7;
const HI = 1.4;
const pct = (v: number) => `${((v - LO) / (HI - LO)) * 100}%`;
/** The smallest effect HYPOTHESIS.md would have called real: an odds ratio of 1.3 per SD. */
const BAR = 1.3;

/*
 * Statement plus one fact (DESIGN.md "VERDICT"). The odds ratio is an estimate, so it carries
 * its construction: the 95 % interval drawn as a bracket on a short axis, with 1.0 marked.
 */
export function Verdict() {
  const run = findings.runs.point;
  const frozen = frozenText();
  return (
    <section id="verdict" className="verdict wrap" aria-labelledby="verdict-h">
      <div className="verdict__grid">
        <div className="verdict__main">
          <h2 id="verdict-h" tabIndex={-1} className="verdict__h" data-reveal>
            No effect.
          </h2>
          <p className="verdict__p" data-reveal>
            {notes.verdict_sentence}
          </p>

          <figure className="or" data-reveal>
            <p className="or__num num" aria-hidden="true">
              <N>{fixed(run.or, 2)}</N>
            </p>
            <div className="or__axis" aria-hidden="true">
              <span className="or__line" />
              {[0.8, 0.9, 1.1, 1.2].map((v) => (
                <span key={v} className="or__tick" style={{ left: pct(v) }}>
                  <span className="or__tl num">{fixed(v, 1)}</span>
                </span>
              ))}
              <span className="or__tick or__tick--one" style={{ left: pct(1) }}>
                <span className="or__tl num">1.0</span>
              </span>
              <span className="or__tick or__tick--bar" style={{ left: pct(BAR) }}>
                <span className="or__tl num">{fixed(BAR, 1)}</span>
              </span>
              <span className="or__bracket" style={{ left: pct(run.lo), width: `calc(${pct(run.hi)} - ${pct(run.lo)})` }} />
              <span className="or__dot" style={{ left: pct(run.or) }} />
            </div>
            <figcaption className="or__cap">
              Odds ratio of being passed per standard deviation earlier cut-off (est.), point{" "}
              <N>{fixed(run.or, 2)}</N>, 95&nbsp;% interval{" "}
              <N>{`${fixed(run.lo, 2)}–${fixed(run.hi, 2)}`}</N>
              . The interval spans <N>1.0</N>, no effect; the frozen bar was{" "}
              <N>{fixed(BAR, 1)}</N>.
            </figcaption>
          </figure>
        </div>

        <aside className="verdict__side" aria-label="Caveat">
          <p className="verdict__frozen num" data-reveal>
            Frozen {frozen}
          </p>
          <p className="verdict__caveat" data-reveal>
            {notes.caveat}
          </p>
          <p data-reveal>
            <a href={href.findings} className="link verdict__link">
              Read the findings
            </a>
          </p>
        </aside>
      </div>
    </section>
  );
}
