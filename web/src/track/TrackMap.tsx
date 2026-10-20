import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import type { Store } from "../explorer/store";
import { along, project, trackAspect, wrap, type CircuitRef, type Pad, type Projection, type TrackStraight } from "../lib/track";
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
  /** Size the box from its width so the track fills it edge to edge (default). */
  autoHeight?: boolean;
  maxHeight?: number;
  /** Turn tall circuits a quarter so the track lies wide (default). */
  landscape?: boolean;
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
 * Proportions, measured on the reference render (a 640 px wide track): a driver dot is 13 px,
 * its chip 30 x 15 px with 8 px type, a corner ring 15 px, the road 6.5 px between two hairline
 * edges, the coloured lines 1.5 px with a chevron every ~55 px. Everything scales with the
 * track's drawn width (k = width / 640), so the map looks the same at any size; only the
 * road edges stay hairlines.
 */
const REF_W = 640;
const SIDE = { wide: { l: 36, r: 36, t: 44, b: 44 }, narrow: { l: 22, r: 22, t: 30, b: 30 } };

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

/** Chevron poses along a run, one every `everyPx`, in the direction of travel. */
function chevrons(T: Projection, r: MapRun, everyPx: number): { x: number; y: number; deg: number }[] {
  const len = wrap(r.d1 - r.d0, T.lap) || (r.d1 > r.d0 ? r.d1 - r.d0 : 0);
  const stepM = everyPx * T.mpp;
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
  const autoHeight = props.autoHeight ?? true;
  const maxHeight = props.maxHeight ?? 900;
  const landscape = props.landscape ?? true;
  const [boxRef, { w: W, h: measuredH }] = useSize<HTMLDivElement>();
  const wide = W >= 560;
  const padding = pad ?? (wide ? SIDE.wide : SIDE.narrow);
  const ref2 = useMemo(() => (rotation === undefined ? circuit : circuit ? { ...circuit, rotation } : null), [circuit, rotation]);
  // The box's own height, from the track's aspect at this width (the track fills the width).
  const autoH = useMemo(() => {
    if (!autoHeight || W <= 0) return null;
    const aspect = trackAspect(outline, ref2, landscape);
    return Math.round(Math.min(maxHeight, padding.t + padding.b + (W - padding.l - padding.r) * aspect));
  }, [autoHeight, W, outline, ref2, landscape, maxHeight, padding]);
  const H = autoH ?? measuredH;
  const T = useMemo(() => {
    if (!(W > 0 && H > 0)) return null;
    return project(outline, W, H, padding, ref2, landscape);
  }, [outline, ref2, W, H, padding, landscape]);

  // Scale factor against the reference render, from the track's drawn width. Proportions
  // are taken off the reference crop with the dot as the unit D = 15 k: road edges 0.55 D
  // apart and 0.08 D thick, the middle line 0.06 D, chevrons 0.15 D, corner rings 0.8 D.
  const k = Math.max(0.8, Math.min(2.6, ((W - padding.l - padding.r) / REF_W) * 1.15));
  const D = 15 * k;
  // The ribbon is almost as wide as the dot (the crop: lines 0.85 D apart, 0.11 D thick), so
  // a dot only just covers it and the lines visibly stop at its edge.
  const gap = 0.85 * D;
  const edgeW = Math.max(1, 0.11 * D);
  const outer = gap + edgeW;
  const lineW = Math.max(1, 0.065 * D);
  const chev = 0.14 * D;

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

  // Static tags follow their d from props. Chips sit just above their dot with the dot under
  // one end of the chip (the reference alternates ends); when that spot is taken the chip
  // tries the other end, the centre, then a row up, so none covers another.
  useLayoutEffect(() => {
    if (!T) return;
    const sorted = [...tags].sort((a, b) => wrap(a.d, T.lap) - wrap(b.d, T.lap));
    // Every dot is an obstacle for every chip (a chip must never sit on a neighbour's dot).
    const r = 0.5 * D + 0.1 * D;
    const boxes: { x: number; y: number; w: number; h: number }[] = sorted.map((t) => {
      const q = T.pose(t.d);
      return { x: q.x - r, y: q.y - r, w: 2 * r, h: 2 * r };
    });
    // Corner rings too, when drawn.
    if (corners) for (const c of T.corners) boxes.push({ x: c.lx - 0.4 * D, y: c.ly - 0.4 * D, w: 0.8 * D, h: 0.8 * D });
    const h = 0.7 * D;
    const lift = 0.5 * D + 0.25 * D; // dot radius plus the air above it
    for (const [i, t] of sorted.entries()) {
      const q = T.pose(t.d);
      const el = tagEls.current.get(t.id);
      const chip = el?.querySelector<HTMLElement>(".tmap__tag-chip");
      const w = chip?.offsetWidth || 1.6 * D;
      const end = w * 0.3;
      const first: [number, number][] = i % 2 ? [[end, 0], [-end, 0]] : [[-end, 0], [end, 0]];
      const SLOTS: [number, number][] = [...first, [0, 0], [-end, -(h + 3)], [end, -(h + 3)], [0, -(h + 3)], [-end, -2 * (h + 3)], [end, -2 * (h + 3)]];
      let pick: [number, number] = SLOTS[0];
      for (const [sx, sy] of SLOTS) {
        const bx = q.x + sx - w / 2;
        const by = q.y - lift - h + sy;
        // Its own dot is not an obstacle (index i in `boxes`): the chip is meant to touch it.
        const hit = boxes.some((b, bi) => bi !== i && bx < b.x + b.w + 3 && bx + w + 3 > b.x && by < b.y + b.h + 2 && by + h + 2 > b.y);
        if (!hit) {
          pick = [sx, sy];
          break;
        }
      }
      boxes.push({ x: q.x + pick[0] - w / 2, y: q.y - lift - h + pick[1], w, h });
      placeTag(t.id, t.d);
      el?.style.setProperty("--tx", `${pick[0].toFixed(1)}px`);
      el?.style.setProperty("--ty", `${pick[1].toFixed(1)}px`);
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
    <div ref={boxRef} className={`tmap ${className}`} data-hires={T?.hires ? "1" : "0"} style={{ ["--k" as string]: k.toFixed(3), ["--D" as string]: `${D.toFixed(2)}px`, height: autoH ?? undefined }}>
      {T && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="tmap__svg" role="group" aria-label={label} onPointerMove={onMove}>
          <defs>
            <pattern id="tmap-chequer" width={0.14 * D} height={0.14 * D} patternUnits="userSpaceOnUse">
              <rect width={0.14 * D} height={0.14 * D} fill="#f2f2f4" />
              <rect width={0.07 * D} height={0.07 * D} fill="#212026" />
              <rect x={0.07 * D} y={0.07 * D} width={0.07 * D} height={0.07 * D} fill="#212026" />
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
                      <text x={q.x + q.nx * (outer + 0.6 * D)} y={q.y + q.ny * (outer + 0.6 * D) + 0.2 * D} textAnchor="middle" className="tmap__sid" fontSize={0.42 * D}>
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
            {runs.filter((r) => r.colour !== "transparent").map((r, i) => (
              <path
                key={i}
                d={T.sub(r.d0, Math.min(r.d1, T.lap - 0.01), r.offset ?? 0)}
                stroke={r.colour}
                strokeWidth={r.kind === "band" ? gap - 2 : lineW}
                className={r.kind === "band" ? "tmap__band" : "tmap__line"}
              />
            ))}
          </g>
          {arrows && (
            <g className="tmap__chevrons" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={Math.max(0.8, 0.05 * D)}>
              {runs
                .filter((r) => r.kind !== "band" && r.colour !== "transparent")
                .flatMap((r, i) =>
                  chevrons(T, r, 3.6 * D).map((c, j) => (
                    <path
                      key={`${i}-${j}`}
                      d={`M${(-chev).toFixed(1)},${(-chev).toFixed(1)}L${(chev * 0.4).toFixed(1)},0L${(-chev).toFixed(1)},${chev.toFixed(1)}`}
                      stroke={r.colour}
                      transform={`translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${c.deg.toFixed(1)})`}
                    />
                  )),
                )}
            </g>
          )}

          {/* Ticks: estimates with their interval, drawn quietly in grey so they never compete with a car. */}
          <g className="tmap__ticks" pointerEvents="none">
            {ticks.map((t) => {
              const side = t.side ?? 1;
              const inner = side === 1 ? outer / 2 + 0.08 * D : -(outer / 2 + 0.08 * D);
              const far = side === 1 ? outer / 2 + 0.42 * D : -(outer / 2 + 0.42 * D);
              const tw = Math.max(1, 0.05 * D);
              return (
                <g key={t.id} stroke={t.on ? "#d6d6dc" : "#8a8a93"} fill="none" className={t.on ? "is-on" : ""}>
                  {t.lo !== null && t.lo !== undefined && t.hi !== null && t.hi !== undefined && (
                    <path d={bracket(T, t.lo, t.hi, far - (side === 1 ? 0.12 * D : -0.12 * D), side === 1 ? 0.12 * D : -0.12 * D)} strokeWidth={tw * 0.8} opacity={0.8} />
                  )}
                  <line {...tickLine(T, t.d, inner, far)} strokeWidth={tw} />
                </g>
              );
            })}
          </g>

          {/* Start/finish: the chequer across the road. */}
          {sf && sfPose && (
            <g className="tmap__sf" transform={`translate(${sfPose.x.toFixed(1)},${sfPose.y.toFixed(1)}) rotate(${sfPose.deg.toFixed(1)})`} pointerEvents="none">
              <rect x={-0.14 * D} y={-(gap / 2 + 0.07 * D)} width={0.28 * D} height={gap + 0.14 * D} fill="url(#tmap-chequer)" />
            </g>
          )}

          {/* Corner numbers: outlined circles outside the bend. */}
          {corners && T.corners.length > 0 && (
            <g className="tmap__corners" pointerEvents="none">
              {T.corners.map((c, i) => (
                <g key={`${c.n}-${i}`} transform={`translate(${c.lx.toFixed(1)},${c.ly.toFixed(1)})`}>
                  <circle r={0.4 * D} className="tmap__corner" strokeWidth={Math.max(0.8, 0.05 * D)} />
                  <text y={0.14 * D} textAnchor="middle" className="tmap__corner-n" fontSize={0.4 * D}>
                    {c.n}
                  </text>
                </g>
              ))}
            </g>
          )}

          {sel && cursor && (
            <g ref={dotRef} className="tmap__dot" pointerEvents="none">
              <circle r={gap / 2 + 0.15 * D} className="tmap__dot-ring" />
              <circle r={0.14 * D} className="tmap__dot-core" />
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
          style={{ left: sfPose.x - sfPose.nx * (outer / 2 + 0.55 * D), top: sfPose.y - sfPose.ny * (outer / 2 + 0.55 * D) }}
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
