import './reveal';
import { PageGround, SiteFooter, SiteHeader } from './chrome';
import { useInitialAnchor } from './preview-navigation';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { gsap } from 'gsap';
import { useList, useRateLimited } from '../lib/api';
import type { SessionRow } from '../lib/types';
import { useSessionData, useRegimes } from './preview-data';
import { useLive, type LiveState } from '../live/useLive';
import { useCircuit, circuitMeta } from '../track/circuits';
import { regimeRuns, wrap } from '../lib/track';
import { teamLogo, driverName } from '../lib/teams';
import { TrackMap, type TrackMapHandle, type MapTag } from './session-track';
import { Info } from './info-tip';
import { SessionSelect } from './session-select';
import { createPixelButton } from './hover.js';
import './session.css';
import './replay.css';
import './refinement.css';

const initial = new URLSearchParams(location.search);
const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const colours: Record<string, string> = {
  deploy: '#53cbae',
  plateau: '#e3c65b',
  lift: '#b398ed',
  brake: '#ef7567',
  other: '#85857c',
};
const words: Record<string, string> = {
  deploy: 'Deploying',
  plateau: 'Plateau',
  lift: 'Lifting',
  brake: 'Braking',
  other: 'Other',
};
function ReplayStageSkeleton({ label }: { label: string }) {
  return (
    <section aria-label={label} aria-busy="true" className="band">
      <div className="wrap replay-stage replay-skeleton">
        <div className="replay-map-panel skel">
          <div className="replay-skel-head" />
          <div className="replay-skel-ctl" />
          <div className="replay-skel-map" />
          <div className="replay-skel-foot" />
        </div>
        <aside className="replay-field skel-field">
          <div className="skel replay-skel-title" />
          <div className="replay-field-rows">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="skel replay-skel-row" />
            ))}
          </div>
          <div className="skel replay-skel-button" />
        </aside>
      </div>
    </section>
  );
}
function ReplaySession({
  sessionKey,
  mode,
  onReview,
}: {
  sessionKey: number;
  mode: 'review' | 'feed';
  onReview: () => void;
}) {
  const data = useSessionData(sessionKey);
  const circuit = useCircuit(data.session?.circuit_key);
  const meta = circuitMeta(data.session?.circuit_key);
  const [smallMap, setSmallMap] = useState(() => matchMedia('(max-width:480px)').matches);
  const [showAll, setShowAll] = useState(true);
  const [driver, setDriver] = useState(() => Number(new URLSearchParams(location.search).get('driver')) || 1);
  const [pickedLap, setPickedLap] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const [held, setHeld] = useState<Record<number, LiveState> | null>(null);
  const connectionStart = useRef(Date.now());
  const lastMode = useRef(mode);
  const modeSwitched = useRef(false);
  if (lastMode.current !== mode) {
    lastMode.current = mode;
    modeSwitched.current = true;
  }
  const feed = useLive(mode === 'feed' ? sessionKey : null);
  const map = useRef<TrackMapHandle>(null);
  const shown = useRef(new Map<number, number>());
  const lastReceipt = useRef(0);
  const [clock, setClock] = useState(Date.now());
  const drivers = useMemo(
    () => [...data.drivers].sort((a, b) => driverName(a).localeCompare(driverName(b))),
    [data.drivers]
  );
  const selected = drivers.find((d) => d.driver_number === driver);
  const laps = (data.laps.get(driver) ?? []).filter((l) => l.green && l.lap_duration !== null);
  const fastest = useMemo(
    () =>
      laps.reduce<(typeof laps)[number] | null>(
        (a, b) => (!a || b.lap_duration! < a.lap_duration! ? b : a),
        null
      ),
    [laps]
  );
  const lap = laps.some((l) => l.lap_number === pickedLap) ? pickedLap : (fastest?.lap_number ?? null);
  const regimes = useRegimes(sessionKey, driver, lap, mode === 'review' && !!data.session?.has_results);
  const bins = useMemo(
    () => (regimes.data && (regimes.loading || regimes.data.lap === lap) ? regimes.data.bins : []),
    [regimes.data, regimes.loading, lap]
  );
  const [dim, setDim] = useState(false);
  // The inspect cursor can play along the lap on its own: one lap in ~24 s from elapsed time. Per frame the dot,
  // slider and readout are written imperatively; React state only changes when the 50 m bin does, because the
  // tags (and the chip layout effect) are rebuilt on every render.
  const [playing, setPlaying] = useState(false);
  const cursorNow = useRef(cursor);
  cursorNow.current = cursor;
  const playPos = useRef(0);
  const rangeEl = useRef<HTMLInputElement>(null);
  const readoutEl = useRef<HTMLElement>(null);
  const lapLen = data.lap ?? 50;
  const canPlay = mode === 'review' && bins.length > 0 && !regimes.loading && lapLen > 50;
  useEffect(() => {
    if (!playing) return;
    if (!canPlay) {
      setPlaying(false);
      return;
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    const d0 = cursorNow.current;
    let raf = 0;
    let bin = Math.floor(d0 / 50);
    playPos.current = d0;
    const tick = (now: number) => {
      const elapsed = now - t0;
      // Reduced motion: hop in 50 m bins every 600 ms instead of sweeping.
      const d = reduced
        ? (Math.floor(d0 / 50) * 50 + 50 * Math.floor(elapsed / 600)) % lapLen
        : (d0 + (elapsed / 24000) * lapLen) % lapLen;
      playPos.current = d;
      const shown = Math.min(Math.round(d), lapLen - 1);
      map.current?.place('review-cursor', d);
      if (rangeEl.current) rangeEl.current.value = String(shown);
      const node = readoutEl.current?.firstChild;
      if (node) node.nodeValue = `${nf.format(shown)} m`;
      const nb = Math.floor(d / 50);
      if (nb !== bin) {
        bin = nb;
        setCursor(shown);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const hide = () => {
      if (document.hidden) {
        setCursor(Math.min(Math.round(playPos.current), lapLen - 1));
        setPlaying(false);
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [playing, canPlay, lapLen]);
  useEffect(() => {
    if (!regimes.loading) {
      setDim(false);
      return;
    }
    const id = setTimeout(() => setDim(true), 150);
    return () => clearTimeout(id);
  }, [regimes.loading]);
  const runs = useMemo(
    () =>
      data.lap && bins.length
        ? regimeRuns(bins, data.lap).map((r) => ({ d0: r.d0, d1: r.d1, colour: colours[r.label] }))
        : [],
    [bins, data.lap]
  );
  const at = bins.find((b) => cursor >= b.d_start_m && cursor < b.d_start_m + 50);
  const states = held ?? feed.states;
  const state = states[driver];
  const paused = held !== null;
  const quiet = feed.status === 'connected' && lastReceipt.current > 0 && clock - lastReceipt.current > 5000;
  const connected = mode === 'feed' && feed.status === 'connected' && Object.keys(feed.states).length > 0;
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    q.set('driver', String(driver));
    history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`);
  }, [driver]);
  useEffect(() => {
    if (data.ready && !drivers.some((d) => d.driver_number === driver) && drivers.length)
      setDriver(drivers[0].driver_number);
  }, [data.ready, drivers, driver]);
  useEffect(() => {
    setHeld(null);
    shown.current.clear();
    connectionStart.current = Date.now();
  }, [mode]);
  useEffect(() => {
    if (Object.keys(feed.states).length) lastReceipt.current = Date.now();
  }, [feed.states]);
  useEffect(() => {
    if (mode !== 'feed') return;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mode]);
  // Follow one driver or the whole received field with the same interruptible motion.
  // Drivers without a state never receive a placeholder track position.
  useEffect(() => {
    if (mode !== 'feed' || paused || !connected || quiet) return;
    const tick = (_t: number, dt: number) => {
      const handle = map.current;
      const len = data.lap;
      if (!handle || !len) return;
      for (const d of drivers) {
        const n = d.driver_number;
        if (!showAll && n !== driver) continue;
        const target = feed.states[n]?.lap_distance_est;
        if (!Number.isFinite(target)) continue;
        const previous = shown.current.get(n);
        let next = target;
        if (previous !== undefined && !matchMedia('(prefers-reduced-motion:reduce)').matches) {
          const delta = wrap(target - previous + len / 2, len) - len / 2;
          next =
            Math.abs(delta) > len / 3 ? target : previous + delta * (1 - Math.exp(-Math.min(dt, 50) / 250));
        }
        shown.current.set(n, next);
        handle.place(n, next);
      }
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [mode, paused, connected, quiet, feed.states, driver, data.lap, showAll, drivers]);
  useEffect(() => {
    if (data.ready)
      document
        .querySelectorAll<HTMLAnchorElement>('.replay-field .button-light, .replay-field .button-grey')
        .forEach((el) => createPixelButton(el));
  }, [data.ready]);
  useEffect(() => {
    const q = matchMedia('(max-width:480px)');
    const change = () => setSmallMap(q.matches);
    q.addEventListener('change', change);
    return () => q.removeEventListener('change', change);
  }, []);
  const receivedDrivers = drivers.filter((d) => Number.isFinite(states[d.driver_number]?.lap_distance_est));
  const tags: MapTag[] =
    mode === 'review'
      ? bins.length
        ? [
            {
              id: 'review-cursor',
              code: 'REVIEW',
              colour: selected?.team_colour ?? colours[at?.label ?? 'other'],
              d: cursor,
              on: true,
              note: `${nf.format(cursor)} m`,
            },
          ]
        : []
      : receivedDrivers
          .filter((d) => showAll || d.driver_number === driver)
          .map((d) => ({
            id: d.driver_number,
            code: d.name_acronym ?? String(d.driver_number),
            colour: d.team_colour ?? '#eee',
            d: shown.current.get(d.driver_number) ?? states[d.driver_number].lap_distance_est,
            on: d.driver_number === driver,
            compact: showAll && d.driver_number !== driver,
            onSelect: () => chooseDriver(d.driver_number),
            name: d.full_name ?? d.name_acronym ?? String(d.driver_number),
          }));
  const slow = mode === 'feed' && !receivedDrivers.length && clock - connectionStart.current > 10000;
  const status =
    mode === 'review'
      ? 'Recorded lap review'
      : paused
        ? 'View paused'
        : quiet
          ? 'Feed quiet'
          : feed.status === 'disabled'
            ? 'Replay disabled'
            : feed.status === 'no-topic'
              ? 'No replay running'
              : feed.status === 'error'
                ? 'Connection lost · retrying'
                : connected
                  ? 'Following recorded feed'
                  : feed.status === 'connecting'
                    ? slow
                      ? 'Still connecting'
                      : 'Connecting'
                    : 'Waiting for replay data';
  const chooseDriver = (n: number) => {
    setDriver(n);
    setPickedLap(null);
    setPlaying(false);
    setCursor(0);
  };
  const selectedRegime = mode === 'review' ? at?.label : state?.regime;
  const split = bins.length
    ? ['deploy', 'plateau', 'lift', 'brake', 'other'].map((k) => ({
        key: k,
        count: bins.filter((b) => b.label === k).length,
      }))
    : [];
  return (
    <>
      <section aria-label="Replay selection">
        <div className="wrap replay-controls">
          <SessionSelect
            pending={!data.ready && !data.loadError && !data.sessionsError}
            label="Driver"
            value={String(driver)}
            items={drivers.map((d) => ({
              value: String(d.driver_number),
              name: d.full_name ?? driverName(d),
              code: d.name_acronym ?? undefined,
              team: d.team_name,
              detail: d.team_name ?? undefined,
              colour: d.team_colour,
            }))}
            onChange={(v) => chooseDriver(Number(v))}
          />
          {mode === 'review' ? (
            <label className="replay-lap">
              <span>
                Clean lap
                <Info label="the clean lap">
                  The fastest lap without traffic, pit stops or flags, so the estimates come from a clean run.
                </Info>
              </span>
              <select
                aria-label="Clean lap"
                value={lap ?? ''}
                disabled={!laps.length}
                onChange={(e) => {
                  setPickedLap(Number(e.target.value));
                  setPlaying(false);
                  setCursor(0);
                }}
              >
                {!laps.length && <option value="">No clean laps available</option>}
                {laps.map((l) => (
                  <option key={l.lap_number} value={l.lap_number}>
                    Lap {l.lap_number}
                    {l.lap_number === fastest?.lap_number ? ' · fastest clean' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="feed-control">
              <span className="feed-eyebrow">View</span>
              <button
                className="button button-secondary"
                disabled={!connected}
                aria-pressed={paused}
                onClick={() => setHeld(paused ? null : { ...feed.states })}
              >
                {paused ? 'Resume view' : 'Pause view'}
                <span aria-hidden="true">{paused ? '▷' : 'Ⅱ'}</span>
              </button>
              <span className="feed-note">Pauses this view; the source continues.</span>
            </div>
          )}
          <div className="replay-state" role="status">
            <span className={`feed-dot ${connected && !paused && !quiet ? 'is-connected' : ''}`} />
            {status}
          </div>
        </div>
      </section>
      {data.sessionsError || data.loadError ? (
        <section role="alert">
          <div className="wrap replay-load">
            <h2>Session couldn’t be loaded.</h2>
            <p>Retry, or choose another recorded session above.</p>
            <button className="button button-secondary" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        </section>
      ) : !data.ready ? (
        <>
          <p className="wrap replay-load-line" role="status">
            Loading the recorded session…
          </p>
          <ReplayStageSkeleton label="Loading circuit and driver field" />
        </>
      ) : (
        <section aria-label="Circuit and driver field" className="band">
          <div className="wrap replay-stage">
            <div
              className={`replay-map-panel${dim ? ' is-loading' : ''}`}
              aria-busy={regimes.loading || undefined}
              style={
                {
                  '--stage-team':
                    (mode === 'review' || !showAll) && selected?.team_colour
                      ? selected.team_colour
                      : 'transparent',
                } as CSSProperties
              }
            >
              <div className="replay-map-head">
                <h2>{meta?.name ?? data.session?.circuit_short_name}</h2>
                <span>
                  {mode === 'review'
                    ? `Lap ${regimes.loading ? '—' : (lap ?? '—')} / model estimates`
                    : 'Approximate track position'}
                  <Info label="the track position">
                    Positions are interpolated from the recorded telemetry and the cut-off is an estimate, not
                    a measured battery state.
                  </Info>
                </span>
              </div>
              <div className="skel-rule replay-rule" data-on={dim || undefined} aria-hidden="true" />
              <div className="mode-stack replay-ctl">
                <div
                  className="mode-pane"
                  aria-hidden={mode !== 'review' || undefined}
                  {...(mode !== 'review' ? ({ inert: '' } as Record<string, unknown>) : {})}
                >
                  <div className="review-distance">
                    <div className="distance-heading">
                      <div className="distance-title">
                        <label htmlFor="review-distance">Inspect distance</label>
                        <Info label="the distance scrubber">
                          Drag to inspect the estimates at a distance along the lap; positions are
                          approximate.
                        </Info>
                        <button
                          type="button"
                          className="button button-secondary distance-play"
                          aria-pressed={playing}
                          disabled={!canPlay}
                          onClick={() => {
                            if (playing) setCursor(Math.min(Math.round(playPos.current), lapLen - 1));
                            setPlaying(!playing);
                          }}
                        >
                          {playing ? 'Pause' : 'Play lap'}
                        </button>
                      </div>
                      <span style={{ color: colours[selectedRegime ?? 'other'] }}>
                        {regimes.loading
                          ? '—'
                          : selectedRegime
                            ? words[selectedRegime]
                            : 'No regime available'}{' '}
                        <strong ref={readoutEl}>{regimes.loading ? '—' : `${nf.format(cursor)} m`}</strong>
                      </span>
                    </div>
                    <input
                      id="review-distance"
                      ref={rangeEl}
                      aria-label="Inspect distance around lap"
                      type="range"
                      min="0"
                      max={Math.max(0, (data.lap ?? 50) - 1)}
                      step="1"
                      value={cursor}
                      disabled={!bins.length}
                      onPointerDown={() => setPlaying(false)}
                      onKeyDown={() => setPlaying(false)}
                      onChange={(e) => {
                        setPlaying(false);
                        setCursor(Number(e.target.value));
                      }}
                    />
                    <div className="review-distance-labels">
                      <span>Start / finish</span>
                      <span>{nf.format(data.lap ?? 0)} m</span>
                    </div>
                  </div>
                </div>
                <div
                  className="mode-pane mode-top"
                  aria-hidden={mode !== 'feed' || undefined}
                  {...(mode !== 'feed' ? ({ inert: '' } as Record<string, unknown>) : {})}
                >
                  <div className="field-display">
                    <div className="field-lead">
                      <div role="group" aria-label="Drivers displayed on track">
                        <button aria-pressed={!showAll} onClick={() => setShowAll(false)}>
                          Follow selected
                        </button>
                        <button aria-pressed={showAll} onClick={() => setShowAll(true)}>
                          All drivers
                        </button>
                      </div>
                      <Info label="the driver display">
                        Follow keeps the chosen driver centred; All drivers shows every car's last received
                        position.
                      </Info>
                    </div>
                    <div className="field-count">
                      <span role="status">
                        {receivedDrivers.length} / {drivers.length} driver states received
                        {showAll ? ' · all received dots shown' : ''}
                      </span>
                      <Info label="driver states received">
                        How many of the field's cars have sent a position in this feed.
                      </Info>
                    </div>
                  </div>
                </div>
              </div>
              <div className="replay-map-wrap">
                {data.outline ? (
                  <TrackMap
                    ref={map}
                    outline={data.outline}
                    circuit={circuit}
                    runs={mode === 'review' ? runs : []}
                    tags={tags}
                    corners={!smallMap}
                    sf
                    rotation={data.session?.circuit_key === 39 ? 85 : (meta?.rotation ?? undefined)}
                    arrows={false}
                    fill
                    markerScale={showAll ? 1 : 1.15}
                    className="replay-track"
                    label={
                      mode === 'review'
                        ? 'Recorded lap regime map with a review cursor'
                        : 'Recorded replay map with approximate position'
                    }
                  />
                ) : (
                  <p className="replay-empty">Circuit geometry is unavailable for this session.</p>
                )}
                <div
                  className="feed-waiting"
                  role="status"
                  {...(mode !== 'feed' || receivedDrivers.length
                    ? ({ inert: '', 'aria-hidden': true, hidden: true } as Record<string, unknown>)
                    : {})}
                >
                  <p>
                    {feed.status === 'disabled'
                      ? 'Replay is disabled on this server.'
                      : feed.status === 'no-topic'
                        ? 'No replay has started for this session.'
                        : feed.status === 'error'
                          ? 'Replay connection lost. Retrying…'
                          : slow
                            ? 'The replay is taking longer to respond. You can review a recorded lap while it connects.'
                            : 'Waiting for driver positions from the replay…'}
                  </p>
                  <button
                    className="button button-secondary"
                    onClick={onReview}
                    {...(slow ||
                    feed.status === 'disabled' ||
                    feed.status === 'no-topic' ||
                    feed.status === 'error'
                      ? {}
                      : ({ inert: '', tabIndex: -1, 'aria-hidden': true } as Record<string, unknown>))}
                  >
                    Review a recorded lap <span aria-hidden="true">↗</span>
                  </button>
                </div>
              </div>
              <div className="mode-stack">
                <div
                  className="mode-pane"
                  aria-hidden={mode !== 'review' || undefined}
                  {...(mode !== 'review' ? ({ inert: '' } as Record<string, unknown>) : {})}
                >
                  <div className="review-distance review-notes">
                    <div className="regime-legend">
                      <div className="regime-share-strip" aria-hidden="true">
                        {split
                          .filter((x) => x.count > 0)
                          .map((x) => (
                            <span
                              key={x.key}
                              style={{
                                width: `${(100 * x.count) / bins.length}%`,
                                background: colours[x.key],
                              }}
                            />
                          ))}
                      </div>
                      <ul aria-label="Track colours">
                        {(['deploy', 'plateau', 'lift', 'brake', 'other'] as const).map((k) => {
                          const n = split.find((x) => x.key === k)?.count ?? 0;
                          return (
                            <li key={k}>
                              <i style={{ background: colours[k] }} />
                              <span>{words[k]}</span>
                              <strong>{bins.length ? `${Math.round((100 * n) / bins.length)}%` : '—'}</strong>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <p className="replay-small">
                      The cursor is a reading position, not a car. Regimes are model estimates in 50 m bins.
                    </p>
                    <div className="review-status">
                      {regimes.error && (
                        <p role="alert" className="replay-error">
                          Lap regimes could not be loaded. Choose another lap or session.
                        </p>
                      )}
                      {!regimes.loading && !bins.length && (
                        <p className="replay-empty">No recorded regime estimates for this lap.</p>
                      )}
                      {regimes.loading && (
                        <p className="replay-small" role="status">
                          Loading this lap’s regime estimates…
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div
                  className="mode-pane"
                  aria-hidden={mode !== 'feed' || undefined}
                  {...(mode !== 'feed' ? ({ inert: '' } as Record<string, unknown>) : {})}
                >
                  <p className="field-map-guide">
                    Every dot is a received driver. Select a dot or driver below to show its label.
                  </p>
                  <div className="feed-readout">
                    <span>
                      <b
                        className="feed-code"
                        style={
                          selected?.team_colour
                            ? ({ '--team': selected.team_colour } as CSSProperties)
                            : undefined
                        }
                      >
                        {selected?.name_acronym ?? '—'}
                      </b>{' '}
                      / {selectedRegime ? words[selectedRegime] : 'No state received'}
                    </span>
                    <strong>{state ? `${nf.format(state.lap_distance_est)} m est.` : '—'}</strong>
                    <p className="replay-small">
                      Cumulative distance since this consumer began; it is not a lap count or race
                      classification. Map position is approximate.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <aside className="replay-field">
              <div className="replay-field-heading">
                <h2>Drivers.</h2>
                <span>Alphabetical order</span>
              </div>
              <div className="replay-field-rows">
                {drivers.map((d) => {
                  const s = states[d.driver_number];
                  const logo = teamLogo(d.team_name);
                  return (
                    <button
                      key={d.driver_number}
                      className={d.driver_number === driver ? 'is-selected' : ''}
                      aria-pressed={d.driver_number === driver}
                      style={{ '--team': d.team_colour ?? '#aaa' } as CSSProperties}
                      onClick={() => chooseDriver(d.driver_number)}
                    >
                      <i />
                      {logo ? <img src={logo} alt="" width="22" height="22" loading="lazy" /> : <span />}
                      <span className="field-identity">
                        <span>{driverName(d)}</span>
                        <small>{d.team_name}</small>
                      </span>
                      <span className="field-code">
                        <b>{d.driver_number ?? d.name_acronym}</b>
                        <small>{d.name_acronym}</small>
                      </span>
                      {mode === 'feed' && (
                        <span className="field-regime" style={{ color: colours[s?.regime ?? 'other'] }}>
                          {s ? words[s.regime] : '—'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <a
                className="button button-light"
                href={`/session.html?session=${sessionKey}&driver=${driver}&compare=0`}
              >
                Compare cut-offs
              </a>
            </aside>
          </div>
        </section>
      )}
      <section key={mode}>
        <div className={`wrap replay-context${modeSwitched.current ? ' switch-in' : ''}`}>
          {mode === 'review' ? (
            <>
              <div>
                <h2>Read the lap.</h2>
                <p>
                  The coloured road shows the recorded model’s regime labels. Move the cursor to inspect a
                  location, or choose another clean lap.
                </p>
              </div>
              <div className="regime-summary">
                {split.length ? (
                  <>
                    <div className="regime-share-strip" aria-hidden="true">
                      {split
                        .filter((s) => s.count > 0)
                        .map((s) => (
                          <span
                            key={s.key}
                            style={{ width: `${(100 * s.count) / bins.length}%`, background: colours[s.key] }}
                          />
                        ))}
                    </div>
                    <ul>
                      {split
                        .filter((s) => s.count > 0)
                        .map((s) => (
                          <li key={s.key}>
                            <i style={{ background: colours[s.key] }} />
                            <span>{words[s.key]}</span>
                            <strong>{Math.round((100 * s.count) / bins.length)}%</strong>
                          </li>
                        ))}
                    </ul>
                    <p className="replay-small">
                      Share of available equal-length bins, not time or battery charge.
                    </p>
                  </>
                ) : (
                  <p className="replay-small">The regime summary appears when this lap’s estimates load.</p>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <h2>{feed.status === 'disabled' ? 'The replay is off.' : 'About the feed.'}</h2>
                <p>
                  {feed.status === 'disabled'
                    ? 'This server has replay disabled. Recorded lap review remains available.'
                    : feed.status === 'no-topic'
                      ? 'No replay topic exists for this session yet.'
                      : feed.status === 'error'
                        ? 'The connection was lost. The existing client will retry; displayed states may be old.'
                        : 'This follows a recorded session through the local replay service. It is not a live race.'}
                </p>
              </div>
              <div>
                <p className="replay-small">
                  Feed labels use a simplified estimator and may differ from the batch model. There is no
                  browser control for source speed or seeking. No position is shown until an actual state
                  arrives.
                </p>
                <p className="replay-small">
                  {state ? `State timestamp: ${state.ts}` : 'No state received for this driver.'}
                  {feed.speed !== null ? ` Observed source rate: ${feed.speed.toFixed(1)}×.` : ''}
                </p>
                <button className="button button-secondary" onClick={() => location.reload()}>
                  Check feed again
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
function App() {
  const limited = useRateLimited();
  const sessions = useList<SessionRow>('/sessions');
  useInitialAnchor(!!sessions.data || !!sessions.error);
  const [key, setKey] = useState(Number(initial.get('session')) || 11361);
  const [mode, setMode] = useState<'review' | 'feed'>(initial.get('mode') === 'feed' ? 'feed' : 'review');
  const races = useMemo(
    () =>
      (sessions.data ?? []).filter(
        (s) => (s.session_name === 'Race' || s.session_name === 'Sprint') && s.has_results
      ),
    [sessions.data]
  );
  const session = races.find((s) => s.session_key === key);
  const hasSession = !!session;
  const place = session?.circuit_short_name ?? 'Session';
  useEffect(() => {
    document.title = session
      ? `Replay ${place} ${session.session_name.toLowerCase()} / F1 Battery`
      : 'Replay / F1 Battery';
  }, [session, place]);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    q.set('session', String(key));
    q.set('mode', mode);
    history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`);
  }, [key, mode]);
  useEffect(() => {
    if (races.length && !races.some((s) => s.session_key === key)) setKey(races[0].session_key);
  }, [races, key]);
  useEffect(() => {
    document
      .querySelectorAll<HTMLAnchorElement>('.replay-preview .button-light, .replay-preview .button-grey')
      .forEach((el) => createPixelButton(el));
  }, [key, hasSession]);
  return (
    <div className="session-preview replay-preview">
      <a className="skip" href="#replay-controls">
        Skip to replay controls
      </a>
      <SiteHeader current="replay" />
      <PageGround className="replay-ground">
        <main className="session-main replay-main">
          <section>
            <div className="wrap replay-hero">
              <h1>
                Race
                <br />
                replay.
              </h1>
              <div>
                <p>
                  Revisit the recorded race.
                  <br />
                  Keep the estimates in view.
                </p>
                <SessionSelect
                  pending={sessions.loading}
                  label="Recorded session"
                  value={String(key)}
                  items={races.map((s) => ({
                    value: String(s.session_key),
                    name: s.circuit_short_name ?? 'Session',
                    detail: `${s.session_name} · ${s.date_start ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(s.date_start)) : ''}`,
                  }))}
                  onChange={(v) => setKey(Number(v))}
                />
              </div>
            </div>
          </section>
          <div id="replay-controls" tabIndex={-1}>
            <div className="wrap replay-modes">
              <div role="group" aria-label="Replay mode">
                <button aria-pressed={mode === 'review'} onClick={() => setMode('review')}>
                  Lap review
                </button>
                <button aria-pressed={mode === 'feed'} onClick={() => setMode('feed')}>
                  Replay feed
                </button>
              </div>
              <span>
                {place} / {mode === 'review' ? 'Recorded model outputs' : 'Local recorded feed'}
              </span>
            </div>
          </div>
          {sessions.error ? (
            <section role="alert">
              <div className="wrap replay-load">
                Recorded sessions could not be loaded.
                <button className="button button-secondary" onClick={() => location.reload()}>
                  Try again
                </button>
              </div>
            </section>
          ) : session ? (
            <ReplaySession key={key} sessionKey={key} mode={mode} onReview={() => setMode('review')} />
          ) : sessions.loading ? (
            <>
              <p className="wrap replay-load-line" role="status">
                Loading recorded sessions…{limited && ' The API is rate limited; retrying automatically.'}
              </p>
              <section aria-hidden="true">
                <div className="wrap replay-controls replay-skeleton">
                  <div className="skel replay-skel-control" />
                  <div className="skel replay-skel-control" />
                  <div className="skel replay-skel-control" />
                </div>
              </section>
              <ReplayStageSkeleton label="Loading circuit and driver field" />
            </>
          ) : (
            <section role="status">
              <div className="wrap replay-load">No recorded races are available.</div>
            </section>
          )}
        </main>
      </PageGround>
      <SiteFooter
        className="replay-footer"
        notes={
          <>
            Data: OpenF1 / f1-battery.
            <br />
            Circuit reference: MultiViewer. Team marks: Formula 1 media.
            <br />
            All energy outputs and replay positions are estimates.
          </>
        }
        top={{ href: '/#races', label: 'Choose another race ↗' }}
      />
    </div>
  );
}
createRoot(document.getElementById('replay-root')!).render(<App />);
