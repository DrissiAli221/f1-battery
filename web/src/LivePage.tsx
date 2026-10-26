import { useEffect, useMemo, useRef, useState } from "react";
import { url, useRemote, apiBase } from "./api";
import type { Driver, Outline, Page, RegimeLabel, SessionRow } from "./types";
import { Card, Empty, fmt, label } from "./ui";

type LiveRegime = RegimeLabel | "other";

interface LiveState {
  driver_number: number;
  ts: string;
  regime: LiveRegime;
  lap_distance_est: number;
}

type Status = "connecting" | "connected" | "no-data" | "disabled" | "no-topic" | "error";

const COLORS: Record<LiveRegime, string> = {
  deploy: "var(--deploy)",
  plateau: "var(--plateau)",
  lift: "var(--lift)",
  brake: "var(--brake)",
  other: "var(--muted)",
};

const STATUS_TEXT: Record<Status, string> = {
  connecting: "Connecting",
  connected: "Connected",
  "no-data": "Connected, no data yet",
  disabled: "Replay disabled",
  "no-topic": "No replay running for this session",
  error: "Connection lost, retrying",
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
    const href = url(`/live/${sessionKey}`);

    // Batches bursts of events into one render per animation frame.
    const timer = window.setInterval(() => {
      if (Object.keys(pending.current).length) {
        const batch = pending.current;
        pending.current = {};
        setStates((s) => ({ ...s, ...batch }));
        setStatus((st) => (st === "no-data" || st === "connecting" ? "connected" : st));
      }
    }, 100);

    const open = () => {
      es = new EventSource(href);
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
        fetch(href, { headers: { Accept: "application/json" } })
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

/**
 * Position along the outline for an estimated lap distance. The outline's distance is in the
 * source's position units (1/10 m), the estimate in metres, and the estimate is a running
 * integral from the moment the consumer started, not from the start/finish line. Dots are
 * therefore placed at (distance mod lap length) from the outline start: the speed and the
 * motion are right, the absolute position is approximate and drifts.
 */
function pointAt(outline: Outline, distanceM: number): { x: number; y: number } {
  const pts = outline.points;
  const total = pts[pts.length - 1].d || 1;
  const d = (((distanceM * 10) % total) + total) % total;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const f = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

export function LivePage({ sessionKey }: { sessionKey: number }) {
  const sessions = useRemote<Page<SessionRow>>(url("/sessions", { size: 1000 }));
  const session = sessions.data?.items.find((s) => s.session_key === sessionKey) ?? null;
  const drivers = useRemote<Page<Driver>>(url(`/sessions/${sessionKey}/drivers`, { size: 1000 }));
  const outline = useRemote<Outline>(session ? url(`/circuits/${session.circuit_key}/outline`) : null);
  const { status, states } = useLive(sessionKey);

  const names = useMemo(() => new Map((drivers.data?.items ?? []).map((d) => [d.driver_number, d])), [drivers.data]);
  const rows = Object.values(states).sort((a, b) => a.driver_number - b.driver_number);

  const geo = useMemo(() => {
    const pts = outline.data?.points ?? [];
    if (pts.length < 2) return null;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 0.06 * (Math.max(maxX - minX, maxY - minY) || 1);
    const sx = (x: number) => x - minX + pad;
    const sy = (y: number) => maxY - y + pad;
    return { w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad, sx, sy, path: pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join("") };
  }, [outline.data]);

  return (
    <>
      <p className="crumb">
        <a href="#/">Sessions</a> / <a href={`#/session/${sessionKey}`}>{session?.circuit_short_name ?? `Session ${sessionKey}`}</a>
      </p>
      <h1>
        Live replay <span className="muted">{session ? `${session.circuit_short_name ?? ""} ${session.session_name} ${session.year}` : `session ${sessionKey}`}</span>
      </h1>
      <p className={`live-status live-${status}`} role="status">
        <i aria-hidden="true" /> {STATUS_TEXT[status]}
      </p>

      {status === "disabled" ? (
        <Empty title="Replay is not enabled on this server">
          Start the API with <code>API_REPLAY_ENABLED=true</code> and a running Kafka broker (<code>docker compose --profile replay up -d</code>); see docs/phase7-replay.md.
        </Empty>
      ) : (
        <div className="grid">
          <Card title="Track" note="Dots follow an estimated lap distance along the outline; position is approximate (see docs/phase7-replay.md).">
            {geo ? (
              <svg className="map" viewBox={`0 0 ${geo.w} ${geo.h}`} role="img" aria-label="Track outline with one dot per driver, coloured by regime">
                <path d={geo.path} fill="none" stroke="var(--track)" strokeWidth={geo.w / 40} strokeLinecap="round" strokeLinejoin="round" />
                <path d={geo.path} fill="none" stroke="var(--track-core)" strokeWidth={geo.w / 120} strokeLinecap="round" strokeLinejoin="round" />
                {outline.data &&
                  rows.map((s) => {
                    const p = pointAt(outline.data!, s.lap_distance_est);
                    const d = names.get(s.driver_number);
                    return (
                      <g key={s.driver_number} className="live-dot">
                        <circle cx={geo.sx(p.x)} cy={geo.sy(p.y)} r={geo.w / 90} fill={COLORS[s.regime] ?? COLORS.other} stroke="var(--bg)" strokeWidth={geo.w / 500} />
                        <text x={geo.sx(p.x)} y={geo.sy(p.y) - geo.w / 70} textAnchor="middle" fontSize={geo.w / 55} fill="var(--ink)">
                          {d?.name_acronym ?? s.driver_number}
                        </text>
                      </g>
                    );
                  })}
              </svg>
            ) : (
              <Empty title="No outline">{outline.loading ? "Loading the track outline." : "The circuit has no outline yet."}</Empty>
            )}
            <ul className="legend" aria-label="Legend">
              {(Object.keys(COLORS) as LiveRegime[]).map((k) => (
                <li key={k}>
                  <i style={{ background: COLORS[k] }} />
                  {k}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Drivers" note="Latest state per driver. Regime is a simplified live estimate, not the batch model.">
            {rows.length === 0 ? (
              <Empty title="No data yet">
                Start the producer and consumer for session {sessionKey}; the API is at {apiBase}.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th>Regime</th>
                      <th className="num">Est. lap distance m</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.driver_number}>
                        <td>{names.has(s.driver_number) ? label(names.get(s.driver_number)!) : s.driver_number}</td>
                        <td>
                          <i className="dot" style={{ background: COLORS[s.regime] ?? COLORS.other }} />
                          {s.regime}
                        </td>
                        <td className="num">{fmt(s.lap_distance_est)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
