import { useState } from "react";
import { Avatar } from "../components/Driver";
import { int } from "../lib/format";
import { driverCode, driverName, teamColour } from "../lib/teams";
import { along, type TrackStraight } from "../lib/track";
import type { RegimeLabel, SummaryDriver } from "../lib/types";
import type { Median } from "./data";
import { REGIME_VAR } from "./TrackMap";

const REGIMES: RegimeLabel[] = ["deploy", "plateau", "lift", "brake"];
const SHOWN = 10;

interface Props {
  rows: SummaryDriver[];
  straights: TrackStraight[];
  lapLen: number;
  selected: number | null;
  primary: number | null;
  compare: number | null;
  onPick: (driver: number) => void;
}

const medOf = (r: SummaryDriver, sid: number): Median | null => {
  const s = r.straights.find((x) => x.straight_id === sid);
  return s && s.cutoff_distance_median_m !== null ? { m: s.cutoff_distance_median_m, lo: s.ci_low, hi: s.ci_high } : null;
};

/*
 * The tower: one row per driver, ranked by the median cut-off on the selected straight
 * (latest first). Position in Orbitron, the team bar, a small headshot, the code; then each
 * straight's median in mono, metres from the straight's start, with its interval drawn as a
 * tiny bracket on a scale shared by every driver for that straight; then the share of green
 * laps in each regime. A row is a button: it selects that driver.
 */
export function Tower({ rows, straights, lapLen, selected, primary, compare, onPick }: Props) {
  const [all, setAll] = useState(false);
  const sel = straights.find((s) => s.straight_id === selected) ?? straights[0];
  const rel = (s: TrackStraight, v: number) => along(s, v, lapLen);
  const key = (r: SummaryDriver) => {
    const m = sel ? medOf(r, sel.straight_id) : null;
    return m && sel ? rel(sel, m.m) : -Infinity;
  };
  const ranked = rows
    .filter((r) => r.straights.some((s) => s.cutoff_distance_median_m !== null))
    .sort((a, b) => key(b) - key(a) || a.driver_number - b.driver_number);
  const without = rows.filter((r) => !ranked.includes(r));
  const visible = all ? ranked : ranked.slice(0, SHOWN);

  const scales = new Map(
    straights.map((s) => {
      const vals = ranked.flatMap((r) => {
        const m = medOf(r, s.straight_id);
        return m ? [m.lo ?? m.m, m.hi ?? m.m].map((v) => rel(s, v)) : [];
      });
      const lo = vals.length ? Math.min(...vals) : 0;
      const hi = vals.length ? Math.max(...vals) : 1;
      return [s.straight_id, { lo, hi: hi > lo ? hi : lo + 1 }];
    }),
  );
  const pct = (s: TrackStraight, v: number) => {
    const sc = scales.get(s.straight_id)!;
    return 4 + ((rel(s, v) - sc.lo) / (sc.hi - sc.lo)) * 92;
  };
  const cols = { "--n": straights.length } as React.CSSProperties;

  return (
    <div className="xp-tower" style={cols}>
      <div className="xp-tower__head" aria-hidden="true">
        <span />
        <span />
        <span>Driver</span>
        {straights.map((s) => (
          <span key={s.straight_id} className={`xp-tower__sh ${s.straight_id === sel?.straight_id ? "is-on" : ""}`}>
            <span className="num">S{s.straight_id}</span> <span className="xp-tower__sn">{s.label}</span>
          </span>
        ))}
        <span>Regimes</span>
      </div>
      <ol className="xp-tower__list">
        {visible.map((r, i) => {
          const isP = r.driver_number === primary;
          const isC = r.driver_number === compare;
          const m = sel ? medOf(r, sel.straight_id) : null;
          return (
            <li key={r.driver_number} data-reveal className={`xp-row ${isP ? "is-primary" : ""} ${isC ? "is-compare" : ""}`}>
              <button
                type="button"
                className="xp-row__btn"
                style={{ "--team": teamColour(r) } as React.CSSProperties}
                onClick={() => onPick(r.driver_number)}
                aria-label={`${i + 1}, ${driverName(r)}, ${sel ? `S${sel.straight_id} median cut-off ${m ? `${int(rel(sel, m.m))} metres` : "none"}` : ""}${isP ? ", selected" : isC ? ", compared" : ""}. Select this driver.`}
              >
                <span className="xp-row__in">
                  <span className="xp-row__pos">{i + 1}</span>
                  <span className="xp-row__bar" />
                  <span className="xp-row__who">
                    <Avatar d={r} size={28} />
                    <span className="xp-row__code">{driverCode(r)}</span>
                    <span className="xp-row__name">{r.last_name ?? driverName(r)}</span>
                    {(isP || isC) && <span className="xp-row__tag">{isP ? "selected" : "compare"}</span>}
                  </span>
                  {straights.map((s) => {
                    const v = medOf(r, s.straight_id);
                    const on = s.straight_id === sel?.straight_id;
                    return (
                      <span key={s.straight_id} className={`xp-row__cell ${on ? "is-on" : ""}`}>
                        <span className="xp-row__m">{v ? `${int(rel(s, v.m))}` : "–"}</span>
                        {v && (
                          <svg className="xp-row__br" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                            {v.lo !== null && v.hi !== null && (
                              <path d={`M${pct(s, v.lo)},2V6H${pct(s, v.hi)}V2`} vectorEffect="non-scaling-stroke" />
                            )}
                            <line x1={pct(s, v.m)} x2={pct(s, v.m)} y1={0} y2={8} vectorEffect="non-scaling-stroke" className="xp-row__tick" />
                          </svg>
                        )}
                      </span>
                    );
                  })}
                  <RegimeShare shares={r.regime_shares} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="xp-tower__foot">
        {ranked.length > SHOWN && (
          <button type="button" className="cta-ghost" onClick={() => setAll((a) => !a)} aria-expanded={all}>
            {all ? "Show the first 10" : `Show all ${ranked.length}`}
          </button>
        )}
        <p className="xp-note">
          Metres from the start of each straight, median over green laps (est.); the bracket is the 95&nbsp;% interval on a scale shared by
          every driver for that straight.
          {without.length > 0 && ` No cut-off on any straight: ${without.map((r) => driverCode(r)).join(", ")}.`}
        </p>
      </div>
    </div>
  );
}

function RegimeShare({ shares }: { shares: Partial<Record<RegimeLabel, number>> }) {
  const total = REGIMES.reduce((a, k) => a + (shares[k] ?? 0), 0);
  if (!total) return <span className="xp-row__share" />;
  return (
    <span className="xp-row__share" title={REGIMES.map((k) => `${k} ${Math.round(((shares[k] ?? 0) / total) * 100)} %`).join(", ")}>
      {REGIMES.map((k) => (
        <span key={k} style={{ width: `${((shares[k] ?? 0) / total) * 100}%`, background: REGIME_VAR[k] }} />
      ))}
    </span>
  );
}
