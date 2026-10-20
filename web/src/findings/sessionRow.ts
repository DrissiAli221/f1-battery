/*
 * Data for one row of the sessions index, fetched only once the row nears the viewport and
 * queued through the rate-limit bucket (throttle.ts). Per row: the session summary (drivers
 * with a cut and their per-straight medians), the circuit's straights (shared per circuit),
 * then the profile of one driver on the main straight.
 *
 * Main straight: the curated "Main straight" / "Pit straight" when the circuit has one
 * (content/straight-names.json), otherwise the longest straight that has medians.
 * The row's driver: the one whose median cut-off on that straight is nearest the session
 * median, so the small trace is representative of the number printed next to it. (The
 * explorer's own default, the race winner, needs the full lap table: too many requests for
 * an index row.)
 */
import { useEffect, useRef, useState } from "react";
import straightNames from "../content/straight-names.json";
import { getAll, getProfile } from "../lib/api";
import { toProfile, type Profile } from "../instrument/driver";
import type { SessionRow, Straight, SummaryDriver } from "../lib/types";
import { limited } from "./throttle";

const CURATED = straightNames as Record<string, Record<string, string>>;

export interface RowData {
  drivers: number | null;
  cutoff: number | null;
  straightName: string | null;
  profile: Profile | null;
  /** True once every request this row will make has settled. */
  done: boolean;
}

const EMPTY: RowData = { drivers: null, cutoff: null, straightName: null, profile: null, done: false };

/** True once the element has come within 300 px of the viewport. */
export function useNearView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

const span = (s: Straight) => (s.end_pct >= s.start_pct ? s.end_pct - s.start_pct : 100 - s.start_pct + s.end_pct);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function useRowData(session: SessionRow, active: boolean): RowData {
  const [data, setData] = useState<RowData>(EMPTY);
  const key = session.session_key;
  const circuit = session.circuit_key;
  useEffect(() => {
    if (!active || !session.has_results) return;
    let live = true;
    (async () => {
      const summary = await limited(`sum:${key}`, () => getAll<SummaryDriver>(`/sessions/${key}/summary`));
      const withCut = summary.filter((d) => d.straights.some((s) => s.cutoff_distance_median_m !== null));
      const straights = circuit !== null ? await limited(`str:${circuit}`, () => getAll<Straight>(`/circuits/${circuit}/straights`)) : [];
      const curated = circuit !== null ? CURATED[String(circuit)] ?? {} : {};
      const hasMedian = (id: number) => withCut.some((d) => d.straights.some((s) => s.straight_id === id && s.cutoff_distance_median_m !== null));
      const named = Object.entries(curated).find(([id, name]) => /^(main|pit) straight$/i.test(name) && hasMedian(Number(id)));
      const longest = straights.filter((s) => hasMedian(s.straight_id)).sort((a, b) => span(b) - span(a))[0];
      const straightId = named ? Number(named[0]) : longest?.straight_id ?? null;
      const straightName = straightId === null ? null : curated[String(straightId)] ?? `straight ${straightId}`;
      const per = withCut
        .map((d) => ({ n: d.driver_number, m: d.straights.find((s) => s.straight_id === straightId)?.cutoff_distance_median_m ?? null }))
        .filter((x): x is { n: number; m: number } => x.m !== null);
      const cutoff = median(per.map((x) => x.m));
      if (!live) return;
      setData({ drivers: withCut.length, cutoff, straightName, profile: null, done: false });
      if (straightId === null || cutoff === null) {
        setData((d) => ({ ...d, done: true }));
        return;
      }
      const pick = [...per].sort((a, b) => Math.abs(a.m - cutoff) - Math.abs(b.m - cutoff))[0];
      const profile = await limited(`prof:${key}:${straightId}:${pick.n}`, () => getProfile(key, straightId, pick.n))
        .then((r) => (r.bins.length ? toProfile(r) : null))
        .catch(() => null); // endpoint absent or no profile: the row keeps its bare axis
      if (live) setData((d) => ({ ...d, profile, done: true }));
    })().catch(() => live && setData((d) => ({ ...d, done: true })));
    return () => {
      live = false;
    };
  }, [active, key, circuit, session.has_results]);
  return data;
}
