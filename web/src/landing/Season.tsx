import { useMemo } from "react";
import { SectionHead } from "../components/system";
import { href } from "../lib/router";
import type { SessionRow } from "../lib/types";
import { SessionCard } from "./SessionCard";

/** Cards on the landing: three rows at desktop width. The sessions page has the rest. */
const CARDS = 9;

/*
 * The season (DESIGN.md v3 "Pages → Landing"): the latest races and sprints with results as
 * cards, newest first, three per row at lg, two at md, one on phones. Each card loads its
 * number when it nears the viewport (SessionCard), through the shared rate-limit bucket.
 */
export function Season({ sessions, loading }: { sessions: SessionRow[]; loading: boolean }) {
  const cards = useMemo(
    () =>
      sessions
        .filter((s) => s.has_results && (s.session_name === "Race" || s.session_name === "Sprint"))
        .sort((a, b) => (b.date_start ?? "").localeCompare(a.date_start ?? ""))
        .slice(0, CARDS),
    [sessions],
  );
  const total = useMemo(() => sessions.filter((s) => s.has_results).length, [sessions]);

  return (
    <section className="lp-section wrap" aria-labelledby="season-h">
      <SectionHead
        label="The season"
        title={<span id="season-h">Race by race</span>}
        aside={
          <a href={href.sessions()} className="lp-more">
            All sessions{total > 0 && <span className="num"> · {total} with estimates</span>}
          </a>
        }
      >
        <p>The latest races and sprints, newest first, with the median cut-off on each main straight (est.).</p>
      </SectionHead>
      {loading && !cards.length ? (
        <div className="sgrid" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="card scard scard--skel" />
          ))}
        </div>
      ) : !cards.length ? (
        <p className="lp-empty">No published races or sprints yet.</p>
      ) : (
        <div className="sgrid">
          {cards.map((s) => (
            <SessionCard key={s.session_key} session={s} />
          ))}
        </div>
      )}
    </section>
  );
}
