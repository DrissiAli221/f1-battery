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
 * The replay's lap axis as a slim scrubber row: play/pause, "Lap 12 of 62", one tick per lap
 * (the laps behind the first car lit, the current one in the accent) and the speed. The
 * replay is paced by the server, so the axis reads but does not seek; play and pause hold or
 * release the drawing, and the speed is the one measured from the feed.
 */
export function LiveAxis({ total, lap, live, playing, onPlay, speed }: Props) {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  const n = total ?? 0;
  const pad = 6;
  const x = (l: number) => pad + ((l - 1) / Math.max(1, n - 1)) * Math.max(1, W - 2 * pad);
  const H = 40;
  const base = 20;
  const cur = lap !== null && n ? Math.max(1, Math.min(n, lap)) : null;
  const labels: number[] = [1];
  for (let l = 10; l <= n; l += 10) labels.push(l);
  if (n > 1 && n - labels[labels.length - 1] >= 4) labels.push(n);
  const on = live && playing;

  return (
    <div className="lv-axis">
      <button type="button" className="lv-play" onClick={onPlay} disabled={!live} aria-pressed={on}>
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
          {on ? <path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor" /> : <path d="M2.5 1v10l8.5-5z" fill="currentColor" />}
        </svg>
        <span>{on ? "Pause" : "Play"}</span>
      </button>
      <p className="lv-axis__lap">
        <span className="lv-axis__k">Lap</span>
        <b>{cur ?? "–"}</b>
        <span className="lv-axis__of">of {n || "–"}</span>
      </p>
      <div ref={ref} className="lv-axis__track" role="img" aria-label={cur ? `Lap ${cur} of ${n}, estimated` : `${n} laps, no replay running`}>
        {W > 0 && n > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" aria-hidden="true">
            <line x1={pad} x2={W - pad} y1={base} y2={base} className="lv-axis__line" />
            {Array.from({ length: n }, (_, i) => i + 1).map((l) => {
              const done = cur !== null && l <= cur;
              const major = l === 1 || l % 10 === 0;
              return <line key={l} x1={x(l)} x2={x(l)} y1={base - (major ? 7 : 4)} y2={base + (major ? 7 : 4)} className={`lv-axis__t ${done ? "is-done" : ""}`} />;
            })}
            {labels.map((l) => (
              <text key={l} x={x(l)} y={H - 1} textAnchor={l === 1 ? "start" : l === n ? "end" : "middle"} className="lv-axis__n">
                {l}
              </text>
            ))}
            {cur !== null && <line x1={x(cur)} x2={x(cur)} y1={base - 11} y2={base + 11} className="lv-axis__now" />}
          </svg>
        )}
      </div>
      <p className="lv-axis__speed">
        {live && speed !== null ? (
          <>
            <b>{Math.round(speed)}×</b> measured from the feed
          </>
        ) : (
          <>Speed set on the server</>
        )}
      </p>
    </div>
  );
}
