import names from "../content/straight-names.json";
import type { Outline, Straight } from "./types";

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
export function nameStraights(straights: Straight[], circuitKey: number | null, outline: Outline | null): Straight[] {
  const length = lapLengthM(outline);
  const km = (pct: number) => ((pct / 100) * (length as number) / 1000).toFixed(1);
  return straights.map((s) => {
    const curated = circuitKey !== null ? CURATED[String(circuitKey)]?.[String(s.straight_id)] : undefined;
    if (curated) return { ...s, label: curated };
    const range = length ? ` · ${km(s.start_pct)}–${km(s.end_pct)} km` : "";
    return { ...s, label: `Straight ${s.straight_id}${range}` };
  });
}
