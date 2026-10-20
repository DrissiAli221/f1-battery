import { useCallback, useEffect, useMemo, useRef } from "react";
import { Straight, type StraightLabels } from "../instrument/Straight";
import { REGIME_WORD, type Profile, type Regime } from "../instrument/driver";
import { int } from "../lib/format";
import { useSize } from "../lib/useSize";
import type { RegimeLabel } from "../lib/types";
import type { Median } from "./data";
import { regimeAtLap } from "./profile";
import { useStore, type Store } from "./store";
import { REGIME_VAR } from "./TrackMap";

/** What the page readout shows: one value per bin, never per frame. */
export interface PanelReading {
  d: number;
  v: number | null;
  regime: Regime | null;
}

interface Props {
  /** "loading" draws the axis skeleton; "none" draws the regime bins only; else the trace. */
  mode: "loading" | "none" | "ready";
  profile: Profile | null;
  compare: { profile: Profile; colour: string } | null;
  /** Straight length, m (from the profile when it exists, else the curated window). */
  length: number;
  /** The straight's start, lap distance (to read the lap's regime bins in the fallback). */
  d0: number;
  lap: number;
  regimes: Map<number, RegimeLabel> | null;
  /** Session median cut-off with its interval, metres along the straight. */
  median: Median | null;
  /** The shown lap's cut-off, metres along the straight. */
  lapCut: number | null;
  lapNo: number | null;
  cursor: Store<number | null>;
  onReading: (r: PanelReading) => void;
  labels: StraightLabels;
  /** Fallback only: each driver's per-lap cut-offs (m along the straight) and median. */
  strips?: { code: string; colour: string; cuts: number[]; median: Median | null }[];
}

/*
 * The straight at panel size, driven by the page: `d` lives in a store the map and the
 * readout share. Pointer (move and press) and keyboard on the plot set it; the instrument
 * eases to it. The shown lap's own cut-off is drawn on top as a small tick on the axis.
 */
export function StraightPanel(p: Props) {
  const d = useStore(p.cursor);
  const plotBox = useRef<HTMLDivElement>(null);
  const L = p.profile?.length_m ?? p.length;

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || p.mode !== "ready") return;
    const plot = plotBox.current?.querySelector<HTMLElement>(".st__plot");
    if (!plot) return;
    const r = plot.getBoundingClientRect();
    if (e.clientY > r.bottom) return;
    p.cursor.set(Math.max(0, Math.min(L, ((e.clientX - r.left) / r.width) * L)));
  };

  const onStraightReading = useCallback(
    (r: { d: number; v: number; regime: Regime }) => p.onReading({ d: r.d, v: r.v, regime: r.regime }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.onReading],
  );

  if (p.mode === "loading") {
    return (
      <div className="xp-straight">
        <Straight profile={null} size="panel" readout="none" labels={p.labels} />
      </div>
    );
  }
  if (p.mode !== "ready" || !p.profile) {
    return <RegimeAxis {...p} d={d ?? 0} />;
  }

  return (
    <div ref={plotBox} className="xp-straight" onPointerMove={onMove}>
      <div className="xp-straight__in">
        <Straight
          profile={p.profile}
          compare={p.compare}
          size="panel"
          d={d ?? p.profile.cutoff_median_m ?? L / 2}
          onSeek={(v) => p.cursor.set(v)}
          onReading={onStraightReading}
          readout="none"
          labels={p.labels}
        />
        {p.lapCut !== null && p.lapCut >= 0 && p.lapCut <= L && (
          <div className="xp-lapcut" style={{ left: `${(p.lapCut / L) * 100}%` }} aria-hidden="true">
            <span className="xp-lapcut__mark" />
            <span className="xp-lapcut__label">L{p.lapNo}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * Without a speed profile (rows not published yet): the straight's distance axis carries what
 * is published. Each driver's per-lap cut-offs as a strip of ticks (measured laps, one tick
 * each) over that driver's median estimate with its hatched interval and bracket; the shown
 * lap's regimes as the band on the axis; the lap's own cut-off as a mark. Same cursor, same
 * keyboard, same readout (without speed).
 */
function RegimeAxis(p: Props & { d: number }) {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  const L = p.length;
  const strips = p.strips ?? [];
  const rowH = 64;
  const top = 28;
  const axisY = top + Math.max(1, strips.length) * rowH + 20;
  const H = axisY + 40;
  const x = (m: number) => (Math.max(0, Math.min(L, m)) / (L || 1)) * W;

  const spans = useMemo(() => {
    const out: { from: number; to: number; label: RegimeLabel | null }[] = [];
    for (let m = 0; m < L; m += 50) {
      const label = regimeAtLap(p.regimes, p.d0 + m + 25, p.lap);
      const last = out[out.length - 1];
      if (last && last.label === label) last.to = Math.min(L, m + 50);
      else out.push({ from: m, to: Math.min(L, m + 50), label });
    }
    return out;
  }, [L, p.regimes, p.d0, p.lap]);

  // The readout changes on bin changes only, like the instrument's.
  const bin = Math.floor(Math.min(p.d, L - 1) / 50);
  const regime = regimeAtLap(p.regimes, p.d0 + p.d, p.lap);
  const { onReading } = p;
  useEffect(() => {
    onReading({ d: Math.min(L, bin * 50 + 25), v: null, regime });
  }, [bin, regime, onReading, L]);

  const toD = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(L, ((clientX - r.left) / r.width) * L));
  };
  const ticks: number[] = [];
  for (let m = 0; m <= L; m += 200) ticks.push(m);

  return (
    <figure className="xp-straight xp-regaxis">
      <div
        ref={ref}
        className="xp-regaxis__plot"
        role="slider"
        tabIndex={0}
        aria-label={`Distance along ${p.labels.straight ?? "the straight"}`}
        aria-valuemin={0}
        aria-valuemax={Math.round(L)}
        aria-valuenow={Math.round(p.d)}
        aria-valuetext={`${int(p.d)} metres, ${regime ? REGIME_WORD[regime] : "no regime"}`}
        onPointerDown={(e) => p.cursor.set(toD(e.clientX, e.currentTarget))}
        onPointerMove={(e) => e.pointerType === "mouse" && p.cursor.set(toD(e.clientX, e.currentTarget))}
        onKeyDown={(e) => {
          const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 50 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -50 : 0;
          let next: number | null = step ? Math.max(0, Math.min(L, Math.floor(p.d / 50) * 50 + 25 + step)) : null;
          if (e.key === "Home") next = 0;
          if (e.key === "End") next = L;
          if (next === null) return;
          e.preventDefault();
          p.cursor.set(next);
        }}
      >
        {W > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block overflow-visible" aria-hidden="true">
            <defs>
              {strips.map((s, i) => (
                <pattern key={i} id={`xp-hatch-${i}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke={s.colour} strokeOpacity="0.45" strokeWidth="1" />
                </pattern>
              ))}
            </defs>
            {ticks.slice(1).map((m) => (
              <line key={m} x1={x(m)} x2={x(m)} y1={top - 8} y2={axisY} className="xp-gridline" />
            ))}
            {strips.map((s, i) => {
              // A label line, then the drawing band under it.
              const y0 = top + i * rowH;
              const b0 = y0 + 12;
              const bh = rowH - 16;
              const mid = b0 + bh / 2;
              const md = s.median;
              return (
                <g key={s.code}>
                  {md && md.lo !== null && md.hi !== null && (
                    <>
                      <rect x={x(md.lo)} y={b0 + 4} width={Math.max(2, x(md.hi) - x(md.lo))} height={bh - 4} fill={`url(#xp-hatch-${i})`} />
                      <path d={`M${x(md.lo)},${b0 + 8}v-4H${x(md.hi)}v4`} fill="none" stroke={s.colour} />
                    </>
                  )}
                  {s.cuts.map((c, j) => (
                    <line key={j} x1={x(c)} x2={x(c)} y1={mid - 8} y2={mid + 8} stroke={s.colour} strokeOpacity={0.55} strokeWidth={1} />
                  ))}
                  {md && <line x1={x(md.m)} x2={x(md.m)} y1={b0} y2={b0 + bh} stroke={s.colour} strokeWidth={2} />}
                  <text x={0} y={y0} className="xp-svgcode" style={{ fill: s.colour }}>
                    {s.code}
                    {md && (
                      <tspan className="xp-svgnum" dx="10">
                        median est. <tspan className="xp-svgnum--ink">{int(md.m)}&nbsp;m</tspan>
                      </tspan>
                    )}
                  </text>
                </g>
              );
            })}
            <line x1={0} x2={W} y1={axisY} y2={axisY} className="xp-axisline" />
            {spans.map((s, i) => (
              <rect key={i} x={x(s.from)} y={axisY + 1} width={Math.max(0, x(s.to) - x(s.from))} height={6} fill={s.label ? REGIME_VAR[s.label] : "var(--line)"} />
            ))}
            {p.lapCut !== null && p.lapCut >= 0 && p.lapCut <= L && (
              <g transform={`translate(${x(p.lapCut)},${axisY})`}>
                <path d="M0,0L-4.5,-8H4.5Z" fill="var(--ink)" />
                <text x={7} y={-2} className="xp-svgnum xp-svgnum--ink">
                  L{p.lapNo}
                </text>
              </g>
            )}
            {ticks.map((m, i) => (
              <text key={m} x={x(m)} y={axisY + 26} textAnchor={i === 0 ? "start" : m > L - 60 ? "end" : "middle"} className="xp-svgnum">
                {i === 0 ? "0 m" : int(m)}
              </text>
            ))}
            <line x1={x(p.d)} x2={x(p.d)} y1={top - 12} y2={axisY + 8} className="xp-regaxis__cursor" />
            <circle cx={x(p.d)} cy={axisY + 4} r={4} className="xp-map__dot-core" />
          </svg>
        )}
      </div>
      <figcaption className="xp-note">
        One tick per lap at its cut-off, over each driver's median estimate. The speed profile for this straight is not published yet.
      </figcaption>
    </figure>
  );
}
