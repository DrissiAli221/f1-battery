import { url, useRemote } from "./api";
import type { Page, SessionRow } from "./types";
import { Async, Empty } from "./ui";

export function SessionsPage() {
  const sessions = useRemote<Page<SessionRow>>(url("/sessions", { size: 1000 }));
  return (
    <>
      <h1>Sessions</h1>
      <p className="lede">
        Pick a session to see where each car stops deploying electrical power along the straights. Sessions marked
        "no results" are ingested but the model has not published output for them yet.
      </p>
      <p className="note">
        How the method was checked, and what changed along the way: <a href="#/method">Method log</a>.
      </p>
      <Async remote={sessions}>
        {(page) =>
          page.items.length === 0 ? (
            <Empty title="No sessions loaded">The database has no sessions yet. Run the ingest job first.</Empty>
          ) : (
            <ul className="sessions">
              {page.items.map((s) => (
                <li key={s.session_key}>
                  <a href={`#/session/${s.session_key}`} className="session-link">
                    <span className="s-main">
                      {s.circuit_short_name ?? "Unknown circuit"} <span className="muted">{s.session_name}</span>
                    </span>
                    <span className="s-meta">
                      {s.date_start ? new Date(s.date_start).toLocaleDateString(undefined, { dateStyle: "medium" }) : "no date"}
                      <span className={s.has_results ? "pill ok" : "pill"}>{s.has_results ? "results" : "no results"}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </>
  );
}
