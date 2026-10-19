import type { Outline, Straight } from "./types";

/*
 * Track geometry shared by the map and the distance strip.
 *
 * Units: the outline's `d` is in the source's position units (decimetres), so the lap length
 * in metres is the last `d` / 10. Model distances (cut-offs, regime bins) are metres from the
 * start/finish line along the driver's own lap; they are placed on the outline at the same
 * metre value, wrapped into [0, lap). Straights arrive as lap fractions (0-100 %).
 */

export interface Pt {
  d: number;
  x: number;
  y: number;
}

export interface Pose {
  x: number;
  y: number;
  /** Heading in degrees, for rotating marks along the line. */
  deg: number;
  /** Unit normal pointing to the inside of the loop. */
  nx: number;
  ny: number;
}

export interface TrackStraight extends Straight {
  d0: number;
  d1: number;
  len: number;
  mid: number;
  /** The corner the straight runs into, from the curated name "A → B", or null. */
  into: string | null;
}

export function lapLength(outline: Outline): number {
  const pts = outline.points;
  const last = pts[pts.length - 1];
  // Close the loop: the outline ends a few metres before the start point.
  const closing = Math.hypot(last.x - pts[0].x, last.y - pts[0].y);
  return (last.d + closing) / 10;
}

export const wrap = (d: number, lap: number) => ((d % lap) + lap) % lap;

export function trackStraights(straights: Straight[], lap: number): TrackStraight[] {
  return straights.map((s) => {
    const d0 = (s.start_pct / 100) * lap;
    const d1 = (s.end_pct / 100) * lap;
    const len = wrap(d1 - d0, lap);
    const m = /→\s*(.+)$/.exec(s.label ?? "");
    return { ...s, d0, d1, len, mid: wrap(d0 + len / 2, lap), into: m ? m[1].trim() : null };
  });
}

/**
 * Signed distance along a straight from its start. A point shortly before the start comes out
 * negative rather than wrapping to almost a full lap: model distances are measured on each
 * driver's own lap, so a cut-off near the start of a straight can land a few metres before the
 * outline's straight window.
 */
export function along(s: TrackStraight, d: number, lap: number): number {
  const a = wrap(d - s.d0, lap);
  return a > s.len + (lap - s.len) / 2 ? a - lap : a;
}

/** Metres from d to the end of the straight, or null when d is outside the straight window. */
export function beforeEnd(s: TrackStraight, d: number, lap: number): number | null {
  const a = along(s, d, lap);
  return a >= 0 && a <= s.len ? s.len - a : null;
}

export function straightAt(straights: TrackStraight[], d: number, lap: number): TrackStraight | null {
  return straights.find((s) => {
    const a = along(s, d, lap);
    return a >= 0 && a <= s.len;
  }) ?? null;
}

/** Closed Catmull-Rom densification of the outline in metres, 8 points per source segment. */
function densify(outline: Outline, lap: number): Pt[] {
  const P = outline.points.map((p) => ({ d: p.d / 10, x: p.x, y: -p.y }));
  const n = P.length;
  const K = 8;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n];
    const p1 = P[i];
    const p2 = P[(i + 1) % n];
    const p3 = P[(i + 2) % n];
    const dA = p1.d;
    const dB = i + 1 < n ? P[i + 1].d : lap;
    for (let k = 0; k < K; k++) {
      const t = k / K;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, e: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
      out.push({ d: dA + (dB - dA) * t, x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ d: lap, x: out[0].x, y: out[0].y });
  return out;
}

const rotate = (pts: Pt[], a: number): Pt[] => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map((p) => ({ d: p.d, x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
};

function bbox(pts: Pt[]) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, x1, y0, y1, w: x1 - x0 || 1, h: y1 - y0 || 1 };
}

export interface Pad {
  l: number;
  r: number;
  t: number;
  b: number;
}

export interface Projection {
  lap: number;
  pts: Pt[];
  /** Screen pixels per metre of track. */
  scale: number;
  pathD: string;
  at: (d: number) => { x: number; y: number };
  pose: (d: number) => Pose;
  /** Fraction of the drawn path length at lap distance d (for DrawSVG timing). */
  frac: (d: number) => number;
  /** Path from d0 to d1 in the direction of travel (wraps over the line), offset along the inner normal. */
  sub: (d0: number, d1: number, offset?: number) => string;
  nearest: (x: number, y: number) => { d: number; dist: number };
  /** Metres per screen pixel along the line. */
  mpp: number;
}

/**
 * Fits the track into a W x H box. The plan view has no fixed "up" on a broadcast map, so the
 * outline is rotated (15 degree steps) to whichever orientation fills the box best: a wide
 * hero frame and a tall phone frame both get a large track.
 */
export function project(outline: Outline, W: number, H: number, pad: Pad): Projection {
  const lap = lapLength(outline);
  const dense = densify(outline, lap);
  const iw = Math.max(10, W - pad.l - pad.r);
  const ih = Math.max(10, H - pad.t - pad.b);
  let best = { a: 0, s: 0 };
  for (let deg = 0; deg < 180; deg += 15) {
    const b = bbox(rotate(dense, (deg * Math.PI) / 180));
    const s = Math.min(iw / b.w, ih / b.h);
    // Prefer the unrotated view unless a rotation is clearly better.
    if (s > best.s * (deg === 0 ? 1 : 1.04)) best = { a: (deg * Math.PI) / 180, s };
  }
  const rot = rotate(dense, best.a);
  const b = bbox(rot);
  const s = best.s;
  const ox = pad.l + (iw - b.w * s) / 2;
  const oy = pad.t + (ih - b.h * s) / 2;
  const pts = rot.map((p) => ({ d: p.d, x: ox + (p.x - b.x0) * s, y: oy + (p.y - b.y0) * s }));

  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1] || 1;
  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) area += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
  const inner = area > 0 ? 1 : -1;

  const idx = (d: number) => {
    const dd = Math.min(wrap(d, lap), lap - 1e-6);
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (pts[m].d <= dd) lo = m;
      else hi = m;
    }
    return { i: lo, t: (dd - pts[lo].d) / (pts[lo + 1].d - pts[lo].d || 1) };
  };
  const at = (d: number) => {
    const { i, t } = idx(d);
    const a = pts[i];
    const c = pts[i + 1];
    return { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t };
  };
  const pose = (d: number): Pose => {
    const p = at(d);
    const a = at(d - 14);
    const c = at(d + 14);
    const ang = Math.atan2(c.y - a.y, c.x - a.x);
    return { x: p.x, y: p.y, deg: (ang * 180) / Math.PI, nx: -Math.sin(ang) * inner, ny: Math.cos(ang) * inner };
  };
  const frac = (d: number) => {
    const { i, t } = idx(d);
    return (cum[i] + (cum[i + 1] - cum[i]) * t) / total;
  };
  const sub = (d0: number, d1: number, off = 0) => {
    const list: [number, number][] = [];
    const push = (d: number) => {
      const q = pose(d);
      list.push([q.x + q.nx * off, q.y + q.ny * off]);
    };
    const a = wrap(d0, lap);
    const z = wrap(d1, lap);
    push(a);
    if (z >= a) {
      for (const p of pts) if (p.d > a && p.d < z) push(p.d);
    } else {
      for (const p of pts) if (p.d > a && p.d < lap) push(p.d);
      for (const p of pts) if (p.d > 0 && p.d < z) push(p.d);
    }
    push(z === 0 ? lap - 0.01 : z);
    return "M" + list.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L");
  };
  const pathD = "M" + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L") + "Z";
  const nearest = (x: number, y: number) => {
    let bestQ = Infinity;
    let bd = 0;
    for (const p of pts) {
      const q = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (q < bestQ) {
        bestQ = q;
        bd = p.d;
      }
    }
    return { d: bd, dist: Math.sqrt(bestQ) };
  };
  return { lap, pts, scale: s, pathD, at, pose, frac, sub, nearest, mpp: lap / total };
}

/** Regime runs: consecutive 50 m bins with the same label merged, "other" where unlabelled. */
export interface RegimeRun {
  label: "deploy" | "plateau" | "lift" | "brake" | "other";
  d0: number;
  d1: number;
}

export function regimeRuns(bins: { d_start_m: number; label: RegimeRun["label"] }[], lap: number, binM = 50): RegimeRun[] {
  if (!bins.length) return [];
  const byStart = new Map(bins.map((b) => [Math.round(b.d_start_m), b.label]));
  const runs: RegimeRun[] = [];
  let cur: RegimeRun | null = null;
  for (let d0 = 0; d0 < lap; d0 += binM) {
    const label = byStart.get(d0) ?? "other";
    const d1 = Math.min(d0 + binM, lap);
    if (cur && cur.label === label) cur.d1 = d1;
    else {
      cur = { label, d0, d1 };
      runs.push(cur);
    }
  }
  return runs;
}

export function regimeAt(runs: RegimeRun[], d: number): RegimeRun["label"] | null {
  if (!runs.length) return null;
  for (const r of runs) if (d >= r.d0 && d < r.d1) return r.label;
  return "other";
}
