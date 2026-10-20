/*
 * The landing's data. Everything is fetched at runtime from the API (D30: nothing derived is
 * committed under src/content except the curated findings and method log).
 *
 * Budget per visit (API limit: 60 requests per minute per IP, docs/api-contract.md):
 *   1   /sessions (shared with the other pages through the getJson cache)
 *   1-2 the "how it is read" profile: Monza race, NOR, main straight first, then straight 2
 *   2   Monza's straights and outline (the profile's frame: cut-off metres into the straight)
 *   2   /sessions/11361/summary (the driver code) and /sessions/11361/laps?driver=1 (clean laps)
 *   the last race: its summary, its circuit's straights and outline (3)
 *   the season cards (SessionCard.tsx): per card its summary, per circuit its straights and
 *     outline, each once the card nears the viewport; nine cards on about seven circuits,
 *     about 20, through the shared rate-limit bucket (findings/throttle.ts). No profiles.
 * About 30 requests on a first visit, all cached for the rest of the visit.
 */
import { useEffect, useState } from "react";
import names from "../content/straight-names.json";
import { getAll, getJson, url } from "../lib/api";
import { intoStraight, straightFrame, type StraightFrame } from "../lib/straights";
import { lapLength, trackStraights, type TrackStraight } from "../lib/track";
import type { Lap, Outline, SessionRow, Straight, SummaryDriver } from "../lib/types";
import { limited } from "../findings/throttle";
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

// ---------------------------------------------------------------- the main straight of a session

/*
 * One session's main straight and every driver's median cut-off on it (est.), for the landing's
 * "Last race" card, the season cards and the sessions page. Requests go through the rate-limit
 * bucket with the same keys as findings/sessionRow.ts, so a summary or an outline asked for by
 * both is fetched once: per session its summary, per circuit its straights and outline. No
 * speed profile is fetched here (a card shows a number, not a trace).
 *
 * Main straight: the curated "Main straight" / "Pit straight" when the circuit has one with
 * medians, otherwise the straight with a median for the most drivers, ties to the longest.
 * Units: the summary serves lap distance from the start/finish line; `m`, `median` and
 * `half` are converted to metres into the straight (lib/straights.ts), never negative.
 */
export interface DriverCut {
  driver: SummaryDriver;
  /** Lap distance of the median cut-off (m from the line): where the tag sits on the map. */
  d: number;
  /** Metres into the straight (est.). */
  m: number;
  /** Half the width of the median's interval, m, or null. */
  half: number | null;
}

export interface MainStraight {
  state: "idle" | "loading" | "done";
  /** Every driver in the summary. */
  drivers: SummaryDriver[];
  /** Drivers with at least one cut-off on any straight. */
  withCut: number | null;
  straightId: number | null;
  straightName: string | null;
  straights: TrackStraight[];
  outline: Outline | null;
  frame: StraightFrame | null;
  /** Drivers with a median cut-off on the main straight. */
  cuts: DriverCut[];
  /** Median of the drivers' medians on the main straight, m into it (est.). */
  median: number | null;
}

const IDLE: MainStraight = {
  state: "idle",
  drivers: [],
  withCut: null,
  straightId: null,
  straightName: null,
  straights: [],
  outline: null,
  frame: null,
  cuts: [],
  median: null,
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

const mainCache = new Map<number, Promise<MainStraight>>();

export function loadMainStraight(session: SessionRow): Promise<MainStraight> {
  const key = session.session_key;
  const hit = mainCache.get(key);
  if (hit) return hit;
  const circuit = session.circuit_key;
  const p = (async (): Promise<MainStraight> => {
    const [summary, raw, outline] = await Promise.all([
      limited(`sum:${key}`, () => getAll<SummaryDriver>(`/sessions/${key}/summary`)),
      circuit !== null ? limited(`str:${circuit}`, () => getAll<Straight>(`/circuits/${circuit}/straights`)) : Promise.resolve([] as Straight[]),
      circuit !== null
        ? limited(`out:${circuit}`, () => getJson<Outline>(url(`/circuits/${circuit}/outline`))).catch(() => null)
        : Promise.resolve(null),
    ]);
    const has = (d: SummaryDriver, id: number) => d.straights.some((s) => s.straight_id === id && s.cutoff_distance_median_m !== null);
    const withCut = summary.filter((d) => d.straights.some((s) => s.cutoff_distance_median_m !== null));
    const count = (id: number) => withCut.filter((d) => has(d, id)).length;
    const curated = circuit !== null ? CURATED[String(circuit)] ?? {} : {};
    const named = Object.entries(curated).find(([id, name]) => /^(main|pit) straight$/i.test(name) && count(Number(id)) > 0);
    const span = (s: Straight) => (s.end_pct >= s.start_pct ? s.end_pct - s.start_pct : 100 - s.start_pct + s.end_pct);
    const best = raw.filter((s) => count(s.straight_id) > 0).sort((a, b) => count(b.straight_id) - count(a.straight_id) || span(b) - span(a))[0];
    const straightId = named ? Number(named[0]) : best?.straight_id ?? null;
    const straightName = straightId === null ? null : curated[String(straightId)] ?? `Straight ${straightId}`;
    const lap = outline && outline.points.length > 1 ? lapLength(outline) : 0;
    const straights = lap > 0 ? trackStraights(raw, lap) : [];
    const frame = straightId !== null ? straightFrame(raw, outline, straightId) : null;
    const cuts: DriverCut[] = [];
    if (frame && straightId !== null) {
      for (const d of summary) {
        const s = d.straights.find((x) => x.straight_id === straightId);
        const lapM = s?.cutoff_distance_median_m;
        const m = intoStraight(frame, lapM);
        if (m === null || lapM === null || lapM === undefined) continue;
        const half = s && s.ci_low !== null && s.ci_high !== null ? Math.abs(s.ci_high - s.ci_low) / 2 : null;
        cuts.push({ driver: d, d: lapM, m, half });
      }
    }
    return {
      state: "done",
      drivers: summary,
      withCut: withCut.length,
      straightId,
      straightName,
      straights,
      outline,
      frame,
      cuts,
      median: median(cuts.map((c) => c.m)),
    };
  })();
  mainCache.set(key, p);
  p.catch(() => mainCache.delete(key)); // a failure can be retried on a later visit
  return p;
}

/** The main straight of a session once `active` (e.g. near the viewport); sessions without results stay idle. */
export function useMainStraight(session: SessionRow | null, active = true): MainStraight {
  const [state, setState] = useState<MainStraight>(IDLE);
  const key = session?.session_key ?? null;
  useEffect(() => {
    if (!session || !active || !session.has_results) return;
    let live = true;
    setState((s) => (s.state === "done" ? s : { ...IDLE, state: "loading" }));
    loadMainStraight(session)
      .then((r) => live && setState(r))
      .catch(() => live && setState({ ...IDLE, state: "done" }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, session?.has_results]);
  return state;
}
