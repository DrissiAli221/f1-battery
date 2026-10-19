import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Arrow, Async, Empty, Eyebrow } from "../components/ui";
import { TrackArt } from "../components/TrackArt";
import { url, useList, useRemote } from "../lib/api";
import { date } from "../lib/format";
import { href, useQueryState } from "../lib/router";
import type { Outline, SessionRow } from "../lib/types";

const TYPES = ["Race", "Sprint", "Qualifying", "Sprint Qualifying"] as const;

export function SessionsPage() {
  const sessions = useList<SessionRow>("/sessions");
  const [query, setQuery] = useQueryState();
  const type = query.get("type");
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of sessions.data ?? []) c.set(s.session_name, (c.get(s.session_name) ?? 0) + 1);
    return c;
  }, [sessions.data]);
  // Grouped by meeting (one card per race weekend), newest first; the filter narrows the sessions inside.
  const meetings = useMemo(() => {
    const by = new Map<number, SessionRow[]>();
    for (const s of sessions.data ?? []) {
      if (type && s.session_name !== type) continue;
      if (!by.has(s.meeting_key)) by.set(s.meeting_key, []);
      by.get(s.meeting_key)!.push(s);
    }
    return [...by.values()]
      .map((list) => list.sort((a, b) => (a.date_start ?? "").localeCompare(b.date_start ?? "")))
      .sort((a, b) => (b[0].date_start ?? "").localeCompare(a[0].date_start ?? ""));
  }, [sessions.data, type]);

  return (
    <>
      <section className="wrap pb-16 pt-16 md:pb-24 md:pt-24">
        <Eyebrow>Explorer</Eyebrow>
        <h1 className="display mt-6 text-[48px] md:text-[88px]">Sessions</h1>
        <p className="lede mt-8 max-w-[56ch]">
          Every ingested 2026 session, grouped by race weekend. Open one to see where each car stops deploying electrical energy on every straight, lap by
          lap. Sessions without results are ingested but have no published model output yet.
        </p>
        <div className="mt-12 flex flex-wrap gap-3" role="group" aria-label="Filter by session type">
          <button type="button" className="sel-btn" aria-pressed={!type} onClick={() => setQuery({ type: null })}>
            All <span className="num opacity-60">{sessions.data?.length ?? ""}</span>
          </button>
          {TYPES.filter((t) => counts.has(t)).map((t) => (
            <button key={t} type="button" className="sel-btn" aria-pressed={type === t} onClick={() => setQuery({ type: t })}>
              {t} <span className="num opacity-60">{counts.get(t)}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="wrap pb-32">
        <Async remote={sessions}>
          {() =>
            meetings.length === 0 ? (
              <Empty title="No sessions">The database has no sessions of this type yet.</Empty>
            ) : (
              <motion.ul layout className="grid gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-3">
                <AnimatePresence initial={false}>
                  {meetings.map((m) => (
                    <motion.li
                      key={m[0].meeting_key}
                      layout
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.22 }}
                    >
                      <MeetingCard sessions={m} />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </motion.ul>
            )
          }
        </Async>
      </section>
    </>
  );
}

function MeetingCard({ sessions }: { sessions: SessionRow[] }) {
  const first = sessions[0];
  const outline = useRemote<Outline>(first.circuit_key !== null ? url(`/circuits/${first.circuit_key}/outline`) : null);
  const any = sessions.some((s) => s.has_results);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xs bg-surface">
      <div className="flex items-start justify-between gap-6 p-7 md:p-8">
        <div className="min-w-0">
          <p className="num text-[14px] text-ink-3">{date(first.date_start, "short")}</p>
          <p className="mt-3 break-words font-display text-[20px] font-bold uppercase leading-tight text-ink-head md:text-[22px]">{first.circuit_short_name ?? "Unknown circuit"}</p>
        </div>
        <div className="h-[96px] w-[120px] shrink-0 sm:w-[150px]">
          {outline.data && outline.data.points.length > 1 && (
            <TrackArt outline={outline.data} width={150} height={96} stroke={2} glow={false} animate={false} colour={any ? "var(--brand)" : "var(--ink-4)"} className="h-full w-full" />
          )}
        </div>
      </div>
      <ul className="mt-auto border-t border-line-2">
        {sessions.map((s) => (
          <li key={s.session_key} className="border-b border-line-2 last:border-b-0">
            <a href={href.session(s.session_key)} className="group flex h-14 items-center gap-4 px-7 transition-colors hover:bg-white/[0.03] md:px-8">
              <span className="flex-1 text-[15px] font-semibold text-ink-head">{s.session_name}</span>
              <span className="num hidden text-[13px] text-ink-3 sm:inline">{date(s.date_start, "short")}</span>
              {s.has_results ? <span className="badge badge-ok">Results</span> : <span className="badge badge-muted">No results</span>}
              <Arrow className="text-ink-3 transition-transform group-hover:translate-x-1 group-hover:text-ink-head" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
