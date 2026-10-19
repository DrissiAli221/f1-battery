import { int } from "../lib/format";
import type { RegimeRun, TrackStraight } from "../lib/track";
import { wrap } from "../lib/track";
import { useSize } from "../lib/useSize";
import { REGIME_VAR, type MarkDriver } from "./TrackMap";

interface Props {
  lap: number;
  straights: TrackStraight[];
  runs: RegimeRun[];
  primary: MarkDriver;
  compare: MarkDriver | null;
  selected: number | null;
  onSelect: (id: number) => void;
  cursor: number | null;
  onHover: (d: number | null) => void;
}

/**
 * The lap unrolled onto one distance axis: straights, regimes for the shown lap, both
 * drivers' median cut-offs. Shares the cursor with the map.
 */
export function DistanceStrip({ lap, straights, runs, primary, compare, selected, onSelect, cursor, onHover }: Props) {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  const narrow = W < 640;
  const H = 112;
  const x = (d: number) => (wrap(d, lap) / lap) * W;
  const yB = 40;
  const hB = narrow ? 18 : 16;
  const yA = H - 8;
  const stepM = narrow ? 2000 : 1000;

  return (
    <div ref={ref} className="w-full">
      {W > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block touch-pan-y select-none"
          role="img"
          aria-label="Lap distance strip: straights, regimes for the shown lap and median cut-offs"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onHover(Math.max(0, Math.min(lap - 1, ((e.clientX - r.left) / r.width) * lap)));
          }}
          onMouseLeave={() => onHover(null)}
        >
          {straights.map((s) => {
            const on = s.straight_id === selected;
            const has = !!primary.medians?.has(s.straight_id);
            const segs: [number, number][] = s.d1 >= s.d0 ? [[s.d0, s.d1]] : [[s.d0, lap], [0, s.d1]];
            const [a, b] = [...segs].sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
            const wide = ((b - a) / lap) * W >= 130 && !narrow;
            return (
              <g key={s.straight_id} className={has ? "cursor-pointer" : undefined} onClick={has ? () => onSelect(s.straight_id) : undefined}>
                {segs.map(([p, q]) => (
                  <g key={p}>
                    {on && <rect x={x(p)} y={yB - 10} width={x(q === lap ? lap - 0.01 : q) - x(p)} height={hB + 40} fill="var(--ink-head)" opacity={0.045} />}
                    <path
                      d={`M${x(p) + 1},${yB - 5}V${yB - 10}H${(q === lap ? W : x(q)) - 1}V${yB - 5}`}
                      fill="none"
                      stroke={on ? "var(--brand)" : "#3a3a48"}
                      strokeWidth={on ? 2 : 1}
                    />
                  </g>
                ))}
                <text x={x(a) + 2} y={yB - 16} fontSize={12} fill={on ? "var(--ink-head)" : has ? "var(--ink-2)" : "var(--ink-4)"}>
                  <tspan fontFamily="var(--font-display)" fontWeight={on ? 700 : 500}>
                    S{s.straight_id}
                  </tspan>
                  {wide && (
                    <tspan dx={6} fill={on ? "var(--ink-2)" : "var(--ink-3)"}>
                      {s.label}
                    </tspan>
                  )}
                </text>
              </g>
            );
          })}
          <g>
            {runs.length ? (
              runs.map((r) => (
                <rect
                  key={`${r.d0}-${r.label}`}
                  x={x(r.d0)}
                  y={yB}
                  width={Math.max(0.5, (r.d1 - r.d0) / lap * W - 0.5)}
                  height={hB}
                  fill={REGIME_VAR[r.label]}
                  opacity={r.label === "other" ? 0.55 : 0.92}
                />
              ))
            ) : (
              <rect x={0} y={yB} width={W} height={hB} fill="var(--regime-other)" opacity={0.4} />
            )}
          </g>
          {straights.map((s) => {
            const mc = compare?.medians?.get(s.straight_id);
            const mp = primary.medians?.get(s.straight_id);
            return (
              <g key={s.straight_id}>
                {compare && mc && (
                  <rect x={x(mc.m) - 2.5} y={yB + 3} width={5} height={hB + 7} rx={1} fill="var(--frame)" stroke={compare.colour} strokeWidth={1.6} />
                )}
                {mp && (
                  <>
                    <line x1={x(mp.m)} x2={x(mp.m)} y1={yB - 4} y2={yB + hB + 4} stroke="var(--surface-deep)" strokeWidth={5} />
                    <line x1={x(mp.m)} x2={x(mp.m)} y1={yB - 4} y2={yB + hB + 4} stroke="var(--ink-head)" strokeWidth={2} />
                  </>
                )}
              </g>
            );
          })}
          {Array.from({ length: Math.floor(lap / stepM) + 1 }, (_, i) => i * stepM).map((m) => (
            <g key={m}>
              <line x1={x(m)} x2={x(m)} y1={yA - 14} y2={yA - 10} stroke="var(--ink-4)" />
              <text x={x(m)} y={yA} textAnchor={m === 0 ? "start" : "middle"} fontFamily="var(--font-mono)" fontSize={11} fill="var(--ink-4)">
                {m === 0 ? "0 m · S/F" : int(m)}
              </text>
            </g>
          ))}
          {cursor !== null && (
            <g transform={`translate(${x(cursor).toFixed(1)},0)`} className="pointer-events-none">
              <line x1={0} x2={0} y1={yB - 7} y2={yB + hB + 7} stroke="var(--ink-head)" strokeWidth={1.3} />
              <path d={`M-5,${yB - 13}L5,${yB - 13}L0,${yB - 6}Z`} fill="var(--ink-head)" />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
