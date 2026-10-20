import { useMemo, useState } from "react";
import { CutTicks } from "../components/CutTicks";
import { Straight } from "../instrument/Straight";
import { int } from "../lib/format";
import { href } from "../lib/router";
import type { SessionRow } from "../lib/types";
import { useRowData } from "../findings/sessionRow";

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
          The latest races and sprints. Each row is the session's main straight: every driver's median cut-off as a tick,
          the session median drawn taller and printed in metres from the start of that straight.
        </p>
      </div>

      <div className="season__head" aria-hidden="true">
        <span>Circuit</span>
        <span>Date</span>
        <span>Session</span>
        <span className="season__head-cut">Median cut-off (est.)</span>
        <span className="season__head-trace">Main straight, one tick per driver (est.)</span>
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
  const [hot, setHot] = useState(false);
  // Ten rows, about 30 requests with the circuits shared: they are all queued at once through
  // the rate-limit bucket (findings/throttle.ts), so the list is filled before it is reached.
  const row = useRowData(session, true);
  const cut = row.cutoff;
  const pending = row.state !== "done";
  const circuit = session.circuit_short_name ?? `Session ${session.session_key}`;

  return (
    <li className="season__li" data-reveal>
      <a
        href={href.session(session.session_key)}
        className={`season__row ${hot ? "is-hot" : ""}`}
        aria-busy={pending || undefined}
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
              <span className="num">{int(cut)}</span>&nbsp;m <span className="season__est">est.</span>
            </>
          ) : pending ? (
            <>
              <span className="shimmer shimmer--num" aria-hidden="true" />
              <span className="sr-only">loading</span>
            </>
          ) : (
            <>
              <span className="num">–</span> <span className="season__est">no cut-off</span>
            </>
          )}
        </span>
        <span className="season__trace" aria-hidden="true">
          {row.profile ? (
            <Straight profile={row.profile} size="row" active={hot} />
          ) : row.length !== null && row.ticks.length ? (
            <CutTicks ticks={row.ticks} length={row.length} median={cut} active={hot} />
          ) : pending ? (
            <span className="shimmer shimmer--axis" />
          ) : (
            <span className="season__axis" />
          )}
        </span>
      </a>
    </li>
  );
}
