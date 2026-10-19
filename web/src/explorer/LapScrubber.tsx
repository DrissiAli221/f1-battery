import { int, lapTime, reason } from "../lib/format";
import type { Lap } from "../lib/types";

interface Props {
  laps: Lap[];
  lap: number | null;
  onLap: (n: number) => void;
  playing: boolean;
  onPlay: () => void;
  /** Laps with a cut-off on the selected straight. */
  withCut: Set<number>;
  straightLabel: string;
  lapCut: number | null;
}

/** One cell per lap (green, green with a cut, excluded), a range input on top, and play. */
export function LapScrubber({ laps, lap, onLap, playing, onPlay, withCut, straightLabel, lapCut }: Props) {
  const idx = Math.max(0, laps.findIndex((l) => l.lap_number === lap));
  const cur = laps[idx];
  const max = laps.length ? laps[laps.length - 1].lap_number : 0;
  return (
    <div className="grid items-center gap-x-8 gap-y-5 md:grid-cols-[auto_1fr_auto]">
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={onPlay}
          disabled={laps.length < 2}
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand text-white transition-colors hover:bg-brand-hover disabled:opacity-40"
          aria-label={playing ? "Pause" : "Play through the laps"}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4.5v15l13-7.5z" />}
          </svg>
        </button>
        <div>
          <div className="cap">Lap</div>
          <div className="num text-[30px] font-medium leading-none text-ink-head">
            {cur?.lap_number ?? "–"}
            <span className="text-[15px] text-ink-3"> / {max}</span>
          </div>
        </div>
      </div>
      <div className="relative">
        <div className="flex items-end gap-[2px]" aria-hidden="true">
          {laps.map((l) => (
            <div
              key={l.lap_number}
              title={`Lap ${l.lap_number}`}
              onClick={() => onLap(l.lap_number)}
              className={`lap-cell ${
                l.lap_number === lap ? "is-selected" : !l.green ? "is-excluded" : withCut.has(l.lap_number) ? "is-cut" : "is-green"
              }`}
            />
          ))}
        </div>
        <input
          type="range"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          min={0}
          max={Math.max(0, laps.length - 1)}
          value={idx}
          disabled={laps.length < 2}
          onChange={(e) => onLap(laps[Number(e.target.value)].lap_number)}
          aria-label="Lap"
          aria-valuetext={cur ? `Lap ${cur.lap_number}` : undefined}
        />
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-3">
          <span className="flex items-center gap-2">
            <i className="inline-block h-3 w-2 rounded-[1px] bg-[#5e5e6e]" /> green, cut on {straightLabel}
          </span>
          <span className="flex items-center gap-2">
            <i className="inline-block h-3 w-2 rounded-[1px] bg-[#2e2e3a]" /> green, no cut
          </span>
          <span className="flex items-center gap-2">
            <i className="lap-cell is-excluded inline-block !h-3 !w-2 !flex-none" /> not green (start, pit, neutralised)
          </span>
        </div>
      </div>
      <div className="flex items-center gap-6 md:justify-end md:text-right">
        <div>
          <div className="flex items-center gap-3 md:justify-end">
            {cur ? (
              cur.green ? (
                <span className="badge badge-ok">Green</span>
              ) : (
                <span className="badge badge-warn">{reason(cur.reason)}</span>
              )
            ) : null}
            <span className="num text-[20px] text-ink-head">{lapTime(cur?.lap_duration)}</span>
          </div>
          <div className="mt-1.5 text-[14px] text-ink-3">
            {straightLabel} cut <span className="num text-ink-head">{lapCut !== null ? `${int(lapCut)} m` : "none"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
