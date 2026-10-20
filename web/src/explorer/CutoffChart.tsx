import { scaleLinear } from "d3-scale";
import { int } from "../lib/format";
import { along, type TrackStraight } from "../lib/track";
import { useSize } from "../lib/useSize";
import type { Lap } from "../lib/types";
import type { Cutoffs, Median } from "./data";
import { lapKind } from "./LapAxis";

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
 * Cut-off per lap on the selected straight, in metres from the straight's start. Measured laps
 * are dots (the selected driver filled in ink, the compare driver hollow in team colour); each
 * driver's session median is an estimate, so it is drawn with its construction: the bootstrap
 * interval as a hatched band and the median as a dashed line. The current lap is the accent
 * line; clicking a dot moves there.
 */
export function CutoffChart({ straight, lapLen, laps, selectedLap, onLap, drivers, loading }: Props) {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  // Before the first measure, assume the phone size (the chart is below the fold on desktop).
  const narrow = W < 640;
  const H = narrow ? 300 : 400;
  const M = { l: narrow ? 44 : 56, r: 8, t: 28, b: 44 };
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
    <div ref={ref} className="xp-chart">
      {/* The legend; below 640 px it also carries the medians, which would overprint the dots in the plot. */}
      <ul className="xp-legend xp-legend--top">
        {series.map((s) => (
          <li key={s.dr.number}>
            <i className="xp-dotsw" style={s.dr.hollow ? { border: `1.5px solid ${s.dr.colour}` } : { background: s.dr.colour }} /> {s.dr.code}
            {narrow && showData && s.med && (
              <span className="xp-legend__k">
                median est. <span className="xp-legend__v">{int(s.med.m)}&nbsp;m</span>
              </span>
            )}
          </li>
        ))}
        <li>
          <i className="xp-sw" style={{ background: "var(--accent)", width: 2, height: 12 }} /> lap {selectedLap ?? "–"}
        </li>
      </ul>
      <div style={{ height: H }}>
      {W > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={`Cut-off per lap on ${straight.label}. ${loading ? "Loading." : summary}`}>
          <defs>
            {series.map((s) => (
              <pattern key={s.dr.number} id={`xp-band-${s.dr.number}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke={s.dr.colour} strokeWidth="1" strokeOpacity="0.55" />
              </pattern>
            ))}
          </defs>

          {/* Axes */}
          {y.ticks(narrow ? 4 : 6).map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="xp-gridline" />
              <text x={M.l - 10} y={y(t) + 4} textAnchor="end" className="xp-svgnum">
                {t < 0 ? `−${int(-t)}` : int(t)}
              </text>
            </g>
          ))}
          <text x={M.l - 10} y={M.t - 12} textAnchor="end" className="xp-svgnum">
            m
          </text>
          <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} className="xp-axisline" />
          {laps.map((l) => {
            const k = lapKind(l);
            return <line key={l.lap_number} x1={x(l.lap_number)} x2={x(l.lap_number)} y1={H - M.b} y2={H - M.b + (k === "green" ? 4 : 7)} className={`xp-lt xp-lt--${k}`} />;
          })}
          {x
            .ticks(narrow ? 5 : 10)
            .filter(Number.isInteger)
            .map((t) => (
              <text key={t} x={x(t)} y={H - M.b + 24} textAnchor="middle" className="xp-svgnum">
                {t}
              </text>
            ))}
          <text x={W - M.r} y={H - 4} textAnchor="end" className="xp-svgnum">
            lap
          </text>

          {/* Medians: estimates, drawn hatched with a dashed line. */}
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
                      fill={`url(#xp-band-${s.dr.number})`}
                    />
                  )}
                  <line x1={M.l} x2={W - M.r} y1={y(clampY(s.med.m))} y2={y(clampY(s.med.m))} stroke={s.dr.colour} strokeWidth={1} strokeDasharray="4 4" />
                  {!narrow && (
                    <text x={W - M.r} y={y(clampY(s.med.m)) + (i === 0 ? -6 : 14)} textAnchor="end" className="xp-svgnum" style={{ fill: s.dr.colour }}>
                      {s.dr.code} median est. {int(s.med.m)}&nbsp;m
                    </text>
                  )}
                </g>
              ) : null,
            )}

          {selectedLap !== null && <line x1={x(selectedLap)} x2={x(selectedLap)} y1={M.t - 8} y2={H - M.b} className="xp-chart__now" />}

          {showData &&
            series.map((s) =>
              s.pts.map((p) => {
                const out = p.y < d0 || p.y > d1;
                const cy = y(clampY(p.y));
                const cx = x(p.lap);
                const on = p.lap === selectedLap;
                return (
                  <g key={`${s.dr.number}-${p.lap}`} className="xp-dot" onClick={() => onLap(p.lap)}>
                    <title>{`${s.dr.code}, lap ${p.lap}: ${int(p.y)} m`}</title>
                    <circle cx={cx} cy={cy} r={12} fill="transparent" />
                    {out ? (
                      <path
                        d={p.y > d1 ? `M${cx - 4},${cy + 5}L${cx + 4},${cy + 5}L${cx},${cy - 2}Z` : `M${cx - 4},${cy - 5}L${cx + 4},${cy - 5}L${cx},${cy + 2}Z`}
                        fill={s.dr.hollow ? "none" : s.dr.colour}
                        stroke={s.dr.colour}
                      />
                    ) : (
                      <circle
                        className="xp-dot__c"
                        cx={cx}
                        cy={cy}
                        r={on ? 5.5 : 3.5}
                        fill={s.dr.hollow ? "var(--page-bg)" : s.dr.colour}
                        stroke={on ? "var(--accent)" : s.dr.colour}
                        strokeWidth={on ? 2 : s.dr.hollow ? 1.5 : 0}
                      />
                    )}
                  </g>
                );
              }),
            )}
        </svg>
      )}
      </div>
      {!loading && !ys.length && <p className="xp-note">No cut-off on this straight for the selected drivers.</p>}
    </div>
  );
}
