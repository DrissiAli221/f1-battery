import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useSize } from "../lib/useSize";
import { gsap } from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { int } from "../lib/format";
import { beforeEnd, project, wrap, type Pose, type Projection, type RegimeRun, type TrackStraight } from "../lib/track";
import type { Outline } from "../lib/types";
import type { Median } from "./data";

gsap.registerPlugin(DrawSVGPlugin, MotionPathPlugin);

export const REGIME_VAR: Record<RegimeRun["label"], string> = {
  deploy: "var(--regime-deploy)",
  plateau: "var(--regime-plateau)",
  lift: "var(--regime-lift)",
  brake: "var(--regime-brake)",
  other: "var(--regime-other)",
};

const HEAD = "var(--ink-head)";
const DEEP = "var(--surface-deep)";

export interface MarkDriver {
  code: string;
  colour: string;
  medians: Map<number, Median> | undefined;
}

interface Props {
  outline: Outline;
  straights: TrackStraight[];
  runs: RegimeRun[];
  primary: MarkDriver;
  compare: MarkDriver | null;
  selected: number | null;
  onSelect: (id: number) => void;
  /** This lap's cut-off on the selected straight (the chevron), or null. */
  lapCut: number | null;
  cursor: number | null;
  onHover: (d: number | null) => void;
  /** Changing this replays the draw-in (one entrance per session). */
  animateKey: string;
}

/** A short line across the track at pose q, from offset a to b along the normal. */
function Tick({ q, a, b, colour, width, casing }: { q: Pose; a: number; b: number; colour: string; width: number; casing?: string }) {
  const p = { x1: q.x + q.nx * a, y1: q.y + q.ny * a, x2: q.x + q.nx * b, y2: q.y + q.ny * b };
  return (
    <>
      {casing && <line {...p} stroke={casing} strokeWidth={width + 3.6} strokeLinecap="round" />}
      <line {...p} stroke={colour} strokeWidth={width} strokeLinecap="round" />
    </>
  );
}

/** Range band along the line, at least 6 px long so a narrow interval never reads as a point. */
function bandPath(T: Projection, lo: number, hi: number, off: number): string {
  const span = wrap(hi - lo, T.lap);
  if (span / T.mpp < 6) {
    const mid = lo + span / 2;
    const half = 3 * T.mpp;
    return T.sub(mid - half, mid + half, off);
  }
  return T.sub(lo, hi, off);
}

export function TrackMap(props: Props) {
  const { outline, straights, runs, primary, compare, selected, onSelect, lapCut, cursor, onHover, animateKey } = props;
  const [wrapRef, { w: W, h: H }] = useSize<HTMLDivElement>();
  const md = W >= 700;
  const T = useMemo(
    () => (W > 0 && H > 0 ? project(outline, W, H, md ? { l: 56, r: 56, t: 72, b: 56 } : { l: 34, r: 34, t: 40, b: 40 }) : null),
    [outline, W, H, md],
  );
  const tw = md ? 18 : 12;
  const half = tw / 2;

  const svgRef = useRef<SVGSVGElement>(null);
  const animated = useRef<string | null>(null);

  // One entrance per session: the track draws in along the direction of travel with a lead
  // dot on the path, then the cut-off marks land in order of travel.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || !T || animated.current === animateKey || !runs.length) return;
    animated.current = animateKey;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const q = <E extends Element = SVGElement>(sel: string) => Array.from(svg.querySelectorAll<E>(sel));
    const DUR = 1.6;
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    const lines = q("[data-draw]");
    tl.fromTo(lines, { drawSVG: "0%" }, { drawSVG: "100%", duration: DUR, ease: "none" }, 0);
    for (const el of q<SVGPathElement>("[data-run]")) {
      const f0 = T.frac(Number(el.dataset.d0));
      const f1 = Number(el.dataset.d1) >= T.lap - 0.01 ? 1 : T.frac(Number(el.dataset.d1));
      tl.fromTo(el, { drawSVG: "0%" }, { drawSVG: "100%", duration: Math.max(0.02, (f1 - f0) * DUR), ease: "none" }, f0 * DUR);
    }
    const lead = q("[data-lead]")[0];
    const path = q<SVGPathElement>("[data-lead-path]")[0];
    if (lead && path) {
      tl.set(lead, { opacity: 1 }, 0);
      tl.to(lead, { motionPath: { path, align: path, alignOrigin: [0.5, 0.5] }, duration: DUR, ease: "none" }, 0);
      tl.to(lead, { opacity: 0, duration: 0.25 }, DUR);
    }
    for (const el of q<SVGGElement>("[data-mark]")) {
      tl.from(el, { opacity: 0, scale: 0.4, transformOrigin: "50% 50%", duration: 0.3, ease: "back.out(2)" }, T.frac(Number(el.dataset.mark)) * DUR);
    }
    tl.from(q("[data-late]"), { opacity: 0, duration: 0.35 }, DUR + 0.1);
    tl.eventCallback("onComplete", () => {
      gsap.set([...lines, ...q("[data-run]")], { clearProps: "strokeDasharray,strokeDashoffset" });
    });
    return () => {
      // Interrupted (StrictMode re-run, or a quick navigation): allow the entrance to replay.
      if (tl.progress() < 1) animated.current = null;
      tl.progress(1).kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateKey, T !== null, runs.length > 0]);

  // Chevron glides between laps rather than jumping.
  const chevRef = useRef<SVGPathElement>(null);
  const chevD = useRef<number | null>(null);
  useEffect(() => {
    const el = chevRef.current;
    if (!el || !T || lapCut === null) {
      chevD.current = lapCut;
      return;
    }
    const place = (d: number) => {
      const p = T.pose(d);
      const off = half + 13;
      el.setAttribute("transform", `translate(${(p.x + p.nx * off).toFixed(1)},${(p.y + p.ny * off).toFixed(1)}) rotate(${p.deg.toFixed(1)})`);
    };
    const from = chevD.current;
    chevD.current = lapCut;
    if (from === null || Math.abs(from - lapCut) > 600 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      place(lapCut);
      return;
    }
    const o = { d: from };
    const tw2 = gsap.to(o, { d: lapCut, duration: 0.35, ease: "power2.out", onUpdate: () => place(o.d) });
    return () => {
      tw2.kill();
    };
  }, [lapCut, T, half]);

  const sel = straights.find((s) => s.straight_id === selected) ?? null;
  const selMedian = sel ? primary.medians?.get(sel.straight_id) : undefined;

  const label = useMemo(() => {
    if (!T || !sel || !selMedian) return null;
    const q = T.pose(selMedian.m);
    const before = beforeEnd(sel, selMedian.m, T.lap);
    const txt = md && before !== null ? `${int(selMedian.m)} m · ${int(before)} m before ${sel.into ?? "braking"}` : `${int(selMedian.m)} m`;
    const fs = md ? 13 : 12;
    const cw = 44;
    const w = cw + 10 + txt.length * fs * 0.6 + 10;
    const h = 28;
    // Obstacles: the line itself, straight badges; pick the free spot closest to the tick.
    const obs: [number, number, number][] = T.pts.filter((_, i) => i % 3 === 0).map((p) => [p.x, p.y, half + 4]);
    for (const s of straights) {
      const c = T.pose(s.mid);
      const o = -(half + (md ? 26 : 18));
      obs.push([c.x + c.nx * o, c.y + c.ny * o, 20]);
    }
    let best: { score: number; x: number; y: number; bx: number; by: number; side: number } | null = null;
    for (const side of [1, -1])
      for (const dist of [half + 30, half + 50, half + 72, half + 100])
        for (const sh of [0, 0.5, 1]) {
          const x = q.x + q.nx * dist * side;
          const y = q.y + q.ny * dist * side;
          let bx = q.nx * side >= 0 ? x - sh * w * 0.5 : x - w + sh * w * 0.5;
          let by = y - h / 2 + (q.ny * side >= 0 ? h * 0.5 * sh : -h * 0.5 * sh);
          bx = Math.max(8, Math.min(W - w - 8, bx));
          by = Math.max(8, Math.min(H - h - 8, by));
          let hit = 0;
          for (const [ox, oy, r] of obs) if (ox > bx - r && ox < bx + w + r && oy > by - r && oy < by + h + r) hit++;
          const score = hit * 100 + dist * 0.6 + sh * 6 + (side < 0 ? 20 : 0);
          if (!best || score < best.score) best = { score, x, y, bx, by, side };
        }
    if (!best) return null;
    const lx = Math.max(best.bx, Math.min(best.bx + w, best.x));
    const ly = Math.max(best.by, Math.min(best.by + h, best.y));
    const s0 = best.side > 0 ? half + 8 : half + 15;
    return { q, txt, fs, cw, w, h, ...best, lx, ly, s0 };
  }, [T, sel, selMedian, straights, md, half, W, H]);

  const cursorPt = T && cursor !== null ? T.at(cursor) : null;

  const scaleBar = useMemo(() => {
    if (!T) return null;
    const target = (md ? 110 : 70) * T.mpp;
    const m = [50, 100, 200, 250, 500, 1000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    return { m, px: m / T.mpp };
  }, [T, md]);

  const sf = T ? T.pose(0) : null;
  const sfLabel = T ? T.pose(T.lap - 160) : null;

  return (
    <div ref={wrapRef} className="absolute inset-0">
      {T && (
        <svg
          ref={svgRef}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block touch-pan-y select-none"
          role="img"
          aria-label={`Track map coloured by regime, with ${primary.code}'s median cut-off on each straight${compare ? ` and ${compare.code}'s on the outer edge` : ""}`}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const n = T.nearest(e.clientX - r.left, e.clientY - r.top);
            onHover(n.dist < 40 ? n.d : null);
          }}
          onMouseLeave={() => onHover(null)}
        >
          <defs>
            <filter id="map-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.8" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g fill="none" strokeLinejoin="round">
            <path data-draw d={T.pathD} stroke="var(--track-edge)" strokeWidth={tw + 2} />
            <path data-draw d={T.pathD} stroke="var(--track-body)" strokeWidth={tw} />
          </g>
          {sel && (
            <path d={T.sub(sel.d0, sel.d1)} fill="none" stroke={HEAD} strokeOpacity={0.08} strokeWidth={tw + 14} strokeLinecap="round" strokeLinejoin="round" />
          )}
          <g filter="url(#map-glow)" fill="none" strokeLinejoin="round">
            {runs.map((r) => (
              <path
                key={`${r.d0}-${r.label}`}
                data-run
                data-d0={r.d0}
                data-d1={r.d1}
                d={T.sub(r.d0, Math.min(r.d1, T.lap - 0.01))}
                stroke={REGIME_VAR[r.label]}
                strokeOpacity={r.label === "other" ? 0.6 : 1}
                strokeWidth={md ? 4 : 3}
              />
            ))}
          </g>
          {/* Click targets for the straights with a cut-off. */}
          <g fill="none" stroke="transparent">
            {straights.map((s) =>
              primary.medians?.has(s.straight_id) ? (
                <path key={s.straight_id} d={T.sub(s.d0, s.d1)} strokeWidth={32} className="cursor-pointer" onClick={() => onSelect(s.straight_id)}>
                  <title>{s.label}</title>
                </path>
              ) : null,
            )}
          </g>
          {/* Start/finish chequer and label. */}
          {sf && sfLabel && (
            <g data-late>
              <g transform={`translate(${sf.x},${sf.y}) rotate(${sf.deg + 90})`}>
                {[0, 1, 2, 3].flatMap((i) =>
                  [0, 1].map((j) => (
                    <rect key={`${i}${j}`} x={-half + (i * tw) / 4} y={-3 + j * 3} width={tw / 4} height={3} fill={(i + j) % 2 ? HEAD : DEEP} />
                  )),
                )}
              </g>
              <text
                x={sfLabel.x - sfLabel.nx * (half + 20)}
                y={sfLabel.y - sfLabel.ny * (half + 20) + 4}
                textAnchor="middle"
                fontFamily="var(--font-display)"
                fontWeight={700}
                fontSize={md ? 12 : 11}
                letterSpacing="0.06em"
                fill={HEAD}
              >
                S/F
              </text>
            </g>
          )}
          {/* Straight badges, outside the line. */}
          <g data-late>
            {straights.map((s) => {
              const has = !!primary.medians?.has(s.straight_id);
              const on = s.straight_id === selected;
              const q = T.pose(s.mid);
              const off = -(half + (md ? 26 : 18));
              const w = md ? 38 : 32;
              const h = md ? 24 : 20;
              return (
                <g
                  key={s.straight_id}
                  transform={`translate(${(q.x + q.nx * off).toFixed(1)},${(q.y + q.ny * off).toFixed(1)})`}
                  className={has ? "cursor-pointer" : undefined}
                  onClick={has ? () => onSelect(s.straight_id) : undefined}
                >
                  <title>{has ? s.label : `${s.label}: no cut-off for ${primary.code}`}</title>
                  <rect
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={h / 2}
                    fill={on ? "var(--brand)" : "var(--frame)"}
                    stroke={on ? "var(--brand)" : has ? "#4a4a57" : "#2b2b37"}
                    strokeWidth={on ? 0 : 1.2}
                  />
                  <text y={md ? 4.6 : 4} textAnchor="middle" fontFamily="var(--font-display)" fontWeight={800} fontSize={md ? 12.5 : 11} fill={on ? "#fff" : has ? HEAD : "var(--ink-4)"}>
                    S{s.straight_id}
                  </text>
                </g>
              );
            })}
          </g>
          {/* Cut-off marks: compare on the outer edge (hollow, team ring), primary on the inner edge (white tick, dark casing). */}
          <g>
            {straights.map((s) => {
              const mc = compare?.medians?.get(s.straight_id);
              const mp = primary.medians?.get(s.straight_id);
              return (
                <g key={s.straight_id}>
                  {compare && mc && (
                    <g data-mark={mc.m}>
                      {mc.lo !== null && mc.hi !== null && (
                        <path d={bandPath(T, mc.lo, mc.hi, -(half + 4))} fill="none" stroke={compare.colour} strokeWidth={3} strokeOpacity={0.9} />
                      )}
                      <Tick q={T.pose(mc.m)} a={-(half + 1)} b={-(half + 14)} colour={compare.colour} width={6} />
                      <Tick q={T.pose(mc.m)} a={-(half + 1)} b={-(half + 14)} colour={DEEP} width={2.4} />
                    </g>
                  )}
                  {mp && (
                    <g data-mark={mp.m}>
                      {mp.lo !== null && mp.hi !== null && (
                        <path d={bandPath(T, mp.lo, mp.hi, half + 4)} fill="none" stroke={HEAD} strokeWidth={3} strokeOpacity={0.9} />
                      )}
                      <Tick q={T.pose(mp.m)} a={half + 7} b={-(half + 1)} colour={HEAD} width={2.8} casing={DEEP} />
                    </g>
                  )}
                </g>
              );
            })}
          </g>
          {/* Label on the selected straight only. */}
          {label && (
            <g data-late className="pointer-events-none">
              <line
                x1={label.q.x + label.q.nx * label.s0 * label.side}
                y1={label.q.y + label.q.ny * label.s0 * label.side}
                x2={label.lx}
                y2={label.ly}
                stroke={HEAD}
                strokeOpacity={0.6}
              />
              <rect x={label.bx} y={label.by} width={label.w} height={label.h} rx={4} fill={HEAD} />
              <path
                d={`M${label.bx + 4},${label.by}H${label.bx + label.cw}V${label.by + label.h}H${label.bx + 4}a4,4 0 0 1 -4,-4V${label.by + 4}a4,4 0 0 1 4,-4Z`}
                fill={DEEP}
              />
              <text x={label.bx + label.cw / 2} y={label.by + 18.5} textAnchor="middle" fontFamily="var(--font-display)" fontWeight={800} fontSize={11} letterSpacing="0.06em" fill={HEAD}>
                CUT
              </text>
              <text x={label.bx + label.cw + 10} y={label.by + 18.5} fontFamily="var(--font-mono)" fontWeight={500} fontSize={label.fs} fill={DEEP}>
                {label.txt}
              </text>
            </g>
          )}
          {lapCut !== null && (
            <path ref={chevRef} data-late d="M8,0 L-6,-7 L-2.5,0 L-6,7 Z" fill={HEAD} stroke={DEEP} strokeWidth={1.5} strokeLinejoin="round" className="pointer-events-none" />
          )}
          {cursorPt && (
            <g className="pointer-events-none">
              <circle cx={cursorPt.x} cy={cursorPt.y} r={7} fill="none" stroke={HEAD} strokeWidth={1.5} />
              <circle cx={cursorPt.x} cy={cursorPt.y} r={2.2} fill={HEAD} />
            </g>
          )}
          <path data-lead-path d={T.pathD} fill="none" stroke="none" />
          <circle data-lead r={5.5} fill={HEAD} opacity={0} className="pointer-events-none" />
        </svg>
      )}
      {scaleBar && (
        <div className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-2 md:bottom-6 md:right-6" aria-hidden="true">
          <span className="num text-[12px] text-ink-3">{scaleBar.m} m</span>
          <svg width={scaleBar.px.toFixed(0)} height="8">
            <path d={`M0.5 1V7.5H${(scaleBar.px - 0.5).toFixed(1)}V1`} fill="none" stroke="var(--ink-3)" />
          </svg>
        </div>
      )}
    </div>
  );
}
