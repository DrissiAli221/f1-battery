import { useMemo } from "react";
import { ApiError, getProfile, profileUrl, useLoad } from "../lib/api";
import { along, wrap, type TrackStraight } from "../lib/track";
import type { RegimeBin, RegimeLabel, StraightProfileResponse } from "../lib/types";
import { toProfile, type Profile, type RegimeMark } from "../instrument/driver";
import type { Median } from "./data";

/*
 * The explorer's adapter between the API and the instrument.
 *
 * Units: profile bins are metres from the straight's start (D30), but the profile's cut-off
 * fields come from `cutoff_distance_median_m`, which is lap distance from the start/finish
 * line, like the per-lap cut-offs and the regime bins. Everything the instrument draws is
 * converted here to metres along the straight with `along()`.
 */

export type ProfileState =
  | { kind: "loading" }
  | { kind: "none" } // no rows (empty bins) or no endpoint yet: draw the regime bins only
  | { kind: "error"; error: Error }
  | { kind: "ready"; data: StraightProfileResponse };

/** One driver's profile on one straight. A 404 (endpoint or rows not there yet) reads as "none". */
export function useProfile(session: number, straight: number | null, driver: number | null, enabled: boolean): ProfileState {
  const key = enabled && straight !== null && driver !== null ? profileUrl(session, straight, driver) : null;
  const r = useLoad<StraightProfileResponse | null>(key, () =>
    getProfile(session, straight as number, driver as number).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
  );
  if (key === null) return { kind: "none" };
  if (r.error) return { kind: "error", error: r.error };
  if (r.loading) return { kind: "loading" };
  if (!r.data || !r.data.bins.some((b) => b.v_kph !== null && b.v_kph !== undefined)) return { kind: "none" };
  return { kind: "ready", data: r.data };
}

/** Regime label at a lap distance from the lap's 50 m regime bins (null where unlabelled). */
export function regimeAtLap(bins: Map<number, RegimeLabel> | null, d: number, lap: number): RegimeLabel | null {
  if (!bins) return null;
  return bins.get(Math.floor(wrap(d, lap) / 50) * 50) ?? null;
}

export function regimeIndex(bins: RegimeBin[] | null | undefined): Map<number, RegimeLabel> | null {
  if (!bins?.length) return null;
  return new Map(bins.map((b) => [Math.round(b.d_start_m), b.label]));
}

/** Lap distance to metres along the straight. */
export const rel = (s: TrackStraight, d: number | null | undefined, lap: number): number | null =>
  d === null || d === undefined ? null : along(s, d, lap);

/** The instrument's profile for one straight: straight-relative cut-off, the shown lap's regimes. */
export function useStraightProfile(
  state: ProfileState,
  s: TrackStraight | null,
  lap: number | null,
  regimes: Map<number, RegimeLabel> | null,
): Profile | null {
  return useMemo(() => {
    if (state.kind !== "ready" || !s || !lap) return null;
    const r = state.data;
    const bins = r.bins.filter((b) => Number.isFinite(b.v_kph) && Number.isFinite(b.a_ms2));
    let marks: RegimeMark[] | undefined;
    if (regimes) {
      marks = [];
      let last: RegimeLabel | null = null;
      for (const b of bins) {
        const label: RegimeLabel | null = regimeAtLap(regimes, s.d0 + b.d_start_m + r.bin_m / 2, lap) ?? last;
        if (label && label !== last) marks.push({ d_start_m: b.d_start_m, label });
        last = label;
      }
      if (!marks.length) marks = undefined;
    }
    return toProfile(
      { ...r, bins, cutoff_median_m: rel(s, r.cutoff_median_m, lap), ci_low_m: rel(s, r.ci_low_m, lap), ci_high_m: rel(s, r.ci_high_m, lap) },
      marks,
    );
  }, [state, s, lap, regimes]);
}

/** A median in metres along the straight. */
export function relMedian(s: TrackStraight, m: Median | undefined, lap: number): Median | null {
  if (!m) return null;
  return { m: along(s, m.m, lap), lo: rel(s, m.lo, lap), hi: rel(s, m.hi, lap) };
}

/*
 * Default straight when the URL names none: the longest straight with a cut-off for the
 * driver that does not cross the start/finish line. A straight across the line splices the
 * end of one lap onto the start of the next (the model needs both laps clean), so its profile
 * rests on fewer laps and its start is the grid's standing start in lap 1; the longest clean
 * straight shows the deploy, the taper and the plateau most fully (Monza: S2, not S1).
 */
export function defaultStraight(straights: TrackStraight[], has: (id: number) => boolean): number | null {
  const pool = straights.filter((s) => has(s.straight_id));
  const inLap = pool.filter((s) => s.d1 > s.d0);
  const list = inLap.length ? inLap : pool.length ? pool : straights;
  if (!list.length) return null;
  return list.reduce((a, b) => (b.len > a.len ? b : a)).straight_id;
}
