import { useMemo } from 'react';
import { getAll, url, useList, useLoad, useRemote } from '../lib/api';
import { nameStraights } from '../lib/straights';
import { lapLength, trackStraights, type TrackStraight } from '../lib/track';
import type {
  Driver,
  Lap,
  Outline,
  RegimeBin,
  ResultRow,
  SessionRow,
  Straight,
  SummaryDriver,
} from '../lib/types';

export type Median = { m: number; lo: number | null; hi: number | null };

export interface SessionData {
  session: SessionRow | null;
  sessionsError: Error | null;
  sessionsLoaded: boolean;
  drivers: Driver[];
  outline: Outline | null;
  outlineError: Error | null;
  lap: number | null;
  straights: TrackStraight[];
  summary: SummaryDriver[] | null;
  /** driver -> straight -> median cut-off with interval */
  medians: Map<number, Map<number, Median>>;
  laps: Map<number, Lap[]>;
  /** Drivers with at least one straight median, the only ones the explorer can show. */
  withResults: Driver[];
  defaultDriver: number | null;
  ready: boolean;
}

/** Everything the explorer needs for one session that does not depend on the selection. */
export function useSessionData(key: number): SessionData {
  const sessions = useList<SessionRow>('/sessions');
  const session = sessions.data?.find((s) => s.session_key === key) ?? null;
  const drivers = useList<Driver>(`/sessions/${key}/drivers`);
  const circuit = session?.circuit_key ?? null;
  const straights = useList<Straight>(circuit !== null ? `/circuits/${circuit}/straights` : null);
  const outline = useRemote<Outline>(circuit !== null ? url(`/circuits/${circuit}/outline`) : null);
  const summary = useList<SummaryDriver>(session?.has_results ? `/sessions/${key}/summary` : null);
  // All drivers' laps in one paged request rather than one per driver.
  const laps = useList<Lap>(`/sessions/${key}/laps`);

  const lap = outline.data && outline.data.points.length > 1 ? lapLength(outline.data) : null;

  const named = useMemo(
    () =>
      lap && straights.data ? trackStraights(nameStraights(straights.data, circuit, outline.data), lap) : [],
    [lap, straights.data, circuit, outline.data]
  );

  const medians = useMemo(() => {
    const out = new Map<number, Map<number, Median>>();
    for (const r of summary.data ?? []) {
      const m = new Map<number, Median>();
      for (const s of r.straights) {
        if (s.cutoff_distance_median_m !== null)
          m.set(s.straight_id, { m: s.cutoff_distance_median_m, lo: s.ci_low, hi: s.ci_high });
      }
      out.set(r.driver_number, m);
    }
    return out;
  }, [summary.data]);

  const lapsBy = useMemo(() => {
    const out = new Map<number, Lap[]>();
    for (const l of laps.data ?? []) {
      if (!out.has(l.driver_number)) out.set(l.driver_number, []);
      out.get(l.driver_number)!.push(l);
    }
    for (const list of out.values()) list.sort((a, b) => a.lap_number - b.lap_number);
    return out;
  }, [laps.data]);

  const withResults = useMemo(
    () => (drivers.data ?? []).filter((d) => (medians.get(d.driver_number)?.size ?? 0) > 0),
    [drivers.data, medians]
  );

  const summaryReady = !session?.has_results || summary.data !== null || summary.error !== null;
  // Wait for the summary before choosing, so the page does not load (and animate) a provisional driver.
  const defaultDriver = useMemo(
    () =>
      summaryReady
        ? pickDefault(session, withResults.length ? withResults : (drivers.data ?? []), lapsBy)
        : null,
    [summaryReady, session, withResults, drivers.data, lapsBy]
  );
  return {
    session,
    sessionsError: sessions.error,
    sessionsLoaded: sessions.data !== null,
    drivers: drivers.data ?? [],
    outline: outline.data,
    outlineError: outline.error,
    lap,
    straights: named,
    summary: summary.data,
    medians,
    laps: lapsBy,
    withResults,
    defaultDriver,
    ready: session !== null && drivers.data !== null && laps.data !== null && summaryReady,
  };
}

/**
 * Default driver: in a race or sprint the winner (most laps, then the earliest end of the
 * last lap); in qualifying the driver with the fastest timed lap. The API has no
 * classification, so this is derived from the lap table.
 */
function pickDefault(session: SessionRow | null, pool: Driver[], laps: Map<number, Lap[]>): number | null {
  if (!pool.length) return null;
  const isRace = session?.session_name === 'Race' || session?.session_name === 'Sprint';
  const scored = pool.map((d) => {
    const list = (laps.get(d.driver_number) ?? []).filter((l) => l.lap_duration !== null);
    const last = list[list.length - 1];
    const end = last?.date_start ? Date.parse(last.date_start) + (last.lap_duration ?? 0) * 1000 : Infinity;
    const best = Math.min(...list.map((l) => l.lap_duration as number), Infinity);
    return { n: d.driver_number, laps: list.length, end, best };
  });
  scored.sort(isRace ? (a, b) => b.laps - a.laps || a.end - b.end : (a, b) => a.best - b.best);
  return scored[0].n;
}

export type Cutoffs = Map<number, Map<number, number>>;

/** Per-lap cut-off distance for one driver: lap -> straight -> metres. */
export function useCutoffs(session: number, driver: number | null, enabled: boolean): Cutoffs | null {
  const r = useLoad<ResultRow[]>(enabled && driver !== null ? `cut:${session}:${driver}` : null, () =>
    getAll<ResultRow>('/results', { session, driver, variable: 'cutoff_distance_m' })
  );
  return useMemo(() => {
    if (!r.data) return null;
    const out: Cutoffs = new Map();
    for (const row of r.data) {
      if (row.value === null || row.straight_id === null || row.lap_number < 1) continue;
      if (!out.has(row.lap_number)) out.set(row.lap_number, new Map());
      out.get(row.lap_number)!.set(row.straight_id, row.value);
    }
    return out;
  }, [r.data]);
}

/** Regime bins for one lap; keeps the previous lap's bins on screen while the next loads. */
export function useRegimes(session: number, driver: number | null, lap: number | null, enabled: boolean) {
  const key = enabled && driver !== null && lap !== null ? `reg:${session}:${driver}:${lap}` : null;
  return useLoad<{ lap: number; bins: RegimeBin[] }>(
    key,
    () =>
      getAll<RegimeBin>(`/sessions/${session}/laps/${lap}/regimes`, { driver }).then((bins) => ({
        lap: lap as number,
        bins,
      })),
    true
  );
}
