import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "../components/Driver";
import { Async, Empty, Eyebrow, SectionHead } from "../components/ui";
import { url, useList, useRemote } from "../lib/api";
import { date, int } from "../lib/format";
import { href } from "../lib/router";
import { driverCode, teamColour } from "../lib/teams";
import { project } from "../lib/track";
import { useSize } from "../lib/useSize";
import type { Driver, Outline, RegimeLabel, SessionRow } from "../lib/types";

type LiveRegime = RegimeLabel | "other";

interface LiveState {
  driver_number: number;
  ts: string;
  regime: LiveRegime;
  lap_distance_est: number;
}

type Status = "connecting" | "connected" | "no-data" | "disabled" | "no-topic" | "error";

const COLORS: Record<LiveRegime, string> = {
  deploy: "var(--regime-deploy)",
  plateau: "var(--regime-plateau)",
  lift: "var(--regime-lift)",
  brake: "var(--regime-brake)",
  other: "var(--regime-other)",
};

const STATUS: Record<Status, { text: string; badge: string }> = {
  connecting: { text: "Connecting", badge: "badge-muted" },
  connected: { text: "Live", badge: "badge-ok" },
  "no-data": { text: "Connected, no data yet", badge: "badge-muted" },
  disabled: { text: "Replay disabled", badge: "badge-warn" },
  "no-topic": { text: "No replay running", badge: "badge-warn" },
  error: { text: "Connection lost, retrying", badge: "badge-pink" },
};

/**
 * Subscribes to /api/live/<key>. EventSource cannot read the status code, so a probe request
 * distinguishes "replay disabled" (404 with a JSON body) from a transient connection failure.
 */
function useLive(sessionKey: number): { status: Status; states: Record<number, LiveState> } {
  const [status, setStatus] = useState<Status>("connecting");
  const [states, setStates] = useState<Record<number, LiveState>>({});
  const pending = useRef<Record<number, LiveState>>({});

  useEffect(() => {
    setStatus("connecting");
    setStates({});
    pending.current = {};
    let es: EventSource | null = null;
    let closed = false;
    const target = url(`/live/${sessionKey}`);

    // Batches bursts of events into one render per 100 ms.
    const timer = window.setInterval(() => {
      if (Object.keys(pending.current).length) {
        const batch = pending.current;
        pending.current = {};
        setStates((s) => ({ ...s, ...batch }));
        setStatus((st) => (st === "no-data" || st === "connecting" ? "connected" : st));
      }
    }, 100);

    const open = () => {
      es = new EventSource(target);
      es.addEventListener("status", (e) => {
        try {
          const s = JSON.parse((e as MessageEvent).data) as { state: string };
          if (s.state === "no-topic") {
            setStatus("no-topic");
            es?.close();
          } else setStatus("no-data");
        } catch {
          /* ignore malformed status */
        }
      });
      es.addEventListener("state", (e) => {
        try {
          const s = JSON.parse((e as MessageEvent).data) as LiveState;
          pending.current[s.driver_number] = s;
        } catch {
          /* ignore malformed record */
        }
      });
      es.onerror = () => {
        es?.close();
        if (closed) return;
        fetch(target, { headers: { Accept: "application/json" } })
          .then(async (res) => {
            if (res.status === 404) setStatus("disabled");
            else {
              setStatus("error");
              window.setTimeout(() => !closed && open(), 3000);
            }
            res.body?.cancel().catch(() => undefined);
          })
          .catch(() => {
            setStatus("error");
            window.setTimeout(() => !closed && open(), 3000);
          });
      };
    };
    open();
    return () => {
      closed = true;
      es?.close();
      window.clearInterval(timer);
    };
  }, [sessionKey]);

  return { status, states };
}

export function LivePage({ sessionKey }: { sessionKey: number | null }) {
  return sessionKey === null ? <LiveIndex /> : <LiveSession sessionKey={sessionKey} />;
}

function LiveIndex() {
  const sessions = useList<SessionRow>("/sessions");
  const races = useMemo(
    () =>
      (sessions.data ?? [])
        .filter((s) => s.session_name === "Race" || s.session_name === "Sprint")
        .sort((a, b) => (b.date_start ?? "").localeCompare(a.date_start ?? "")),
    [sessions.data],
  );
  return (
    <>
      <section className="wrap pb-16 pt-16 md:pb-24 md:pt-24">
        <Eyebrow>Live replay</Eyebrow>
        <h1 className="display mt-6 text-[48px] md:text-[88px]">Live</h1>
        <p className="lede mt-8 max-w-[60ch]">
          A recorded race replayed through Kafka at real speed: one dot per car on the track, coloured by a simplified live regime estimate.
          It runs only when the replay producer and consumer are started on the server (docs/phase7-replay.md).
        </p>
      </section>
      <section className="wrap pb-32">
        <Async remote={sessions}>
          {() => (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {races.map((s) => (
                <li key={s.session_key}>
                  <a href={href.live(s.session_key)} className="flex h-full flex-col rounded-xs bg-surface p-7 transition-colors hover:bg-[var(--color-surface-btn-other--pressed)]">
                    <span className="num text-[13px] text-ink-3">{date(s.date_start, "short")}</span>
                    <span className="mt-6 font-display text-[20px] font-bold uppercase text-ink-head">{s.circuit_short_name}</span>
                    <span className="text-[15px] text-ink-2">{s.session_name}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </section>
    </>
  );
}

/**
 * The replay's distance is a running integral from when the consumer started, not from the
 * start/finish line, so dots are placed at (distance mod lap length): speed and motion are
 * right, the absolute position is approximate and drifts (docs/phase7-replay.md).
 */
function LiveSession({ sessionKey }: { sessionKey: number }) {
  const sessions = useList<SessionRow>("/sessions");
  const session = sessions.data?.find((s) => s.session_key === sessionKey) ?? null;
  const drivers = useList<Driver>(`/sessions/${sessionKey}/drivers`);
  const outline = useRemote<Outline>(session?.circuit_key != null ? url(`/circuits/${session.circuit_key}/outline`) : null);
  const { status, states } = useLive(sessionKey);
  const names = useMemo(() => new Map((drivers.data ?? []).map((d) => [d.driver_number, d])), [drivers.data]);
  const rows = Object.values(states).sort((a, b) => a.driver_number - b.driver_number);
  const [ref, { w: W, h: H }] = useSize<HTMLDivElement>();
  const T = useMemo(() => (outline.data && outline.data.points.length > 1 && W > 0 ? project(outline.data, W, H, { l: 48, r: 48, t: 48, b: 48 }) : null), [outline.data, W, H]);

  return (
    <>
      <section className="wrap pb-12 pt-14 md:pb-16 md:pt-20">
        <nav className="mb-8 flex items-center gap-2 text-[14px] text-ink-3" aria-label="Breadcrumb">
          <a className="prose-link" href={href.live()}>
            Live
          </a>
          <span aria-hidden="true">/</span>
          <a className="prose-link" href={href.session(sessionKey)}>
            {session?.circuit_short_name ?? `Session ${sessionKey}`}
          </a>
        </nav>
        <Eyebrow>
          Live replay · session <span className="num">{sessionKey}</span>
        </Eyebrow>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
          <h1 className="font-display text-[40px] font-bold uppercase leading-none text-ink-head md:text-[64px]">
            {session?.circuit_short_name ?? "…"} <span className="text-ink-3">{session?.session_name}</span>
          </h1>
          <span className={`badge ${STATUS[status].badge}`} role="status">
            {STATUS[status].text}
          </span>
        </div>
      </section>
      {status === "disabled" ? (
        <section className="wrap pb-32">
          <Empty title="Replay is not enabled on this server">
            Start the API with API_REPLAY_ENABLED=true and a running Kafka broker (docker compose --profile replay up -d); see docs/phase7-replay.md.
          </Empty>
        </section>
      ) : (
        <>
          <section className="wrap">
            <div className="grid-bg relative h-[64vh] min-h-[420px] overflow-hidden rounded-s border border-line-2 bg-frame" ref={ref}>
              {T && (
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Track with one dot per driver, coloured by regime">
                  <path d={T.pathD} fill="none" stroke="var(--track-edge)" strokeWidth={18} strokeLinejoin="round" />
                  <path d={T.pathD} fill="none" stroke="var(--track-body)" strokeWidth={16} strokeLinejoin="round" />
                  {rows.map((s) => {
                    const p = T.at(s.lap_distance_est);
                    const d = names.get(s.driver_number);
                    return (
                      <g key={s.driver_number} style={{ transition: "transform 100ms linear" }} transform={`translate(${p.x},${p.y})`}>
                        <circle r={9} fill={COLORS[s.regime] ?? COLORS.other} stroke={d ? teamColour(d) : "var(--ink-head)"} strokeWidth={3} />
                        <text y={-16} textAnchor="middle" fontFamily={d ? "var(--font-display)" : "var(--font-mono)"} fontWeight={700} fontSize={11} fill="var(--ink-head)">
                          {d ? driverCode(d) : s.driver_number}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              )}
              <ul className="pointer-events-none absolute left-5 top-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-2">
                {(Object.keys(COLORS) as LiveRegime[]).map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLORS[k] }} />
                    {k}
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-4 text-[13px] text-ink-3">Dots follow an estimated lap distance along the outline; their position is approximate and drifts.</p>
          </section>
          <section className="wrap section">
            <SectionHead eyebrow="Timing" title="Latest state per driver">
              The regime here is a simplified live estimate, not the batch model behind the explorer.
            </SectionHead>
            {rows.length === 0 ? (
              <Empty title="No data yet">Start the producer and consumer for session {sessionKey} to see cars here.</Empty>
            ) : (
              <ul className="grid gap-x-10 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((s) => {
                  const d = names.get(s.driver_number);
                  return (
                    <li key={s.driver_number} className="flex h-16 items-center gap-4 border-b border-line-2">
                      <span className="h-8 w-1 rounded-full" style={{ background: d ? teamColour(d) : "var(--line)" }} />
                      {d && <Avatar d={d} size={36} />}
                      <span className="w-14 font-display text-[15px] font-bold uppercase text-ink-head">{d ? driverCode(d) : <span className="num">{s.driver_number}</span>}</span>
                      <span className="flex flex-1 items-center gap-2 text-[14px] text-ink-2">
                        <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLORS[s.regime] ?? COLORS.other }} />
                        {s.regime}
                      </span>
                      <span className="num text-[14px] text-ink-head">{int(s.lap_distance_est)} m</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
