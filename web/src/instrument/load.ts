import { getProfile } from "../lib/api";
import { getStraightFrame, type StraightFrame } from "../lib/straights";
import { toProfile, type Profile } from "./driver";

/**
 * One driver's cross-lap profile on one straight, ready for the instrument: the cut-off and
 * its interval converted to metres into the straight through the circuit's frame. Null when
 * the profile has no bins yet (the endpoint answers `bins: []` until the model writes them).
 * Network errors propagate; a missing frame leaves the cut-off out rather than misplace it.
 */
export async function loadStraightProfile(
  sessionKey: number,
  circuitKey: number,
  straightId: number,
  driver: number,
  frame?: StraightFrame | null,
): Promise<Profile | null> {
  const [r, f] = await Promise.all([
    getProfile(sessionKey, straightId, driver),
    frame !== undefined ? Promise.resolve(frame) : getStraightFrame(circuitKey, straightId).catch(() => null),
  ]);
  const bins = r.bins.filter((b) => Number.isFinite(b.v_kph) && Number.isFinite(b.a_ms2));
  if (bins.length < 2) return null;
  const clean = { ...r, bins };
  return f ? toProfile(clean, undefined, f) : toProfile({ ...clean, cutoff_median_m: null, ci_low_m: null, ci_high_m: null });
}
