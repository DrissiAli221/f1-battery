/*
 * The landing's data. Everything is fetched at runtime from the API (D30: nothing derived is
 * committed under src/content except the curated findings and method log).
 *
 * Budget per visit (API limit: 60 requests per minute per IP, docs/api-contract.md):
 *   1   /sessions (shared with the other pages through the getJson cache)
 *   1-2 the hero profile: Monza race, NOR, main straight first, then straight 2
 *   2   Monza's straights and outline (the hero's frame: cut-off metres into the straight)
 *   1   /sessions/11361/summary (the driver code; also the Monza row's summary, cached)
 *   1   /sessions/11361/laps?driver=1 (the clean-lap count behind the medians)
 *   the season rows (Season.tsx, findings/sessionRow.ts): per row its summary and its
 *     main-straight profile, plus the circuit's straights and outline once per circuit;
 *     10 rows on 6 or so circuits, about 32, through the shared rate-limit bucket.
 * About 40 requests on a first visit, all cached for the rest of the visit.
 */
import { useEffect, useState } from "react";
import names from "../content/straight-names.json";
import { getAll } from "../lib/api";
import type { Lap, SessionRow, SummaryDriver } from "../lib/types";
import type { Profile } from "../instrument/driver";
import { loadStraightProfile } from "../instrument/load";
import type { StraightLabels } from "../instrument/Straight";

export const HERO_SESSION = 11361; // Monza, race
export const HERO_DRIVER = 1; // NOR
const HERO_CIRCUIT = 39; // Monza
/** Straight ids tried in order: the curated main straight, then T1 to Roggia (the explorer's default). */
const HERO_STRAIGHTS = [1, 2];

const CURATED = names as Record<string, Record<string, string>>;

/** "Main straight" reads "main straight" mid-caption; "T1 → Roggia" keeps its capital. */
function midSentence(s: string): string {
  return s.length > 1 && s[1] === s[1].toLowerCase() && /[a-z]/.test(s[1]) ? s[0].toLowerCase() + s.slice(1) : s;
}

export function straightLabel(circuitKey: number | null, straightId: number): string {
  const curated = circuitKey !== null ? CURATED[String(circuitKey)]?.[String(straightId)] : undefined;
  return curated ? midSentence(curated) : `straight ${straightId}`;
}

// ---------------------------------------------------------------- hero

export interface HeroData {
  /** null while pending, or when nothing could be loaded in production. */
  profile: Profile | null;
  status: "pending" | "real" | "fixture" | "missing";
  straightId: number | null;
  labels: StraightLabels;
}

export function useHero(session: SessionRow | null): HeroData {
  const [state, setState] = useState<{ profile: Profile | null; status: HeroData["status"]; straightId: number | null; fixtureLabels?: StraightLabels }>({
    profile: null,
    status: "pending",
    straightId: null,
  });
  const [driver, setDriver] = useState<string | null>(null);
  const [laps, setLaps] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      for (const sid of HERO_STRAIGHTS) {
        try {
          const p = await loadStraightProfile(HERO_SESSION, HERO_CIRCUIT, sid, HERO_DRIVER);
          if (p) {
            if (live) setState({ profile: p, status: "real", straightId: sid });
            return;
          }
        } catch {
          /* not published for this straight: try the next one */
        }
      }
      // Dev server only: the fixture, so the page can be judged before the endpoint ships. The
      // DEV guard lets the production build drop the import (and the fixture) entirely.
      if (import.meta.env.DEV) {
        const f = await import("../instrument/fixture");
        if (live) setState({ profile: f.MONZA_MAIN_FIXTURE, status: "fixture", straightId: 1, fixtureLabels: { ...f.MONZA_MAIN_FIXTURE_LABELS, driver: "NOR, fixture" } });
        return;
      }
      if (live) setState({ profile: null, status: "missing", straightId: null });
    })();
    getAll<SummaryDriver>(`/sessions/${HERO_SESSION}/summary`)
      .then((rows) => live && setDriver(rows.find((r) => r.driver_number === HERO_DRIVER)?.name_acronym ?? null))
      .catch(() => undefined);
    getAll<Lap>(`/sessions/${HERO_SESSION}/laps`, { driver: HERO_DRIVER })
      .then((rows) => live && setLaps(rows.filter((l) => l.driver_number === HERO_DRIVER && l.green === true).length))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (state.status === "fixture" && state.fixtureLabels) return { ...state, labels: state.fixtureLabels };

  const circuit = session?.circuit_short_name ?? "Monza";
  const code = driver ?? "NOR";
  const labels: StraightLabels = {
    circuit,
    straight: straightLabel(session?.circuit_key ?? 39, state.straightId ?? HERO_STRAIGHTS[0]),
    driver: state.status === "missing" ? `${code}, profile not published yet` : code,
    laps: state.status === "real" && laps ? laps : undefined,
  };
  return { profile: state.profile, status: state.status, straightId: state.straightId, labels };
}
