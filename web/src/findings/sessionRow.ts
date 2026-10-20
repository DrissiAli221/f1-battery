/*
 * Data for one index row (the sessions page and the landing's season list), queued through the
 * rate-limit bucket (throttle.ts) once the row is due. Per row: the session summary (every
 * driver's median cut-off per straight), the circuit's straights and outline (shared per
 * circuit, the explorer's URLs), then the profile of one driver on the main straight.
 *
 * Units: the summary's medians are lap distance from the start/finish line; every number the
 * row prints or draws is converted to metres into the straight with the straight's frame
 * (lib/straights.ts), so a cut-off can never print negative.
 *
 * Main straight: the curated "Main straight" / "Pit straight" when the circuit has one with
 * medians (content/straight-names.json), otherwise the straight with a median for the most
 * drivers, ties to the longest. The row's driver: the one whose median is nearest the
 * session median, so the small trace is representative of the number printed next to it.
 */
import { useEffect, useRef, useState } from "react";
import straightNames from "../content/straight-names.json";
import { getAll, getJson, url } from "../lib/api";
import { intoStraight, straightFrame } from "../lib/straights";
import type { Outline, SessionRow, Straight, SummaryDriver } from "../lib/types";
import type { Profile } from "../instrument/driver";
import { loadStraightProfile } from "../instrument/load";
import { limited } from "./throttle";

const CURATED = straightNames as Record<string, Record<string, string>>;

export interface RowData {
  /** idle: not due yet; loading: requests queued or running; done: settled (data or not). */
  state: "idle" | "loading" | "done";
  drivers: number | null;
  /** Session median of the drivers' median cut-offs on the main straight, m into it (est.). */
  cutoff: number | null;
  straightName: string | null;
  /** Length of the main straight on the outline, m: the scale of `ticks`. */
  length: number | null;
  /** Each driver's median cut-off on the main straight, m into it: the row's drawn ticks. */
  ticks: number[];
  profile: Profile | null;
}

const EMPTY: RowData = { state: "idle", drivers: null, cutoff: null, straightName: null, length: null, ticks: [], profile: null };

/** True once the element has come within `margin` of the viewport. */
export function useNearView<T extends Element>(margin = "300px 0px"): [React.RefObject<T>, boolean] {
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
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return [ref, seen];
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Results are kept per session for the visit, so a row remounting (filters, back) is instant. */
const done = new Map<number, RowData>();

export function useRowData(session: SessionRow, active: boolean): RowData {
  const key = session.session_key;
  const [data, setData] = useState<RowData>(() => done.get(key) ?? EMPTY);
  const circuit = session.circuit_key;
  useEffect(() => {
    if (!active || !session.has_results || done.has(key)) return;
    let live = true;
    setData((d) => ({ ...d, state: "loading" }));
    (async () => {
      const summary = await limited(`sum:${key}`, () => getAll<SummaryDriver>(`/sessions/${key}/summary`));
      const withCut = summary.filter((d) => d.straights.some((s) => s.cutoff_distance_median_m !== null));
      const [straights, outline] =
        circuit !== null
          ? await Promise.all([
              limited(`str:${circuit}`, () => getAll<Straight>(`/circuits/${circuit}/straights`)),
              limited(`out:${circuit}`, () => getJson<Outline>(url(`/circuits/${circuit}/outline`))).catch(() => null),
            ])
          : [[] as Straight[], null];
      const count = (id: number) => withCut.filter((d) => d.straights.some((s) => s.straight_id === id && s.cutoff_distance_median_m !== null)).length;
      const curated = circuit !== null ? CURATED[String(circuit)] ?? {} : {};
      const named = Object.entries(curated).find(([id, name]) => /^(main|pit) straight$/i.test(name) && count(Number(id)) > 0);
      const span = (s: Straight) => (s.end_pct >= s.start_pct ? s.end_pct - s.start_pct : 100 - s.start_pct + s.end_pct);
      const best = straights
        .filter((s) => count(s.straight_id) > 0)
        .sort((a, b) => count(b.straight_id) - count(a.straight_id) || span(b) - span(a))[0];
      const straightId = named ? Number(named[0]) : best?.straight_id ?? null;
      const straightName = straightId === null ? null : curated[String(straightId)] ?? `straight ${straightId}`;
      const frame = straightId !== null ? straightFrame(straights, outline, straightId) : null;
      // Without a frame the medians cannot be placed on the straight: show the driver count only.
      const per = frame
        ? withCut
            .map((d) => ({ n: d.driver_number, m: intoStraight(frame, d.straights.find((s) => s.straight_id === straightId)?.cutoff_distance_median_m) }))
            .filter((x): x is { n: number; m: number } => x.m !== null)
        : [];
      const cutoff = median(per.map((x) => x.m));
      const base: RowData = {
        state: "loading",
        drivers: withCut.length,
        cutoff,
        straightName,
        length: frame?.straight.len ?? null,
        ticks: per.map((x) => x.m),
        profile: null,
      };
      if (!live) return;
      setData(base);
      let profile: Profile | null = null;
      if (straightId !== null && cutoff !== null && circuit !== null && frame) {
        const pick = [...per].sort((a, b) => Math.abs(a.m - cutoff) - Math.abs(b.m - cutoff))[0];
        profile = await limited(`prof:${key}:${straightId}:${pick.n}`, () => loadStraightProfile(key, circuit, straightId, pick.n, frame), true).catch(
          () => null, // endpoint absent or no bins yet: the row keeps its ticks
        );
      }
      const final = { ...base, profile, state: "done" as const };
      done.set(key, final);
      if (live) setData(final);
    })().catch(() => live && setData((d) => ({ ...d, state: "done" })));
    return () => {
      live = false;
    };
  }, [active, key, circuit, session.has_results]);
  return data;
}
