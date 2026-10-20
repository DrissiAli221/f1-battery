import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { Readout } from "../components/Readout";
import { SectionIntro } from "../components/Section";
import { CutoffChart, type ChartDriver } from "../explorer/CutoffChart";
import { useCutoffs, useRegimes, useSessionData } from "../explorer/data";
import { DriverSelect } from "../explorer/DriverSelect";
import { LapAxis } from "../explorer/LapAxis";
import { defaultStraight, regimeIndex, rel, relMedian, useProfile, useStraightProfile } from "../explorer/profile";
import { createStore, useStore, type Store } from "../explorer/store";
import { StraightPanel, type PanelReading } from "../explorer/StraightPanel";
import { Tower } from "../explorer/Tower";
import { REGIME_VAR, TrackMap, type MarkDriver } from "../explorer/TrackMap";
import { REGIME_WORD } from "../instrument/driver";
import { date, int } from "../lib/format";
import { href, useQueryState } from "../lib/router";
import { driverCode, teamColour } from "../lib/teams";
import { regimeRuns } from "../lib/track";
import { straightName } from "../lib/types";
import { scrollToTarget, usePage } from "../motion";
import "../explorer/explorer.css";

const num = (v: string | null) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const NB = " ";

/*
 * The session explorer (DESIGN.md "Session page"): one instrument, no cards. A header with the
 * circuit at display size and the two driver pickers; the stage (the map in columns 1 to 7,
 * the straight in 8 to 12, one shared cursor); the race as a lap axis; then, with room, the
 * cut-off by lap and the tower. State that can be shared lives in the query string
 * (?driver=&compare=&straight=&lap=); the cursor lives in a store so a pointer move never
 * re-renders the page.
 */
export function SessionPage({ sessionKey }: { sessionKey: number }) {
  const data = useSessionData(sessionKey);
  const [query, setQuery] = useQueryState();
  const [playing, setPlaying] = useState(false);
  const [cursor] = useState(() => createStore<number | null>(null));
  const [reading] = useState(() => createStore<PanelReading | null>(null));

  const { session, drivers, withResults, medians, laps, straights, lap: lapLen } = data;
  const has = !!session?.has_results;
  const enabled = useMemo(
    () => new Set((has ? withResults : drivers).map((d) => d.driver_number)),
    [has, withResults, drivers],
  );

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
  const runs = useMemo(() => (regimes.data && lapLen ? regimeRuns(regimes.data.bins, lapLen) : []), [regimes.data, lapLen]);
  const regIdx = useMemo(() => regimeIndex(regimes.data?.bins), [regimes.data]);

  // The speed profiles (D30): the selected driver, and the compare driver as a second trace.
  const pState = useProfile(sessionKey, straightId, driver, has);
  const cState = useProfile(sessionKey, straightId, compare, has);
  const pProfile = useStraightProfile(pState, straight, lapLen, regIdx);
  const cProfile = useStraightProfile(cState, straight, lapLen, null);

  const lapCutLap = straightId !== null && lapNo !== null ? pCut?.get(lapNo)?.get(straightId) ?? null : null;
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
  const onReading = useCallback((r: PanelReading) => reading.set(r), [reading]);

  if (data.sessionsError) {
    return (
      <div ref={root} className="xp">
        <p className="wrap xp-plain">The session could not be loaded: {data.sessionsError.message}</p>
      </div>
    );
  }
  if (!session && data.sessionsLoaded) {
    return (
      <div ref={root} className="xp">
        <h1 className="wrap xp-plain">
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
      <div ref={root} className="xp">
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
  const pMark: MarkDriver | null = pDriver ? { code: pCode, colour: "var(--ink)", medians: pMed } : null;
  const cMark: MarkDriver | null = cDriver ? { code: cCode, colour: teamColour(cDriver), medians: cMed } : null;
  const nLaps = Math.max(0, ...[...laps.values()].map((l) => l.length));
  const sName = straight ? straightName(straight) : "";
  const regLapShown = regimes.data?.lap ?? null;
  const mode = pState.kind === "ready" ? "ready" : pState.kind === "loading" ? "loading" : "none";
  // Per-lap cut-offs on the selected straight, for the fallback drawing without a profile.
  const stripOf = (code: string, colour: string, cuts: typeof pCut, med: typeof median) => ({
    code,
    colour,
    median: med,
    cuts: straight && lapLen ? [...(cuts ?? new Map()).values()].flatMap((m) => (m.has(straight.straight_id) ? [rel(straight, m.get(straight.straight_id), lapLen) as number] : [])) : [],
  });
  const strips = [
    ...(pDriver ? [stripOf(pCode, "var(--ink)", pCut, median)] : []),
    ...(cDriver ? [stripOf(cCode, teamColour(cDriver), cCut, cMedian)] : []),
  ];
  const chartDrivers: ChartDriver[] = [];
  if (pDriver) chartDrivers.push({ number: pDriver.driver_number, code: pCode, colour: "var(--ink)", hollow: false, cutoffs: pCut, median: straight ? pMed?.get(straight.straight_id) : undefined });
  if (cDriver) chartDrivers.push({ number: cDriver.driver_number, code: cCode, colour: teamColour(cDriver), hollow: true, cutoffs: cCut, median: straight ? cMed?.get(straight.straight_id) : undefined });

  return (
    <div ref={root} className="xp">
      {/* ---------- Header: the circuit, the session, the two drivers ---------- */}
      <div className="wrap xp-head">
        <div className="xp-head__title">
          <h1 className="xp-h1" data-intro>
            {session.circuit_short_name ?? `Session ${sessionKey}`}
          </h1>
          <p className="xp-head__meta" data-intro>
            {session.session_name} · {date(session.date_start, "short").replace(/ /g, NB)}
            {nLaps > 0 && ` · ${nLaps}${NB}laps`}
            {lapLen && ` · ${int(lapLen)}${NB}m${NB}a${NB}lap`}
          </p>
        </div>
        <div className="xp-head__pick" data-intro>
          <DriverSelect drivers={drivers} value={driver} onChange={pickDriver} enabled={enabled} label="Driver" align="right" />
          {has && (
            <>
              <span className="xp-vs" aria-hidden="true">
                vs
              </span>
              <DriverSelect drivers={drivers} value={compare} onChange={pickCompare} enabled={enabled} label="Compare with" allowNone exclude={driver} align="right" />
            </>
          )}
        </div>
      </div>
      {!has && (
        <p className="wrap xp-plain xp-plain--s" role="status">
          Model results are not published for this session yet: the map shows the circuit only, without cut-offs or regimes.
        </p>
      )}

      {/* ---------- The stage: map and straight, one cursor ---------- */}
      <section className="wrap xp-stage" aria-labelledby="xp-sname">
        <div className="xp-stage__map" data-reveal>
          <div className="xp-stage__mapbox">
            {data.outline && data.outline.points.length > 1 && pMark ? (
              <TrackMap
                outline={data.outline}
                straights={straights}
                runs={runs}
                primary={pMark}
                compare={cMark}
                selected={straightId}
                onSelect={pickStraight}
                lapCut={lapCutLap}
                cursor={cursor}
                length={length || null}
                animateKey={String(sessionKey)}
              />
            ) : data.outlineError ? (
              <p className="xp-plain xp-plain--s">The circuit outline could not be loaded: {data.outlineError.message}</p>
            ) : data.outline ? (
              <p className="xp-plain xp-plain--s">The reference lap has no position samples, so there is no map for this circuit.</p>
            ) : (
              <div className="xp-skel-map" aria-label="Drawing the circuit" role="img" />
            )}
          </div>
          {straights.length > 0 && (
            <ul className="xp-strlist" aria-label="Straights">
              {straights.map((s) => (
                <li key={s.straight_id}>
                  <button
                    type="button"
                    className="xp-strbtn"
                    aria-pressed={s.straight_id === straightId}
                    onClick={() => pickStraight(s.straight_id)}
                  >
                    <span className="num">S{s.straight_id}</span> {straightName(s)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="xp-stage__side" data-reveal>
          {straight && lapLen ? (
            <>
              <div className="xp-side__head">
                <p className="xp-side__sid">
                  S{straight.straight_id} · {int(length)}
                  {NB}m
                </p>
                <h2 id="xp-sname" className="xp-side__name">
                  {sName}
                </h2>
              </div>
              {has && (
                <dl className="xp-figs">
                  <div>
                    <dt>{pCode} median est.</dt>
                    <dd>
                      {median ? `${int(median.m)}${NB}m` : "none"}
                      {median && median.lo !== null && median.hi !== null && (
                        <span className="xp-figs__ci">
                          {int(median.lo)}–{int(median.hi)}
                        </span>
                      )}
                    </dd>
                  </div>
                  {cDriver && (
                    <div>
                      <dt>{cCode} median est.</dt>
                      <dd>
                        {cMedian ? `${int(cMedian.m)}${NB}m` : "none"}
                        {cMedian && cMedian.lo !== null && cMedian.hi !== null && (
                          <span className="xp-figs__ci">
                            {int(cMedian.lo)}–{int(cMedian.hi)}
                          </span>
                        )}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>
                      {pCode} lap {lapNo ?? "–"} est.
                    </dt>
                    <dd>{lapCut !== null ? `${int(lapCut)}${NB}m` : "no cut-off"}</dd>
                  </div>
                </dl>
              )}
              {has ? (
                pState.kind === "error" ? (
                  <p className="xp-plain xp-plain--s">The speed profile could not be loaded: {pState.error.message}</p>
                ) : (
                  <StraightPanel
                    mode={mode}
                    profile={pProfile}
                    compare={cProfile && cDriver ? { profile: cProfile, colour: teamColour(cDriver) } : null}
                    length={length}
                    d0={straight.d0}
                    lap={lapLen}
                    regimes={regIdx}
                    median={median}
                    lapCut={lapCut}
                    lapNo={lapNo}
                    cursor={cursor}
                    onReading={onReading}
                    labels={{ circuit: session.circuit_short_name ?? undefined, straight: sName, driver: pCode }}
                    strips={strips}
                  />
                )
              ) : null}
              {has && (
                <ul className="xp-legend">
                  {mode === "ready" && (
                    <li>
                      <i className="xp-sw" style={{ background: "var(--ink)", height: 2 }} /> {pCode}, median speed of clean laps (est.)
                    </li>
                  )}
                  {mode === "ready" && cProfile && cDriver && (
                    <li>
                      <i className="xp-sw" style={{ background: teamColour(cDriver), height: 1 }} /> {cCode}
                    </li>
                  )}
                  <li>
                    <i className="xp-sw xp-sw--hatch" /> cut-off interval (95{NB}%)
                  </li>
                  {regLapShown !== null &&
                    (["deploy", "plateau", "lift", "brake"] as const).map((k) => (
                      <li key={k}>
                        <i className="xp-sw" style={{ background: REGIME_VAR[k] }} /> {REGIME_WORD[k]}
                      </li>
                    ))}
                  {regLapShown !== null && <li className="xp-legend__k">regimes of lap {regLapShown}</li>}
                </ul>
              )}
            </>
          ) : (
            <div className="xp-straight">
              <div className="st st--panel">
                <div className="st__plot" aria-busy="true">
                  <div className="st__skeleton" />
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---------- The race: laps as the distance axis ---------- */}
      <section className="wrap xp-scrub" aria-label="Laps" data-reveal>
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
          <p className="xp-plain xp-plain--s">No timed laps for this driver.</p>
        ) : (
          <div className="xp-skel-axis" role="img" aria-label="Loading the laps" />
        )}
      </section>

      {/* ---------- Cut-off by lap ---------- */}
      {has && straight && lapLen && pDriver && (
        <section className="wrap xp-sec" aria-labelledby="xp-bylap">
          <SectionIntro id="xp-bylap" title={<>Cut‑off by lap on <span className="whitespace-nowrap">{sName}</span></>}>
            One dot per lap with a cut-off, in metres from the start of the straight. Each band is a driver's median with its 95{NB}%
            interval, an estimate. Click a dot to put that lap on the stage.
          </SectionIntro>
          <div className="xp-sec__body" data-reveal>
            <ul className="xp-legend xp-legend--top">
              <li>
                <i className="xp-dotsw" style={{ background: "var(--ink)" }} /> {pCode}
              </li>
              {cDriver && (
                <li>
                  <i className="xp-dotsw" style={{ border: `1.5px solid ${teamColour(cDriver)}` }} /> {cCode}
                </li>
              )}
              <li>
                <i className="xp-sw" style={{ background: "var(--accent)", width: 2, height: 12 }} /> lap {lapNo ?? "–"}
              </li>
            </ul>
            <CutoffChart
              straight={straight}
              lapLen={lapLen}
              laps={pLaps}
              selectedLap={lapNo}
              onLap={pickLap}
              drivers={chartDrivers}
              loading={pCut === null}
            />
          </div>
        </section>
      )}

      {/* ---------- The tower ---------- */}
      {has && lapLen && (
        <section className="wrap xp-sec" aria-labelledby="xp-tower">
          <SectionIntro id="xp-tower" title="Median cut‑off per straight">
            Every driver with a cut-off, ranked by {straight ? `S${straight.straight_id}` : "the selected straight"}, latest first. The bar on
            the right is the share of green laps spent deploying, on the plateau, lifting and braking. Select a row to put that driver on the stage.
          </SectionIntro>
          <div className="xp-sec__body">
            {data.summary ? (
              <Tower
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
              />
            ) : (
              <div className="xp-skel-rows" role="img" aria-label="Loading the tower" />
            )}
          </div>
        </section>
      )}

      {has && <PageReadout reading={reading} code={pCode} lapNo={regLapShown ?? lapNo} sid={straight?.straight_id ?? null} />}
    </div>
  );
}

/** The fixed bottom-right readout: where the cursor is, what the car is doing there. */
function PageReadout({ reading, code, lapNo, sid }: { reading: Store<PanelReading | null>; code: string; lapNo: number | null; sid: number | null }) {
  const r = useStore(reading);
  if (!r) return null;
  const parts = [`${int(r.d)}${NB}m`];
  if (r.v !== null) parts.push(`${int(r.v)}${NB}kph`);
  if (r.regime) parts.push(REGIME_WORD[r.regime]);
  return (
    <Readout label="Cursor">
      <p className="xp-ro__main">{parts.join(" · ")}</p>
      <p className="xp-ro__sub">
        {code} · lap {lapNo ?? "–"}
        {sid !== null && ` · S${sid}`}
      </p>
    </Readout>
  );
}

function PageSkeleton() {
  return (
    <div className="wrap" role="img" aria-label="Loading the session">
      <div className="xp-head xp-head--skel">
        <div className="xp-skel-title" />
      </div>
      <div className="xp-skel-stage" />
    </div>
  );
}
