import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, CardHead, Flag, Label, Pill, type PillTone } from "../components/system";
import { useList, useRemote, url } from "../lib/api";
import { date, lapTime } from "../lib/format";
import { driverCode, driverName, teamColour } from "../lib/teams";
import { href } from "../lib/router";
import { lapLength, regimeRuns, wrap } from "../lib/track";
import { useRegimes } from "../explorer/data";
import { REGIME_VAR, REGIME_WORD } from "../track/regimes";
import type { MapRun } from "../track/TrackMap";
import type { Driver, Lap, Outline, SessionRow } from "../lib/types";
import { usePage } from "../motion";
import { circuitHero, circuitMeta, eventName, useCircuit } from "../track/circuits";
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

  // Without a feed the middle line shows the selected car's regimes on its fastest clean lap,
  // from the model (the same data the session page draws), and the caption says which lap.
  const restLap = useMemo(() => {
    if (running || selected === null || !laps.data) return null;
    const mine = laps.data.filter((l) => l.driver_number === selected && l.green && l.lap_duration !== null);
    if (!mine.length) return null;
    return mine.reduce((a, b) => ((a.lap_duration ?? Infinity) <= (b.lap_duration ?? Infinity) ? a : b)).lap_number;
  }, [running, selected, laps.data]);
  const restRegimes = useRegimes(key ?? 0, selected, restLap, key !== null && !running && !!session?.has_results);
  const restRuns = useMemo<MapRun[]>(
    () => (restRegimes.data && lap ? regimeRuns(restRegimes.data.bins, lap).map((r) => ({ d0: r.d0, d1: r.d1, colour: REGIME_VAR[r.label] })) : []),
    [restRegimes.data, lap],
  );

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
  // The poster theme (DESIGN.md pending: black ground, red field, halftone) is scoped to the
  // page while it is the template; the class retints the shared tokens for the whole document.
  useEffect(() => {
    document.documentElement.classList.add("theme-poster");
    return () => document.documentElement.classList.remove("theme-poster");
  }, []);

  const meta = circuitMeta(circuit);
  const photo = circuitHero(circuit);
  const year = session?.date_start ? new Date(session.date_start).getUTCFullYear() : null;
  const lapKm = lap ? lap / 1000 : null;
  // Fastest lap of the session from the lap times (any lap with a duration).
  const fastest = useMemo(() => {
    const best = (laps.data ?? []).reduce<Lap | null>((m, l) => (l.lap_duration !== null && (!m || l.lap_duration < (m.lap_duration ?? Infinity)) ? l : m), null);
    return best ? { lap: best, driver: names.get(best.driver_number) ?? null } : null;
  }, [laps.data, names]);
  // Share of each regime on the selected driver's fastest clean lap (model output, equal bins).
  const split = useMemo(() => {
    const bins = restRegimes.data?.bins ?? [];
    if (!bins.length) return null;
    const keys = ["deploy", "plateau", "lift", "brake"] as const;
    return keys.map((k) => ({ k, pct: (100 * bins.filter((b) => b.label === k).length) / bins.length }));
  }, [restRegimes.data]);
  const selDriver = selected !== null ? names.get(selected) ?? null : null;

  const mapEl = hasOutline ? (
    <LiveMap
      key={keyOrPending}
      outline={outline.data!}
      circuit={circuitRef}
      order={order}
      states={running ? Object.values(states) : []}
      selected={selected}
      trail={trail}
      restRuns={restRuns}
      paused={!playing}
    />
  ) : (
    <div className="lv-map lv-map--empty" aria-hidden="true" />
  );

  const stat = (label: string, value: ReactNode, unit?: string, wide = false) => (
    <div className={`lv-stat ${wide ? "is-wide" : ""}`}>
      <dt>{label}</dt>
      <dd>
        <span className="num">{value}</span>
        {unit && <small>{unit}</small>}
      </dd>
    </div>
  );

  return (
    <div ref={page} className="lv">
      {/* Photo band: the country and the year over a race-day photograph. */}
      <section className="lv-hero" aria-labelledby="lv-h">
        {photo && <img className="lv-hero__img" src={photo} alt="" decoding="async" />}
        <div className="lv-hero__in" data-intro>
          <h1 id="lv-h" className="lv-hero__title">
            {meta?.country ?? (session ? eventName(circuit, session.circuit_short_name) : sessions.error ? "Live" : "Loading")}
          </h1>
          {year && <p className="lv-hero__year">{year}</p>}
          {session && <p className="lv-hero__date num">{date(session.date_start, "short")}</p>}
        </div>
      </section>
      <nav className="lv-sub" aria-label="On this page">
        <a href="#lv-circuit">Circuit</a>
        <a href="#lv-flag">At the flag</a>
        <a href={key !== null ? href.session(key) : href.sessions()}>Analysis</a>
        <Pill tone={status.tone} dot={status.dot} className="lv-sub__status">
          {status.text}
        </Pill>
      </nav>

      {/* The circuit: map on the left, the figures on the right, inside the red frame. */}
      <section id="lv-circuit" className="wrap lv-circ" aria-label="Circuit">
        {session && (
          <p className="lv-circ__event">
            Formula 1 {eventName(circuit, session.circuit_short_name)} {year} · {session.session_name}
          </p>
        )}
        <div className="lv-circ__box">
          <h2 className="lv-circ__head">
            {meta?.iso2 && <Flag iso2={meta.iso2} title={meta.country} size={40} className="lv-circ__flag" />}
            <span>{meta?.name ?? session?.circuit_short_name ?? "Circuit"}</span>
          </h2>
          <div className="lv-circ__body">
            <div className="lv-circ__map">{mapEl}</div>
            <div className="lv-circ__side">
              <dl className="lv-stats">
                {stat("Number of laps", totalLaps ?? "–")}
                {stat("Circuit length", lapKm ? lapKm.toFixed(3) : "–", "km")}
                {stat("Race distance", lapKm && totalLaps ? (lapKm * totalLaps).toFixed(3) : "–", "km")}
                {stat("Corners", meta?.corners ?? "–")}
                <div className="lv-stat is-wide">
                  <dt>Fastest lap</dt>
                  <dd>
                    <span className="num">{fastest ? lapTime(fastest.lap.lap_duration) : "–"}</span>
                    {fastest?.driver && (
                      <small>
                        {driverName(fastest.driver)} (lap {fastest.lap.lap_number})
                      </small>
                    )}
                  </dd>
                </div>
              </dl>
              <ul className="lv-links">
                <li>
                  <a href={key !== null ? href.session(key) : href.sessions()}>Session analysis</a>
                </li>
                <li>
                  <a href={key !== null ? href.session(key) : href.sessions()}>Cut-off by straight</a>
                </li>
                <li>
                  <a href={href.findings}>Findings</a>
                </li>
                <li>
                  <a href={href.method}>How it is estimated</a>
                </li>
              </ul>
              <p className="lv-circ__note">Length measured on the circuit outline; distance is laps × length.</p>
            </div>
          </div>
        </div>
      </section>

      {/* At the flag: the first three as broadcast cards, then the full order beside two cards. */}
      <section id="lv-flag" className="wrap lv-flag" aria-labelledby="lv-flag-h">
        <h2 id="lv-flag-h" className="lv-sec">
          <span>{running ? "Live order" : "At the flag"}</span>
        </h2>
        <ol className="lv-podium">
          {(running ? rows : flag).slice(0, 3).map((r) => (
            <li key={r.driver.driver_number} className="lv-pod" style={{ ["--team" as string]: teamColour(r.driver) }}>
              <span className="lv-pod__pos">{r.pos}</span>
              <span className="lv-pod__name">
                <span className="lv-pod__first">{r.driver.first_name ?? ""}</span>
                <span className="lv-pod__last">{r.driver.last_name ?? driverCode(r.driver)}</span>
                <span className="lv-pod__team">{r.driver.team_name ?? ""}</span>
              </span>
              <span className="lv-pod__gap num">{r.gap ?? "Leader"}</span>
              <span className="lv-pod__no" aria-hidden="true">
                {r.driver.driver_number}
              </span>
            </li>
          ))}
        </ol>
        <div className="lv-flag__grid">
          <Card inset as="div" className="lv-stage__tower">
            <div className="lv-stage__th">
              <Label>{running ? "Live order" : "Order at the flag"}</Label>
              <span className="lv-stage__tn num">{rows.length || "–"} cars</span>
            </div>
            <LiveTower rows={rows} selected={selected} onPick={setPicked} live={running} />
            <p className="lv-stage__cap">
              {running ? "Order by estimated distance; gap in metres to the first car." : "Order at the flag from lap times, not the official classification."}
            </p>
          </Card>
          <div className="lv-flag__side">
            <Card className="lv-card" as="section" aria-label="Regimes on the fastest lap">
              <p className="lv-card__k">
                Regimes{selDriver ? <> · <b style={{ color: teamColour(selDriver) }}>{driverCode(selDriver)}</b></> : null}
                {restLap ? <> · lap <span className="num">{restLap}</span></> : null}
              </p>
              {split ? (
                <>
                  <div className="lv-card__bar" aria-hidden="true">
                    {split
                      .filter((r) => r.pct > 0)
                      .map((r) => (
                        <i key={r.k} style={{ flexGrow: r.pct, background: REGIME_VAR[r.k] }} />
                      ))}
                  </div>
                  <ul className="lv-card__split">
                    {split.map((r) => (
                      <li key={r.k}>
                        <span className="lv-card__sw" style={{ background: REGIME_VAR[r.k] }} />
                        <span>{REGIME_WORD[r.k]}</span>
                        <span className="num">{Math.round(r.pct)}%</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="lv-card__big">–</p>
              )}
              <p className="lv-card__note">Share of the driver's fastest clean lap, estimated by the model. The map's middle line shows the same lap. Pick a driver in the order.</p>
            </Card>
            <Card className="lv-card lv-replay" as="section" aria-label="Replay">
              <p className="lv-replay__badge">
                <span>Replay</span>
                <b className="num">{running ? `Lap ${leadLap ?? "–"}/${totalLaps ?? "–"}` : "Off"}</b>
              </p>
              {running && <LiveAxis total={totalLaps} lap={leadLap} live={running} playing={playing} onPlay={togglePlay} speed={live.speed} />}
              <div className="lv-card__foot">
                <p className="lv-card__note">{sentence.charAt(0).toUpperCase() + sentence.slice(1)}.</p>
                {!running && (
                  <details className="lv-card__more">
                    <summary>How to start one</summary>
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
                  </details>
                )}
              </div>
            </Card>
          </div>
        </div>
      </section>

      {races.length > 1 && (
        <section className="lv-more" aria-labelledby="lv-more-h">
          <div className="wrap">
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
          </div>
        </section>
      )}
    </div>
  );
}
