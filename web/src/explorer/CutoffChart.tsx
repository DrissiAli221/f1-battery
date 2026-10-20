import { scaleLinear } from "d3-scale";
import { int } from "../lib/format";
import { along, type TrackStraight } from "../lib/track";
import { useSize } from "../lib/useSize";
import type { Lap } from "../lib/types";
import type { Cutoffs, Median } from "./data";
import { lapKind } from "./LapAxis";
import "../instrument/telemetry.css";

export interface ChartDriver {
  number: number;
  code: string;
  colour: string;
  /** The compare driver is drawn hollow. */
  hollow: boolean;
  cutoffs: Cutoffs | null;
  median: Median | undefined;
}

interface Props {
  straight: TrackStraight;
  lapLen: number;
  laps: Lap[];
  selectedLap: number | null;
  onLap: (n: number) => void;
  drivers: ChartDriver[];
  /** Still fetching the per-lap cut-offs: draw the axes only. */
  loading: boolean;
}

/*
 * Cut-off per lap on the selected straight, in metres into the straight. Measured laps are
 * dots in team colour (the compare driver hollow); each driver's session median is an
 * estimate, so it is drawn with its construction: the bootstrap interval as a hatched band,
 * the median as a line, labelled "median est.". The shown lap's dot is ringed; clicking a
 * dot puts that lap on the stage.
 */
export function CutoffChart({ straight, lapLen, laps, selectedLap, onLap, drivers, loading }: Props) {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  // Before the first measure, assume the phone size (the chart is below the fold on desktop).
  const narrow = W < 640;
  const H = narrow ? 300 : 380;
  const M = { l: narrow ? 44 : 56, r: 12, t: 28, b: 44 };
  const sid = straight.straight_id;
  const rel = (d: number) => along(straight, d, lapLen);

  const series = drivers.map((dr) => {
    const pts: { lap: number; y: number }[] = [];
    for (const [l, m] of dr.cutoffs ?? []) {
      const v = m.get(sid);
      if (v !== undefined) pts.push({ lap: l, y: rel(v) });
    }
    pts.sort((a, b) => a.lap - b.lap);
    const md = dr.median;
    return { dr, pts, med: md ? { m: rel(md.m), lo: md.lo !== null ? rel(md.lo) : null, hi: md.hi !== null ? rel(md.hi) : null } : null };
  });
  const ys = series.flatMap((s) => [...s.pts.map((p) => p.y), ...(s.med ? [s.med.m] : [])]);
  const first = laps[0]?.lap_number ?? 1;
  const last = laps[laps.length - 1]?.lap_number ?? 1;

  // Robust range: 2nd to 98th percentile plus the medians, so one wild lap does not flatten the rest.
  const sorted = [...ys].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
  const medVals = series.flatMap((s) => (s.med ? [s.med.m, s.med.lo ?? s.med.m, s.med.hi ?? s.med.m] : []));
  let y0 = ys.length ? Math.min(q(0.02), ...medVals) : 0;
  let y1 = ys.length ? Math.max(q(0.98), ...medVals) : straight.len;
  const pad = Math.max(10, (y1 - y0) * 0.12);
  y0 -= pad;
  y1 += pad;
  const x = scaleLinear().domain([first - 0.5, last + 0.5]).range([M.l, Math.max(M.l + 1, W - M.r)]);
  const y = scaleLinear().domain([y0, y1]).range([H - M.b, M.t]).nice();
  const [d0, d1] = y.domain();
  const clampY = (v: number) => Math.max(d0, Math.min(d1, v));
  const showData = !loading && ys.length > 0;

  const summary = series
    .map((s) =>
      s.med
        ? `${s.dr.code}: median ${int(s.med.m)} metres from the start of the straight${s.med.lo !== null && s.med.hi !== null ? `, interval ${int(s.med.lo)} to ${int(s.med.hi)}` : ""}, ${s.pts.length} laps with a cut-off`
        : `${s.dr.code}: no cut-off on this straight`,
    )
    .join(". ");

  return (
    <div ref={ref} className="cc">
      <ul className="cc__legend">
        {series.map((s) => (
          <li key={s.dr.number}>
            <i className="cc__dot" style={s.dr.hollow ? { boxShadow: `inset 0 0 0 1.5px ${s.dr.colour}` } : { background: s.dr.colour }} />
            <span className="cc__code">{s.dr.code}</span>
            {showData && s.med && (
              <span className="cc__med">
                median est. <b>{int(s.med.m)}&nbsp;m</b>
              </span>
            )}
          </li>
        ))}
        <li>
          <i className="cc__ring" /> lap {selectedLap ?? "–"}
        </li>
      </ul>
      <div style={{ height: H }}>
        {W > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={`Cut-off per lap on ${straight.label}. ${loading ? "Loading." : summary}`}>
            <defs>
              {series.map((s) => (
                <pattern key={s.dr.number} id={`cc-band-${s.dr.number}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke={s.dr.colour} strokeWidth="1" strokeOpacity="0.45" />
                </pattern>
              ))}
            </defs>

            {/* Grid and axes */}
            {y.ticks(narrow ? 4 : 6).map((t) => (
              <g key={t}>
                <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="tl__grid" />
                <text x={M.l - 10} y={y(t) + 4} textAnchor="end" className="tl__num">
                  {t < 0 ? `−${int(-t)}` : int(t)}
                </text>
              </g>
            ))}
            {x
              .ticks(narrow ? 5 : 10)
              .filter(Number.isInteger)
              .map((t) => (
                <line key={t} x1={x(t)} x2={x(t)} y1={M.t} y2={H - M.b} className="tl__grid" />
              ))}
            <text x={M.l - 10} y={M.t - 14} textAnchor="end" className="tl__unit">
              m
            </text>
            <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} className="tl__axis" />
            {laps.map((l) => {
              const k = lapKind(l);
              return <line key={l.lap_number} x1={x(l.lap_number)} x2={x(l.lap_number)} y1={H - M.b + 2} y2={H - M.b + (k === "green" ? 6 : 9)} className={`lx__t lx__t--${k}`} />;
            })}
            {x
              .ticks(narrow ? 5 : 10)
              .filter(Number.isInteger)
              .map((t) => (
                <text key={t} x={x(t)} y={H - M.b + 26} textAnchor="middle" className="tl__num">
                  {t}
                </text>
              ))}
            <text x={W - M.r} y={H - 4} textAnchor="end" className="tl__unit">
              lap
            </text>

            {/* Medians: estimates, a hatched band with the median line, labelled. */}
            {showData &&
              series.map((s, i) =>
                s.med ? (
                  <g key={`m${s.dr.number}`}>
                    {s.med.lo !== null && s.med.hi !== null && (
                      <rect
                        x={M.l}
                        width={W - M.l - M.r}
                        y={y(clampY(s.med.hi))}
                        height={Math.max(2, y(clampY(s.med.lo)) - y(clampY(s.med.hi)))}
                        fill={`url(#cc-band-${s.dr.number})`}
                      />
                    )}
                    <line x1={M.l} x2={W - M.r} y1={y(clampY(s.med.m))} y2={y(clampY(s.med.m))} stroke={s.dr.colour} strokeWidth={1.25} strokeOpacity={0.9} />
                    {!narrow && (
                      <g transform={`translate(${i === 0 ? M.l + 10 : W - M.r - 10},${y(clampY(s.med.m)) + (i === 0 ? -8 : 16)})`}>
                        <text className="cc__label" style={{ fill: s.dr.colour }} textAnchor={i === 0 ? "start" : "end"}>
                          {s.dr.code}
                          <tspan className="cc__label-k" dx="8">
                            median est.{" "}
                          </tspan>
                          <tspan className="cc__label-v">{int(s.med.m)}&nbsp;m</tspan>
                        </text>
                      </g>
                    )}
                  </g>
                ) : null,
              )}

            {selectedLap !== null && <line x1={x(selectedLap)} x2={x(selectedLap)} y1={M.t} y2={H - M.b} className="cc__now" />}

            {showData &&
              series.map((s) =>
                s.pts.map((p) => {
                  const out = p.y < d0 || p.y > d1;
                  const cy = y(clampY(p.y));
                  const cx = x(p.lap);
                  const on = p.lap === selectedLap;
                  return (
                    <g key={`${s.dr.number}-${p.lap}`} className="cc__pt" onClick={() => onLap(p.lap)}>
                      <title>{`${s.dr.code}, lap ${p.lap}: ${int(p.y)} m`}</title>
                      <circle cx={cx} cy={cy} r={12} fill="transparent" />
                      {on && <circle cx={cx} cy={cy} r={9} fill="none" stroke="#fff" strokeWidth={1.5} />}
                      {out ? (
                        <path
                          d={p.y > d1 ? `M${cx - 4},${cy + 5}L${cx + 4},${cy + 5}L${cx},${cy - 2}Z` : `M${cx - 4},${cy - 5}L${cx + 4},${cy - 5}L${cx},${cy + 2}Z`}
                          fill={s.dr.hollow ? "none" : s.dr.colour}
                          stroke={s.dr.colour}
                        />
                      ) : (
                        <circle
                          className="cc__c"
                          cx={cx}
                          cy={cy}
                          r={on ? 5 : 4}
                          fill={s.dr.hollow ? "var(--surface-1)" : s.dr.colour}
                          stroke={s.dr.colour}
                          strokeWidth={s.dr.hollow ? 1.5 : 0}
                        />
                      )}
                    </g>
                  );
                }),
              )}
          </svg>
        )}
      </div>
      {!loading && !ys.length && <p className="ss-note">No cut-off on this straight for the selected drivers.</p>}
    </div>
  );
}
