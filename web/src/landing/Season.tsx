import { useEffect, useMemo, useRef, useState } from "react";
import { Straight } from "../instrument/Straight";
import { int } from "../lib/format";
import { href } from "../lib/router";
import type { SessionRow } from "../lib/types";
import { useRow } from "./data";

const ROWS = 10;

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "–";

/*
 * Index list (DESIGN.md "THE SEASON"): one row per race or sprint with results, newest first.
 * Each row loads its numbers and its own trace only once it comes near the viewport (data.ts
 * spaces those requests). Hover or keyboard focus: the circuit name's underline draws, the
 * row's trace lights and its cursor runs.
 */
export function Season({ sessions, loading }: { sessions: SessionRow[]; loading: boolean }) {
  const rows = useMemo(
    () =>
      sessions
        .filter((s) => s.has_results && (s.session_name === "Race" || s.session_name === "Sprint"))
        .sort((a, b) => (b.date_start ?? "").localeCompare(a.date_start ?? ""))
        .slice(0, ROWS),
    [sessions],
  );
  const total = useMemo(() => sessions.filter((s) => s.has_results).length, [sessions]);

  return (
    <section className="season wrap" aria-labelledby="season-h">
      <div className="section-intro">
        <h2 id="season-h" className="section-intro__title" data-reveal>
          The season
        </h2>
        <p className="section-intro__text" data-reveal>
          The latest races and sprints. Each row draws its main straight from the session's own median profile, with the
          median cut-off in metres from the start of that straight.
        </p>
      </div>

      <div className="season__head" aria-hidden="true">
        <span>Circuit</span>
        <span>Date</span>
        <span>Session</span>
        <span className="season__head-cut">Cut-off, into it</span>
        <span className="season__head-trace">Main straight</span>
      </div>
      {loading && !rows.length ? (
        <p className="season__empty">Loading the season.</p>
      ) : !rows.length ? (
        <p className="season__empty">No published races or sprints yet.</p>
      ) : (
        <ul className="season__list">
          {rows.map((s) => (
            <SeasonRow key={s.session_key} session={s} />
          ))}
        </ul>
      )}
      <p className="season__all" data-reveal>
        <a href={href.sessions()} className="link">
          All sessions
        </a>
        {total > 0 && (
          <span className="season__count">
            {" "}
            <span className="num">{total}</span> with published estimates
          </span>
        )}
      </p>
    </section>
  );
}

function SeasonRow({ session }: { session: SessionRow }) {
  const li = useRef<HTMLLIElement>(null);
  const [seen, setSeen] = useState(false);
  const [hot, setHot] = useState(false);
  useEffect(() => {
    const el = li.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: "200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const row = useRow(session, seen);
  const cut = row.cutoff;
  const circuit = session.circuit_short_name ?? `Session ${session.session_key}`;

  return (
    <li ref={li} className="season__li" data-reveal>
      <a
        href={href.session(session.session_key)}
        className={`season__row ${hot ? "is-hot" : ""}`}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHot(true)}
        onPointerLeave={() => setHot(false)}
        onFocus={() => setHot(true)}
        onBlur={() => setHot(false)}
      >
        <span className="season__name">{circuit}</span>
        <span className="season__date num">{day(session.date_start)}</span>
        <span className="season__type">{session.session_name}</span>
        <span className="season__cut">
          {cut !== null ? (
            <>
              <span className="num">{cut < 0 ? `\u2212${int(-cut)}` : int(cut)}</span>&nbsp;m <span className="season__est">est.</span>
            </>
          ) : (
            <>
              <span className="num">–</span> <span className="season__est">est.</span>
              {row.state === "loading" && <span className="sr-only"> loading</span>}
            </>
          )}
        </span>
        <span className="season__trace" aria-hidden="true">
          {row.profile ? <Straight profile={row.profile} size="row" active={hot} /> : <span className="season__axis" />}
        </span>
      </a>
    </li>
  );
}
