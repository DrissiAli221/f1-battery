import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import type { Store } from "../explorer/store";
import { along, project, wrap, type CircuitRef, type Pad, type Projection, type TrackStraight } from "../lib/track";
import { useSize } from "../lib/useSize";
import { prefersReducedMotion } from "../motion";
import type { Outline } from "../lib/types";
import "./track.css";

/** A coloured line down the middle of the road (a regime, a car's trail, a driver's line). */
export interface MapRun {
  d0: number;
  d1: number;
  colour: string;
  /** Sideways offset in px along the road's normal, so two drivers' lines run side by side. */
  offset?: number;
  /** "band": a wider, fainter run under the lines (the lit straight). */
  kind?: "trail" | "band";
}

/** A driver: a team-colour dot on the line with the code tag above it. */
export interface MapTag {
  id: number | string;
  code: string;
  colour: string;
  d: number;
  /** Lower emphasis (retired, not selected): grey. */
  dim?: boolean;
  /** Raised emphasis (the selected driver). */
  on?: boolean;
  /** Extra text in the tag after the code (a value), optional. */
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
  /** Direction chevrons along the coloured lines. */
  arrows?: boolean;
  /** Start/finish marker with its label. */
  sf?: boolean;
  /** Label the straights (S1, S2, ...) on the map. */
  straightLabels?: boolean;
  /** Kept for callers; the reference look has neither. */
  compass?: boolean;
  scale?: boolean;
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

/*
 * Pixel proportions, read off the reference (DESIGN.md v3): the road is two 1.75 px light
 * lines 11 px apart with the ground showing between them; the coloured lines in the middle
 * are 2 px with a chevron every ~64 px; a driver is a 16 px dot with a 2.5 px ground-colour
 * ring that visibly cuts the road lines, and its tag sits above; corner numbers are 18 px
 * outlined circles outside the bend.
 */
const GAP = 11;
const EDGE = 1.75;
const LINE = 2;
const CHEVRON_PX = 64;
const SIDE = { wide: { l: 44, r: 44, t: 40, b: 40 }, narrow: { l: 28, r: 28, t: 28, b: 28 } };

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

/** Chevron poses along a run, one every CHEVRON_PX, in the direction of travel. */
function chevrons(T: Projection, r: MapRun): { x: number; y: number; deg: number }[] {
  const len = wrap(r.d1 - r.d0, T.lap) || (r.d1 > r.d0 ? r.d1 - r.d0 : 0);
  const stepM = CHEVRON_PX * T.mpp;
  const out: { x: number; y: number; deg: number }[] = [];
  if (len < stepM * 0.6) return out;
  const n = Math.floor(len / stepM);
  const start = (len - n * stepM) / 2 + stepM / 2;
  for (let i = 0; i < n; i++) {
    const q = T.pose(r.d0 + start + i * stepM);
    out.push({ x: q.x + q.nx * (r.offset ?? 0), y: q.y + q.ny * (r.offset ?? 0), deg: q.deg });
  }
  return out;
}

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
    arrows = true,
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

  const gap = wide ? GAP : GAP - 2;
  const outer = gap + 2 * EDGE;

  // Tags: HTML, positioned from the ticker (live) or from props (static).
  const tagEls = useRef(new Map<number | string, HTMLDivElement>());
  const placeTag = (id: number | string, d: number) => {
    const el = tagEls.current.get(id);
    if (!el || !T) return;
    const q = T.pose(d);
    el.style.setProperty("--x", `${q.x.toFixed(1)}px`);
    el.style.setProperty("--y", `${q.y.toFixed(1)}px`);
  };
  useImperativeHandle(ref, () => ({ place: placeTag, projection: () => T }), [T]);

  // Static tags follow their d from props. Chips are laid out so none covers another: each
  // tries the slots above its dot in order (centred, then left and right, then a row up).
  useLayoutEffect(() => {
    if (!T) return;
    const sorted = [...tags].sort((a, b) => wrap(a.d, T.lap) - wrap(b.d, T.lap));
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const SLOTS: [number, number][] = [[0, 0], [-24, -6], [24, -6], [0, -22], [-24, -28], [24, -28], [0, -44], [-24, -50], [24, -50]];
    for (const t of sorted) {
      const q = T.pose(t.d);
      const el = tagEls.current.get(t.id);
      const chip = el?.querySelector<HTMLElement>(".tmap__tag-chip");
      const w = chip?.offsetWidth || 36;
      const h = 18;
      let pick: [number, number] = SLOTS[0];
      for (const [sx, sy] of SLOTS) {
        const bx = q.x + sx - w / 2;
        const by = q.y - 13 - h + sy;
        const hit = boxes.some((b) => bx < b.x + b.w + 4 && bx + w + 4 > b.x && by < b.y + b.h + 3 && by + h + 3 > b.y);
        if (!hit) {
          pick = [sx, sy];
          break;
        }
      }
      boxes.push({ x: q.x + pick[0] - w / 2, y: q.y - 13 - h + pick[1], w, h });
      placeTag(t.id, t.d);
      el?.style.setProperty("--tx", `${pick[0]}px`);
      el?.style.setProperty("--ty", `${pick[1]}px`);
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

  const sfPose = T ? T.pose(0) : null;
  const sel = straights.find((s) => s.straight_id === selected) ?? null;
  const sfLabelPos = sfPose ? (Math.abs(sfPose.nx) > Math.abs(sfPose.ny) ? (sfPose.nx < 0 ? "right" : "left") : sfPose.ny < 0 ? "below" : "above") : "below";

  return (
    <div ref={boxRef} className={`tmap ${className}`} data-hires={T?.hires ? "1" : "0"}>
      {T && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="tmap__svg" role="group" aria-label={label} onPointerMove={onMove}>
          <defs>
            <pattern id="tmap-chequer" width="5" height="5" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" fill="#f2f2f4" />
              <rect width="2.5" height="2.5" fill="#111114" />
              <rect x="2.5" y="2.5" width="2.5" height="2.5" fill="#111114" />
            </pattern>
          </defs>

          {/* The road: two thin light lines, the ground between them. */}
          <path d={T.pathD} className="tmap__edge" strokeWidth={outer} />
          <path d={T.pathD} className="tmap__ground" strokeWidth={gap} />

          {/* Straights: pickable; the selected one brightens its edges. */}
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
                    <path d={d} className="tmap__hit" strokeWidth={outer + 12} />
                    <path d={d} className="tmap__lit" strokeWidth={outer} />
                    <path d={d} className="tmap__lit-ground" strokeWidth={gap} />
                    {straightLabels && (
                      <text x={q.x - q.nx * (outer + 12)} y={q.y - q.ny * (outer + 12) + 4} textAnchor="middle" className="tmap__sid">
                        S{s.straight_id}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* Colour down the middle: regimes, trails, drivers' lines, with direction chevrons. */}
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {runs.map((r, i) => (
              <path
                key={i}
                d={T.sub(r.d0, Math.min(r.d1, T.lap - 0.01), r.offset ?? 0)}
                stroke={r.colour}
                strokeWidth={r.kind === "band" ? gap - 2 : LINE}
                className={r.kind === "band" ? "tmap__band" : "tmap__line"}
              />
            ))}
          </g>
          {arrows && (
            <g className="tmap__chevrons" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
              {runs
                .filter((r) => r.kind !== "band")
                .flatMap((r, i) =>
                  chevrons(T, r).map((c, j) => (
                    <path key={`${i}-${j}`} d="M-2.5,-2.5L1,0L-2.5,2.5" stroke={r.colour} transform={`translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${c.deg.toFixed(1)})`} />
                  )),
                )}
            </g>
          )}

          {/* Ticks: estimates with their interval. */}
          <g className="tmap__ticks" pointerEvents="none">
            {ticks.map((t) => {
              const side = t.side ?? 1;
              const inner = side === 1 ? outer / 2 + 2 : -(outer / 2 + 2);
              const far = side === 1 ? outer / 2 + 11 : -(outer / 2 + 11);
              return (
                <g key={t.id} stroke={t.colour} fill="none" className={t.on ? "is-on" : ""}>
                  {t.lo !== null && t.lo !== undefined && t.hi !== null && t.hi !== undefined && (
                    <path d={bracket(T, t.lo, t.hi, far - (side === 1 ? 3 : -3), side === 1 ? 3 : -3)} strokeWidth={1.25} opacity={0.9} />
                  )}
                  <line {...tickLine(T, t.d, inner, far)} strokeWidth={t.on ? 2.5 : 2} />
                </g>
              );
            })}
          </g>

          {/* Start/finish: the chequer across the road. */}
          {sf && sfPose && (
            <g className="tmap__sf" transform={`translate(${sfPose.x.toFixed(1)},${sfPose.y.toFixed(1)}) rotate(${sfPose.deg.toFixed(1)})`} pointerEvents="none">
              <rect x={-2.5} y={-(gap / 2 + 1)} width={5} height={gap + 2} fill="url(#tmap-chequer)" />
            </g>
          )}

          {/* Corner numbers: outlined circles outside the bend. */}
          {corners && T.corners.length > 0 && (
            <g className="tmap__corners" pointerEvents="none">
              {T.corners.map((c, i) => (
                <g key={`${c.n}-${i}`} transform={`translate(${c.lx.toFixed(1)},${c.ly.toFixed(1)})`}>
                  <circle r={wide ? 9 : 7.5} className="tmap__corner" />
                  <text y={wide ? 3.5 : 3} textAnchor="middle" className="tmap__corner-n">
                    {c.n}
                  </text>
                </g>
              ))}
            </g>
          )}

          {sel && cursor && (
            <g ref={dotRef} className="tmap__dot" pointerEvents="none">
              <circle r={gap / 2 + 3} className="tmap__dot-ring" />
              <circle r={3} className="tmap__dot-core" />
            </g>
          )}
        </svg>
      )}

      {/* Drivers: the dot on the line and the tag above, in HTML so the type stays crisp. */}
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
          style={{ left: sfPose.x - sfPose.nx * (outer / 2 + 12), top: sfPose.y - sfPose.ny * (outer / 2 + 12) }}
          data-pos={sfLabelPos}
          aria-hidden="true"
        >
          Start / Finish
        </span>
      )}
      {children}
    </div>
  );
});
