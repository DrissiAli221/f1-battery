/*
 * The landing's data. Everything is fetched at runtime from the API (D30: nothing derived is
 * committed under src/content except the curated findings and method log).
 *
 * Budget per visit (API limit: 60 requests per minute per IP, docs/api-contract.md):
 *   1   /sessions (shared with the other pages through the getJson cache)
 *   1-2 the hero profile: Monza race, NOR, main straight first, then straight 2
 *   1   /sessions/11361/summary (the driver code; also the Monza row's summary, cached)
 *   1   /sessions/11361/laps?driver=1 (the clean-lap count behind the medians)
 *   per season row, only once the row scrolls near the viewport: its summary and its
 *     main-straight profile (2), plus the circuit's straights and outline (2, once per
 *     circuit, the same URLs the explorer uses); at most 10 rows on 8 or so circuits, so
 *     about 36, started at least 400 ms apart.
 * Worst case about 42 requests on a first visit, all cached for the rest of the visit.
 */
import { useEffect, useRef, useState } from "react";
import names from "../content/straight-names.json";
import { getAll, getJson, getProfile, url } from "../lib/api";
import { along, lapLength, trackStraights, type TrackStraight } from "../lib/track";
import type { Lap, Outline, SessionRow, Straight, SummaryDriver } from "../lib/types";
import { toProfile, type Profile } from "../instrument/driver";
import type { StraightLabels } from "../instrument/Straight";

export const HERO_SESSION = 11361; // Monza, race
export const HERO_DRIVER = 1; // NOR
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

// ---------------------------------------------------------------- request spacing

/*
 * Lazy row requests go through one queue, started at least GAP_MS apart, so a fast scroll past
 * the season list cannot burst the API's per-minute budget. A 429 pauses the queue for the
 * Retry-After the API suggests (or 10 s) and the request is not retried: the row keeps its
 * axis only.
 */
const GAP_MS = 400;
let chain: Promise<void> = Promise.resolve();
let nextSlot = 0;

export function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const turn = chain.then(async () => {
    const wait = nextSlot - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nextSlot = Date.now() + GAP_MS;
  });
  const run = turn.then(fn).catch((e: unknown) => {
    if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 429) nextSlot = Date.now() + 10_000;
    throw e;
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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
          const r = await getProfile(HERO_SESSION, sid, HERO_DRIVER);
          if (r.bins.length > 1) {
            if (live) setState({ profile: toProfile(r), status: "real", straightId: sid });
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

// ---------------------------------------------------------------- season rows

export interface RowData {
  state: "idle" | "loading" | "done" | "error";
  /** The session's main straight: the one most drivers have a cut-off on, then the longest. */
  straightId: number | null;
  /** The driver shown: the first in the summary with a cut-off on that straight. */
  driver: number | null;
  /** That driver's median cut-off, metres from the start of the straight (est.). */
  cutoff: number | null;
  profile: Profile | null;
}

/*
 * "Main straight": the straight with a cut-off for the most drivers in the session, ties going
 * to the longest. Not the curated "main" or "pit" name: at Singapore the pit straight carries
 * no cut-off at all (no derating there), so the row would show nothing.
 */
function mainStraight(rows: SummaryDriver[], straights: TrackStraight[]): TrackStraight | null {
  const count = new Map<number, number>();
  for (const r of rows) for (const s of r.straights) if (s.cutoff_distance_median_m !== null) count.set(s.straight_id, (count.get(s.straight_id) ?? 0) + 1);
  let best: TrackStraight | null = null;
  for (const st of straights) {
    const n = count.get(st.straight_id) ?? 0;
    if (!n) continue;
    const bn = best ? count.get(best.straight_id) ?? 0 : -1;
    if (n > bn || (n === bn && best && st.len > best.len)) best = st;
  }
  return best;
}

/** Loads one row's numbers and trace the first time `visible` turns true. */
export function useRow(session: SessionRow, visible: boolean): RowData {
  const [data, setData] = useState<RowData>({ state: "idle", straightId: null, driver: null, cutoff: null, profile: null });
  // A latch, not effect cleanup: the request must survive the state change it causes (and
  // StrictMode's double effect run); `alive` only stops updates after unmount.
  const started = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!visible || started.current) return;
    started.current = true;
    const set = (d: RowData | ((d: RowData) => RowData)) => alive.current && setData(d);
    set((d) => ({ ...d, state: "loading" }));
    (async () => {
      const c = session.circuit_key;
      if (c === null) throw new Error("no circuit");
      const rows = await spaced(() => getAll<SummaryDriver>(`/sessions/${session.session_key}/summary`));
      // Same URLs as the explorer (explorer/data.ts), so a click through costs nothing more.
      const straights = await spaced(() => getAll<Straight>(`/circuits/${c}/straights`));
      const outline = await spaced(() => getJson<Outline>(url(`/circuits/${c}/outline`)));
      const lap = outline.points.length > 1 ? lapLength(outline) : null;
      if (!lap) throw new Error("no outline");
      const main = mainStraight(rows, trackStraights(straights, lap));
      const sid = main?.straight_id ?? null;
      const pick = main ? rows.find((r) => r.straights.some((s) => s.straight_id === sid && s.cutoff_distance_median_m !== null)) : undefined;
      const lapM = pick?.straights.find((s) => s.straight_id === sid)?.cutoff_distance_median_m ?? null;
      const cutoff = main && lapM !== null ? along(main, lapM, lap) : null;
      const base: RowData = { state: "done", straightId: sid, driver: pick?.driver_number ?? null, cutoff, profile: null };
      set(base);
      if (sid === null || !pick) return;
      try {
        const r = await spaced(() => getProfile(session.session_key, sid, pick.driver_number));
        if (r.bins.length > 1) set({ ...base, profile: toProfile(r) });
      } catch {
        /* profile not published: the row keeps its axis */
      }
    })().catch(() => set((d) => ({ ...d, state: "error" })));
  }, [visible, session]);
  return data;
}
