import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import type { Store } from "../explorer/store";
import { int } from "../lib/format";
import { along, project, wrap, type CircuitRef, type Pad, type Projection, type TrackStraight } from "../lib/track";
import { useSize } from "../lib/useSize";
import { prefersReducedMotion } from "../motion";
import type { Outline } from "../lib/types";
import "./track.css";

/** A coloured run along the road (a regime, a car's trail, a lit straight). */
export interface MapRun {
  d0: number;
  d1: number;
  colour: string;
  /** Stroke width class: "trail" (inside the road) or "band" (over the road). */
  kind?: "trail" | "band";
}

/** A driver tag: the chip with the code, pinned to the road at lap distance d. */
export interface MapTag {
  id: number | string;
  code: string;
  colour: string;
  d: number;
  /** Lower emphasis (retired, not selected). */
  dim?: boolean;
  /** Raised emphasis (the selected driver). */
  on?: boolean;
  /** Extra text under the code (a value), optional. */
  note?: string;
}

/** A tick across the road with an optional bracket: an estimate drawn with its interval. */
export interface MapTick {
  id: number | string;
  d: number;
  lo?: number | null;
  hi?: number | null;
  colour: string;
  /** Outside (1, default) or inside (-1) of the loop. */
  side?: 1 | -1;
  on?: boolean;
}

export interface TrackMapProps {
  outline: Outline;
  /** Circuit reference (corners, centreline, orientation); null draws from the outline alone. */
  circuit?: CircuitRef | null;
  straights?: TrackStraight[];
  selected?: number | null;
  onSelect?: (id: number) => void;
  runs?: MapRun[];
  tags?: MapTag[];
  ticks?: MapTick[];
  /** A cursor dot bound to a straight: `store` holds metres along it. */
  cursor?: { store: Store<number | null>; straight: TrackStraight | null; length?: number | null } | null;
  corners?: boolean;
  compass?: boolean;
  scale?: boolean;
  /** Start/finish marker with its label. */
  sf?: boolean;
  /** Label the straights (S1, S2, ...) on the map. */
  straightLabels?: boolean;
  pad?: Pad;
  /** Overrides the reference orientation (degrees), for testing or a fixed layout. */
  rotation?: number | null;
  className?: string;
  label?: string;
  children?: ReactNode;
}

/** Imperative placement of tags, for feeds that move faster than React should render. */
export interface TrackMapHandle {
  /** Place a tag at lap distance d (px computed here; no render). */
  place(id: number | string, d: number): void;
  projection(): Projection | null;
}

const SIDE = { wide: { l: 56, r: 56, t: 48, b: 48 }, narrow: { l: 34, r: 34, t: 30, b: 30 } };

function tickLine(T: Projection, d: number, a: number, b: number) {
  const q = T.pose(d);
  return { x1: q.x + q.nx * a, y1: q.y + q.ny * a, x2: q.x + q.nx * b, y2: q.y + q.ny * b };
}

function bracket(T: Projection, lo: number, hi: number, off: number, serif: number): string {
  let a = lo;
  let b = hi;
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

/*
 * The track map (DESIGN.md v3): a road, not a hairline. A light edge under a dark asphalt
 * body with round joins, the official corner numbers in circles where the circuit guide puts
 * them, a chequered start/finish marker, a compass and a scale. Colour runs inside the road:
 * regimes, a car's trail, the lit straight. Drivers are tags (team-colour chips) pinned to
 * the line with a dot and a short leader; estimates are ticks with their interval bracket.
 *
 * Geometry comes from lib/track.ts `project`: the road is the reference centreline when the
 * circuit has one, and every lap distance is snapped onto it. Entrance is a fade; nothing
 * draws itself in.
 */
export const TrackMap = forwardRef<TrackMapHandle, TrackMapProps>(function TrackMap(props, ref) {
  const {
    outline,
    circuit = null,
    straights = [],
    selected = null,
    onSelect,
    runs = [],
    tags = [],
    ticks = [],
    cursor = null,
    corners = true,
    compass = true,
    scale = true,
    sf = true,
    straightLabels = false,
    pad,
    rotation,
    className = "",
    label = "Track map",
    children,
  } = props;
  const [boxRef, { w: W, h: H }] = useSize<HTMLDivElement>();
  const wide = W >= 560;
  const T = useMemo(() => {
    if (!(W > 0 && H > 0)) return null;
    const ref2 = rotation === undefined ? circuit : circuit ? { ...circuit, rotation } : null;
    return project(outline, W, H, pad ?? (wide ? SIDE.wide : SIDE.narrow), ref2);
  }, [outline, circuit, W, H, wide, pad, rotation]);

  const road = wide ? 12 : 9;
  const edge = road + 3;
  const trail = Math.max(3, road - 6);

  // Tags: HTML, positioned from the ticker (live) or from props (static).
  const tagEls = useRef(new Map<number | string, HTMLDivElement>());
  const placeTag = (id: number | string, d: number) => {
    const el = tagEls.current.get(id);
    if (!el || !T) return;
    const q = T.pose(d);
    el.style.setProperty("--x", `${q.x.toFixed(1)}px`);
    el.style.setProperty("--y", `${q.y.toFixed(1)}px`);
    // The chip sits outside the loop, along the normal; the leader points back at the dot.
    const side = -1;
    const ox = q.nx * side;
    const oy = q.ny * side;
    el.style.setProperty("--ox", ox.toFixed(3));
    el.style.setProperty("--oy", oy.toFixed(3));
    el.dataset.pos = Math.abs(ox) > Math.abs(oy) ? (ox > 0 ? "right" : "left") : oy > 0 ? "below" : "above";
  };
  useImperativeHandle(ref, () => ({ place: placeTag, projection: () => T }), [T]);

  // Static tags follow their d from props; stacked away from the road when they would overlap.
  useLayoutEffect(() => {
    if (!T) return;
    const sorted = [...tags].sort((a, b) => wrap(a.d, T.lap) - wrap(b.d, T.lap));
    const placed: { x: number; y: number; level: number }[] = [];
    for (const t of sorted) {
      const q = T.pose(t.d);
      let level = 0;
      for (const p of placed) if (Math.hypot(p.x - q.x, p.y - q.y) < 26) level = Math.max(level, p.level + 1);
      placed.push({ x: q.x, y: q.y, level });
      placeTag(t.id, t.d);
      tagEls.current.get(t.id)?.style.setProperty("--level", String(level));
    }
  });

  // The cursor dot eases toward the store's value on its own, no render per move.
  const dotRef = useRef<SVGGElement>(null);
  useEffect(() => {
    const g = dotRef.current;
    const s = cursor?.straight;
    if (!g || !T || !cursor || !s) return;
    const L = cursor.length ?? s.len;
    const o = { d: cursor.store.get() ?? 0 };
    const place = () => {
      const p = T.at(s.d0 + Math.max(0, Math.min(L, o.d)));
      g.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    };
    place();
    let tw: gsap.core.Tween | null = null;
    const unsub = cursor.store.subscribe(() => {
      const d = cursor.store.get();
      if (d === null) return;
      tw?.kill();
      if (prefersReducedMotion()) {
        o.d = d;
        place();
        return;
      }
      tw = gsap.to(o, { d, duration: 0.5, ease: "expo.out", onUpdate: place });
    });
    return () => {
      unsub();
      tw?.kill();
    };
  }, [T, cursor]);

  // Pointer over the bound straight moves the cursor (fine pointers only).
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const s = cursor?.straight;
    if (!T || !cursor || !s || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const n = T.nearest(e.clientX - r.left, e.clientY - r.top);
    if (n.dist > 24) return;
    const a = along(s, n.d, T.lap);
    const L = cursor.length ?? s.len;
    if (a >= 0 && a <= L) cursor.store.set(a);
  };

  const scaleBar = useMemo(() => {
    if (!T) return null;
    const target = 80 * T.mpp;
    const m = [50, 100, 200, 250, 500, 1000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    return { m, px: m / T.mpp };
  }, [T]);

  const sfPose = T ? T.pose(0) : null;
  const sel = straights.find((s) => s.straight_id === selected) ?? null;

  return (
    <div ref={boxRef} className={`tmap ${className}`} data-hires={T?.hires ? "1" : "0"}>
      {T && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="tmap__svg" role="group" aria-label={label} onPointerMove={onMove}>
          <defs>
            <pattern id="tmap-chequer" width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="3" height="3" fill="#fff" />
              <rect x="3" y="3" width="3" height="3" fill="#fff" />
              <rect x="3" width="3" height="3" fill="#111" />
              <rect y="3" width="3" height="3" fill="#111" />
            </pattern>
          </defs>

          {/* The road. */}
          <path d={T.pathD} className="tmap__edge" strokeWidth={edge} />
          <path d={T.pathD} className="tmap__body" strokeWidth={road} />

          {/* Straights: pickable, the selected one lit along its edge. */}
          {straights.length > 0 && (
            <g className="tmap__straights">
              {straights.map((s) => {
                const on = s.straight_id === selected;
                const d = T.sub(s.d0, s.d1);
                const q = T.pose(s.mid);
                return (
                  <g
                    key={s.straight_id}
                    className={`tmap__straight ${on ? "is-on" : ""} ${onSelect ? "is-pick" : ""}`}
                    role={onSelect ? "button" : undefined}
                    tabIndex={onSelect ? 0 : undefined}
                    aria-pressed={onSelect ? on : undefined}
                    aria-label={`S${s.straight_id} ${s.label ?? ""}`.trim()}
                    onClick={onSelect ? () => onSelect(s.straight_id) : undefined}
                    onKeyDown={
                      onSelect
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelect(s.straight_id);
                            }
                          }
                        : undefined
                    }
                  >
                    <path d={d} className="tmap__hit" strokeWidth={edge + 10} />
                    <path d={d} className="tmap__lit" strokeWidth={edge} />
                    <path d={d} className="tmap__lit-body" strokeWidth={road} />
                    {straightLabels && (
                      <text x={q.x - q.nx * (edge + 10)} y={q.y - q.ny * (edge + 10) + 4} textAnchor="middle" className="tmap__sid">
                        S{s.straight_id}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* Colour inside the road: regimes, trails, bands. */}
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {runs.map((r, i) => (
              <path
                key={i}
                d={T.sub(r.d0, Math.min(r.d1, T.lap - 0.01))}
                stroke={r.colour}
                strokeWidth={r.kind === "band" ? road : trail}
                className={r.kind === "band" ? "tmap__band" : "tmap__trail"}
              />
            ))}
          </g>

          {/* Ticks: estimates with their interval. */}
          <g className="tmap__ticks" pointerEvents="none">
            {ticks.map((t) => {
              const side = t.side ?? 1;
              const inner = side === 1 ? edge / 2 + 3 : -(edge / 2 + 3);
              const outer = side === 1 ? edge / 2 + 13 : -(edge / 2 + 13);
              return (
                <g key={t.id} stroke={t.colour} fill="none" className={t.on ? "is-on" : ""}>
                  {t.lo !== null && t.lo !== undefined && t.hi !== null && t.hi !== undefined && (
                    <path d={bracket(T, t.lo, t.hi, outer - (side === 1 ? 3 : -3), side === 1 ? 3 : -3)} strokeWidth={1.25} opacity={0.9} />
                  )}
                  <line {...tickLine(T, t.d, inner, outer)} strokeWidth={t.on ? 2.5 : 2} />
                </g>
              );
            })}
          </g>

          {/* Start/finish: a chequered bar across the road. */}
          {sf && sfPose && (
            <g className="tmap__sf" transform={`translate(${sfPose.x.toFixed(1)},${sfPose.y.toFixed(1)}) rotate(${sfPose.deg.toFixed(1)})`} pointerEvents="none">
              <rect x={-2.5} y={-(edge / 2 + 2)} width={5} height={edge + 4} fill="url(#tmap-chequer)" />
              <rect x={-2.5} y={-(edge / 2 + 2)} width={5} height={edge + 4} fill="none" stroke="#fff" strokeWidth={0.75} />
            </g>
          )}

          {/* Corner numbers, where the circuit guide puts them. */}
          {corners && T.corners.length > 0 && (
            <g className="tmap__corners" pointerEvents="none">
              {T.corners.map((c, i) => (
                <g key={`${c.n}-${i}`} transform={`translate(${c.lx.toFixed(1)},${c.ly.toFixed(1)})`}>
                  <circle r={wide ? 9.5 : 8} className="tmap__corner" />
                  <text y={wide ? 3.5 : 3} textAnchor="middle" className="tmap__corner-n">
                    {c.n}
                  </text>
                </g>
              ))}
            </g>
          )}

          {sel && cursor && (
            <g ref={dotRef} className="tmap__dot" pointerEvents="none">
              <circle r={road / 2 + 4} className="tmap__dot-ring" />
              <circle r={3.5} className="tmap__dot-core" />
            </g>
          )}
        </svg>
      )}

      {/* Tags, in HTML so the type stays crisp. */}
      {T && tags.length > 0 && (
        <div className="tmap__tags" aria-hidden="true">
          {tags.map((t) => (
            <div
              key={t.id}
              ref={(el) => {
                if (el) tagEls.current.set(t.id, el);
                else tagEls.current.delete(t.id);
              }}
              className={`tmap__tag ${t.on ? "is-on" : ""} ${t.dim ? "is-dim" : ""}`}
              style={{ ["--team" as string]: t.colour }}
            >
              <i className="tmap__tag-dot" />
              <i className="tmap__tag-lead" />
              <span className="tmap__tag-chip">
                {t.code}
                {t.note && <small>{t.note}</small>}
              </span>
            </div>
          ))}
        </div>
      )}

      {sf && sfPose && T && (
        <span
          className="tmap__sf-label"
          style={{ left: sfPose.x - sfPose.nx * (edge + 14), top: sfPose.y - sfPose.ny * (edge + 14) }}
          data-pos={Math.abs(sfPose.nx) > Math.abs(sfPose.ny) ? (sfPose.nx < 0 ? "right" : "left") : sfPose.ny < 0 ? "below" : "above"}
          aria-hidden="true"
        >
          Start / Finish
        </span>
      )}

      {compass && T?.north && (
        <div className="tmap__compass" aria-hidden="true" style={{ ["--rot" as string]: `${(Math.atan2(T.north.x, -T.north.y) * 180) / Math.PI}deg` }}>
          <svg viewBox="0 0 32 32" width="32" height="32">
            <circle cx="16" cy="16" r="15" />
            <path d="M16 4 L20 16 L16 13 L12 16 Z" className="tmap__compass-n" />
            <path d="M16 28 L20 16 L16 19 L12 16 Z" className="tmap__compass-s" />
          </svg>
          <b>N</b>
        </div>
      )}

      {scale && scaleBar && (
        <div className="tmap__scale" aria-hidden="true">
          <svg width={scaleBar.px.toFixed(0)} height="7">
            <path d={`M0.5 0V6.5H${(scaleBar.px - 0.5).toFixed(1)}V0`} fill="none" stroke="currentColor" />
          </svg>
          <span>{int(scaleBar.m)} m</span>
        </div>
      )}
      {children}
    </div>
  );
});
