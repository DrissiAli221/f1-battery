/*
 * Fig. 1's model: the threshold-crossing estimator read off one speed profile, as a pure
 * function of the profile. No DOM. The drawing and the readout both come from here.
 *
 * The estimator (model/f1battery_model/derate.py, `threshold_crossing`): on a 0.25 s grid, the
 * cut-off is the first step q where acceleration stays below A_CROSS = 0.5 m/s² for
 * CROSS_STEPS = 4 steps in a row and the speed at q is above CROSS_V_MIN_KPH = 250 kph.
 *
 * The figure runs that rule down one cross-lap median profile (D30): the cam is cut to the
 * profile's speed, the 0.25 s ticks are laid along it by integrating time over distance
 * (dt = dd / v), and the acceleration at each tick is the profile's median acceleration where
 * the follower rides (`accelAt`). The cut-off it finds is that of the median profile, which is
 * not the median of the per-lap cut-offs; the caption says so and the ruler carries the
 * session's own median interval as a bracket.
 */
import { speedAt, speedDomain, type Profile } from "../../instrument/driver";

export const A_CROSS = 0.5; // m/s²
export const CROSS_STEPS = 4;
export const CROSS_V_MIN_KPH = 250;
export const GRID_S = 0.25; // s

/**
 * Acceleration at d, m/s²: the profile's own per-bin median acceleration (the median of the
 * per-lap mean acceleration in each 50 m bin, D30), linear between bin centres. Not the slope
 * of the median speeds: those are rounded to whole kph, and differentiating them invents
 * steps of about 0.7 m/s² on the plateau.
 */
export function accelAt(p: Profile, d: number): number {
  const bins = p.bins;
  if (!bins.length) return 0;
  const c = (i: number) => bins[i].d_start_m + p.bin_m / 2;
  if (d <= c(0)) return bins[0].a_ms2;
  const n = bins.length;
  if (d >= c(n - 1)) return bins[n - 1].a_ms2;
  let i = Math.min(n - 2, Math.max(0, Math.floor((d - c(0)) / p.bin_m)));
  while (i > 0 && d < c(i)) i--;
  while (i < n - 2 && d > c(i + 1)) i++;
  const t = (d - c(i)) / (c(i + 1) - c(i));
  return bins[i].a_ms2 + (bins[i + 1].a_ms2 - bins[i].a_ms2) * t;
}

export interface Tick {
  d: number;
  v: number;
  a: number;
  below: boolean;
}

export interface Reading {
  ticks: Tick[];
  /** Index of the first tick of the qualifying run, or null. */
  q: number | null;
  /** Cut-off on the median profile, m along the straight. */
  cutoff: number | null;
  /** Where the run is confirmed (the fourth tick): the pawl drops here. */
  confirm: number | null;
  /** Speed axis of the cam, kph. */
  domain: [number, number];
}

/** Lays the 0.25 s grid down the straight and runs the crossing rule. */
export function readProfile(p: Profile): Reading {
  const ticks: Tick[] = [];
  const L = p.length_m;
  // Integrate time over distance in 1 m steps; a tick every 0.25 s of car time.
  let t = 0;
  let next = 0;
  for (let x = 0; x <= L; x += 1) {
    const v = Math.max(1, speedAt(p, x)) / 3.6;
    if (t >= next - 1e-9) {
      const a = accelAt(p, x);
      ticks.push({ d: x, v: v * 3.6, a, below: a < A_CROSS });
      next += GRID_S;
    }
    t += 1 / v;
  }
  let q: number | null = null;
  for (let i = 0; i + CROSS_STEPS <= ticks.length; i++) {
    let all = true;
    for (let j = 0; j < CROSS_STEPS; j++) all = all && ticks[i + j].below;
    if (all && ticks[i].v > CROSS_V_MIN_KPH) {
      q = i;
      break;
    }
  }
  return {
    ticks,
    q,
    cutoff: q === null ? null : ticks[q].d,
    confirm: q === null ? null : ticks[q + CROSS_STEPS - 1].d,
    domain: speedDomain(p),
  };
}

/** Index of the last tick at or before d. */
export function tickAt(r: Reading, d: number): number {
  let lo = 0;
  let hi = r.ticks.length - 1;
  if (hi < 0 || d < r.ticks[0].d) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r.ticks[mid].d <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * How many of the four lamps are lit at d: the length of the run of below-threshold ticks
 * ending at the current tick, counted only from a tick above 250 kph, capped at four. Once the
 * run is confirmed the lamps stay full until the carriage goes back before the cut-off.
 */
export function lampsAt(r: Reading, d: number): number {
  if (r.confirm !== null && d >= r.confirm) return CROSS_STEPS;
  const i = tickAt(r, d);
  if (i < 0) return 0;
  let n = 0;
  for (let j = i; j >= 0 && r.ticks[j].below && n < CROSS_STEPS; j--) n++;
  if (n === 0) return 0;
  const start = i - n + 1;
  return r.ticks[start].v > CROSS_V_MIN_KPH ? n : 0;
}

export const fmtM = (m: number) => Math.round(m).toLocaleString("en-GB");
export const fmtA = (a: number) => `${a < 0 ? "−" : ""}${Math.abs(a).toFixed(1)}`;

/** The card's readout at d. */
export function readoutAt(r: Reading, p: Profile, d: number): string {
  const head = `d ${fmtM(d)} m · ${fmtA(accelAt(p, d))} m/s²`;
  if (r.cutoff !== null && r.confirm !== null && d >= r.confirm) return `${head} · cut-off at ${fmtM(r.cutoff)} m`;
  return head;
}
