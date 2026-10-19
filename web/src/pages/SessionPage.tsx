import { useEffect, useMemo, useState } from "react";
import { DriverCard, DriverPicker } from "../components/Driver";
import { Empty, ErrorNote, Eyebrow, Loading, Reveal, SectionHead } from "../components/ui";
import { CutoffChart } from "../explorer/CutoffChart";
import { useCutoffs, useRegimes, useSessionData } from "../explorer/data";
import { DistanceStrip } from "../explorer/DistanceStrip";
import { LapScrubber } from "../explorer/LapScrubber";
import { StraightDetail, type StraightDriver } from "../explorer/StraightDetail";
import { SummaryTable } from "../explorer/SummaryTable";
import { REGIME_VAR, TrackMap, type MarkDriver } from "../explorer/TrackMap";
import { date, int, signed } from "../lib/format";
import { href, useQueryState } from "../lib/router";
import { driverCode, teamColour } from "../lib/teams";
import { regimeAt, regimeRuns, straightAt } from "../lib/track";
import { useRemote, url } from "../lib/api";

const num = (v: string | null) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export function SessionPage({ sessionKey }: { sessionKey: number }) {
  const data = useSessionData(sessionKey);
  const models = useRemote<{ items: { model_version: string; run_id: string }[] }>(url("/models"));
  const [query, setQuery] = useQueryState();
  const [cursorHover, setCursorHover] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const { session, drivers, withResults, medians, laps, straights, lap: lapLen } = data;
  const has = !!session?.has_results;
  const enabled = useMemo(() => new Set(withResults.map((d) => d.driver_number)), [withResults]);

  // Selection: query string first (shareable), validated against the data, then defaults.
  const qDriver = num(query.get("driver"));
  const driver = qDriver !== null && (enabled.has(qDriver) || (!has && drivers.some((d) => d.driver_number === qDriver))) ? qDriver : data.defaultDriver;
  const qCompare = num(query.get("compare"));
  const compare = qCompare !== null && qCompare !== driver && enabled.has(qCompare) ? qCompare : null;
  const pDriver = drivers.find((d) => d.driver_number === driver) ?? null;
  const cDriver = drivers.find((d) => d.driver_number === compare) ?? null;
  const pMed = driver !== null ? medians.get(driver) : undefined;
  const cMed = compare !== null ? medians.get(compare) : undefined;

  const qStraight = num(query.get("straight"));
  const straightId =
    qStraight !== null && straights.some((s) => s.straight_id === qStraight)
      ? qStraight
      : (straights.find((s) => pMed?.has(s.straight_id)) ?? straights[0])?.straight_id ?? null;
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

  // Default lap: the fastest green lap with a cut on the selected straight.
  const defaultLap = useMemo(() => {
    const green = pLaps.filter((l) => l.green);
    const pool = green.filter((l) => withCut.has(l.lap_number));
    const list = pool.length ? pool : green.length ? green : pLaps;
    if (!list.length) return null;
    return list.reduce((a, b) => ((a.lap_duration ?? Infinity) <= (b.lap_duration ?? Infinity) ? a : b)).lap_number;
  }, [pLaps, withCut]);
  const qLap = num(query.get("lap"));
  const lapNo = qLap !== null && pLaps.some((l) => l.lap_number === qLap) ? qLap : defaultLap;

  // Regimes for the shown lap. While playing, the previous lap's colours stay and the request
  // waits for the pause, to stay inside the API's per-IP rate limit.
  const [regLap, setRegLap] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) setRegLap(lapNo);
  }, [lapNo, playing]);
  const regimes = useRegimes(sessionKey, driver, regLap, has);
  const runs = useMemo(() => (regimes.data && lapLen ? regimeRuns(regimes.data.bins, lapLen) : []), [regimes.data, lapLen]);

  // Play through the laps.
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      const i = pLaps.findIndex((l) => l.lap_number === lapNo);
      if (i < 0 || i >= pLaps.length - 1) {
        setPlaying(false);
        return;
      }
      setQuery({ lap: pLaps[i + 1].lap_number });
    }, 450);
    return () => window.clearInterval(t);
  }, [playing, pLaps, lapNo, setQuery]);

  useEffect(() => {
    setPlaying(false);
    setCursorHover(null);
  }, [sessionKey]);

  const lapCut = straightId !== null && lapNo !== null ? pCut?.get(lapNo)?.get(straightId) ?? null : null;
  const pm = straightId !== null ? pMed?.get(straightId) : undefined;
  const restCursor = lapCut ?? pm?.m ?? null;
  const cursor = cursorHover ?? restCursor;

  if (data.sessionsError) return <PageError error={data.sessionsError} />;
  if (!session && data.sessionsLoaded) {
    return (
      <div className="wrap section">
        <Empty title="Unknown session">
          There is no session {sessionKey}. <a className="prose-link" href={href.sessions()}>Back to the sessions</a>.
        </Empty>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="wrap section">
        <Loading label="Loading the session" className="h-[60vh]" />
      </div>
    );
  }

  const pickDriver = (n: number | null) => {
    if (n === null) return;
    setQuery({ driver: n, compare: n === compare ? null : compare, lap: null, straight: null });
  };
  const pickCompare = (n: number | null) => setQuery({ compare: n });
  const pickStraight = (id: number) => setQuery({ straight: id });
  const pickLap = (n: number) => setQuery({ lap: n });

  const pMark: MarkDriver | null = pDriver ? { code: driverCode(pDriver), colour: teamColour(pDriver), medians: pMed } : null;
  const cMark: MarkDriver | null = cDriver ? { code: driverCode(cDriver), colour: teamColour(cDriver), medians: cMed } : null;
  const greenOf = (n: number | null) => (n === null ? 0 : (laps.get(n) ?? []).filter((l) => l.green).length);
  const pStraight: StraightDriver | null = pDriver ? { d: pDriver, colour: teamColour(pDriver), medians: pMed, cutoffs: pCut, greenLaps: greenOf(driver) } : null;
  const cStraight: StraightDriver | null = cDriver ? { d: cDriver, colour: teamColour(cDriver), medians: cMed, cutoffs: cCut, greenLaps: greenOf(compare) } : null;
  const nLaps = Math.max(0, ...[...laps.values()].map((l) => l.length));
  const model = models.data?.items[0];
  const straightTag = straight ? `S${straight.straight_id}` : "";

  return (
    <>
      {/* ---------- Header: session meta and driver pickers ---------- */}
      <section className="wrap pb-14 pt-14 md:pb-20 md:pt-20">
        <nav className="mb-8 flex items-center gap-2 text-[14px] text-ink-3" aria-label="Breadcrumb">
          <a className="prose-link" href={href.sessions()}>
            Sessions
          </a>
          <span aria-hidden="true">/</span>
          <span className="text-ink-2">{session.circuit_short_name}</span>
        </nav>
        <div className="grid gap-12 xl:grid-cols-12 xl:items-end">
          <div className="xl:col-span-6">
            <Eyebrow>Explorer · session {sessionKey}</Eyebrow>
            <h1 className="mt-5 break-words font-display text-[36px] font-bold uppercase leading-[1.05] text-ink-head sm:text-[48px] md:text-[64px]">
              {session.circuit_short_name}
              <span className="block text-ink-3">{session.session_name}</span>
            </h1>
            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4 text-[15px]">
              <Meta label="Date" value={date(session.date_start)} />
              <Meta label="Laps" value={nLaps ? String(nLaps) : "–"} />
              <Meta label="Lap length" value={lapLen ? `${int(lapLen)} m` : "–"} />
              <Meta label="Model" value={model ? `${model.model_version} · run ${model.run_id.slice(0, 8)}` : "–"} />
            </dl>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:col-span-6">
            {pDriver ? (
              <DriverCard
                d={pDriver}
                role="Selected"
                stat={straight && has ? { label: `${straightTag} median cut`, value: pm ? `${int(pm.m)} m` : "none" } : undefined}
                action={
                  <DriverPicker drivers={drivers} value={driver} onChange={pickDriver} enabled={has ? enabled : new Set(drivers.map((d) => d.driver_number))} label="Choose the driver">
                    Change
                  </DriverPicker>
                }
              />
            ) : (
              <div className="h-[196px] rounded-xs bg-surface" />
            )}
            {cDriver ? (
              <DriverCard
                d={cDriver}
                role="Compare"
                stat={
                  straight
                    ? {
                        label: `Δ median ${straightTag}`,
                        value: pm && cMed?.get(straight.straight_id) ? `${signed(cMed.get(straight.straight_id)!.m - pm.m)} m` : "–",
                      }
                    : undefined
                }
                action={
                  <DriverPicker drivers={drivers} value={compare} onChange={pickCompare} enabled={enabled} label="Choose a driver to compare" allowNone exclude={driver}>
                    Change
                  </DriverPicker>
                }
              />
            ) : (
              <div className="flex h-[176px] flex-col justify-between rounded-xs border-2 border-dashed border-line p-5 md:h-[196px]">
                <div>
                  <p className="font-display text-[15px] font-bold uppercase text-ink-2">Compare</p>
                  <p className="mt-2 max-w-[30ch] text-[14px] text-ink-3">Add a second driver: hollow marks on the outer edge of the track.</p>
                </div>
                {has && (
                  <div className="self-start">
                    <DriverPicker drivers={drivers} value={null} onChange={pickCompare} enabled={enabled} label="Choose a driver to compare" exclude={driver}>
                      Add a driver
                    </DriverPicker>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {!has && (
          <div className="mt-10 rounded-xs border border-warn/40 bg-warn/10 px-5 py-4 text-[15px] text-ink-2" role="status">
            <strong className="text-ink-head">Model results are not published for this session.</strong> The track and laps come from ingested
            telemetry only; cut-offs, regimes and the summary stay empty until the model has run.
          </div>
        )}
      </section>

      {/* ---------- Hero: the track map ---------- */}
      <section id="map" className="wrap scroll-mt-20" aria-label="Track map">
        <div className="overflow-hidden rounded-s border border-line-2 bg-frame">
          <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-5 border-b border-line-2 px-4 py-5 md:px-8 md:py-6">
            <MapLegend
              code={pDriver ? driverCode(pDriver) : ""}
              compare={cDriver ? { code: driverCode(cDriver), colour: teamColour(cDriver) } : null}
              regimeLap={regimes.data?.lap ?? null}
              hasRegimes={runs.length > 0}
            />
            {lapLen && cursor !== null && (
              <Readout
                d={cursor}
                lap={lapLen}
                live={cursorHover !== null}
                lapNo={lapNo}
                zone={straightAt(straights, cursor, lapLen)}
                regime={regimeAt(runs, cursor)}
                regimeLap={regimes.data?.lap ?? null}
                code={pDriver ? driverCode(pDriver) : ""}
              />
            )}
          </div>
          <div className="grid-bg relative h-[62vh] min-h-[420px] max-h-[900px] md:h-[74vh] md:min-h-[560px]">
            {data.outline && data.outline.points.length > 1 && straights.length >= 0 && pMark ? (
              <TrackMap
                outline={data.outline}
                straights={straights}
                runs={runs}
                primary={pMark}
                compare={cMark}
                selected={straightId}
                onSelect={pickStraight}
                lapCut={lapCut}
                cursor={cursor}
                onHover={setCursorHover}
                animateKey={`${sessionKey}`}
              />
            ) : data.outlineError ? (
              <div className="p-8">
                <ErrorNote error={data.outlineError} />
              </div>
            ) : data.outline && data.outline.points.length <= 1 ? (
              <div className="grid h-full place-items-center p-8">
                <Empty title="No outline for this circuit">The reference lap has no location samples.</Empty>
              </div>
            ) : (
              <Loading label="Drawing the track" className="h-full" />
            )}
          </div>
          {/* Distance strip and scrubber, attached under the map. */}
          <div className="border-t border-line-2 bg-surface px-4 pb-8 pt-8 md:px-8">
            {lapLen && pMark && (
              <DistanceStrip
                lap={lapLen}
                straights={straights}
                runs={runs}
                primary={pMark}
                compare={cMark}
                selected={straightId}
                onSelect={pickStraight}
                cursor={cursor}
                onHover={setCursorHover}
              />
            )}
            <div className="mt-8 border-t border-line-2 pt-8">
              {pLaps.length ? (
                <LapScrubber
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
                  straightLabel={straightTag || "straight"}
                  lapCut={lapCut}
                />
              ) : (
                <p className="text-ink-3">{data.ready ? "No timed laps for this driver." : "Loading laps"}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Selected straight ---------- */}
      {has && straight && pStraight && lapLen && (
        <section id="straight" className="wrap section">
          <SectionHead
            eyebrow="Selected straight"
            title={
              <>
                {straightTag} · {straight.label}
              </>
            }
          >
            Where {driverCode(pStraight.d)}'s electrical deployment stops on this straight: the point where acceleration drops to the
            engine-only plateau. Estimated from speed, not measured.
          </SectionHead>
          <div className="mb-14 grid grid-cols-3 gap-2 sm:flex sm:gap-8" role="tablist" aria-label="Straight">
            {straights.map((s) => {
              const hasCut = !!pMed?.has(s.straight_id);
              return (
                <button
                  key={s.straight_id}
                  type="button"
                  role="tab"
                  aria-selected={s.straight_id === straightId}
                  className={`tab text-left sm:min-w-[120px] ${hasCut ? "" : "is-empty"}`}
                  onClick={() => pickStraight(s.straight_id)}
                >
                  <span className="block font-display text-[15px] font-bold">S{s.straight_id}</span>
                  <span className="block truncate text-[12px]">{hasCut ? s.label : "no cut"}</span>
                </button>
              );
            })}
          </div>
          <Reveal>
            <StraightDetail straight={straight} lap={lapLen} selectedLap={lapNo} primary={pStraight} compare={cStraight} onLap={pickLap} />
          </Reveal>
        </section>
      )}

      {/* ---------- Cut-off by lap ---------- */}
      {has && straight && pStraight && lapLen && (
        <section id="chart" className="border-y border-line-2 bg-surface/40">
          <div className="wrap section">
            <SectionHead
              eyebrow="Cut-off by lap"
              title={`${straightTag} across the ${session.session_name.toLowerCase()}`}
              aside={
                <ul className="flex flex-wrap gap-x-8 gap-y-3 text-[14px]">
                  <LegendDot code={driverCode(pStraight.d)} colour={pStraight.colour} hollow={false} />
                  {cStraight && <LegendDot code={driverCode(cStraight.d)} colour={cStraight.colour} hollow />}
                  <li className="flex items-center gap-2 text-ink-3">
                    <i className="inline-block h-3 w-6 bg-white/15" /> median and 95 % range
                  </li>
                </ul>
              }
            >
              One point per lap with a cut-off on this straight. The red line is the scrubber's lap; click a point to move there.
            </SectionHead>
            <CutoffChart straight={straight} lap={lapLen} laps={pLaps} selectedLap={lapNo} onLap={pickLap} primary={pStraight} compare={cStraight} />
          </div>
        </section>
      )}

      {/* ---------- Session summary ---------- */}
      {has && data.summary && lapLen && (
        <section id="summary" className="wrap section">
          <SectionHead eyebrow={`Session summary · ${withResults.length} drivers with a cut-off`} title="Median cut-off per straight">
            Ranked by the selected straight, latest cut-off first. The regime bar is the share of each green lap spent deploying, on the
            plateau, lifting and braking.
          </SectionHead>
          <SummaryTable
            rows={data.summary}
            straights={straights}
            lap={lapLen}
            selected={straightId}
            primary={driver}
            compare={compare}
            onPick={(n) => {
              pickDriver(n);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </section>
      )}
      {!has && <div className="h-24" />}
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="num mt-1 text-ink-head">{value}</dd>
    </div>
  );
}

function LegendDot({ code, colour, hollow }: { code: string; colour: string; hollow: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <svg width="14" height="14" aria-hidden="true">
        <circle cx="7" cy="7" r="5" fill={hollow ? "none" : colour} stroke={colour} strokeWidth="1.8" />
      </svg>
      <span className="font-display font-bold uppercase text-ink-head">{code}</span>
    </li>
  );
}

function MapLegend({
  code,
  compare,
  regimeLap,
  hasRegimes,
}: {
  code: string;
  compare: { code: string; colour: string } | null;
  regimeLap: number | null;
  hasRegimes: boolean;
}) {
  return (
    <div>
      <p className="cap">{hasRegimes ? `Regimes · ${code} lap ${regimeLap}` : "Regimes not available"}</p>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-2">
        {(["deploy", "plateau", "lift", "brake"] as const).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <i className="inline-block h-[3px] w-4 rounded" style={{ background: REGIME_VAR[k] }} />
            {k}
          </li>
        ))}
      </ul>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-3">
        <li className="flex items-center gap-2">
          <i className="inline-block h-3.5 w-[3px] bg-ink-head" /> {code} median
        </li>
        <li className="flex items-center gap-2">
          <i className="inline-block h-[3px] w-4 bg-ink-head" /> range (95 %)
        </li>
        <li className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="-7 -7 15 14" aria-hidden="true">
            <path d="M8,0 L-6,-7 L-2.5,0 L-6,7 Z" fill="var(--ink-head)" />
          </svg>
          this lap's cut
        </li>
        {compare && (
          <li className="flex items-center gap-2">
            <i className="inline-block h-3.5 w-[5px] rounded-[1px] border-[1.5px]" style={{ borderColor: compare.colour }} /> {compare.code}, outer edge
          </li>
        )}
      </ul>
    </div>
  );
}

function Readout({
  d,
  lap,
  live,
  lapNo,
  zone,
  regime,
  regimeLap,
  code,
}: {
  d: number;
  lap: number;
  live: boolean;
  lapNo: number | null;
  zone: { straight_id: number; label: string | null } | null;
  regime: string | null;
  regimeLap: number | null;
  code: string;
}) {
  return (
    <div className="hidden min-w-[220px] md:block md:text-right" aria-live="polite">
      <p className="cap">Cursor · {live ? "hover" : `lap ${lapNo ?? "–"} cut`}</p>
      <p className="mt-2 flex items-baseline gap-4 md:justify-end">
        <span className="num text-[26px] leading-none text-ink-head">{int(d)} m</span>
        <span className="num text-[13px] text-ink-3">{((d / lap) * 100).toFixed(1)} %</span>
      </p>
      <p className="mt-1 text-[14px] text-ink-2">
        {zone ? (
          <>
            <span className="font-display text-[12px] font-bold text-ink-head">S{zone.straight_id}</span> · {zone.label}
          </>
        ) : (
          "between straights"
        )}
      </p>
      {regime && (
        <p className="mt-1 flex items-center gap-2 text-[14px] text-ink-2 md:justify-end">
          <i className="inline-block h-[3px] w-3 rounded" style={{ background: REGIME_VAR[regime as keyof typeof REGIME_VAR] }} />
          {regime === "other" ? "unlabelled" : regime}
          <span className="text-ink-3">
            · {code} L{regimeLap}
          </span>
        </p>
      )}
    </div>
  );
}

function PageError({ error }: { error: Error }) {
  return (
    <div className="wrap section">
      <ErrorNote error={error} />
    </div>
  );
}

