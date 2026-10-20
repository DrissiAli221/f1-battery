import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { gsap } from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { int } from "../lib/format";
import { along, project, wrap, type Projection, type RegimeRun, type TrackStraight } from "../lib/track";
import { useSize } from "../lib/useSize";
import { prefersReducedMotion } from "../motion";
import type { Outline } from "../lib/types";
import type { Median } from "./data";
import type { Store } from "./store";

gsap.registerPlugin(DrawSVGPlugin);

export const REGIME_VAR: Record<RegimeRun["label"], string> = {
  deploy: "var(--regime-deploy)",
  plateau: "var(--regime-plateau)",
  lift: "var(--regime-lift)",
  brake: "var(--regime-brake)",
  other: "var(--line-strong)",
};

export interface MarkDriver {
  code: string;
  /** Ink for the selected driver, the team colour for the compare driver. */
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
  /** The shown lap's cut-off on the selected straight, lap distance, or null. */
  lapCut: number | null;
  /** The instrument's cursor, metres along the selected straight. */
  cursor: Store<number | null>;
  /** Length of the selected straight as the instrument draws it, m. */
  length: number | null;
  /** Changing this replays the draw-in (one entrance per session). */
  animateKey: string;
}

/** A path along the line from lo to hi at `off` px from it, with short serifs at both ends: the CI bracket. */
function bracket(T: Projection, lo: number, hi: number, off: number, serif: number): string {
  let a = lo;
  let b = hi;
  // Never let an interval read as a point: at least 8 px long.
  if (wrap(b - a, T.lap) / T.mpp < 8) {
    const mid = a + wrap(b - a, T.lap) / 2;
    a = mid - 4 * T.mpp;
    b = mid + 4 * T.mpp;
  }
  const p0 = T.pose(a);
  const p1 = T.pose(b);
  const s0 = `M${(p0.x + p0.nx * (off - serif)).toFixed(1)},${(p0.y + p0.ny * (off - serif)).toFixed(1)}`;
  const s1 = `L${(p1.x + p1.nx * (off - serif)).toFixed(1)},${(p1.y + p1.ny * (off - serif)).toFixed(1)}`;
  return `${s0}L${T.sub(a, b, off).slice(1)}${s1}`;
}

function tick(T: Projection, d: number, a: number, b: number) {
  const q = T.pose(d);
  return { x1: q.x + q.nx * a, y1: q.y + q.ny * a, x2: q.x + q.nx * b, y2: q.y + q.ny * b };
}

/*
 * The circuit as an instrument drawing, not a broadcast graphic: a hairline road, the shown
 * lap's regimes along it, the straights as thick segments you can pick, the median cut-off of
 * each driver as a tick with its bootstrap bracket (selected driver inside the loop in ink,
 * compare driver outside in team colour), and the cursor dot bound to the straight.
 */
export function TrackMap(props: Props) {
  const { outline, straights, runs, primary, compare, selected, onSelect, lapCut, cursor, length, animateKey } = props;
  const [boxRef, { w: W, h: H }] = useSize<HTMLDivElement>();
  const wide = W >= 560;
  const T = useMemo(
    () => (W > 0 && H > 0 ? project(outline, W, H, wide ? { l: 72, r: 72, t: 56, b: 56 } : { l: 40, r: 40, t: 36, b: 36 }) : null),
    [outline, W, H, wide],
  );
  const sel = straights.find((s) => s.straight_id === selected) ?? null;
  const svgRef = useRef<SVGSVGElement>(null);
  const dotRef = useRef<SVGGElement>(null);
  const lapRef = useRef<SVGPathElement>(null);

  // One entrance per session: the road draws along the direction of travel, then the marks.
  const drawn = useRef<string | null>(null);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || !T || drawn.current === animateKey || prefersReducedMotion()) return;
    drawn.current = animateKey;
    const q = (sel: string) => Array.from(svg.querySelectorAll(sel));
    const tl = gsap.timeline();
    tl.fromTo(q("[data-draw]"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 1.4, ease: "taper" }, 0);
    tl.from(q("[data-late]"), { opacity: 0, duration: 0.6, stagger: 0.04, ease: "power3.out" }, 0.9);
    tl.eventCallback("onComplete", () => {
      gsap.set(q("[data-draw]"), { clearProps: "strokeDasharray,strokeDashoffset" });
    });
    return () => {
      if (tl.progress() < 1) drawn.current = null;
      tl.progress(1).kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateKey, T !== null]);

  // The cursor dot follows the instrument's d with its own short ease (no React render per move).
  useEffect(() => {
    const g = dotRef.current;
    if (!g || !T || !sel) return;
    const o = { d: cursor.get() ?? 0 };
    const place = () => {
      const p = T.at(sel.d0 + Math.max(0, Math.min(length ?? sel.len, o.d)));
      g.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    };
    place();
    let tw: gsap.core.Tween | null = null;
    const unsub = cursor.subscribe(() => {
      const d = cursor.get();
      if (d === null) return;
      tw?.kill();
      if (prefersReducedMotion()) {
        o.d = d;
        place();
        return;
      }
      tw = gsap.to(o, { d, duration: 0.6, ease: "expo.out", onUpdate: place });
    });
    return () => {
      unsub();
      tw?.kill();
    };
  }, [T, sel, cursor, length]);

  // The lap's cut-off glides between laps rather than jumping.
  const lapD = useRef<number | null>(null);
  useEffect(() => {
    const el = lapRef.current;
    if (!el || !T || lapCut === null) {
      lapD.current = lapCut;
      return;
    }
    const place = (d: number) => {
      const p = T.pose(d);
      el.setAttribute("transform", `translate(${(p.x + p.nx * 9).toFixed(1)},${(p.y + p.ny * 9).toFixed(1)}) rotate(${(p.deg + 90).toFixed(1)})`);
    };
    const from = lapD.current;
    lapD.current = lapCut;
    if (from === null || Math.abs(from - lapCut) > 400 || prefersReducedMotion()) {
      place(lapCut);
      return;
    }
    const o = { d: from };
    const tw = gsap.to(o, { d: lapCut, duration: 0.4, ease: "power3.out", onUpdate: () => place(o.d) });
    return () => {
      tw.kill();
    };
  }, [lapCut, T]);

  const scale = useMemo(() => {
    if (!T) return null;
    const target = 90 * T.mpp;
    const m = [50, 100, 200, 250, 500, 1000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    return { m, px: m / T.mpp };
  }, [T]);

  // Pointer over the selected straight moves the instrument's cursor (fine pointers only).
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!T || !sel || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const n = T.nearest(e.clientX - r.left, e.clientY - r.top);
    if (n.dist > 28) return;
    const a = along(sel, n.d, T.lap);
    const L = length ?? sel.len;
    if (a >= 0 && a <= L) cursor.set(a);
  };

  const label = (s: TrackStraight) => {
    if (!T) return null;
    const q = T.pose(s.mid);
    const off = wide ? 26 : 18;
    const x = q.x - q.nx * off;
    const y = q.y - q.ny * off;
    const anchor: "start" | "end" | "middle" = -q.nx > 0.35 ? "start" : -q.nx < -0.35 ? "end" : "middle";
    const dy = -q.ny > 0.35 ? 12 : -q.ny < -0.35 ? -4 : 4;
    return { x, y: y + dy, anchor };
  };

  const sf = T ? T.pose(0) : null;

  return (
    <div ref={boxRef} className="xp-map">
      {T && (
        <svg
          ref={svgRef}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="xp-map__svg"
          role="group"
          aria-label={`Track map. Straights are buttons; ${primary.code}'s median cut-off is marked on each${compare ? `, ${compare.code}'s on the outside of the line` : ""}.`}
          onPointerMove={onMove}
        >
          {/* The road: a hairline, then the shown lap's regimes along it. */}
          <path data-draw d={T.pathD} className="xp-map__road" />
          <g fill="none">
            {runs.map((r) => (
              <path
                key={`${r.d0}-${r.label}`}
                data-draw
                d={T.sub(r.d0, Math.min(r.d1, T.lap - 0.01))}
                stroke={REGIME_VAR[r.label]}
                strokeWidth={r.label === "other" ? 1 : wide ? 2.5 : 2}
                strokeLinejoin="round"
              />
            ))}
          </g>

          {/* Straights: thick segments under the regime line, each a button with its name. */}
          {straights.map((s) => {
            const has = !!primary.medians?.has(s.straight_id);
            const on = s.straight_id === selected;
            const l = label(s);
            return (
              <g
                key={s.straight_id}
                data-late
                className={`xp-map__seg ${on ? "is-on" : ""} ${has ? "" : "is-empty"}`}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={`S${s.straight_id}, ${s.label}${has ? "" : `, no cut-off for ${primary.code}`}`}
                onClick={() => onSelect(s.straight_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(s.straight_id);
                  }
                }}
              >
                <path d={T.sub(s.d0, s.d1)} className="xp-map__hit" />
                <path d={T.sub(s.d0, s.d1)} className="xp-map__band" />
                {l && (
                  <text x={l.x} y={l.y} textAnchor={l.anchor} className="xp-map__name">
                    <tspan className="xp-map__sid">S{s.straight_id}</tspan>
                    {wide && <tspan dx="6">{s.label}</tspan>}
                  </text>
                )}
              </g>
            );
          })}

          {/* Median cut-offs with their bootstrap brackets: estimates, drawn with their construction. */}
          <g className="xp-map__marks" pointerEvents="none">
            {straights.map((s) => {
              const mp = primary.medians?.get(s.straight_id);
              const mc = compare?.medians?.get(s.straight_id);
              return (
                <g key={s.straight_id} data-late>
                  {compare && mc && (
                    <g stroke={compare.colour} fill="none">
                      {mc.lo !== null && mc.hi !== null && <path d={bracket(T, mc.lo, mc.hi, -12, -4)} strokeWidth={1.25} />}
                      <line {...tick(T, mc.m, -3, -16)} strokeWidth={2} />
                    </g>
                  )}
                  {mp && (
                    <g stroke={primary.colour} fill="none">
                      {mp.lo !== null && mp.hi !== null && <path d={bracket(T, mp.lo, mp.hi, 12, 4)} strokeWidth={1.25} />}
                      <line {...tick(T, mp.m, 3, 16)} strokeWidth={2} />
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          {/* Start/finish: a short bar across the line. */}
          {sf && (
            <g data-late pointerEvents="none">
              <line {...tick(T, 0, -9, 9)} className="xp-map__sf" />
              <text x={sf.x - sf.nx * 22} y={sf.y - sf.ny * 22 + 4} textAnchor="middle" className="xp-map__sid">
                S/F
              </text>
            </g>
          )}

          {lapCut !== null && <path ref={lapRef} data-late d="M0,-5L4.5,3H-4.5Z" className="xp-map__lapcut" pointerEvents="none" />}

          {sel && (
            <g ref={dotRef} className="xp-map__dot" pointerEvents="none">
              <circle r={9} className="xp-map__dot-ring" />
              <circle r={4} className="xp-map__dot-core" />
            </g>
          )}
        </svg>
      )}
      {scale && (
        <div className="xp-map__scale" aria-hidden="true">
          <svg width={scale.px.toFixed(0)} height="7">
            <path d={`M0.5 0V6.5H${(scale.px - 0.5).toFixed(1)}V0`} fill="none" stroke="currentColor" />
          </svg>
          <span>{int(scale.m)}&nbsp;m</span>
        </div>
      )}
    </div>
  );
}
