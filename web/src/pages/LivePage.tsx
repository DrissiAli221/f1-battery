import { useEffect, useMemo, useRef, useState } from "react";
import { Readout } from "../components/Readout";
import { url, useList, useRemote } from "../lib/api";
import { date } from "../lib/format";
import { href } from "../lib/router";
import { nameStraights } from "../lib/straights";
import { lapLength, trackStraights, wrap } from "../lib/track";
import type { Driver, Lap, Outline, SessionRow, Straight } from "../lib/types";
import { usePage } from "../motion";
import { LiveAxis } from "../live/LiveAxis";
import { LiveMap, type TrailPoint } from "../live/LiveMap";
import { LiveTower, type TowerRow } from "../live/LiveTower";
import { useLive, type LiveState } from "../live/useLive";
import "../explorer/explorer.css";
import "../live/live.css";

const TRAIL_M = 900;
const NB = " ";

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

  const drivers = useList<Driver>(key !== null ? `/sessions/${key}/drivers` : null);
  const laps = useList<Lap>(key !== null ? `/sessions/${key}/laps` : null);
  const outline = useRemote<Outline>(circuit !== null ? url(`/circuits/${circuit}/outline`) : null);
  const straightsRaw = useList<Straight>(circuit !== null ? `/circuits/${circuit}/straights` : null);
  const lap = outline.data && outline.data.points.length > 1 ? lapLength(outline.data) : null;
  const straights = useMemo(
    () => (lap && straightsRaw.data ? trackStraights(nameStraights(straightsRaw.data, circuit, outline.data), lap) : []),
    [lap, straightsRaw.data, circuit, outline.data],
  );

  const live = useLive(key);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState<Record<number, LiveState> | null>(null);
  const states = playing || !held ? live.states : held;
  const running = live.status === "connected" && Object.keys(live.states).length > 0;

  const names = useMemo(() => new Map((drivers.data ?? []).map((d) => [d.driver_number, d])), [drivers.data]);
  const totalLaps = useMemo(() => (laps.data?.length ? Math.max(...laps.data.map((l) => l.lap_number)) : null), [laps.data]);

  // Tower: live order by estimated distance, or the order at the flag without a feed.
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
    return flagOrder(laps.data ?? [], drivers.data ?? []);
  }, [running, states, names, laps.data, drivers.data]);

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

  const togglePlay = () => {
    if (playing) setHeld(live.states);
    else setHeld(null);
    setPlaying((p) => !p);
  };

  const page = usePage<HTMLDivElement>(undefined, [session !== null, drivers.data !== null, outline.data !== null]);
  const keyOrPending = key ?? 0;

  return (
    <div ref={page}>
      <section className="lv" aria-labelledby="lv-h">
        <div className="lv__in">
          <header className="lv__head">
            <h1 id="lv-h" className="lv__title" data-intro>
              {session?.circuit_short_name ?? (sessions.error ? "Live" : "Loading")}
              <span className="sr-only">, live replay</span>
            </h1>
            <p className="lv__meta" data-intro>
              <span>{session?.session_name ?? "Race"}</span>
              {session?.date_start && <span className="num">{date(session.date_start, "short")}</span>}
              <span className="num">session {keyOrPending || "–"}</span>
            </p>
            {!running && (
              <div className="lv__off" data-intro>
                <p className="lv__off-p">
                  {live.status === "connecting"
                    ? "Checking for a running replay."
                    : live.status === "error"
                      ? "The replay feed dropped; retrying every 3 s."
                      : live.status === "disabled" || live.status === "no-topic"
                        ? "No replay is running."
                        : "Replay connected; no cars yet."}{" "}
                  A replay re-emits this recorded race through Kafka at a chosen speed and moves one tag per car here. It needs the
                  replay profile on the server (docs/phase7-replay.md):
                </p>
                <pre className="lv__cmd">
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
            )}
          </header>

          <div className="lv__map">
            {outline.data && outline.data.points.length > 1 ? (
              <LiveMap outline={outline.data} straights={straights} drivers={names} states={running ? Object.values(states) : []} selected={selected} trail={trail} paused={!playing} />
            ) : (
              <div className="lv-map lv-map--empty" aria-hidden="true" />
            )}
            {running && <p className="lv__note">Tags sit at each car's estimated lap distance; the place along the lap is approximate and drifts.</p>}
          </div>

          <div className="lv__axis">
            <LiveAxis total={totalLaps} lap={leadLap} live={running} playing={playing} onPlay={togglePlay} speed={live.speed} />
          </div>

          <aside className="lv__tower" aria-label="Timing tower">
            <LiveTower
              rows={rows}
              selected={selected}
              onPick={setPicked}
              live={running}
              caption={running ? "Order by estimated distance; gap in metres to the first car." : "Order at the flag, from lap times (not the official classification)."}
            />
          </aside>
        </div>
      </section>

      {races.length > 1 && (
        <section className="lv-more wrap" aria-labelledby="lv-more-h">
          <h2 id="lv-more-h" className="lv-more__h" data-reveal>
            Replay another race
          </h2>
          <ol className="lv-more__list">
            {races.map((s) => (
              <li key={s.session_key} data-reveal>
                <a href={href.live(s.session_key)} className="lv-more__row" aria-current={s.session_key === key ? "page" : undefined}>
                  <span className="lv-more__name">{s.circuit_short_name}</span>
                  <span className="lv-more__type">{s.session_name}</span>
                  <span className="lv-more__date num">{date(s.date_start, "short")}</span>
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}

      <Readout label="Replay">
        <p>{sentence}</p>
      </Readout>
    </div>
  );
}
