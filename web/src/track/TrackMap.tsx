import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  /** Faded: context, not the thing being looked at. */
  dim?: boolean;
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

/** A quiet marker across the road with a small grey label: a field value, an estimate. */
export interface MapPin {
  id: number | string;
  d: number;
  text: string;
}

/** A grey chip pinned to the road at a lap distance: a name for a stretch. */
export interface MapLabel {
  id: number | string;
  d: number;
  text: string;
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
  /** Pointer over this straight reports metres along it and the pointer's place in the box (null on leave). */
  hover?: { straight: TrackStraight; length?: number | null; onHover: (m: number | null, at: { x: number; y: number } | null) => void } | null;
  pins?: MapPin[];
  labels?: MapLabel[];
  corners?: boolean;
  /** Direction chevrons along the coloured lines. */
  arrows?: boolean;
  /** Start/finish marker with its label. */
  sf?: boolean;
  /** Label the straights (S1, S2, ...) on the map. */
  straightLabels?: boolean;
  /** A second, muted line under the picked straight's label (e.g. a driver with no cut-off there). */
  sectionNote?: string | null;
  /** Straights that have data; the others' chips are drawn quieter (null: all have data). */
  straightsWithData?: Set<number> | null;
  /** Cross-fade the coloured line when it changes (a new lap), rather than swapping it. */
  crossfadeLines?: boolean;
  /** Kept for callers; the reference look has neither. */
  compass?: boolean;
  scale?: boolean;
  /** Size the box from its width so the track fills it edge to edge (default). */
  autoHeight?: boolean;
  maxHeight?: number;
  /** Turn tall circuits a quarter so the track lies wide (default). */
  landscape?: boolean;
  /** Multiplies the element scale (dots, chips, lines) without changing the track's fit. */
  zoom?: number;
  /** Multiplies only the markers (dots and chips), leaving the road, rings and lines alone. */
  markerScale?: number;
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
const SIDE = { wide: { l: 56, r: 56, t: 52, b: 52 }, narrow: { l: 28, r: 28, t: 34, b: 34 } };

/** Relative luminance of a #rrggbb colour; chips on light colours take dark type. */
function isLight(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

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

/*
 * Runs shorter than `minM` (one 50 m model bin, or a trail flicker) take the colour of their
 * longer touching neighbour, then touching runs of the same look merge, so the middle line
 * changes colour in clean stretches instead of flickering. Display only: the data behind a
 * run is untouched, and anything a bin long or longer keeps its own colour.
 */
function smoothRuns(runs: MapRun[], lap: number, minM = 60): MapRun[] {
  const out: MapRun[] = [];
  const groups = new Map<string, MapRun[]>();
  for (const r of runs) {
    if (r.kind === "band" || r.colour === "transparent") {
      out.push(r);
      continue;
    }
    const key = String(r.offset ?? 0);
    groups.set(key, [...(groups.get(key) ?? []), { ...r }]);
  }
  const len = (r: MapRun) => wrap(r.d1 - r.d0, lap) || r.d1 - r.d0;
  const touch = (a: MapRun, b: MapRun) => Math.abs(wrap(b.d0 - a.d1 + lap / 2, lap) - lap / 2) <= 1;
  for (const list of groups.values()) {
    list.sort((a, b) => a.d0 - b.d0);
    const n = list.length;
    if (n > 1) {
      // Shortest first, so a blip between two long runs joins one of them, not another blip.
      const order = list.map((_, i) => i).sort((a, b) => len(list[a]) - len(list[b]));
      for (const i of order) {
        const r = list[i];
        if (len(r) >= minM) break;
        const p = list[(i - 1 + n) % n];
        const q = list[(i + 1) % n];
        const cands = [p, q].filter((x) => x !== r && x.dim === r.dim && (x === p ? touch(p, r) : touch(r, q)));
        if (!cands.length) continue;
        const pick = cands.reduce((a, b) => (len(b) > len(a) ? b : a));
        r.colour = pick.colour;
      }
    }
    const merged: MapRun[] = [];
    for (const r of list) {
      const last = merged[merged.length - 1];
      if (last && last.colour === r.colour && last.dim === r.dim && touch(last, r)) last.d1 = r.d1;
      else merged.push(r);
    }
    out.push(...merged);
  }
  return out;
}

/** Ink metrics of a string in a CSS font, from a shared canvas (no layout). */
let measureCtx: CanvasRenderingContext2D | null = null;
function inkBox(text: string, font: string) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return null;
  measureCtx.font = font;
  const m = measureCtx.measureText(text);
  return { adv: m.width, left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent, fAsc: m.fontBoundingBoxAscent, fDesc: m.fontBoundingBoxDescent };
}

/** The centreline sampled every ~2 px in a 24 px grid: fast "how close is this point to the road". */
function roadIndex(T: Projection) {
  const step = 2 * T.mpp;
  const cell = 24;
  const grid = new Map<string, [number, number][]>();
  for (let d = 0; d < T.lap; d += step) {
    const p = T.at(d);
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    const list = grid.get(key);
    if (list) list.push([p.x, p.y]);
    else grid.set(key, [[p.x, p.y]]);
  }
  /** Distance from (x, y) to the centreline, or `cap` when further than that. */
  return (x: number, y: number, cap: number) => {
    let best = cap * cap;
    const r = Math.ceil(cap / cell);
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) {
        const list = grid.get(`${cx + i},${cy + j}`);
        if (list) for (const [px, py] of list) best = Math.min(best, (px - x) ** 2 + (py - y) ** 2);
      }
    return Math.sqrt(best);
  };
}

/** One shared empty list for absent props, so memos keyed on them stay put between renders. */
const NONE: readonly never[] = [];

export const TrackMap = forwardRef<TrackMapHandle, TrackMapProps>(function TrackMap(props, ref) {
  const {
    outline,
    circuit = null,
    straights = NONE as never[],
    selected = null,
    onSelect,
    runs = NONE as never[],
    tags = NONE as never[],
    ticks = NONE as never[],
    cursor = null,
    hover = null,
    pins = NONE as never[],
    labels = NONE as never[],
    corners = true,
    arrows = true,
    sf = true,
    straightLabels = false,
    sectionNote = null,
    straightsWithData = null,
    crossfadeLines = false,
    pad,
    rotation,
    className = "",
    label = "Track map",
    children,
  } = props;
  const autoHeight = props.autoHeight ?? true;
  const maxHeight = props.maxHeight ?? 760;
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

  // Scale factor from the track's drawn width, with the dot as the unit D. Proportions are
  // read off the owner's generated reference (a 1540 px wide track, dot 28 px): road lines
  // 0.64 D apart and 0.14 D thick, the middle line 0.09 D, corner rings 0.9 D with a 0.05 D
  // outline, the cut around a disc 0.1 D, chips about one D tall.
  const k = Math.max(0.8, Math.min(2.8, ((W - padding.l - padding.r) / REF_W) * (props.zoom ?? 1)));
  const D = 12.5 * k;
  const gap = 0.66 * D;
  const edgeW = Math.max(1, 0.14 * D);
  const outer = gap + edgeW;
  const lineW = Math.max(1, 0.09 * D);
  const chev = 0.12 * D;
  // Markers: the disc is a little smaller than the unit, so it sits across the road without
  // owning it; M scales the disc and the chip together, independently of the track.
  const M = D * (props.markerScale ?? 1);
  const dot = 0.84 * M;

  // Tags: HTML, positioned from the ticker (live) or from props (static). Each tag also
  // owns a circle in the road's mask, so the lines are really cut around its disc (no
  // painted ring): the same call moves both.
  // Switching straights: the render that changes `selected` marks the box (data-jump) and the
  // chip layout below sends each driver's dot along the road to its new place (the chip waits
  // and shows on arrival), instead of gliding across the infield or blinking out.
  const prevSel = useRef(selected);
  const jump = prevSel.current !== selected;
  useEffect(() => {
    prevSel.current = selected;
  }, [selected]);
  const lastD = useRef(new Map<number | string, number>());
  const travel = useRef(new Map<number | string, { tw: gsap.core.Tween; o: { d: number }; to: number }>());
  useEffect(() => () => travel.current.forEach((tr) => tr.tw.kill()), []);


  const uid = useId().replace(/:/g, "");
  const maskId = `tmap-cut-${uid}`;
  const tagEls = useRef(new Map<number | string, HTMLDivElement>());
  const cutEls = useRef(new Map<number | string, SVGCircleElement>());
  const placeTag = (id: number | string, d: number) => {
    const el = tagEls.current.get(id);
    if (!el || !T) return;
    const q = T.pose(d);
    // The transform is written directly (not through a custom property): a per-frame
    // variable change on the parent would restyle the chip too.
    el.style.transform = `translate3d(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px, 0)`;
    const c = cutEls.current.get(id);
    if (c) {
      c.setAttribute("cx", q.x.toFixed(1));
      c.setAttribute("cy", q.y.toFixed(1));
    }
  };
  useImperativeHandle(ref, () => ({ place: placeTag, projection: () => T }), [T]);

  // How close a point is to the road's centreline (for chips and corner rings).
  const roadDist = useMemo(() => (T ? roadIndex(T) : null), [T]);

  // Corner rings and straight chips: on the side of the road the reference's label angle
  // points to (straight chips: the outside), at one fixed distance from the centreline,
  // clear of the rails by 0.3 D. Where that spot comes near another part of the road (a
  // hairpin, a chicane) or another mark, try the other side, then turned directions, then
  // further out; if nothing is clear, the spot with the most room. Both are treated as
  // circles; a straight chip's circle is its half-width.
  const ringR = 0.45 * D;
  const sChipW = 1.3 * D;
  const sChipH = 0.86 * D;
  const marks = useMemo(() => {
    const empty = {
      corners: [] as { n: number; x: number; y: number }[],
      straights: [] as { id: number; x: number; y: number }[],
      labels: [] as { id: number; x: number; y: number }[],
    };
    if (!T || !roadDist) return empty;
    const placed: { x: number; y: number; r: number }[] = [];
    // `skip`: a mark this spot may overlap (a straight's own chip, for its label); `keep`:
    // false places without reserving room (labels show one at a time).
    const place = (d: number, side: number, r: number, skip: { x: number; y: number } | null = null, keep = true) => {
      const q = T.pose(d);
      const base = outer / 2 + 0.3 * D + r;
      const need = outer / 2 + 0.2 * D + r;
      // Room at a spot: the smaller of the road's clearance and the nearest mark's, as a margin.
      const room = (x: number, y: number) => {
        let m = roadDist(x, y, need + 2 * D) - need;
        for (const o of placed) if (o !== skip) m = Math.min(m, Math.hypot(o.x - x, o.y - y) - r - o.r - 0.15 * D);
        return m;
      };
      let best = { x: q.x + q.nx * side * base, y: q.y + q.ny * side * base, m: -Infinity };
      search: for (let step = 0; step < 8; step++)
        for (const a of [0, 0.5, -0.5, 1, -1])
          for (const sd of [side, -side]) {
            const off = base + step * 0.35 * D;
            const ux = q.nx * Math.cos(a) - q.ny * Math.sin(a);
            const uy = q.nx * Math.sin(a) + q.ny * Math.cos(a);
            const x = q.x + ux * sd * off;
            const y = q.y + uy * sd * off;
            const m = room(x, y);
            if (m > best.m) best = { x, y, m };
            if (m >= 0) break search;
          }
      if (keep) placed.push({ x: best.x, y: best.y, r });
      return best;
    };
    const out = { corners: [] as typeof empty.corners, straights: [] as typeof empty.straights, labels: [] as typeof empty.labels };
    if (corners)
      for (const c of T.corners) {
        const q = T.pose(c.d);
        const p = place(c.d, (c.lx - c.x) * q.nx + (c.ly - c.y) * q.ny >= 0 ? 1 : -1, ringR);
        out.corners.push({ n: c.n, x: p.x, y: p.y });
      }
    // Chips and labels do not depend on which straight is picked, so nothing jumps on a pick:
    // the picked straight's chip fades out and its label (placed beforehand, free to cover its
    // own chip, wider and further out for the leader) fades in.
    const chipAt = new Map<number, { x: number; y: number; r: number }>();
    if (straightLabels)
      for (const st of straights) {
        const p = place(st.mid, -1, sChipW / 2);
        chipAt.set(st.straight_id, placed[placed.length - 1]);
        out.straights.push({ id: st.straight_id, x: p.x, y: p.y });
      }
    for (const st of straights) {
      const p = place(st.mid, -1, 1.25 * D, chipAt.get(st.straight_id) ?? null, false);
      out.labels.push({ id: st.straight_id, x: p.x, y: p.y });
    }
    return out;
  }, [T, roadDist, outer, D, ringR, sChipW, corners, straightLabels, straights]);
  const cornerPos = marks.corners;

  // Fonts arrive after the first layout; measure the chips again once they have.
  const [, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);

  // Chips. Each chip is sized from its text's ink (canvas measure), so every chip has the same
  // height, the same padding left and right of the letters, and the letters optically centred
  // (italic overhang and cap height included). It sits on the outward normal of the road at
  // its dot, one fixed gap from the dot's ring; if that spot covers the road, a dot, a corner
  // ring or another chip, it tries the inside, then turned 35 and 70 degrees, then a ladder
  // outward with a leader line. Never over the line.
  useLayoutEffect(() => {
    if (!T || !roadDist) return;
    const sorted = [...tags].sort((a, b) => wrap(a.d, T.lap) - wrap(b.d, T.lap));
    const ring = 2;
    const rDot = 0.5 * dot + ring;
    type Box = { x: number; y: number; w: number; h: number };
    const boxes: Box[] = sorted.map((t) => {
      const q = T.pose(t.d);
      return { x: q.x - rDot, y: q.y - rDot, w: 2 * rDot, h: 2 * rDot };
    });
    if (corners) for (const c of cornerPos) boxes.push({ x: c.x - ringR, y: c.y - ringR, w: 2 * ringR, h: 2 * ringR });
    for (const c of marks.straights) boxes.push({ x: c.x - sChipW / 2, y: c.y - sChipH / 2, w: sChipW, h: sChipH });
    // The HTML labels (pins, stretch names, start/finish) are obstacles too.
    const host = tagEls.current.values().next().value?.closest(".tmap");
    if (host) {
      const o = host.getBoundingClientRect();
      host.querySelectorAll(".tmap__pinlabel, .tmap__label, .tmap__sf-label").forEach((n) => {
        const r = n.getBoundingClientRect();
        boxes.push({ x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height });
      });
    }
    const h = 0.95 * M;
    const padX = 0.3 * M;
    const clear = 0.16 * M;
    const roadClear = outer / 2 + 1;
    const onRoad = (b: Box) => {
      for (const fx of [0, 0.5, 1])
        for (const fy of [0, 0.5, 1]) if (roadDist(b.x + fx * b.w, b.y + fy * b.h, roadClear + 1) < roadClear) return true;
      return false;
    };
    const rot = (x: number, y: number, a: number) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as const;
    for (const [i, t] of sorted.entries()) {
      const q = T.pose(t.d);
      const el = tagEls.current.get(t.id);
      const chip = el?.querySelector<HTMLElement>(".tmap__tag-chip");
      const code = chip?.querySelector<HTMLElement>(".tmap__tag-code");
      // A chip with a note sizes itself (CSS padding); clear any size from an earlier render.
      if (chip && code && t.note) {
        chip.style.width = "";
        chip.style.padding = "";
        code.style.transform = "";
      }
      let w = chip?.offsetWidth || 1.7 * M;
      if (chip && code && !t.note) {
        const font = getComputedStyle(code).font;
        const ink = inkBox(t.code, font);
        if (ink) {
          const inkW = ink.left + ink.right;
          w = Math.round(inkW + 2 * padX);
          // Line box is one font-size tall (line-height 1); move the ink's centre to the chip's.
          const size = parseFloat(getComputedStyle(code).fontSize);
          const base = (size - (ink.fAsc + ink.fDesc)) / 2 + ink.fAsc;
          const cy = size / 2 - (base - (ink.asc - ink.desc) / 2);
          // The flex box centres the advance box [0, adv]; the ink runs [-left, right]. Move the
          // ink's centre onto the chip's (italic type overhangs to the right).
          const cx = ink.adv / 2 - (ink.right - ink.left) / 2;
          chip.style.width = `${w}px`;
          chip.style.padding = "0";
          code.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`;
        }
      }
      const out = { x: -q.nx, y: -q.ny };
      // Chip-centre distance along u so the chip's near edge is `clear` from the dot's ring.
      const at = (ux: number, uy: number, extra = 0): [number, number] => {
        const dist = rDot + clear + (w / 2) * Math.abs(ux) + (h / 2) * Math.abs(uy) + extra;
        return [ux * dist, uy * dist];
      };
      const spots: [number, number][] = [];
      for (const a of [0, Math.PI]) spots.push(at(...rot(out.x, out.y, a)));
      for (const a of [0.6, -0.6, Math.PI + 0.6, Math.PI - 0.6, 1.2, -1.2]) spots.push(at(...rot(out.x, out.y, a)));
      const near = spots.length;
      for (let n = 1; n <= 16; n++) for (const s of [1, -1]) spots.push(at(out.x * s, out.y * s, n * (h + 0.25 * M)));
      let pick: [number, number] = spots[0];
      let pickI = 0;
      for (const [si, [sx, sy]] of spots.entries()) {
        const b = { x: q.x + sx - w / 2, y: q.y + sy - h / 2, w, h };
        const hit = boxes.some((o, bi) => bi !== i && b.x < o.x + o.w + 2 && b.x + w + 2 > o.x && b.y < o.y + o.h + 2 && b.y + h + 2 > o.y);
        if (!hit && !onRoad(b)) {
          pick = [sx, sy];
          pickI = si;
          break;
        }
      }
      boxes.push({ x: q.x + pick[0] - w / 2, y: q.y + pick[1] - h / 2, w, h });
      // Place the dot: travel along the road after a straight switch (shortest way round the
      // lap), retarget a running trip if the place moved again, else put it straight there.
      const from = lastD.current.get(t.id);
      const tr = travel.current.get(t.id);
      const go = (start: number) => {
        travel.current.get(t.id)?.tw.kill();
        const delta = wrap(t.d - start + T.lap / 2, T.lap) - T.lap / 2;
        const o = { d: start };
        el?.classList.add("is-travel");
        if (el) el.style.transition = "none";
        const tw = gsap.to(o, {
          d: start + delta,
          duration: 0.45,
          ease: "power3.out",
          onUpdate: () => placeTag(t.id, o.d),
          onComplete: () => {
            travel.current.delete(t.id);
            el?.classList.remove("is-travel");
            if (el) el.style.transition = "";
          },
        });
        travel.current.set(t.id, { tw, o, to: t.d });
      };
      if (jump && from !== undefined && Math.abs(wrap(t.d - from + T.lap / 2, T.lap) - T.lap / 2) > 1 && !prefersReducedMotion()) go(from);
      else if (tr && tr.to !== t.d) go(tr.o.d);
      else if (!tr) placeTag(t.id, t.d);
      lastD.current.set(t.id, t.d);
      el?.style.setProperty("--tx", `${pick[0].toFixed(1)}px`);
      el?.style.setProperty("--ty", `${pick[1].toFixed(1)}px`);
      // A leader from the dot to the chip when the chip is on the ladder.
      const dist = Math.hypot(pick[0], pick[1]);
      el?.style.setProperty("--lead", pickI < near ? "0px" : `${(dist - h / 2).toFixed(1)}px`);
      el?.style.setProperty("--lead-rot", `${((Math.atan2(pick[1], pick[0]) * 180) / Math.PI - 90).toFixed(1)}deg`);
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
      // Follows the pointer: short and ease-out, so it never feels behind the hand.
      tw = gsap.to(o, { d, duration: 0.2, ease: "expo.out", onUpdate: place });
    });
    return () => {
      unsub();
      tw?.kill();
    };
  }, [T, cursor]);

  // Pointer over the bound straight moves the cursor and reports a hover (fine pointers only).
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!T || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const n = T.nearest(px, py);
    const s = hover?.straight ?? cursor?.straight;
    if (!s) return;
    const L = (hover ? hover.length : cursor?.length) ?? s.len;
    const a = along(s, n.d, T.lap);
    const inside = n.dist <= 24 && a >= 0 && a <= L;
    if (cursor && inside) cursor.store.set(a);
    if (hover) hover.onHover(inside ? a : null, inside ? { x: px, y: py } : null);
  };
  const onLeave = () => hover?.onHover(null, null);

  // Section defs for every straight (fade mask, grain, glow), built once per layout so a pick
  // only flips classes: the old section fades out while the new one fades in.
  const secDefs = useMemo(
    () =>
      T
        ? straights.map((st) => {
              // The section fade, as a mask that follows the road. Each end is a stack of pieces
              // that start one step further in and all run to the middle; their opacities are
              // chosen so the stack composites to a smoothstep along lap distance. Every piece
              // edge is a start, never a join, so no seam or overlap shows, and the fade bends
              // with the track. Wide enough to carry both the fill and the glow.
              const len = wrap(st.d1 - st.d0, T.lap) || st.len;
              const fade = Math.min(0.25 * len, 4 * D * T.mpp);
              const n = 32;
              const half = len / 2;
              const pieces: { a: number; b: number; o: number }[] = [];
              const smooth = (t: number) => t * t * (3 - 2 * t);
              for (const end of [0, 1] as const) {
                let prev = 0;
                for (let k = 0; k < n; k++) {
                  const target = smooth((k + 1) / n);
                  const o = k === n - 1 ? 1 : 1 - (1 - target) / (1 - prev);
                  prev = target;
                  const inset = (k * fade) / n;
                  // Start pieces run up to just past the middle and end pieces from just before
                  // it: both are opaque there, so the overlap cannot show.
                  if (end === 0) pieces.push({ a: st.d0 + inset, b: st.d0 + half + T.mpp, o });
                  else pieces.push({ a: st.d0 + half - T.mpp, b: st.d0 + len - inset, o });
                }
              }
              // Filters work on the section's own box, not the whole map: far less to paint.
              let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
              for (let k = 0; k <= 40; k++) {
                const q = T.at(st.d0 + (k * len) / 40);
                x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
              }
              const padB = outer + 1.5 * D;
              const box = { x: x0 - padB, y: y0 - padB, width: x1 - x0 + 2 * padB, height: y1 - y0 + 2 * padB };
              return (
                <g key={st.straight_id}>
                  <mask id={`${maskId}-sec-${st.straight_id}`} maskUnits="userSpaceOnUse" {...box}>
                    {pieces.map((pc, i) => (
                      <path key={i} d={T.sub(pc.a, pc.b)} fill="none" stroke="#fff" strokeOpacity={pc.o} strokeWidth={outer + 1.4 * D} strokeLinecap="butt" strokeLinejoin="round" />
                    ))}
                  </mask>
                  {/* Grain for the fill: fine fractal noise inside the fill's own shape, no blur. */}
                  <filter id={`${maskId}-grain-${st.straight_id}`} filterUnits="userSpaceOnUse" {...box} colorInterpolationFilters="sRGB">
                    <feTurbulence type="fractalNoise" baseFrequency={(1.1 / D).toFixed(4)} numOctaves={2} seed={7} result="noise" />
                    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.2 -0.45" result="grain" />
                    <feComposite in="grain" in2="SourceGraphic" operator="in" result="tex" />
                    <feComponentTransfer in="SourceGraphic" result="base">
                      <feFuncA type="linear" slope={0.7} />
                    </feComponentTransfer>
                    <feMerge>
                      <feMergeNode in="base" />
                      <feMergeNode in="tex" />
                    </feMerge>
                  </filter>
                  <filter id={`${maskId}-glow-${st.straight_id}`} filterUnits="userSpaceOnUse" {...box}>
                    <feGaussianBlur stdDeviation={0.15 * D} />
                  </filter>
                </g>
              );
          })
        : null,
    [T, straights, D, outer, maskId],
  );

  const sfPose = T ? T.pose(0) : null;
  const sel = straights.find((s) => s.straight_id === selected) ?? null;

  // Drawn runs (nothing transparent), and the blends where two runs of different colour meet
  // end to end on the same offset: a stretch of 1.6 D centred on the join, never longer than
  // the shorter neighbour.
  const lines = useMemo(() => (T ? smoothRuns(runs.filter((r) => r.colour !== "transparent"), T.lap) : []), [runs, T]);
  // A new set of lines (another lap) cross-fades with the old one instead of swapping. The
  // change is caught during render (React's "adjust state on prop change"), so the first frame
  // with the new lines already fades them in.
  // Compared by content, not identity: callers may pass a fresh (even empty) array each
  // render, and an identity check would set state on every render, forever.
  const [fading, setFading] = useState<MapRun[] | null>(null);
  const [lineGen, setLineGen] = useState(0);
  const lineKey = crossfadeLines ? lines.map((r) => `${r.d0}:${r.d1}:${r.colour}:${r.offset ?? 0}:${r.dim ? 1 : 0}`).join("|") : "";
  const [prev, setPrev] = useState({ key: lineKey, lines });
  if (crossfadeLines && prev.key !== lineKey) {
    setPrev({ key: lineKey, lines });
    if (prev.lines.length && lines.length && !prefersReducedMotion()) {
      setFading(prev.lines);
      setLineGen((g) => g + 1);
    }
  }
  useEffect(() => {
    if (!fading) return;
    const id = window.setTimeout(() => setFading(null), 220);
    return () => window.clearTimeout(id);
  }, [fading]);
  const blends: { d0: number; d1: number; offset: number; from: string; to: string }[] = [];
  if (T) {
    const byOff = new Map<number, MapRun[]>();
    for (const r of lines) {
      if (r.kind === "band") continue;
      const key = r.offset ?? 0;
      byOff.set(key, [...(byOff.get(key) ?? []), r]);
    }
    for (const [offset, list] of byOff) {
      const sorted = [...list].sort((a, b) => a.d0 - b.d0);
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i];
        const b = sorted[(i + 1) % sorted.length];
        if (a === b || a.colour === b.colour) continue;
        const join = a.d1;
        if (Math.abs(wrap(b.d0 - join, T.lap)) > 1 && Math.abs(wrap(join - b.d0, T.lap)) > 1) continue;
        const half = Math.min(0.45 * D * T.mpp, (a.d1 - a.d0) / 2, (b.d1 - b.d0) / 2);
        if (half < 2) continue;
        blends.push({ d0: join - half, d1: join + half, offset, from: a.colour, to: b.colour });
      }
    }
  }
  const sfLabelPos = sfPose ? (Math.abs(sfPose.nx) > Math.abs(sfPose.ny) ? (sfPose.nx < 0 ? "right" : "left") : sfPose.ny < 0 ? "below" : "above") : "below";

  return (
    <div ref={boxRef} className={`tmap ${className}`} data-jump={jump ? "1" : undefined} data-hires={T?.hires ? "1" : "0"} style={{ ["--k" as string]: k.toFixed(3), ["--D" as string]: `${D.toFixed(2)}px`, ["--dot" as string]: `${dot.toFixed(2)}px`, ["--M" as string]: `${M.toFixed(2)}px`, height: autoH ?? undefined }}>
      {T && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="tmap__svg" role="group" aria-label={label} onPointerMove={onMove} onPointerLeave={onLeave}>
          <defs>
            {/* The cut: white keeps, black removes. One hole per driver, 0.1 D wider than the disc. */}
            <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
              <rect width={W} height={H} fill="#fff" />
              {tags.map((t) => (
                <circle
                  key={t.id}
                  ref={(el) => {
                    if (el) cutEls.current.set(t.id, el);
                    else cutEls.current.delete(t.id);
                  }}
                  r={0.5 * dot + 0.1 * D}
                  fill="#000"
                />
              ))}
            </mask>
            {blends.map((b, i) => {
              const a = T.pose(b.d0);
              const c = T.pose(b.d1);
              return (
                <linearGradient key={i} id={`${maskId}-g${i}`} gradientUnits="userSpaceOnUse" x1={a.x + a.nx * b.offset} y1={a.y + a.ny * b.offset} x2={c.x + c.nx * b.offset} y2={c.y + c.ny * b.offset}>
                  <stop offset="0" stopColor={b.from} />
                  <stop offset="1" stopColor={b.to} />
                </linearGradient>
              );
            })}
            {secDefs}
            <pattern id="tmap-chequer" width={0.14 * D} height={0.14 * D} patternUnits="userSpaceOnUse">
              <rect width={0.14 * D} height={0.14 * D} fill="#f2f2f4" />
              <rect width={0.07 * D} height={0.07 * D} fill="#111114" />
              <rect x={0.07 * D} y={0.07 * D} width={0.07 * D} height={0.07 * D} fill="#111114" />
            </pattern>
          </defs>

          <g mask={tags.length ? `url(#${maskId})` : undefined}>
          {/* The road: two thin light lines, the ground between them. */}
          {/* Layer 1, behind the road: the picked section's outer glow, very faint and a little
              blurred, faded by the same mask; the rails drawn over it stay crisp. */}
          {straights.map((st) => (
            <path key={`glow-${st.straight_id}`} d={T.sub(st.d0, st.d1)} className={`tmap__glow ${st.straight_id === selected ? "is-on" : ""}`} strokeWidth={outer + 0.6 * D} filter={`url(#${maskId}-glow-${st.straight_id})`} mask={`url(#${maskId}-sec-${st.straight_id})`} />
          ))}
          <path d={T.pathD} className="tmap__edge" strokeWidth={outer} />
          <path d={T.pathD} className="tmap__ground" strokeWidth={gap} />

          {/* Straights: pickable; the selected one brightens its edges. */}
          {straights.length > 0 && (
            <g className="tmap__straights">
              {straights.map((s) => {
                const on = s.straight_id === selected;
                const d = T.sub(s.d0, s.d1);
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
                    {/* The ground runs 1 px past the lit edges, so no anti-aliased seam crosses the road at the ends. */}
                    <path d={T.sub(s.d0 - T.mpp, s.d1 + T.mpp)} className="tmap__lit-ground" strokeWidth={gap} />
                    {/* Layer 2, between the rails: the picked section's fill, exactly the road's inner
                        width (so it never covers a rail), faded along the road by the section mask,
                        under the telemetry line, arrows and markers. */}
                    <g mask={`url(#${maskId}-sec-${s.straight_id})`}>
                      <path d={d} className="tmap__fill" strokeWidth={gap} filter={`url(#${maskId}-grain-${s.straight_id})`} />
                    </g>
                  </g>
                );
              })}
            </g>
          )}

          {/* Colour down the middle: regimes, trails, drivers' lines. Runs meet with flat ends
              under a short gradient from one colour into the next, so the line reads as one
              continuous stroke whose colour changes, not as pieces laid end to end. */}
          {fading && (
            <g key={`out-${lineGen}`} className="tmap__lines-out" fill="none" strokeLinecap="butt" strokeLinejoin="round">
              {fading.map((r, i) => (
                <path key={i} d={T.sub(r.d0, Math.min(r.d1, T.lap - 0.01), r.offset ?? 0)} stroke={r.colour} strokeWidth={r.kind === "band" ? gap - 2 : lineW} className={r.kind === "band" ? "tmap__band" : "tmap__line"} />
              ))}
            </g>
          )}
          <g key={`in-${lineGen}`} className={lineGen ? "tmap__lines-in" : undefined} fill="none" strokeLinecap="butt" strokeLinejoin="round">
            {lines.map((r, i) => (
              <path
                key={i}
                d={T.sub(r.d0, Math.min(r.d1, T.lap - 0.01), r.offset ?? 0)}
                stroke={r.colour}
                strokeWidth={r.kind === "band" ? gap - 2 : lineW}
                className={`${r.kind === "band" ? "tmap__band" : "tmap__line"} ${r.dim ? "is-dim" : ""}`}
                strokeLinecap={r.kind === "band" ? "round" : "butt"}
              />
            ))}
            {blends.map((b, i) => (
              <path key={`b${i}`} d={T.sub(b.d0, b.d1, b.offset)} stroke={`url(#${maskId}-g${i})`} strokeWidth={lineW} />
            ))}
          </g>
          {arrows && (
            <g className="tmap__chevrons" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={Math.max(0.8, 0.05 * D)}>
              {lines
                .filter((r) => r.kind !== "band")
                .flatMap((r, i) =>
                  chevrons(T, r, 8 * D).map((c, j) => (
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

          {/* Ticks: a thin line across the road per driver, in team colour; the bracket (if any) outside. */}
          <g className="tmap__ticks" pointerEvents="none" key={`ticks-${selected ?? ""}`}>
            {ticks.map((t) => {
              const side = t.side ?? 1;
              const half = outer / 2 + 0.08 * D;
              const far = side === 1 ? outer / 2 + 0.42 * D : -(outer / 2 + 0.42 * D);
              const tw = Math.max(1, 0.055 * D);
              return (
                <g key={t.id} stroke={t.colour} fill="none" className={t.on ? "is-on" : ""} opacity={t.on ? 1 : 0.85}>
                  {t.lo !== null && t.lo !== undefined && t.hi !== null && t.hi !== undefined && (
                    <path d={bracket(T, t.lo, t.hi, far - (side === 1 ? 0.12 * D : -0.12 * D), side === 1 ? 0.12 * D : -0.12 * D)} strokeWidth={tw * 0.8} opacity={0.8} />
                  )}
                  <line {...tickLine(T, t.d, -half, half)} strokeWidth={tw} strokeLinecap="round" />
                </g>
              );
            })}
          </g>
          </g>

          {/* Pins: a thin grey line across the road; the label is HTML below. */}
          <g className="tmap__pins" pointerEvents="none">
            {pins.map((pn) => (
              <line key={pn.id} {...tickLine(T, pn.d, -(outer / 2 + 0.25 * D), outer / 2 + 0.25 * D)} stroke="#8a8a93" strokeWidth={Math.max(1, 0.06 * D)} />
            ))}
          </g>

          {/* Start/finish: the chequer across the road. */}
          {sf && sfPose && (
            <g className="tmap__sf" transform={`translate(${sfPose.x.toFixed(1)},${sfPose.y.toFixed(1)}) rotate(${sfPose.deg.toFixed(1)})`} pointerEvents="none">
              <rect x={-0.14 * D} y={-(gap / 2 + 0.07 * D)} width={0.28 * D} height={gap + 0.14 * D} fill="url(#tmap-chequer)" />
            </g>
          )}
          {/* Race direction: a small arrow on the middle line just before the flag, pointing
              the way the cars cross it (lap distance grows in the direction of travel). */}
          {sf && sfPose && (() => {
            const q = T.pose(-0.9 * D * T.mpp);
            const a = 0.42 * D;
            return (
              <g className="tmap__dir" transform={`translate(${q.x.toFixed(1)},${q.y.toFixed(1)}) rotate(${q.deg.toFixed(1)})`} pointerEvents="none">
                <path d={`M${(-a * 1.1).toFixed(2)},0H${(a * 0.4).toFixed(2)}`} strokeWidth={Math.max(1, 0.08 * D)} />
                <path d={`M${(a * 0.65).toFixed(2)},0L${(-a * 0.15).toFixed(2)},${(-a * 0.5).toFixed(2)}L${(-a * 0.15).toFixed(2)},${(a * 0.5).toFixed(2)}Z`} className="tmap__dir-head" />
              </g>
            );
          })()}

          {/* Corner numbers: outlined circles outside the bend. */}
          {corners && T.corners.length > 0 && (
            <g className="tmap__corners" pointerEvents="none">
              {cornerPos.map((c, i) => (
                <g key={`${c.n}-${i}`} transform={`translate(${c.x.toFixed(1)},${c.y.toFixed(1)})`}>
                  <circle r={ringR} className="tmap__corner" strokeWidth={Math.max(0.8, 0.05 * D)} />
                  {/* Centred on the ring: middle anchor, central baseline, and a nudge left for
                      the italic lean so the digits sit in the middle by eye. */}
                  <text x={-0.03 * D} textAnchor="middle" dominantBaseline="central" className="tmap__corner-n" fontSize={0.42 * D}>
                    {c.n}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* Straight chips: "S3" plates beside each straight; click one to pick it. The
              picked one is filled. (The straight's own road path stays the keyboard target.) */}
          {marks.straights.length > 0 && (
            <g className="tmap__schips">
              {marks.straights.map((c) => (
                <g
                  key={c.id}
                  className={`tmap__schip ${c.id === selected ? "is-on" : ""} ${onSelect ? "is-pick" : ""} ${straightsWithData && !straightsWithData.has(c.id) ? "is-empty" : ""}`}
                  transform={`translate(${c.x.toFixed(1)},${c.y.toFixed(1)})`}
                  onClick={onSelect ? () => onSelect(c.id) : undefined}
                  aria-hidden="true"
                >
                  {straightsWithData && !straightsWithData.has(c.id) && <title>No cut-offs on this straight in this session</title>}
                  <rect x={-sChipW / 2} y={-sChipH / 2} width={sChipW} height={sChipH} rx={sChipH / 2} strokeWidth={Math.max(0.8, 0.05 * D)} />
                  <text x={-0.03 * D} textAnchor="middle" dominantBaseline="central" fontSize={0.42 * D}>
                    S{c.id}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* Layer 4, labels: the picked section's name off the road (where its chip was), small
              and muted, with a hairline leader that stops just short of the rail. */}
          {straights.map((sel) => {
            const on = sel.straight_id === selected;
            const note = on ? sectionNote : null;
            const spot = marks.labels.find((c) => c.id === sel.straight_id);
            const q = T.pose(sel.mid);
            let leader = null;
            if (spot) {
              // The label's box (one line, about 2.8 D x 0.5 D around its centre): the leader
              // stops a little short of it, wherever the label sits relative to the road.
              const cy = spot.y;
              const vx = spot.x - q.x;
              const vy = cy - q.y;
              const L = Math.hypot(vx, vy) || 1;
              const inBox = Math.min(Math.abs(vx) > 0.01 ? (1.4 * D * L) / Math.abs(vx) : Infinity, Math.abs(vy) > 0.01 ? ((note ? 0.55 : 0.28) * D * L) / Math.abs(vy) : Infinity);
              const from = outer / 2 + 0.15 * D;
              const to = L - inBox - 0.15 * D;
              // A stub reads as a stray mark: no leader when the label sits right by the road.
              if (to - from > 0.3 * D) leader = { x1: q.x + (vx / L) * from, y1: q.y + (vy / L) * from, x2: q.x + (vx / L) * to, y2: q.y + (vy / L) * to };
            }
            return (
              <g key={`sec-${sel.straight_id}`} className={`tmap__sec ${on ? "is-on" : ""}`} pointerEvents="none" aria-hidden={!on}>
                {leader && <line {...leader} className="tmap__sec-lead" strokeWidth={Math.max(0.8, 0.05 * D)} />}
                {spot && (
                  <text x={spot.x} y={spot.y} textAnchor="middle" dominantBaseline="central" fontSize={0.38 * D} className="tmap__sec-label">
                    SECTION S{sel.straight_id}
                    {note && (
                      <tspan x={spot.x} dy={0.55 * D} fontSize={0.34 * D} className="tmap__sec-note">
                        {note}
                      </tspan>
                    )}
                  </text>
                )}
              </g>
            );
          })}

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
              className={`tmap__tag ${t.on ? "is-on" : ""} ${t.dim ? "is-dim" : ""} ${isLight(t.colour) ? "is-light" : ""}`}
              style={{ ["--team" as string]: t.colour }}
            >
              <i className="tmap__tag-lead" />
              <i className="tmap__tag-dot" />
              <span className={`tmap__tag-chip ${t.note ? "has-note" : ""}`}>
                <b className="tmap__tag-code">{t.code}</b>
                {t.note && <small>{t.note}</small>}
              </span>
            </div>
          ))}
        </div>
      )}

      {T && pins.length > 0 && (
        <div className="tmap__pinlabels" aria-hidden="true">
          {pins.map((pn) => {
            const q = T.pose(pn.d);
            // Inside the loop, past the pin's end (chips take the outside).
            const off = outer / 2 + 1.1 * D;
            return (
              <span key={pn.id} className="tmap__pinlabel" style={{ left: q.x + q.nx * off, top: q.y + q.ny * off }} data-pos={Math.abs(q.nx) > Math.abs(q.ny) ? (q.nx > 0 ? "right" : "left") : q.ny > 0 ? "below" : "above"}>
                {pn.text}
              </span>
            );
          })}
        </div>
      )}
      {T && labels.length > 0 && (
        <div className="tmap__labels" aria-hidden="true">
          {labels.map((lb) => {
            const q = T.pose(lb.d);
            const off = outer / 2 + 0.6 * D;
            return (
              <span key={lb.id} className="tmap__label" style={{ left: q.x + q.nx * off, top: q.y + q.ny * off }} data-pos={Math.abs(q.nx) > Math.abs(q.ny) ? (q.nx > 0 ? "right" : "left") : q.ny > 0 ? "below" : "above"}>
                {lb.text}
              </span>
            );
          })}
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
