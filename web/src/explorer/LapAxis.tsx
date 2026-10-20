import { useRef } from "react";
import { lapTime } from "../lib/format";
import { useSize } from "../lib/useSize";
import type { Lap } from "../lib/types";

export type LapKind = "green" | "pit" | "neutral";

/** Green laps; pit, out and standing-start laps; slow or odd-length laps (safety car, VSC, incidents). */
export function lapKind(l: Lap): LapKind {
  if (l.green) return "green";
  return l.reason === "pit" || l.reason === "out_lap" || l.reason === "standing_start" ? "pit" : "neutral";
}

const KIND_WORD: Record<LapKind, string> = { green: "green", pit: "pit or start", neutral: "neutralised or slow" };

interface Props {
  laps: Lap[];
  lap: number | null;
  onLap: (n: number) => void;
  playing: boolean;
  onPlay: () => void;
  /** Laps with a cut-off on the selected straight: their ticks run full height. */
  withCut: Set<number>;
  code: string;
}

/*
 * The race as a distance axis: one tick per lap, green laps in ink (full height where the lap
 * has a cut-off on the selected straight), pit and start laps faint, neutralised laps in the
 * yellow-flag colour; the current lap in red with its number above. The axis is a slider:
 * press or drag anywhere on it, arrows step a lap, Page keys ten, Home and End the ends.
 */
export function LapAxis({ laps, lap, onLap, playing, onPlay, withCut, code }: Props) {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  const dragging = useRef(false);
  const n = laps.length;
  const idx = Math.max(0, laps.findIndex((l) => l.lap_number === lap));
  const cur = laps[idx] ?? null;
  const first = laps[0]?.lap_number ?? 1;
  const last = laps[n - 1]?.lap_number ?? 1;
  const pad = 8;
  const x = (lapNo: number) => pad + ((lapNo - first) / Math.max(1, last - first)) * Math.max(1, W - 2 * pad);
  const H = 58;
  const base = 38;

  const toLap = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const v = first + ((clientX - r.left - pad) / Math.max(1, r.width - 2 * pad)) * (last - first);
    let best = laps[0];
    for (const l of laps) if (Math.abs(l.lap_number - v) < Math.abs(best.lap_number - v)) best = l;
    return best?.lap_number ?? null;
  };
  const step = (k: number) => {
    const next = laps[Math.max(0, Math.min(n - 1, idx + k))];
    if (next) onLap(next.lap_number);
  };

  const labels: number[] = [];
  for (let l = Math.ceil(first / 10) * 10; l <= last; l += 10) if (l !== first) labels.push(l);

  return (
    <div className="lx">
      <div className="lx__head">
        <button type="button" className="lx__play" onClick={onPlay} disabled={n < 2} aria-pressed={playing}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            {playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor" /> : <path d="M2.5 1v10l8.5-5z" fill="currentColor" />}
          </svg>
          <span>{playing ? "Pause" : "Play"}</span>
        </button>
        <p className="lx__now">
          <span className="lx__big">
            <span className="lx__k">Lap</span> {cur?.lap_number ?? "–"}
            <span className="lx__of"> of {last}</span>
          </span>
          <span className="lx__meta">
            <span className="lx__code">{code}</span> <span className="lx__time">{cur ? lapTime(cur.lap_duration) : "–"}</span>
            {cur && <span className={`lx__kind lx__kind--${lapKind(cur)}`}>{KIND_WORD[lapKind(cur)]}</span>}
          </span>
        </p>
      </div>
      <div
        ref={ref}
        className="lx__axis"
        role="slider"
        tabIndex={n ? 0 : -1}
        aria-label={`Lap, ${code}`}
        aria-valuemin={first}
        aria-valuemax={last}
        aria-valuenow={cur?.lap_number ?? first}
        aria-valuetext={cur ? `Lap ${cur.lap_number} of ${last}, ${KIND_WORD[lapKind(cur)]}, ${lapTime(cur.lap_duration)}` : "No laps"}
        onPointerDown={(e) => {
          if (!n) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const l = toLap(e.clientX, e.currentTarget);
          if (l !== null) onLap(l);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const l = toLap(e.clientX, e.currentTarget);
          if (l !== null && l !== lap) onLap(l);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={(e) => {
          const k =
            e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "PageUp" ? 10 : e.key === "PageDown" ? -10 : e.key === "Home" ? -n : e.key === "End" ? n : 0;
          if (!k) return;
          e.preventDefault();
          step(k);
        }}
      >
        {W > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" aria-hidden="true">
            <line x1={0} x2={W} y1={base} y2={base} className="lx__line" />
            {laps.map((l) => {
              const kind = lapKind(l);
              const h = kind === "green" ? (withCut.has(l.lap_number) ? 20 : 12) : kind === "neutral" ? 16 : 8;
              return <line key={l.lap_number} x1={x(l.lap_number)} x2={x(l.lap_number)} y1={base} y2={base - h} className={`lx__t lx__t--${kind}`} />;
            })}
            {labels.map((l) => (
              <text key={l} x={x(l)} y={base + 18} textAnchor="middle" className="lx__num">
                {l}
              </text>
            ))}
            <text x={x(first)} y={base + 18} textAnchor="start" className="lx__num">
              L{first}
            </text>
            {cur && (
              <g>
                <line x1={x(cur.lap_number)} x2={x(cur.lap_number)} y1={base + 4} y2={base - 30} className="lx__t--now" />
                <text
                  x={x(cur.lap_number)}
                  y={9}
                  textAnchor={x(cur.lap_number) < 20 ? "start" : x(cur.lap_number) > W - 20 ? "end" : "middle"}
                  className="lx__num lx__num--now"
                >
                  {cur.lap_number}
                </text>
              </g>
            )}
          </svg>
        )}
      </div>
      <ul className="lx__legend">
        <li>
          <i style={{ background: "var(--ink)" }} /> green lap, tall with a cut-off here
        </li>
        <li>
          <i style={{ background: "var(--faint)" }} /> pit, out or start
        </li>
        <li>
          <i style={{ background: "var(--flag-yellow)" }} /> neutralised or slow
        </li>
        <li>
          <i style={{ background: "var(--accent)" }} /> shown lap
        </li>
      </ul>
    </div>
  );
}
