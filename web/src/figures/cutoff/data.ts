/*
 * Fig. 1's data: one cross-lap median profile (D30), Monza race, NOR, straight 2 (T1 to
 * Roggia, the explorer's default straight there). The profile's cut-off fields are lap
 * distances; the cam is drawn in metres along the straight, so they are converted with the
 * same `along()` the explorer uses (explorer/profile.ts).
 *
 * While the API serves the profile without bins (the model has not written them yet), the dev
 * server falls back to the instrument's fixture so the figure can be built and judged; a
 * production build shows no figure rather than invented numbers (AGENTS.md truth rules).
 */
import { useMemo } from "react";
import { url, useList, useLoad, useRemote, getProfile } from "../../lib/api";
import { lapLength, along, trackStraights } from "../../lib/track";
import type { Outline, SessionRow, Straight, StraightProfileResponse } from "../../lib/types";
import { toProfile, type Profile } from "../../instrument/driver";
import { MONZA_MAIN_FIXTURE } from "../../instrument/fixture";
import { straightLabel } from "../../landing/data";

export const FIG_SESSION = 11361;
export const FIG_STRAIGHT = 2;
export const FIG_DRIVER = 1;

export interface FigData {
  profile: Profile;
  /** e.g. "Monza race, T1 → Roggia, NOR" */
  source: string;
  fixture: boolean;
}

export function useFigData(): { data: FigData | null; settled: boolean } {
  const sessions = useList<SessionRow>("/sessions");
  const circuit = sessions.data?.find((s) => s.session_key === FIG_SESSION)?.circuit_key ?? null;
  const straights = useList<Straight>(circuit !== null ? `/circuits/${circuit}/straights` : null);
  const outline = useRemote<Outline>(circuit !== null ? url(`/circuits/${circuit}/outline`) : null);
  const prof = useLoad<StraightProfileResponse | null>(`fig1-${FIG_SESSION}-${FIG_STRAIGHT}-${FIG_DRIVER}`, () =>
    getProfile(FIG_SESSION, FIG_STRAIGHT, FIG_DRIVER).catch(() => null),
  );

  return useMemo(() => {
    const r = prof.data;
    const hasBins = !!r && r.bins.some((b) => Number.isFinite(b.v_kph) && Number.isFinite(b.a_ms2));
    if (hasBins && r) {
      if (!outline.data || !straights.data) return { data: null, settled: false };
      const lap = lapLength(outline.data);
      const s = trackStraights(straights.data, lap).find((x) => x.straight_id === FIG_STRAIGHT);
      if (!s) return { data: null, settled: true };
      const rel = (d: number | null) => (d === null ? null : along(s, d, lap));
      const bins = r.bins.filter((b) => Number.isFinite(b.v_kph) && Number.isFinite(b.a_ms2));
      const profile = toProfile({ ...r, bins, cutoff_median_m: rel(r.cutoff_median_m), ci_low_m: rel(r.ci_low_m), ci_high_m: rel(r.ci_high_m) });
      return { data: { profile, source: `Monza race, ${straightLabel(circuit, FIG_STRAIGHT)}, NOR`, fixture: false }, settled: true };
    }
    const settled = !prof.loading;
    if (settled && import.meta.env.DEV) {
      return { data: { profile: MONZA_MAIN_FIXTURE, source: "the dev fixture (invented numbers, never shipped)", fixture: true }, settled };
    }
    return { data: null, settled };
  }, [prof.data, prof.loading, outline.data, straights.data, circuit]);
}
