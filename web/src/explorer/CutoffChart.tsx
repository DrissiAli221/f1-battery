import { scaleLinear } from "d3-scale";
import { int } from "../lib/format";
import { driverCode } from "../lib/teams";
import { along, wrap, type TrackStraight } from "../lib/track";
import { useSize } from "../lib/useSize";
import type { Lap } from "../lib/types";
import type { StraightDriver } from "./StraightDetail";

interface Props {
  straight: TrackStraight;
  lap: number;
  laps: Lap[];
  selectedLap: number | null;
  onLap: (n: number) => void;
  primary: StraightDriver;
  compare: StraightDriver | null;
}

/**
 * Cut-off per lap on one straight: the selected driver as filled points, the compared driver
 * hollow, each with its median line and range band. Laps that are not green are hatched.
 * Values are lap distance from the start/finish line.
 */
export function CutoffChart({ straight, lap, laps, selectedLap, onLap, primary, compare }: Props) {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  const sid = straight.straight_id;
  const narrow = W < 640;
  const H = narrow ? 340 : 460;
  const M = { l: narrow ? 50 : 64, r: 16, t: 20, b: 44 };
  // A straight across the line is plotted from its start through 0 (S/F) to positive values,
  // so the axis reads "metres before / after the line" instead of jumping from 5,700 to 40.
  const base = straight.d1 < straight.d0 ? straight.d0 - lap : straight.d0;
  const toY = (d: number) => base + along(straight, d, lap);

  const series = [primary, ...(compare ? [compare] : [])].map((dr, i) => {
    const pts: { lap: number; y: number }[] = [];
    for (const [l, m] of dr.cutoffs ?? []) {
      const v = m.get(sid);
      if (v !== undefined) pts.push({ lap: l, y: toY(v) });
    }
    const med = dr.medians?.get(sid);
    return {
      dr,
      hollow: i === 1,
      pts: pts.sort((a, b) => a.lap - b.lap),
      med: med ? { m: toY(med.m), lo: med.lo !== null ? toY(med.lo) : null, hi: med.hi !== null ? toY(med.hi) : null } : null,
    };
  });
  const ys = series.flatMap((s) => [...s.pts.map((p) => p.y), ...(s.med ? [s.med.m] : [])]);
  const nLaps = laps.length ? laps[laps.length - 1].lap_number : 1;

  return (
    <div ref={ref} className="w-full">
      {!ys.length ? (
        <p className="rounded-xs border border-dashed border-line px-6 py-16 text-center text-ink-3">No cut-off values on this straight for the selected drivers.</p>
      ) : (
        W > 0 &&
        (() => {
          // Robust y range: 2nd-98th percentile plus the medians, so one wild lap does not flatten the rest.
          const sorted = [...ys].sort((a, b) => a - b);
          const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
          const medVals = series.flatMap((s) => (s.med ? [s.med.m, s.med.lo ?? s.med.m, s.med.hi ?? s.med.m] : []));
          let y0 = Math.min(q(0.02), ...medVals);
          let y1 = Math.max(q(0.98), ...medVals);
          const pad = Math.max(8, (y1 - y0) * 0.12);
          y0 -= pad;
          y1 += pad;
          const x = scaleLinear().domain([0.5, nLaps + 0.5]).range([M.l, W - M.r]);
          const y = scaleLinear().domain([y0, y1]).range([H - M.b, M.t]).nice();
          const [d0, d1] = y.domain();
          const clampY = (v: number) => Math.max(d0, Math.min(d1, v));
          const colW = Math.max(1, x(1) - x(0));
          return (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={`Cut-off distance per lap on ${straight.label}`}>
              <defs>
                <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="#2a2a34" strokeWidth="2.5" />
                </pattern>
              </defs>
              {laps
                .filter((l) => !l.green)
                .map((l) => (
                  <rect key={l.lap_number} x={x(l.lap_number) - colW / 2} y={M.t} width={colW} height={H - M.b - M.t} fill="url(#hatch)" />
                ))}
              {y.ticks(narrow ? 5 : 7).map((t) => (
                <g key={t}>
                  <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--line-2)" />
                  <text x={M.l - 10} y={y(t) + 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize={11} fill="var(--ink-3)">
                    {t < 0 ? `−${int(-t)}` : int(t)}
                  </text>
                </g>
              ))}
              {x.ticks(narrow ? 5 : 10).filter(Number.isInteger).map((t) => (
                <text key={t} x={x(t)} y={H - M.b + 20} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fill={t === selectedLap ? "var(--ink-head)" : "var(--ink-3)"}>
                  L{t}
                </text>
              ))}
              <text x={W - M.r} y={H - 6} textAnchor="end" fontSize={11} fill="var(--ink-4)">
                lap · hatched = not green (start, pit, neutralised)
              </text>
              <text x={M.l} y={M.t - 6} fontSize={11} fill="var(--ink-4)">
                m from S/F
              </text>
              {series.map((s) =>
                s.med ? (
                  <g key={`m${s.dr.d.driver_number}`}>
                    {s.med.lo !== null && s.med.hi !== null && (
                      <rect
                        x={M.l}
                        width={W - M.l - M.r}
                        y={y(clampY(s.med.hi))}
                        height={Math.max(2, y(clampY(s.med.lo)) - y(clampY(s.med.hi)))}
                        fill={s.dr.colour}
                        opacity={0.16}
                      />
                    )}
                    <line x1={M.l} x2={W - M.r} y1={y(s.med.m)} y2={y(s.med.m)} stroke={s.dr.colour} strokeWidth={1.5} strokeDasharray={s.hollow ? "5 4" : undefined} />
                  </g>
                ) : null,
              )}
              {selectedLap !== null && (
                <line x1={x(selectedLap)} x2={x(selectedLap)} y1={M.t} y2={H - M.b} stroke="var(--brand)" strokeWidth={1.5} />
              )}
              {series.map((s) =>
                s.pts.map((p) => {
                  const out = p.y < d0 || p.y > d1;
                  const cy = y(clampY(p.y));
                  const on = p.lap === selectedLap;
                  return (
                    <g key={`${s.dr.d.driver_number}-${p.lap}`} className="cursor-pointer" onClick={() => onLap(p.lap)}>
                      <title>{`${driverCode(s.dr.d)} lap ${p.lap}: ${int(wrap(p.y, lap))} m`}</title>
                      <circle cx={x(p.lap)} cy={cy} r={10} fill="transparent" />
                      {out ? (
                        <path
                          d={p.y > d1 ? `M${x(p.lap) - 5},${cy + 6}L${x(p.lap) + 5},${cy + 6}L${x(p.lap)},${cy - 2}Z` : `M${x(p.lap) - 5},${cy - 6}L${x(p.lap) + 5},${cy - 6}L${x(p.lap)},${cy + 2}Z`}
                          fill={s.hollow ? "none" : s.dr.colour}
                          stroke={s.dr.colour}
                          strokeWidth={1.5}
                        />
                      ) : (
                        <circle
                          cx={x(p.lap)}
                          cy={cy}
                          r={on ? 6.5 : 4.5}
                          fill={s.hollow ? "var(--page-bg)" : s.dr.colour}
                          stroke={on ? "var(--ink-head)" : s.dr.colour}
                          strokeWidth={on ? 2.5 : s.hollow ? 1.8 : 0}
                        />
                      )}
                    </g>
                  );
                }),
              )}
            </svg>
          );
        })()
      )}
    </div>
  );
}
