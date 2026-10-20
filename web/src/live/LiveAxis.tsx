import { useSize } from "../lib/useSize";

interface Props {
  total: number | null;
  /** Estimated lap of the first car, or null without a feed. */
  lap: number | null;
  live: boolean;
  playing: boolean;
  onPlay: () => void;
  speed: number | null;
}

/*
 * The replay's lap axis, in the session page's pattern (explorer/LapAxis.tsx): one tick per
 * lap of the race, the laps behind the first car in ink, the current lap in the accent with
 * its number above. The replay is paced by the server, so the axis reads but does not seek;
 * play and pause hold or release the drawing, and the speed is the one measured from the feed.
 */
export function LiveAxis({ total, lap, live, playing, onPlay, speed }: Props) {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  const n = total ?? 0;
  const pad = 8;
  const x = (l: number) => pad + ((l - 1) / Math.max(1, n - 1)) * Math.max(1, W - 2 * pad);
  const H = 56;
  const base = 38;
  const cur = lap !== null && n ? Math.max(1, Math.min(n, lap)) : null;
  const labels: number[] = [];
  for (let l = 10; l <= n; l += 10) labels.push(l);

  return (
    <div className="xp-laps lv-axis">
      <div className="xp-laps__head">
        <button type="button" className="xp-play" onClick={onPlay} disabled={!live} aria-pressed={live && playing}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            {live && playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor" /> : <path d="M2.5 1v10l8.5-5z" fill="currentColor" />}
          </svg>
          <span>{live && playing ? "Pause" : "Play"}</span>
        </button>
        <p className="xp-laps__now">
          <span className="xp-laps__big">
            Lap {cur ?? "–"}
            <span className="xp-laps__of"> of {n || "–"}</span>
          </span>
          <span className="xp-laps__meta">{live && speed !== null ? `${Math.round(speed)}× speed, measured` : "speed set on the server"}</span>
        </p>
      </div>
      <div ref={ref} className="lv-axis__track" role="img" aria-label={cur ? `Lap ${cur} of ${n}, estimated` : `${n} laps, no replay running`}>
        {W > 0 && n > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" aria-hidden="true">
            <line x1={0} x2={W} y1={base} y2={base} className="xp-axisline" />
            {Array.from({ length: n }, (_, i) => i + 1).map((l) => (
              <line key={l} x1={x(l)} x2={x(l)} y1={base} y2={base - (cur !== null && l <= cur ? 14 : 8)} className={`xp-lt ${cur !== null && l <= cur ? "xp-lt--green" : "xp-lt--pit"}`} />
            ))}
            {labels.map((l) => (
              <text key={l} x={x(l)} y={base + 16} textAnchor="middle" className="xp-svgnum">
                {l}
              </text>
            ))}
            <text x={x(1)} y={base + 16} textAnchor="start" className="xp-svgnum">
              L1
            </text>
            {cur !== null && (
              <g>
                <line x1={x(cur)} x2={x(cur)} y1={base + 4} y2={base - 26} className="xp-lt--now" />
                <text x={x(cur)} y={8} textAnchor={x(cur) < 20 ? "start" : x(cur) > W - 20 ? "end" : "middle"} className="xp-svgnum xp-svgnum--ink">
                  {cur}
                </text>
              </g>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
