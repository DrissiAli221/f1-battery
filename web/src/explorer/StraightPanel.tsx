import { useId, useMemo, useRef } from "react";
import { useEasedCursor, seekKey } from "../instrument/cursor";
import type { Profile } from "../instrument/driver";
import { SpeedChart } from "../instrument/SpeedChart";
import "../instrument/telemetry.css";
import { int } from "../lib/format";
import { useSize } from "../lib/useSize";
import type { RegimeLabel } from "../lib/types";
import { REGIME_VAR, REGIME_WORD } from "../track/regimes";
import type { Median } from "./data";
import { regimeAtLap } from "./profile";
import type { Store } from "./store";

export interface Strip {
  code: string;
  colour: string;
  /** Per-lap cut-offs, metres into the straight. */
  cuts: number[];
  median: Median | null;
}

interface Props {
  /** "loading" draws the frame's skeleton; "none" draws the per-lap cut-off strip; else the speed chart. */
  mode: "loading" | "none" | "ready";
  profile: Profile | null;
  compare: { profile: Profile; colour: string; code: string } | null;
  code: string;
  /** Straight length, m (from the profile when it exists, else the curated window). */
  length: number;
  /** The straight's start, lap distance (to read the lap's regime bins in the strip). */
  d0: number;
  lap: number;
  regimes: Map<number, RegimeLabel> | null;
  regLap: number | null;
  lapCut: number | null;
  lapNo: number | null;
  lapColour: string;
  cursor: Store<number | null>;
  label: string;
  strips: Strip[];
}

/*
 * The stage's right column body: the speed chart when the straight's profile is published,
 * otherwise the per-lap cut-off strip on the same grid (the published per-lap results over
 * each driver's median estimate). Both follow the page's shared cursor.
 */
export function StraightPanel(p: Props) {
  if (p.mode === "loading") return <div className="tl tl--skel skel" aria-busy="true" aria-label="Loading the speed profile" />;
  if (p.mode === "ready" && p.profile) {
    return (
      <SpeedChart profile={p.profile} code={p.code} compare={p.compare} cursor={p.cursor} lapCut={p.lapCut} lapNo={p.lapNo} lapColour={p.lapColour} label={p.label} />
    );
  }
  return <CutStrip {...p} />;
}

const M = { l: 6, r: 10, t: 10, b: 50 };

/*
 * Without a speed profile: the straight's distance axis carries what is published. One row per
 * driver: a tick per lap at that lap's cut-off, over the driver's median estimate with its
 * hatched interval; the shown lap's regimes as the strip under the axis; the lap's own cut-off
 * as a chip on the axis. The tooltip says how many of the driver's laps were cut by the cursor.
 */
function CutStrip(p: Props) {
  const uid = useId().replace(/:/g, "");
  const [box, { w: W, h: H }] = useSize<HTMLDivElement>();
  const L = p.length || 1;
  const strips = p.strips;
  const n = Math.max(1, strips.length);
  const axisY = H - M.b;
  const rowH = (axisY - M.t) / n;
  const sx = (m: number) => M.l + (Math.max(0, Math.min(L, m)) / L) * Math.max(1, W - M.l - M.r);
  const ready = W > 0 && H > 0;

  // Where more than 25 laps fall within one 50 m bin the ticks merge: alternate laps take two rows.
  const dense = useMemo(
    () =>
      strips.some((s) => {
        const c = new Map<number, number>();
        for (const v of s.cuts) c.set(Math.floor(v / 50), (c.get(Math.floor(v / 50)) ?? 0) + 1);
        return Math.max(0, ...c.values()) > 25;
      }),
    [strips],
  );

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

  const sorted = useMemo(() => strips.map((s) => [...s.cuts].sort((a, b) => a - b)), [strips]);
  const dStep = L > 700 ? 200 : 100;
  const dTicks: number[] = [];
  for (let m = 0; m <= L + 1e-6; m += dStep) dTicks.push(m);

  // ---- cursor
  const curRef = useRef<SVGGElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const t = useRef<Record<string, HTMLElement | null>>({});
  const slider = useRef<HTMLDivElement | null>(null);
  useEasedCursor(
    p.cursor,
    (d) => {
      if (!ready) return;
      const x = sx(d);
      curRef.current?.setAttribute("transform", `translate(${x.toFixed(1)},0)`);
      const el = tip.current;
      if (el) {
        const gap = 22;
        const flip = x + gap + el.offsetWidth > W - 4;
        const left = Math.max(0, Math.min(W - el.offsetWidth, flip ? x - gap - el.offsetWidth : x + gap));
        el.style.transform = `translate(${left.toFixed(1)}px, 0)`;
      }
      const tx = t.current;
      if (tx.d) tx.d.textContent = `${int(d)} m`;
      sorted.forEach((cuts, i) => {
        const k = cuts.filter((c) => c <= d).length;
        const e = tx[`c${i}`];
        if (e) e.textContent = `${k}/${cuts.length}`;
      });
      const regime = regimeAtLap(p.regimes, p.d0 + d, p.lap);
      if (tx.r) {
        tx.r.textContent = regime ? `lap ${p.regLap ?? "–"} ${REGIME_WORD[regime]}` : "";
        tx.r.style.setProperty("--regime", regime ? REGIME_VAR[regime] : "");
      }
      slider.current?.setAttribute("aria-valuenow", String(Math.round(d)));
      slider.current?.setAttribute("aria-valuetext", `${int(d)} metres${regime ? `, ${REGIME_WORD[regime]}` : ""}`);
    },
    [ready, W, H, L, sorted, p.regimes, p.d0, p.lap, p.regLap],
  );

  const toD = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(L, ((clientX - r.left - M.l) / Math.max(1, r.width - M.l - M.r)) * L));
  };

  return (
    <div
      ref={(el) => {
        box(el);
        slider.current = el;
      }}
      className="tl"
      role="slider"
      tabIndex={0}
      aria-label={`Distance along ${p.label}`}
      aria-valuemin={0}
      aria-valuemax={Math.round(L)}
      onPointerMove={(e) => e.pointerType === "mouse" && p.cursor.set(toD(e.clientX, e.currentTarget))}
      onPointerDown={(e) => p.cursor.set(toD(e.clientX, e.currentTarget))}
      onKeyDown={(e) => seekKey(e, p.cursor, L)}
    >
      {ready && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="tl__svg" aria-hidden="true">
          <defs>
            {strips.map((s, i) => (
              <pattern key={i} id={`${uid}-h${i}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke={s.colour} strokeOpacity="0.4" strokeWidth="1" />
              </pattern>
            ))}
          </defs>
          {dTicks.map((m) => (
            <line key={m} x1={sx(m)} x2={sx(m)} y1={M.t} y2={axisY} className="tl__grid" />
          ))}
          {strips.map((s, i) => {
            const y0 = M.t + i * rowH;
            const b0 = y0 + 30;
            const bh = Math.max(16, rowH - 42);
            const mid = b0 + bh / 2;
            const th = Math.min(bh / 2 - 2, 64);
            const md = s.median;
            return (
              <g key={s.code + i}>
                {i > 0 && <line x1={M.l} x2={W - M.r} y1={y0} y2={y0} className="tl__grid" />}
                <text x={M.l} y={y0 + 14} className="tl__code" style={{ fill: s.colour }}>
                  {s.code}
                  {md ? (
                    <tspan className="tl__num" dx="10">
                      median est. <tspan className="tl__num--ink">{int(md.m)} m</tspan>
                      {md.lo !== null && md.hi !== null && ` ${int(md.lo)}–${int(md.hi)}`}
                    </tspan>
                  ) : (
                    <tspan className="tl__num" dx="10">
                      no cut-off here
                    </tspan>
                  )}
                </text>
                {md && md.lo !== null && md.hi !== null && (
                  <rect x={sx(md.lo)} y={b0} width={Math.max(2, sx(md.hi) - sx(md.lo))} height={bh} fill={`url(#${uid}-h${i})`} />
                )}
                {s.cuts.map((c, j) => {
                  const [a, b] = !dense ? [mid - th, mid + th] : j % 2 ? [mid + 2, mid + th] : [mid - th, mid - 2];
                  return <line key={j} x1={sx(c)} x2={sx(c)} y1={a} y2={b} stroke={s.colour} strokeOpacity={0.5} strokeWidth={1} />;
                })}
                {md && <line x1={sx(md.m)} x2={sx(md.m)} y1={b0 - 4} y2={b0 + bh + 4} stroke={s.colour} strokeWidth={2} />}
              </g>
            );
          })}
          <line x1={M.l} x2={W - M.r} y1={axisY} y2={axisY} className="tl__axis" />
          {spans.map((s, i) => (
            <rect key={i} x={sx(s.from)} y={axisY + 5} width={Math.max(0, sx(s.to) - sx(s.from))} height={4} rx={1} fill={s.label ? REGIME_VAR[s.label] : "var(--line)"} />
          ))}
          {dTicks.map((m, i) => (
            <text key={m} x={sx(m)} y={axisY + 28} textAnchor={i === 0 ? "start" : m > L - dStep / 2 ? "end" : "middle"} className="tl__num">
              {i === 0 ? "0 m" : int(m)}
            </text>
          ))}
          {p.lapCut !== null && p.lapCut >= 0 && p.lapCut <= L && (
            <g transform={`translate(${sx(p.lapCut).toFixed(1)},${axisY})`}>
              <line y1={0} y2={-10} stroke={p.lapColour} strokeWidth={2} />
              <rect x={-17} y={-26} width={34} height={16} rx={4} fill={p.lapColour} />
              <text y={-14.5} textAnchor="middle" className="tl__chip">
                L{p.lapNo}
              </text>
            </g>
          )}
          <g ref={curRef} className="tl__cursor">
            <line x1={0} x2={0} y1={M.t} y2={axisY + 9} />
            <circle r={4} cy={axisY} className="tl__dot tl__dot--p" />
          </g>
        </svg>
      )}
      {ready && (
        <div ref={tip} className="tl-tip" style={{ top: M.t + 30 }} aria-hidden="true">
          <p className="tl-tip__d" ref={(el) => (t.current.d = el)} />
          {strips.map((s, i) => (
            <p key={s.code + i} className="tl-tip__row">
              <i style={{ background: s.colour }} />
              <span className="tl-tip__k">{s.code}</span>
              <b ref={(el) => (t.current[`c${i}`] = el)} />
              <span className="tl-tip__u">laps cut</span>
            </p>
          ))}
          <p className="tl-tip__regime" ref={(el) => (t.current.r = el)} />
        </div>
      )}
    </div>
  );
}
