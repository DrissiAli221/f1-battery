/*
 * Sessions `#/sessions` (DESIGN.md v3 "Pages → Sessions"): every ingested session, grouped by
 * race weekend, newest first. Each weekend is a card: flag, Grand Prix, circuit and dates with
 * the circuit's outline (local index, no request), then one tile per session with its median
 * cut-off on the main straight (est.), or a "no estimates" pill. Numbers load a few weekends
 * ahead of the reader through the rate-limit bucket (findings/throttle.ts); no traces.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Flag, Label, Tabs } from "../components/system";
import { useNearView } from "../findings/sessionRow";
import { useList } from "../lib/api";
import { href, useQueryState } from "../lib/router";
import type { SessionRow } from "../lib/types";
import { usePage } from "../motion";
import { circuitMeta, eventName } from "../track/circuits";
import { SessionTile, dayMonth } from "../landing/SessionCard";
import { Silhouette } from "../landing/Silhouette";
import "../landing/landing.css";

const TYPES = ["Race", "Sprint", "Qualifying", "Sprint Qualifying"] as const;
/** Weekends loaded ahead of the one nearest the viewport. */
const PREFETCH = 2;

/** "4–6 Sept 2026", "30 May – 1 Jun 2026". */
function range(list: SessionRow[]): string {
  const ds = list.map((s) => s.date_start).filter((d): d is string => !!d).sort();
  if (!ds.length) return "no date";
  const a = new Date(ds[0]);
  const b = new Date(ds[ds.length - 1]);
  if (a.getUTCDate() === b.getUTCDate() && a.getUTCMonth() === b.getUTCMonth()) return dayMonth(ds[0], true);
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${dayMonth(ds[ds.length - 1], true)}`;
  return `${dayMonth(ds[0])} – ${dayMonth(ds[ds.length - 1], true)}`;
}

export function SessionsPage() {
  const sessions = useList<SessionRow>("/sessions");
  const [query] = useQueryState();
  const type = query.get("type");
  const all = useMemo(() => sessions.data ?? [], [sessions.data]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of all) c.set(s.session_name, (c.get(s.session_name) ?? 0) + 1);
    return c;
  }, [all]);
  // Grouped by meeting, newest weekend first; sessions inside a weekend newest first too.
  const meetings = useMemo(() => {
    const by = new Map<number, SessionRow[]>();
    for (const s of all) {
      if (type && s.session_name !== type) continue;
      if (!by.has(s.meeting_key)) by.set(s.meeting_key, []);
      by.get(s.meeting_key)!.push(s);
    }
    return [...by.values()]
      .map((list) => list.sort((a, b) => (b.date_start ?? "").localeCompare(a.date_start ?? "")))
      .sort((a, b) => (b[0].date_start ?? "").localeCompare(a[0].date_start ?? ""));
  }, [all, type]);
  const root = usePage<HTMLDivElement>(undefined, [meetings]);
  // A weekend nearing the viewport also starts the next two, so numbers are in before they are read.
  const [reach, setReach] = useState(0);
  const seen = useCallback((i: number) => setReach((r) => Math.max(r, i)), []);
  const withResults = all.filter((s) => s.has_results).length;

  const tabs = [
    { key: "all", label: "All", count: sessions.data ? all.length : undefined },
    ...TYPES.filter((t) => counts.has(t)).map((t) => ({ key: t as string, label: t, count: counts.get(t) })),
  ];

  return (
    <div ref={root} className="lp sx">
      <section className="wrap sx-top" aria-labelledby="sx-h1">
        <div className="sx-top__main" data-intro>
          <Label as="p">2026 season</Label>
          <h1 id="sx-h1" className="sx-h1">
            Sessions
          </h1>
          <p className="sx-intro">
            Every ingested session, newest weekend first, with the median cut-off on each main straight (est.). Open one to read every straight, lap
            by lap.
          </p>
        </div>
        <p className="sx-count" data-intro>
          {sessions.data ? (
            <>
              <span className="num">{all.length}</span> sessions · <span className="num">{withResults}</span> with estimates
            </>
          ) : (
            <span className="shimmer shimmer--num" aria-hidden="true" />
          )}
        </p>
      </section>

      <div className="wrap sx-tabs" data-intro>
        <Tabs
          label="Filter by session type"
          items={tabs}
          value={type ?? "all"}
          onChange={(k) => {
            window.location.hash = k === "all" ? href.sessions() : href.sessions(k);
          }}
        />
      </div>

      <section className={`wrap sx-index ${sessions.data ? "" : "is-loading"}`} aria-label="Sessions by race weekend">
        {sessions.error && <p className="lp-empty">The session list could not be loaded: {sessions.error.message}</p>}
        {sessions.loading && (
          <div className="sx-skel" aria-busy="true">
            <div className="card sx-meeting sx-meeting--skel" />
            <div className="card sx-meeting sx-meeting--skel" />
          </div>
        )}
        {sessions.data && meetings.length === 0 && <p className="lp-empty">No sessions of this type yet.</p>}
        {meetings.map((m, i) => (
          <Meeting key={m[0].meeting_key} sessions={m} index={i} due={i <= reach + PREFETCH} onNear={seen} />
        ))}
      </section>
    </div>
  );
}

function Meeting({ sessions, index, due, onNear }: { sessions: SessionRow[]; index: number; due: boolean; onNear: (i: number) => void }) {
  const first = sessions[0];
  const id = `sx-m-${first.meeting_key}`;
  const meta = circuitMeta(first.circuit_key);
  const [ref, near] = useNearView<HTMLDivElement>("600px 0px");
  useEffect(() => {
    if (near) onNear(index);
  }, [near, index, onNear]);
  return (
    <div ref={ref}>
      <Card as="section" className="sx-meeting">
        <div className="sx-meeting__head" data-reveal>
          <Flag iso2={meta?.iso2} title={meta?.country} size={80} className="sx-meeting__flag" />
          <div className="sx-meeting__id">
            <h2 id={id} className="sx-meeting__gp">
              {eventName(first.circuit_key, first.circuit_short_name)}
            </h2>
            <p className="sx-meeting__sub">
              {meta?.name ?? first.circuit_short_name ?? "Unknown circuit"} · <span className="num">{range(sessions)}</span>
            </p>
          </div>
          <Silhouette circuitKey={first.circuit_key} className="sx-meeting__sil" />
        </div>
        <ul className="sx-tiles" aria-labelledby={id}>
          {sessions.map((s) => (
            <li key={s.session_key} data-reveal>
              <SessionTile session={s} due={due || near} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
