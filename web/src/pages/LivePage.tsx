import { useEffect, useMemo, useRef, useState } from "react";
import { Readout } from "../components/Readout";
import { SessionHeader } from "../components/SessionHeader";
import { Card, CardHead, Flag, Label, Pill, type PillTone } from "../components/system";
import { useList, useRemote, url } from "../lib/api";
import { date } from "../lib/format";
import { href } from "../lib/router";
import { lapLength, wrap } from "../lib/track";
import type { Driver, Lap, Outline, SessionRow } from "../lib/types";
import { usePage } from "../motion";
import { circuitMeta, circuitPhoto, eventName, useCircuit } from "../track/circuits";
import { LiveAxis } from "../live/LiveAxis";
import { LiveMap, type TrailPoint } from "../live/LiveMap";
import { LiveTower, type TowerRow } from "../live/LiveTower";
import { useLive, type LiveState } from "../live/useLive";
import "../live/live.css";

const TRAIL_M = 900;
const NB = "\u00a0";

const isRace = (s: SessionRow) => s.session_name === "Race" || s.session_name === "Sprint";

/** Seconds, one decimal, with a plus sign. */
const secs = (s: number) => `+${s.toFixed(1)}${NB}s`;

/*
 * The order at the flag, read from lap times (no replay running): most laps first, then the
 * earliest end of the last lap. It is the timing order, not the official classification
 * (penalties are not in the data), and the tower says so.
 */
function flagOrder(laps: Lap[], drivers: Driver[]): TowerRow[] {
  const by = new Map<number, { n: number; end: number }>();
  for (const l of laps) {
    const start = l.date_start ? Date.parse(l.date_start) : NaN;
    if (!Number.isFinite(start)) continue;
    const end = start + (l.lap_duration ?? 0) * 1000;
    const cur = by.get(l.driver_number);
    if (!cur || l.lap_number > cur.n || (l.lap_number === cur.n && end > cur.end)) by.set(l.driver_number, { n: l.lap_number, end });
  }
  const ranked = drivers
    .map((d) => ({ d, r: by.get(d.driver_number) }))
    .sort((a, b) => (b.r?.n ?? -1) - (a.r?.n ?? -1) || (a.r?.end ?? Infinity) - (b.r?.end ?? Infinity) || a.d.driver_number - b.d.driver_number);
  const lead = ranked[0]?.r;
  return ranked.map(({ d, r }, i) => {
    let gap: string | null = null;
    if (i > 0 && r && lead) {
      const down = lead.n - r.n;
      gap = down > 0 ? `+${down}${NB}${down === 1 ? "lap" : "laps"}` : secs((r.end - lead.end) / 1000);
    }
    if (!r) gap = "no laps";
    return { driver: d, pos: i + 1, gap, regime: null };
  });
}

export function LivePage({ sessionKey }: { sessionKey: number | null }) {
  const sessions = useList<SessionRow>("/sessions");
  const races = useMemo(() => (sessions.data ?? []).filter(isRace).sort((a, b) => (b.date_start ?? "").localeCompare(a.date_start ?? "")), [sessions.data]);
  // #/live opens the latest race; #/live/<key> the one asked for.
  const key = sessionKey ?? races[0]?.session_key ?? null;
  const session = (sessions.data ?? []).find((s) => s.session_key === key) ?? null;
  const circuit = session?.circuit_key ?? null;
  const circuitRef = useCircuit(circuit);

  const drivers = useList<Driver>(key !== null ? `/sessions/${key}/drivers` : null);
  const laps = useList<Lap>(key !== null ? `/sessions/${key}/laps` : null);
  const outline = useRemote<Outline>(circuit !== null ? url(`/circuits/${circuit}/outline`) : null);
  const hasOutline = !!outline.data && outline.data.points.length > 1;
  const lap = hasOutline ? lapLength(outline.data!) : null;

  const live = useLive(key);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState<Record<number, LiveState> | null>(null);
  const states = playing || !held ? live.states : held;
  const running = live.status === "connected" && Object.keys(live.states).length > 0;

  const names = useMemo(() => new Map((drivers.data ?? []).map((d) => [d.driver_number, d])), [drivers.data]);
  const totalLaps = useMemo(() => (laps.data?.length ? Math.max(...laps.data.map((l) => l.lap_number)) : null), [laps.data]);

  // Tower: live order by estimated distance, or the order at the flag without a feed.
  const flag = useMemo(() => flagOrder(laps.data ?? [], drivers.data ?? []), [laps.data, drivers.data]);
  const rows: TowerRow[] = useMemo(() => {
    if (running) {
      const list = Object.values(states).sort((a, b) => b.lap_distance_est - a.lap_distance_est);
      const lead = list[0]?.lap_distance_est ?? 0;
      return list.flatMap((s, i) => {
        const d = names.get(s.driver_number);
        if (!d) return [];
        return [{ driver: d, pos: i + 1, gap: i === 0 ? null : `+${Math.round(lead - s.lap_distance_est).toLocaleString("en-GB")}${NB}m`, regime: s.regime }];
      });
    }
    return flag;
  }, [running, states, names, flag]);

  const [picked, setPicked] = useState<number | null>(null);
  const selected = picked ?? rows[0]?.driver.driver_number ?? null;

  // The selected car's trail: its recent (distance, regime) pairs, the last 900 m.
  const [trail, setTrail] = useState<TrailPoint[]>([]);
  const lastKey = useRef<string>("");
  useEffect(() => {
    setTrail([]);
  }, [selected, key]);
  useEffect(() => {
    if (!running || selected === null || !lap || !playing) return;
    const s = live.states[selected];
    if (!s) return;
    const k = `${selected}-${s.ts}`;
    if (k === lastKey.current) return;
    lastKey.current = k;
    setTrail((t) => {
      const next = [...t, { d: wrap(s.lap_distance_est, lap), regime: s.regime }];
      const head = s.lap_distance_est;
      // Keep the points within TRAIL_M behind the head (distances on the lap wrap).
      return next.filter((p) => wrap(wrap(head, lap) - p.d, lap) <= TRAIL_M);
    });
  }, [live.states, selected, running, lap, playing]);

  const leadLap = running && lap && rows[0] ? Math.floor((states[rows[0].driver.driver_number]?.lap_distance_est ?? 0) / lap) + 1 : null;

  // Map order: the tower's order, then any driver the tower does not list yet.
  const order = useMemo(() => {
    const seen = new Set(rows.map((r) => r.driver.driver_number));
    return [...rows.map((r) => r.driver), ...(drivers.data ?? []).filter((d) => !seen.has(d.driver_number))];
  }, [rows, drivers.data]);

  const sentence = (() => {
    if (running) return playing ? `replay · lap ${leadLap ?? "–"} (est.) · ${live.speed !== null ? `${Math.round(live.speed)}× speed` : "measuring speed"}` : `replay paused · lap ${leadLap ?? "–"} (est.)`;
    switch (live.status) {
      case "connecting":
        return "connecting to the replay";
      case "no-data":
      case "connected":
        return "replay connected · no cars yet";
      case "error":
        return "replay connection lost · retrying";
      default:
        return "no replay running";
    }
  })();

  const status: { tone: PillTone; dot: boolean; text: string } =
    live.status === "connected" || live.status === "no-data"
      ? { tone: "live", dot: true, text: running ? (playing ? "Live replay" : "Replay paused") : "Connected · no cars yet" }
      : live.status === "disabled"
        ? { tone: "neutral", dot: false, text: "Replay disabled" }
        : live.status === "connecting"
          ? { tone: "neutral", dot: false, text: "Connecting" }
          : live.status === "error"
            ? { tone: "warn", dot: false, text: "Reconnecting" }
            : { tone: "neutral", dot: false, text: "No replay running" };

  const togglePlay = () => {
    if (playing) setHeld(live.states);
    else setHeld(null);
    setPlaying((p) => !p);
  };

  const page = usePage<HTMLDivElement>(undefined, [session !== null, drivers.data !== null, outline.data !== null]);
  const keyOrPending = key ?? 0;
  const photo = circuitPhoto(circuit);

  return (
    <div ref={page} className="lv">
      <section className="lv-top" aria-labelledby="lv-h">
        <div className={`lv-top__band ${photo ? "" : "is-plain"}`} aria-hidden="true">
          {photo && <img src={photo} alt="" className="lv-top__img" decoding="async" />}
        </div>
        <div className="wrap lv-top__in" data-intro>
          {session ? (
            <SessionHeader
              session={session}
              size="lg"
              facts={[{ label: "Laps", value: totalLaps ?? "–" }]}
              aside={
                <Pill tone={status.tone} dot={status.dot} className="lv-status">
                  {status.text}
                </Pill>
              }
            />
          ) : (
            <h1 className="lv-top__pending">{sessions.error ? "Live" : "Loading"}</h1>
          )}
          <span id="lv-h" className="sr-only">
            Live replay
          </span>
          {live.status !== "disabled" && live.status !== "no-topic" && (
            <Readout label="Replay">
              <p>{sentence}</p>
            </Readout>
          )}
        </div>
      </section>

      <section className="wrap lv-body" aria-label="Replay">
        <div className="lv-stage">
          <div className="lv-stage__map">
            <div className="lv-stage__bar">
              <Label>{circuitMeta(circuit)?.name ?? session?.circuit_short_name ?? "Track"}</Label>
              {running ? (
                <Pill tone="live" dot>
                  {playing ? `Lap ${leadLap ?? "–"} est.` : "Paused"}
                </Pill>
              ) : (
                <Pill>{live.status === "connecting" ? "Checking for a replay" : "No replay running"}</Pill>
              )}
            </div>
            <div className="lv-stage__road">
              {hasOutline ? (
                <LiveMap
                  key={keyOrPending}
                  outline={outline.data!}
                  circuit={circuitRef}
                  order={order}
                  states={running ? Object.values(states) : []}
                  selected={selected}
                  trail={trail}
                  paused={!playing}
                />
              ) : (
                <div className="lv-map lv-map--empty" aria-hidden="true" />
              )}
            </div>
            <p className="lv-stage__note">
              {running
                ? "Tags sit at each car's estimated lap distance; the place along the lap is approximate and drifts."
                : "Without a feed the cars wait behind the line in the order at the flag."}
            </p>
          </div>
          <Card inset as="aside" className="lv-stage__tower">
            <div className="lv-stage__th">
              <Label>{running ? "Live order" : "Order at the flag"}</Label>
              <span className="lv-stage__tn num">{rows.length || "–"} cars</span>
            </div>
            <LiveTower rows={rows} selected={selected} onPick={setPicked} live={running} />
            <p className="lv-stage__cap">
              {running ? "Order by estimated distance; gap in metres to the first car." : "Order at the flag from lap times, not the official classification."}
            </p>
          </Card>
        </div>

        <Card className="lv-axis-card">
          <LiveAxis total={totalLaps} lap={leadLap} live={running} playing={playing} onPlay={togglePlay} speed={live.speed} />
        </Card>

        {!running && (
          <Card className="lv-off" as="section">
            <CardHead title="No replay running" aside={<span className="num">docs/phase7-replay.md</span>} />
            <div className="lv-off__body">
              <p className="lv-off__p">
                {live.status === "connecting"
                  ? "Checking for a running replay."
                  : live.status === "error"
                    ? "The replay feed dropped; retrying every 3 s."
                    : live.status === "disabled"
                      ? "The replay is disabled on this server."
                      : live.status === "no-topic"
                        ? "No replay is running."
                        : "Replay connected; no cars yet."}{" "}
                A replay re-emits this recorded race through Kafka at a chosen speed and moves one tag per car on the map. It needs the replay
                profile on the server:
              </p>
              <pre className="lv-off__cmd">
                <code>
                  {`docker compose --profile replay up -d
java -jar replay/target/replay-0.1.0-SNAPSHOT.jar \\
  --mode=producer --session=${keyOrPending} --speed=20
java -jar replay/target/replay-0.1.0-SNAPSHOT.jar \\
  --mode=consumer --session=${keyOrPending}
API_REPLAY_ENABLED=true java -jar api/target/api-0.1.0-SNAPSHOT.jar`}
                </code>
              </pre>
            </div>
          </Card>
        )}
      </section>

      {races.length > 1 && (
        <section className="wrap lv-more" aria-labelledby="lv-more-h">
          <Card>
            <CardHead title={<h2 id="lv-more-h">Replay another race</h2>} aside={<span className="num">{races.length} sessions</span>} />
            <ul className="lv-more__grid">
              {races.map((s) => {
                const m = circuitMeta(s.circuit_key);
                const cur = s.session_key === key;
                return (
                  <li key={s.session_key}>
                    <a href={href.live(s.session_key)} className={`lv-race ${cur ? "is-on" : ""}`} aria-current={cur ? "page" : undefined}>
                      <Flag iso2={m?.iso2} title={m?.country} size={40} className="lv-race__flag" />
                      <span className="lv-race__name">{eventName(s.circuit_key, s.circuit_short_name)}</span>
                      <span className="lv-race__meta">
                        <span>{s.session_name}</span>
                        <span className="num">{date(s.date_start, "short")}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
