/*
 * The straight's driver module (patterns.md 1): everything the instrument draws or says is a
 * pure function of one variable, the distance d along the straight, and the profile data.
 * No DOM, no React; Straight.tsx maps the results to pixels and moves only the cursor.
 *
 * Speed between bin medians follows a monotone cubic (Fritsch-Carlson): it passes through every
 * median, never overshoots between two of them (no invented bumps above the plateau), and the
 * same curve is used for the drawn path and for the cursor dot, so the dot sits on the line.
 */
import type { ProfileBin, RegimeLabel, StraightProfileResponse } from "../lib/types";
import { intoStraight, type StraightFrame } from "../lib/straights";

export type Regime = RegimeLabel;

export interface RegimeMark {
  d_start_m: number;
  label: Regime;
}

export interface Profile {
  length_m: number;
  bin_m: number;
  bins: ProfileBin[];
  cutoff_median_m: number | null;
  ci_low_m: number | null;
  ci_high_m: number | null;
  /** The model's regime bins (preferred). Without them the regime is inferred, see `regimeOfBin`. */
  regimes?: RegimeMark[];
}

/** The regime in words, as the readout says it. */
export const REGIME_WORD: Record<Regime, string> = {
  deploy: "deploying",
  plateau: "plateau",
  lift: "lifting",
  brake: "braking",
};

export const REGIME_VAR: Record<Regime, string> = {
  deploy: "var(--regime-deploy)",
  plateau: "var(--regime-plateau)",
  lift: "var(--regime-lift)",
  brake: "var(--regime-brake)",
};

/**
 * Adapts the API response; the straight's length is the binned extent. Bins count metres from
 * the straight's start, the response's cut-off fields count metres from the start/finish line:
 * pass the straight's `frame` (lib/straights.ts) and they are converted to metres into the
 * straight. Without a frame the cut-off fields are taken as already converted.
 */
export function toProfile(r: StraightProfileResponse, regimes?: RegimeMark[], frame?: StraightFrame | null): Profile {
  const bins = [...r.bins].sort((a, b) => a.d_start_m - b.d_start_m);
  const last = bins[bins.length - 1];
  const m = (v: number | null) => (frame ? intoStraight(frame, v) : v);
  return {
    length_m: last ? last.d_start_m + r.bin_m : 0,
    bin_m: r.bin_m,
    bins,
    cutoff_median_m: m(r.cutoff_median_m),
    ci_low_m: m(r.ci_low_m),
    ci_high_m: m(r.ci_high_m),
    regimes,
  };
}

// ---------------------------------------------------------------- spline

interface Spline {
  xs: number[]; // bin centres, m
  ys: number[]; // kph
  ms: number[]; // tangents, kph per m
}

const splines = new WeakMap<Profile, Spline>();

function spline(p: Profile): Spline {
  const hit = splines.get(p);
  if (hit) return hit;
  const xs = p.bins.map((b) => b.d_start_m + p.bin_m / 2);
  const ys = p.bins.map((b) => b.v_kph);
  const n = xs.length;
  const ms = new Array<number>(n).fill(0);
  if (n > 1) {
    const dk = xs.slice(0, -1).map((x, i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - x));
    ms[0] = dk[0];
    ms[n - 1] = dk[n - 2];
    for (let i = 1; i < n - 1; i++) ms[i] = dk[i - 1] * dk[i] <= 0 ? 0 : (dk[i - 1] + dk[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (dk[i] === 0) {
        ms[i] = 0;
        ms[i + 1] = 0;
        continue;
      }
      const a = ms[i] / dk[i];
      const b = ms[i + 1] / dk[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        ms[i] = t * a * dk[i];
        ms[i + 1] = t * b * dk[i];
      }
    }
  }
  const sp = { xs, ys, ms };
  splines.set(p, sp);
  return sp;
}

/** Speed in kph at distance d on the monotone curve (flat beyond the first and last centres). */
export function speedAt(p: Profile, d: number): number {
  const { xs, ys, ms } = spline(p);
  const n = xs.length;
  if (n === 0) return 0;
  if (d <= xs[0]) return ys[0];
  if (d >= xs[n - 1]) return ys[n - 1];
  let i = Math.min(n - 2, Math.max(0, Math.floor((d - xs[0]) / p.bin_m)));
  while (i > 0 && d < xs[i]) i--;
  while (i < n - 2 && d > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i];
  const t = (d - xs[i]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * ms[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * ms[i + 1];
}

/** Speed axis domain in kph: rounded out to 50 kph so the hairline grid lands on round values. */
export function speedDomain(p: Profile): [number, number] {
  if (!p.bins.length) return [0, 350];
  const vs = p.bins.map((b) => b.v_kph);
  const lo = Math.max(0, Math.floor((Math.min(...vs) - 10) / 50) * 50);
  const hi = Math.ceil((Math.max(...vs) + 8) / 50) * 50;
  return [lo, hi];
}

/**
 * The trace as one SVG path in pixel space. `sx` maps metres to px, `sy` maps kph to px.
 * Each spline segment is an exact cubic Bezier (Hermite to Bezier), so the path is smooth and
 * small: one segment per bin, plus flat lead-in and lead-out to the straight's ends.
 */
export function tracePath(p: Profile, sx: (m: number) => number, sy: (kph: number) => number): string {
  const { xs, ys, ms } = spline(p);
  const n = xs.length;
  if (n === 0) return "";
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(sx(0))},${f(sy(ys[0]))}L${f(sx(xs[0]))},${f(sy(ys[0]))}`;
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i];
    const c1x = xs[i] + h / 3;
    const c1y = ys[i] + (ms[i] * h) / 3;
    const c2x = xs[i + 1] - h / 3;
    const c2y = ys[i + 1] - (ms[i + 1] * h) / 3;
    d += `C${f(sx(c1x))},${f(sy(c1y))} ${f(sx(c2x))},${f(sy(c2y))} ${f(sx(xs[i + 1]))},${f(sy(ys[i + 1]))}`;
  }
  d += `L${f(sx(p.length_m))},${f(sy(ys[n - 1]))}`;
  return d;
}

// ---------------------------------------------------------------- regimes

/** Index of the bin that contains d (clamped). */
export function binIndexAt(p: Profile, d: number): number {
  if (!p.bins.length) return -1;
  const i = Math.floor((d - p.bins[0].d_start_m) / p.bin_m);
  return Math.max(0, Math.min(p.bins.length - 1, i));
}

/*
 * Fallback only, for profiles served without the model's regime bins. It reads the bin's
 * median acceleration with the estimator's own 0.5 m/s² crossing level (model A_THRESH) and
 * calls a deceleration over 3 m/s² braking. Pages should pass `regimes` from the API.
 */
function regimeOfBin(p: Profile, i: number): Regime {
  const b = p.bins[i];
  if (p.regimes?.length) {
    let label: Regime = p.regimes[0].label;
    for (const r of p.regimes) if (r.d_start_m <= b.d_start_m + 1e-6) label = r.label;
    return label;
  }
  if (b.a_ms2 <= -3) return "brake";
  if (b.a_ms2 <= -0.5) return "lift";
  if (b.a_ms2 >= 0.5 && (p.cutoff_median_m === null || b.d_start_m < p.cutoff_median_m)) return "deploy";
  return "plateau";
}

export interface RegimeSpan {
  from_m: number;
  to_m: number;
  regime: Regime;
}

/** Consecutive bins with the same regime, merged: the colour band and the coloured trace. */
export function regimeSpans(p: Profile): RegimeSpan[] {
  const out: RegimeSpan[] = [];
  p.bins.forEach((b, i) => {
    const regime = regimeOfBin(p, i);
    const from = i === 0 ? 0 : b.d_start_m;
    const to = i === p.bins.length - 1 ? p.length_m : b.d_start_m + p.bin_m;
    const last = out[out.length - 1];
    if (last && last.regime === regime) last.to_m = to;
    else out.push({ from_m: from, to_m: to, regime });
  });
  return out;
}

// ---------------------------------------------------------------- the reading

export interface Reading {
  /** Distance along the straight, m (clamped to the straight). */
  d: number;
  /** Bin index under the cursor; the readout text changes only when this changes. */
  bin: number;
  /** Horizontal position, 0 at the start of the straight, 1 at its end. */
  x: number;
  /** Vertical position in the speed domain, 0 at the bottom, 1 at the top. */
  y: number;
  /** Speed on the trace, kph. */
  v: number;
  /** The bin's median acceleration, m/s². */
  a: number;
  regime: Regime;
  pastCutoff: boolean;
}

/** Everything the instrument shows at distance d. Pure: same profile and d, same reading. */
export function readAt(p: Profile, d: number): Reading {
  const L = p.length_m || 1;
  const dc = Math.max(0, Math.min(L, d));
  const bin = binIndexAt(p, dc);
  const v = speedAt(p, dc);
  const [lo, hi] = speedDomain(p);
  return {
    d: dc,
    bin,
    x: dc / L,
    y: (v - lo) / (hi - lo || 1),
    v,
    a: bin >= 0 ? p.bins[bin].a_ms2 : 0,
    regime: bin >= 0 ? regimeOfBin(p, bin) : "plateau",
    pastCutoff: p.cutoff_median_m !== null && dc >= p.cutoff_median_m,
  };
}

/** Where the cursor rests when nothing drives it (reduced motion, touch): the cut-off, the best frame. */
export function restingD(p: Profile): number {
  return p.cutoff_median_m ?? p.length_m / 2;
}
