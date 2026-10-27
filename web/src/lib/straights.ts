import names from '../content/straight-names.json';
import { getAll, getJson, url } from './api';
import { along, lapLength, trackStraights, type TrackStraight } from './track';
import type { Outline, Straight } from './types';

const CURATED = names as Record<string, Record<string, string>>;

/** Outline distance is in decimetres (position units), so a lap length in metres is the last distance / 10. */
export function lapLengthM(outline: Outline | null): number | null {
  const last = outline?.points[outline.points.length - 1]?.d;
  return last && last > 0 ? last / 10 : null;
}

/**
 * Resolves a display name for every straight: a curated name for the circuit when one exists,
 * otherwise "Straight N · a–b km" from the start/end fractions and the outline length.
 */
export function nameStraights(
  straights: Straight[],
  circuitKey: number | null,
  outline: Outline | null
): Straight[] {
  const length = lapLengthM(outline);
  const km = (pct: number) => (((pct / 100) * (length as number)) / 1000).toFixed(1);
  return straights.map((s) => {
    const curated = circuitKey !== null ? CURATED[String(circuitKey)]?.[String(s.straight_id)] : undefined;
    if (curated) return { ...s, label: curated };
    const range = length ? ` · ${km(s.start_pct)}–${km(s.end_pct)} km` : '';
    return { ...s, label: `Straight ${s.straight_id}${range}` };
  });
}

// ---------------------------------------------------------------- metres into a straight

/*
 * Units, settled here once (D30): a profile's `bins` count metres from the straight's start,
 * but every cut-off the API serves (`cutoff_median_m`, `ci_low_m`, `ci_high_m` on the profile,
 * `cutoff_distance_median_m` and its interval in the summary, the per-lap cut-offs) is lap
 * distance from the start/finish line. A `StraightFrame` (the straight placed on the circuit's
 * outline) converts the second into the first. Pages pass it to `toProfile` and to
 * `intoStraight`; nothing else should subtract offsets by hand.
 */
export interface StraightFrame {
  /** The straight on the outline: d0 (start, m from the line), len (m), wrap-aware. */
  straight: TrackStraight;
  /** Lap length in metres (closed outline). */
  lap: number;
}

/** The frame for one straight from the circuit's straights and outline, or null if either is missing. */
export function straightFrame(
  straights: Straight[],
  outline: Outline | null,
  straightId: number
): StraightFrame | null {
  if (!outline || outline.points.length < 2) return null;
  const lap = lapLength(outline);
  const s = trackStraights(straights, lap).find((t) => t.straight_id === straightId);
  return s && lap > 0 ? { straight: s, lap } : null;
}

/**
 * Lap distance (m from the start/finish line) to metres into the straight. A point a few metres
 * before the straight's start (each driver's lap is measured on his own line) comes out at 0:
 * the site never prints a negative distance into a straight.
 */
export function intoStraight(frame: StraightFrame, lapM: number | null | undefined): number | null {
  if (lapM === null || lapM === undefined || !Number.isFinite(lapM)) return null;
  return Math.max(0, along(frame.straight, lapM, frame.lap));
}

/** Fetches (cached, the explorer's URLs) the circuit's straights and outline and builds the frame. */
export async function getStraightFrame(
  circuitKey: number,
  straightId: number
): Promise<StraightFrame | null> {
  const [straights, outline] = await Promise.all([
    getAll<Straight>(`/circuits/${circuitKey}/straights`),
    getJson<Outline>(url(`/circuits/${circuitKey}/outline`)),
  ]);
  return straightFrame(straights, outline, straightId);
}
