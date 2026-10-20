/*
 * Sessions `#/sessions`: the landing's index list at full size (DESIGN.md "The season"),
 * grouped by race weekend, newest first. Each row draws its own small trace (the session's
 * main-straight profile for one driver) instead of a floating image; its numbers load when
 * the row nears the viewport, through the rate-limit bucket. Hover or focus: the session
 * name's underline draws and the row's trace lights and runs its cursor.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CutTicks } from "../components/CutTicks";
import { Readout } from "../components/Readout";
import { Straight } from "../instrument/Straight";
import { useList } from "../lib/api";
import { int } from "../lib/format";
import { href, useQueryState } from "../lib/router";
import type { SessionRow } from "../lib/types";
import { usePage } from "../motion";
import { useNearView, useRowData } from "../findings/sessionRow";
import "../findings/findings.css";

const TYPES = ["Race", "Sprint", "Qualifying", "Sprint Qualifying"] as const;
const NB = " ";
/** Weekends loaded ahead of the one nearest the viewport. */
const PREFETCH = 3;

const dayMonth = (iso: string, withYear: boolean) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: withYear ? "numeric" : undefined, timeZone: "UTC" });

/** "4–6 Sept 2026", "30 May – 1 Jun 2026". */
function range(list: SessionRow[]): string {
  const ds = list.map((s) => s.date_start).filter((d): d is string => !!d).sort();
  if (!ds.length) return "no date";
  const a = new Date(ds[0]);
  const b = new Date(ds[ds.length - 1]);
  if (a.getUTCDate() === b.getUTCDate() && a.getUTCMonth() === b.getUTCMonth()) return dayMonth(ds[0], true);
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${dayMonth(ds[ds.length - 1], true)}`;
  return `${dayMonth(ds[0], false)} – ${dayMonth(ds[ds.length - 1], true)}`;
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function SessionsPage() {
  const sessions = useList<SessionRow>("/sessions");
  const [query] = useQueryState();
  const type = query.get("type");
  const all = sessions.data ?? [];
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of all) c.set(s.session_name, (c.get(s.session_name) ?? 0) + 1);
    return c;
  }, [all]);
  // Grouped by meeting, newest weekend first; sessions inside a weekend in running order.
  const meetings = useMemo(() => {
    const by = new Map<number, SessionRow[]>();
    for (const s of all) {
      if (type && s.session_name !== type) continue;
      if (!by.has(s.meeting_key)) by.set(s.meeting_key, []);
      by.get(s.meeting_key)!.push(s);
    }
    return [...by.values()]
      .map((list) => list.sort((a, b) => (a.date_start ?? "").localeCompare(b.date_start ?? "")))
      .sort((a, b) => (b[0].date_start ?? "").localeCompare(a[0].date_start ?? ""));
  }, [all, type]);
  const root = usePage<HTMLDivElement>(undefined, [meetings]);
  // Rows load a weekend at a time: the first weekends at once, then each weekend that comes
  // near the viewport also starts the next three, so the list is filled ahead of the reader.
  const [reach, setReach] = useState(0);
  const seen = useCallback((i: number) => setReach((r) => Math.max(r, i)), []);
  const withResults = all.filter((s) => s.has_results).length;

  return (
    <div ref={root}>
      <section className="wrap sx-top" aria-labelledby="sx-h1">
        <div data-intro>
          <h1 id="sx-h1" className="sx-h1">
            Sessions
          </h1>
          {/* Always rendered (it sits in the flow on phones): a shimmer until the list arrives, no shift. */}
          <Readout label="Sessions">
            {sessions.data ? (
              <>
                {all.length} sessions · {withResults} with estimates
              </>
            ) : (
              <span className="shimmer shimmer--num" aria-hidden="true" />
            )}
          </Readout>
        </div>
        <div data-intro data-delay="0.1">
          <p className="sx-intro">
            Every ingested 2026 session, newest weekend first. Each row draws the main straight with every driver’s median cut-off as a
            tick and prints the session median (est.), in metres from the start of the straight. Open one to read every straight, lap by lap.
          </p>
          <nav className="sx-filter" aria-label="Filter by session type">
            <a href={href.sessions()} aria-current={!type ? "true" : undefined}>
              All <span>{sessions.data ? all.length : ""}</span>
            </a>
            {TYPES.filter((t) => counts.has(t)).map((t) => (
              <a key={t} href={href.sessions(t)} aria-current={type === t ? "true" : undefined}>
                {t} <span>{counts.get(t)}</span>
              </a>
            ))}
          </nav>
        </div>
      </section>

      <section className={`wrap sx-index fx-section--tight ${sessions.data ? "" : "is-loading"}`} aria-label="Sessions by race weekend">
        {sessions.error && <p className="sx-intro">The session list could not be loaded: {sessions.error.message}</p>}
        {sessions.loading && <p className="sx-intro">Loading the sessions.</p>}
        {sessions.data && meetings.length === 0 && <p className="sx-intro">No sessions of this type yet.</p>}
        {meetings.length > 0 && (
          <div className="sx-legend" aria-hidden="true">
            <span>Session</span>
            <span>Date</span>
            <span>Drivers with a cut</span>
            <span>Median cut-off, main straight (est.)</span>
            <span>Main straight, one tick per driver (est.)</span>
            <span />
          </div>
        )}
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
  const [ref, near] = useNearView<HTMLElement>("600px 0px");
  useEffect(() => {
    if (near) onNear(index);
  }, [near, index, onNear]);
  return (
    <section ref={ref} className="sx-meeting" aria-labelledby={id}>
      <div className="sx-meeting__head" data-reveal>
        <h2 id={id} className="sx-h2">
          {first.circuit_short_name ?? "Unknown circuit"}
        </h2>
        <p className="sx-meeting__dates">{range(sessions)}</p>
      </div>
      <ul className="sx-rows">
        {sessions.map((s) => (
          <li key={s.session_key} data-reveal>
            <Row s={s} due={due || near} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A loading value: a short shimmer bar in the number's place, never an ellipsis. */
function Pending() {
  return (
    <>
      <span className="shimmer shimmer--num" aria-hidden="true" />
      <span className="sr-only">loading</span>
    </>
  );
}

function Row({ s, due }: { s: SessionRow; due: boolean }) {
  const data = useRowData(s, due);
  const [lit, setLit] = useState(false);
  const muted = !s.has_results;
  const pending = !muted && data.state !== "done";
  const date = s.date_start ? dayMonth(s.date_start, false) : "no date";
  const hasTicks = data.length !== null && data.ticks.length > 0;
  return (
    <a
      href={href.session(s.session_key)}
      className={`sx-row ${muted ? "is-muted" : ""}`}
      aria-busy={pending || undefined}
      onPointerEnter={(e) => e.pointerType === "mouse" && setLit(true)}
      onPointerLeave={() => setLit(false)}
      onFocus={() => setLit(true)}
      onBlur={() => setLit(false)}
    >
      <span className="sx-row__name draw">{s.session_name}</span>
      <span className="sx-row__meta">
        <span className="sx-row__date">{date}</span>
        {muted ? (
          <>
            <span className="sx-row__n">no estimates</span>
            <span className="sx-row__cut" />
          </>
        ) : (
          <>
            <span className="sx-row__n">
              {data.drivers !== null ? <b>{data.drivers}</b> : pending ? <Pending /> : <b>–</b>}
              <span className="sx-row__k">{NB}{data.drivers === 1 ? "driver" : "drivers"} with a cut</span>
            </span>
            <span className="sx-row__cut">
              {data.cutoff !== null ? (
                <b>
                  {int(data.cutoff)}
                  {NB}m
                </b>
              ) : pending ? (
                <Pending />
              ) : (
                <b>–</b>
              )}
              <span className="sx-row__k">
                {NB}median cut-off{data.straightName ? `, ${data.straightName.toLowerCase()}` : ""} (est.)
              </span>
            </span>
          </>
        )}
      </span>
      <span className={`sx-row__trace ${data.profile || hasTicks ? "" : "is-empty"}`} aria-hidden="true">
        {data.profile ? (
          <Straight profile={data.profile} size="row" active={lit} />
        ) : hasTicks ? (
          <CutTicks ticks={data.ticks} length={data.length as number} median={data.cutoff} active={lit} />
        ) : pending ? (
          <span className="shimmer shimmer--axis" />
        ) : (
          <span className="sx-row__axis" />
        )}
      </span>
      <span className="sx-row__go">
        <Arrow />
      </span>
    </a>
  );
}
