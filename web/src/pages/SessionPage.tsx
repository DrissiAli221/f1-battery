import { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { CircuitPoster } from "../components/CircuitPoster";
import { SessionHeader } from "../components/SessionHeader";
import { Card, CardHead, Label, SectionHead, Skeleton, Stat, Tabs } from "../components/system";
import { CutoffChart, type ChartDriver } from "../explorer/CutoffChart";
import { RollingNumber, Swap } from "../components/Swap";
import { useCutoffs, useRegimes, useSessionData } from "../explorer/data";
import { DriverSelect } from "../explorer/DriverSelect";
import { LapAxis } from "../explorer/LapAxis";
import { defaultStraight, regimeIndex, rel, relMedian, useProfile, useStraightProfile } from "../explorer/profile";
import { createStore } from "../explorer/store";
import { StraightPanel, type Strip } from "../explorer/StraightPanel";
import { SessionTower } from "../explorer/Tower";
import { int } from "../lib/format";
import { href, useQueryState } from "../lib/router";
import { driverCode, teamColour } from "../lib/teams";
import { regimeRuns, wrap } from "../lib/track";
import { straightName } from "../lib/types";
import { scrollToTarget, usePage } from "../motion";
import { useCircuit } from "../track/circuits";
import { REGIME_VAR, REGIME_WORD, REGIMES } from "../track/regimes";
import { TrackMap, type MapRun, type MapTag, type MapTick } from "../track/TrackMap";
import "../explorer/explorer.css";

const num = (v: string | null) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const NB = " ";

type TabKey = "map" | "straight" | "bylap" | "timing";
const TAB_ID: Record<TabKey, string> = { map: "ss-map", straight: "ss-straight", bylap: "ss-bylap", timing: "ss-timing" };

/*
 * The session page as a broadcast console (DESIGN.md v3 "Pages → Session"): the venue photo
 * fading into the ground with the session header over its lower edge and the two driver
 * pickers; a sticky sub-nav; the stage card (the track map as the hero, the straight panel
 * beside it, one shared cursor); the lap scrubber; the cut-off by lap; the tower. Shareable
 * state lives in the query string (?driver=&compare=&straight=&lap=); the cursor lives in a
 * store so a pointer move never re-renders the page.
 */
export function SessionPage({ sessionKey }: { sessionKey: number }) {
  const data = useSessionData(sessionKey);
  const [query, setQuery] = useQueryState();
  const [playing, setPlaying] = useState(false);
  const [cursor] = useState(() => createStore<number | null>(null));
  // Hover on the map's straight (metres along it and the pointer's place in the box).
  const [hov, setHov] = useState<{ m: number; x: number; y: number } | null>(null);

  const { session, drivers, withResults, medians, laps, straights, lap: lapLen } = data;
  const circuit = useCircuit(session?.circuit_key);
  const has = !!session?.has_results;
  const enabled = useMemo(() => new Set((has ? withResults : drivers).map((d) => d.driver_number)), [has, withResults, drivers]);

  // Selection: the query string first (shareable), validated against the data, then defaults.
  const qDriver = num(query.get("driver"));
  const driver = qDriver !== null && enabled.has(qDriver) ? qDriver : data.defaultDriver;
  const qCompare = num(query.get("compare"));
  const compare = qCompare !== null && qCompare !== driver && enabled.has(qCompare) ? qCompare : null;
  const pDriver = drivers.find((d) => d.driver_number === driver) ?? null;
  const cDriver = drivers.find((d) => d.driver_number === compare) ?? null;
  const pMed = driver !== null ? medians.get(driver) : undefined;
  const cMed = compare !== null ? medians.get(compare) : undefined;

  const qStraight = num(query.get("straight"));
  const straightId =
    qStraight !== null && straights.some((s) => s.straight_id === qStraight) ? qStraight : defaultStraight(straights, (id) => !!pMed?.has(id));
  const straight = straights.find((s) => s.straight_id === straightId) ?? null;

  const pCut = useCutoffs(sessionKey, driver, has);
  const cCut = useCutoffs(sessionKey, compare, has);
  const pLaps = useMemo(() => (driver !== null ? laps.get(driver) ?? [] : []).filter((l) => l.lap_duration !== null), [laps, driver]);

  const withCut = useMemo(() => {
    const s = new Set<number>();
    if (straightId === null) return s;
    for (const [l, m] of pCut ?? []) if (m.has(straightId)) s.add(l);
    return s;
  }, [pCut, straightId]);

  // Default lap: the fastest green lap with a cut-off on the selected straight.
  const defaultLap = useMemo(() => {
    const green = pLaps.filter((l) => l.green);
    const pool = green.filter((l) => withCut.has(l.lap_number));
    const list = pool.length ? pool : green.length ? green : pLaps;
    if (!list.length) return null;
    return list.reduce((a, b) => ((a.lap_duration ?? Infinity) <= (b.lap_duration ?? Infinity) ? a : b)).lap_number;
  }, [pLaps, withCut]);
  const qLap = num(query.get("lap"));
  const lapNo = qLap !== null && pLaps.some((l) => l.lap_number === qLap) ? qLap : defaultLap;

  // Regimes for the shown lap. While playing, the colours of the lap the play started on stay
  // and the request waits for the pause, to stay inside the API's per-IP rate limit.
  const [regLap, setRegLap] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) setRegLap(lapNo);
  }, [lapNo, playing]);
  const regimes = useRegimes(sessionKey, driver, regLap, has);
  const regIdx = useMemo(() => regimeIndex(regimes.data?.bins), [regimes.data]);
  const runs = useMemo<MapRun[]>(
    () =>
      regimes.data && lapLen
        ? regimeRuns(regimes.data.bins, lapLen).map((r) => ({ d0: r.d0, d1: r.d1, colour: REGIME_VAR[r.label], kind: "trail" as const }))
        : [],
    [regimes.data, lapLen],
  );

  // The speed profiles (D30): the selected driver, and the compare driver as a second trace.
  const pState = useProfile(sessionKey, straightId, driver, has);
  const cState = useProfile(sessionKey, straightId, compare, has);
  const pProfile = useStraightProfile(pState, straight, lapLen, regIdx);
  const cProfile = useStraightProfile(cState, straight, lapLen, null);

  const lapCutLap = straightId !== null && lapNo !== null ? pCut?.get(lapNo)?.get(straightId) ?? null : null;
  const cLapCutLap = straightId !== null && lapNo !== null ? cCut?.get(lapNo)?.get(straightId) ?? null : null;
  const lapCut = straight && lapLen ? rel(straight, lapCutLap, lapLen) : null;
  const median = straight && lapLen ? relMedian(straight, pMed?.get(straight.straight_id), lapLen) : null;
  const cMedian = straight && lapLen ? relMedian(straight, cMed?.get(straight.straight_id), lapLen) : null;
  const length = pProfile?.length_m ?? straight?.len ?? 0;

  // The scrubber owns the cursor: a new lap or straight parks it on that lap's cut-off.
  useEffect(() => {
    if (!length) return;
    cursor.set(Math.max(0, Math.min(length, lapCut ?? median?.m ?? length / 2)));
  }, [cursor, straightId, lapNo, lapCut, median?.m, length]);

  // Play: one lap every 0.65 s on the GSAP ticker (the page's one clock).
  const play = useRef({ laps: pLaps, lap: lapNo });
  play.current = { laps: pLaps, lap: lapNo };
  useEffect(() => {
    if (!playing) return;
    let acc = 0;
    const tick = (_t: number, dt: number) => {
      acc += dt;
      if (acc < 650) return;
      acc = 0;
      const { laps: list, lap } = play.current;
      const i = list.findIndex((l) => l.lap_number === lap);
      if (i < 0 || i >= list.length - 1) {
        setPlaying(false);
        return;
      }
      setQuery({ lap: list[i + 1].lap_number });
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [playing, setQuery]);

  const root = usePage<HTMLDivElement>(undefined, [data.ready, session !== null, data.summary !== null]);
  const tab = useActiveTab(has);

  if (data.sessionsError) {
    return (
      <div ref={root} className="ss">
        <p className="wrap ss-plain">The session could not be loaded: {data.sessionsError.message}</p>
      </div>
    );
  }
  if (!session && data.sessionsLoaded) {
    return (
      <div ref={root} className="ss">
        <h1 className="wrap ss-plain">
          There is no session {sessionKey}.{" "}
          <a className="link" href={href.sessions()}>
            Back to the sessions
          </a>
        </h1>
      </div>
    );
  }
  if (!session) {
    return (
      <div ref={root} className="ss">
        <PageSkeleton />
      </div>
    );
  }

  const pickDriver = (n: number | null) => {
    if (n === null) return;
    setPlaying(false);
    setQuery({ driver: n, compare: n === compare ? null : compare, lap: null, straight: null });
  };
  const pickCompare = (n: number | null) => setQuery({ compare: n });
  const pickStraight = (id: number) => setQuery({ straight: id });
  const pickLap = (n: number) => setQuery({ lap: n });

  const pCode = pDriver ? driverCode(pDriver) : "";
  const cCode = cDriver ? driverCode(cDriver) : "";
  const pTeam = pDriver ? teamColour(pDriver) : "var(--ink)";
  const cTeam = cDriver ? teamColour(cDriver) : "var(--ink)";
  const nLaps = Math.max(0, ...[...laps.values()].map((l) => l.length));
  const sName = straight ? straightName(straight) : "";
  const regLapShown = regimes.data?.lap ?? null;
  const mode = pState.kind === "ready" ? "ready" : pState.kind === "loading" ? "loading" : "none";

  // ---- the map's marks on the selected straight
  // Only the selected and the compare driver are dots with chips, each chip reading the
  // cut-off in metres into the straight (the shown lap's, else the median). The rest of the
  // field is one grey bracket inside the road over the middle half of their medians, with a
  // tick at the field median: a rake of twenty ticks in a few tens of metres reads as a
  // smudge. The hover card still names the drivers near the pointer.
  const tags: MapTag[] = [];
  const ticks: MapTick[] = [];
  const field: { code: string; m: number }[] = [];
  if (straight && lapLen && has) {
    for (const d of drivers) {
      const m = medians.get(d.driver_number)?.get(straight.straight_id);
      if (!m) continue;
      const isP = d.driver_number === driver;
      const isC = d.driver_number === compare;
      field.push({ code: driverCode(d), m: rel(straight, m.m, lapLen) as number });
      if (isP || isC) {
        const at = isP && lapCutLap !== null ? lapCutLap : isC && cLapCutLap !== null ? cLapCutLap : m.m;
        const into = rel(straight, at, lapLen);
        tags.push({ id: d.driver_number, code: driverCode(d), colour: teamColour(d), d: at, on: isP, note: into !== null && into !== undefined ? `${int(into)}${NB}m` : undefined });
      }
    }
  }
  // The picked and compare drivers with no cut-off on this straight have no dot to show; the
  // section label says so instead of the chip silently disappearing.
  const noCut = straight && lapLen && has
    ? [pDriver, cDriver].filter((d): d is NonNullable<typeof d> => !!d && !medians.get(d.driver_number)?.get(straight.straight_id)).map((d) => driverCode(d))
    : [];
  const sectionNote = noCut.length ? `${noCut.join(", ")} · no cut-off` : null;
  // Straights where anyone in the session has a cut-off; the map draws the rest quieter.
  // (Plain code, not a hook: this runs after the early returns above.)
  const withData = has ? new Set([...medians.values()].flatMap((m) => [...m.keys()])) : null;
  // The field on this straight: the bracket on the map; the median's value goes in the key
  // under the map (text on the road collides with chips and corner rings).
  const fieldMedian = (() => {
    if (!straight || !lapLen || !has) return null;
    const vals = drivers.flatMap((d) => {
      const m = medians.get(d.driver_number)?.get(straight.straight_id);
      return m ? [rel(straight, m.m, lapLen) as number] : [];
    }).sort((a, b) => a - b);
    if (!vals.length) return null;
    // Quantile with linear interpolation between the sorted medians.
    const qt = (p: number) => {
      const i = p * (vals.length - 1);
      const lo = Math.floor(i);
      return vals[lo] + (vals[Math.min(lo + 1, vals.length - 1)] - vals[lo]) * (i - lo);
    };
    const mid = qt(0.5);
    ticks.push({ id: "field", d: straight.d0 + mid, lo: straight.d0 + qt(0.25), hi: straight.d0 + qt(0.75), colour: "#9a9aa3" });
    return mid;
  })();
  // Regime colour at full strength round the whole lap, drawn as on the live map; the picked
  // straight is marked by its lit road edges and its label, not by fading the rest.
  const mapRuns: MapRun[] = runs;
  // Hover on the straight: the chart's cursor follows, and a card reads the point.
  const onHover = (m: number | null, at: { x: number; y: number } | null) => {
    if (m === null || !at) setHov(null);
    else {
      setHov({ m, x: at.x, y: at.y });
      cursor.set(m);
    }
  };
  const hovRead = (() => {
    if (!hov || !straight || !lapLen) return null;
    const bin = pProfile?.bins[Math.min(pProfile.bins.length - 1, Math.floor(hov.m / 50))];
    const lapD = wrap(straight.d0 + hov.m, lapLen);
    const reg = regIdx?.get(Math.floor(lapD / 50) * 50) ?? null;
    const near = field.filter((f) => Math.abs(f.m - hov.m) <= 15).map((f) => f.code);
    return { v: bin?.v_kph ?? null, a: bin?.a_ms2 ?? null, regime: reg, near };
  })();

  // Per-lap cut-offs on the selected straight, for the strip drawn without a speed profile.
  const stripOf = (code: string, colour: string, cuts: typeof pCut, med: typeof median): Strip => ({
    code,
    colour,
    median: med,
    cuts:
      straight && lapLen
        ? [...(cuts ?? new Map()).values()].flatMap((m) => (m.has(straight.straight_id) ? [rel(straight, m.get(straight.straight_id), lapLen) as number] : []))
        : [],
  });
  const strips: Strip[] = [...(pDriver ? [stripOf(pCode, "var(--ink)", pCut, median)] : []), ...(cDriver ? [stripOf(cCode, cTeam, cCut, cMedian)] : [])];
  const chartDrivers: ChartDriver[] = [];
  if (pDriver) chartDrivers.push({ number: pDriver.driver_number, code: pCode, colour: pTeam, hollow: false, cutoffs: pCut, median: straight ? pMed?.get(straight.straight_id) : undefined });
  if (cDriver) chartDrivers.push({ number: cDriver.driver_number, code: cCode, colour: cTeam, hollow: true, cutoffs: cCut, median: straight ? cMed?.get(straight.straight_id) : undefined });

  const facts = [
    ...(nLaps > 0 ? [{ label: "Laps", value: int(nLaps) }] : []),
    ...(lapLen ? [{ label: "Lap length", value: `${int(lapLen)}${NB}m` }] : []),
    ...(has && drivers.length ? [{ label: "With a cut-off", value: `${withResults.length} of ${drivers.length}` }] : []),
  ];
  const tabs: { key: TabKey; label: string }[] = [
    { key: "map", label: "Track map" },
    { key: "straight", label: "Straight" },
    ...(has ? [{ key: "bylap" as const, label: "Cut-off by lap" }, { key: "timing" as const, label: "Timing" }] : []),
  ];

  return (
    <div ref={root} className="ss">
      {/* ---------- Circuit poster: the place, the drawing, four numbers ---------- */}
      <CircuitPoster
        session={session}
        laps={nLaps}
        lapLength={lapLen || null}
        cutoff={median && pDriver ? { label: `${pCode} median cut-off`, value: `${int(median.m)}${NB}m` } : null}
        intro={
          <>
            {nLaps > 0 && lapLen ? `${int(nLaps)} laps of ${(lapLen / 1000).toFixed(3)} km. ` : ""}
            F1 does not publish 2026 battery data, so this page reads it off the public speed trace.
            {median && pDriver && sName ? ` On ${sName}, ${pCode} stops deploying a median ${int(median.m)} m into the straight.` : ""}
          </>
        }
      />

      {/* ---------- Header: the event, the facts, the two drivers ---------- */}
      <div className="wrap ss-head" data-intro>
        <SessionHeader
          session={session}
          facts={facts}
          aside={
            <div className="ss-pick">
              <DriverSelect drivers={drivers} value={driver} onChange={pickDriver} enabled={enabled} label="Driver" align="right" />
              {has && (
                <>
                  <span className="ss-vs" aria-hidden="true">
                    vs
                  </span>
                  <DriverSelect drivers={drivers} value={compare} onChange={pickCompare} enabled={enabled} label="Compare" allowNone exclude={driver} align="right" />
                </>
              )}
            </div>
          }
        />
        {!has && (
          <p className="ss-notice" role="status">
            {data.outlineError
              ? "This session has not been ingested yet: no outline, laps or model results."
              : "Model results are not published for this session yet: the map shows the circuit only, without cut-offs or regimes."}
          </p>
        )}
      </div>

      {/* ---------- Sub-nav: jumps to the sections below ---------- */}
      <div className="ss-nav">
        <div className="wrap">
          <Tabs
            items={tabs}
            value={tab}
            label="Sections"
            onChange={(k) => {
              const el = document.getElementById(TAB_ID[k]);
              if (el) scrollToTarget(el, -(window.innerWidth >= 1024 ? 136 : 72));
            }}
          />
        </div>
      </div>

      {/* ---------- The stage: map and straight, one cursor ---------- */}
      <section className="wrap ss-stage-sec" aria-labelledby="ss-sname">
        {data.outlineError ? (
          <Card className="ss-stage ss-stage--empty">
            <div id="ss-map" className="ss-empty">
              <span id="ss-straight">
                <Label as="p">Not ingested yet</Label>
                No circuit outline has been ingested for this session yet, so there is no map, no straights and no speed profile.
              </span>
            </div>
          </Card>
        ) : (
        <div className="ss-stage" style={{ ["--team" as string]: pTeam }}>
          <div className="ss-map" id="ss-map" data-reveal>
            <div className="ss-map__top">
              <Label>{regLapShown !== null && has ? `${pCode} · lap ${regLapShown} regimes` : "Track map"}</Label>
            </div>
            <div className="ss-map__box">
              {data.outline && data.outline.points.length > 1 ? (
                <TrackMap
                  outline={data.outline}
                  circuit={circuit}
                  straights={straights}
                  selected={straightId}
                  onSelect={pickStraight}
                  runs={mapRuns}
                  tags={tags}
                  ticks={ticks}
                  hover={straight ? { straight, length: length || null, onHover } : null}
                  corners
                  sf
                  straightLabels
                  sectionNote={sectionNote}
                  straightsWithData={withData}
                  crossfadeLines
                  zoom={1.3}
                  markerScale={1.18}
                  label={`${session.circuit_short_name ?? "Circuit"} track map; select a straight`}
                  className="ss-tmap"
                >
                  {hov && (
                    <div className="ss-hover" style={{ left: hov.x, top: hov.y }} role="status">
                      <b>{int(hov.m)}{NB}m</b>
                      {hovRead?.v !== null && hovRead?.v !== undefined && <span>{int(hovRead.v)}{NB}kph</span>}
                      {hovRead?.a !== null && hovRead?.a !== undefined && <span>{hovRead.a > 0 ? "+" : ""}{hovRead.a.toFixed(1)}{NB}m/s²</span>}
                      {hovRead?.regime && <span style={{ color: REGIME_VAR[hovRead.regime] }}>{REGIME_WORD[hovRead.regime]}</span>}
                      {hovRead && hovRead.near.length > 0 && <span className="ss-hover__near">cut-off: {hovRead.near.join(" ")}</span>}
                    </div>
                  )}
                </TrackMap>
              ) : data.outlineError ? (
                <p className="ss-empty">No circuit outline has been ingested for this session yet, so there is no map.</p>
              ) : data.outline ? (
                <p className="ss-empty">The reference lap has no position samples, so there is no map for this circuit.</p>
              ) : (
                <Skeleton className="ss-map__skel" />
              )}
            </div>
            {(straights.length > 0 || has) && (
            <div className="ss-map__foot">
              {straights.length > 0 && (
                <ul className="ss-strs" aria-label="Straights">
                  {straights.map((s) => (
                    <li key={s.straight_id}>
                      <button type="button" className="ss-str" aria-pressed={s.straight_id === straightId} onClick={() => pickStraight(s.straight_id)}>
                        <b>S{s.straight_id}</b> {s.into ?? straightName(s)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {has && (
                <ul className="ss-key">
                  <li>
                    <i className="ss-key__tick" style={{ background: "#9a9aa3" }} /> field: middle half of the drivers' median cut-offs, tick at the median{fieldMedian !== null ? ` (${int(fieldMedian)}${NB}m)` : ""}, est.
                  </li>
                  {regLapShown !== null &&
                    REGIMES.map((k) => (
                      <li key={k}>
                        <i className="ss-key__sw" style={{ background: REGIME_VAR[k] }} /> {REGIME_WORD[k]}
                      </li>
                    ))}
                </ul>
              )}
            </div>
            )}
          </div>

          <div className="ss-side" id="ss-straight" data-reveal>
            <CardHead
              className="ss-side__head"
              title={
                <span id="ss-sname" key={straightId ?? "none"} className="ss-swap-in">
                  {straight ? sName : "Straight"}
                </span>
              }
              aside={
                straight ? (
                  <span key={straight.straight_id} className="ss-mono ss-swap-in">
                    S{straight.straight_id} · {int(length)}
                    {NB}m
                  </span>
                ) : null
              }
            />
            {straight && lapLen ? (
              has ? (
                <Swap swapKey={straight.straight_id} className="ss-side__body">
                  <div className="ss-figs">
                    <Stat
                      label={`${pCode} median est.`}
                      value={median ? <RollingNumber value={median.m} format={int} /> : "–"}
                      unit={median ? "m" : undefined}
                      note={median && median.lo !== null && median.hi !== null ? `${int(median.lo)}–${int(median.hi)} m, 95 % interval` : median ? undefined : "no cut-off here"}
                    />
                    {lapNo !== null && pCut !== null ? (
                      <Stat
                        label={`Lap ${lapNo} est.`}
                        value={lapCut !== null ? <RollingNumber value={lapCut} format={int} /> : "–"}
                        unit={lapCut !== null ? "m" : undefined}
                        note={lapCut !== null ? "this lap's cut-off" : "no cut-off this lap"}
                        className="ss-figs__lap"
                      />
                    ) : (
                      <div className="stat" aria-busy="true">
                        <div className="stat__label">Lap est.</div>
                        <Skeleton className="ss-figs__skel" />
                      </div>
                    )}
                  </div>
                  {cDriver && (
                    <p className="ss-cmp">
                      <i style={{ background: cTeam }} />
                      <span className="ss-cmp__code">{cCode}</span> median est.{" "}
                      <b>{cMedian ? `${int(cMedian.m)}${NB}m` : "none"}</b>
                      {cMedian && cMedian.lo !== null && cMedian.hi !== null && (
                        <span className="ss-cmp__ci">
                          {int(cMedian.lo)}–{int(cMedian.hi)}
                        </span>
                      )}
                    </p>
                  )}
                  {pState.kind === "error" ? (
                    <p className="ss-plain ss-plain--s">The speed profile could not be loaded: {pState.error.message}</p>
                  ) : (
                    <div className="ss-chart">
                      <StraightPanel
                        mode={mode}
                        profile={pProfile}
                        compare={cProfile && cDriver ? { profile: cProfile, colour: cTeam, code: cCode } : null}
                        code={pCode}
                        length={length}
                        d0={straight.d0}
                        lap={lapLen}
                        regimes={regIdx}
                        regLap={regLapShown}
                        lapCut={lapCut}
                        lapNo={lapNo}
                        lapColour={pTeam}
                        cursor={cursor}
                        label={sName}
                        strips={strips}
                      />
                    </div>
                  )}
                  <p className="ss-caption">
                    {mode === "ready"
                      ? `Median of clean laps, 50${NB}m bins (est.). Strip under the axis: regimes of lap ${regLapShown ?? "–"}.`
                      : `One tick per lap at its cut-off over each driver's median (est.). Strip under the axis: regimes of lap ${regLapShown ?? "–"}. The speed profile for this straight is not published yet.`}
                  </p>
                </Swap>
              ) : (
                <div className="ss-side__body">
                  <Stat label="Straight length" value={int(length)} unit="m" note={`S${straight.straight_id} of ${straights.length} on this circuit`} />
                  <ul className="ss-slist" aria-label="Straights">
                    {straights.map((s) => (
                      <li key={s.straight_id}>
                        <button type="button" aria-pressed={s.straight_id === straightId} onClick={() => pickStraight(s.straight_id)}>
                          <b>S{s.straight_id}</b>
                          <span>{straightName(s)}</span>
                          <span className="ss-mono">{int(s.len)}{NB}m</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="ss-caption">No cut-offs, regimes or speed profiles are published for this session yet.</p>
                </div>
              )
            ) : data.ready && !straights.length ? (
              <div className="ss-side__body">
                <p className="ss-plain ss-plain--s">No straights are defined for this circuit yet.</p>
              </div>
            ) : (
              <div className="ss-side__body">
                <Skeleton className="ss-side__skel" />
              </div>
            )}
          </div>
        </div>
        )}

        {/* ---------- The race: laps as the scrubber ---------- */}
        <Card className="ss-laps" style={{ ["--team" as string]: pTeam }}>
          {pLaps.length ? (
            <LapAxis
              laps={pLaps}
              lap={lapNo}
              onLap={(n) => {
                setPlaying(false);
                pickLap(n);
              }}
              playing={playing}
              onPlay={() => {
                if (!playing && pLaps[pLaps.length - 1]?.lap_number === lapNo) pickLap(pLaps[0].lap_number);
                setPlaying((p) => !p);
              }}
              withCut={withCut}
              code={pCode}
            />
          ) : data.ready ? (
            <p className="ss-plain ss-plain--s">{laps.size ? "No timed laps for this driver." : "No laps have been ingested for this session yet."}</p>
          ) : (
            <Skeleton className="ss-laps__skel" />
          )}
        </Card>
      </section>

      {/* ---------- Cut-off by lap ---------- */}
      {has && straight && lapLen && pDriver && (
        <section className="wrap ss-sec" id="ss-bylap" aria-labelledby="ss-bylap-h">
          <SectionHead label={`S${straight.straight_id} · ${sName}`} title={<span id="ss-bylap-h">Cut-off by lap</span>}>
            One dot per lap with a cut-off, in metres into the straight. Each band is a driver's median with its 95{NB}% interval, an estimate. Click a
            dot to put that lap on the stage.
          </SectionHead>
          <Card className="ss-card">
            <CardHead
              title={
                <span key={straight.straight_id} className="ss-swap-in">
                  {`${pCode}${cDriver ? ` vs ${cCode}` : ""} · ${sName}`}
                </span>
              }
              aside={<span className="ss-mono">metres into the straight</span>}
            />
            <Swap swapKey={straight.straight_id} className="card__body">
              <CutoffChart straight={straight} lapLen={lapLen} laps={pLaps} selectedLap={lapNo} onLap={pickLap} drivers={chartDrivers} loading={pCut === null} />
            </Swap>
          </Card>
        </section>
      )}

      {/* ---------- The tower ---------- */}
      {has && lapLen && (
        <section className="wrap ss-sec" id="ss-timing" aria-labelledby="ss-timing-h">
          <SectionHead label="Timing" title={<span id="ss-timing-h">Median cut-off per straight</span>}>
            Every driver with a cut-off, ranked by {straight ? `S${straight.straight_id}` : "the selected straight"}, latest first. The bar is the share of
            green laps spent deploying, on the plateau, lifting and braking.
          </SectionHead>
          <Card className="ss-card ss-tower">
            {data.summary ? (
              <SessionTower
                rows={data.summary}
                straights={straights}
                lapLen={lapLen}
                selected={straightId}
                primary={driver}
                compare={compare}
                onPick={(n) => {
                  pickDriver(n);
                  scrollToTarget(0);
                }}
                onCompare={pickCompare}
              />
            ) : (
              <Skeleton className="ss-tower__skel" />
            )}
          </Card>
        </section>
      )}
    </div>
  );
}

/** The tab whose section is under the sub-nav. On desktop the map and the straight share a row. */
function useActiveTab(has: boolean): TabKey {
  const [tab, setTab] = useState<TabKey>("map");
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const line = (window.innerWidth >= 1024 ? 136 : 72) + 40;
      let cur: TabKey = "map";
      const mapTop = document.getElementById(TAB_ID.map)?.getBoundingClientRect().top ?? 0;
      for (const k of ["map", "straight", "bylap", "timing"] as TabKey[]) {
        const el = document.getElementById(TAB_ID[k]);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (k === "straight" && Math.abs(top - mapTop) < 40) continue;
        if (top <= line) cur = k;
      }
      setTab(cur);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    window.addEventListener("scroll", on, { passive: true });
    read();
    return () => {
      window.removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
    };
  }, [has]);
  return tab;
}

function PageSkeleton() {
  return (
    <div role="img" aria-label="Loading the session">
      <div className="ss-photo ss-photo--none" />
      <div className="wrap ss-head">
        <Skeleton className="ss-skel-title" />
      </div>
      <div className="wrap ss-stage-sec">
        <Skeleton className="ss-skel-stage" />
      </div>
    </div>
  );
}
