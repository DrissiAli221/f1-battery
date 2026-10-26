import { pageUrl } from '../lib/routes';
import './reveal';
import { PageGround, SiteFooter, SiteHeader } from './chrome';
import { useInitialAnchor } from './preview-navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useList, useRateLimited } from '../lib/api';
import type { SessionRow } from '../lib/types';
import { circuitHero, circuitMeta } from '../track/circuits';
import { CircuitMini } from './circuit-mini';
import { createPixelButton } from './hover.js';
import { paintScreen } from './session-halftone';
import { SessionIcon } from './session-icons';
import './session.css';
import './home.css';
import './refinement.css';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const date = (s: SessionRow) =>
  s.date_start ? dateFormat.format(new Date(s.date_start)) : 'Date unavailable';
const href = (s: SessionRow) => pageUrl('session', { session: s.session_key });
/* Every card lists the same four slots in the All-sessions view, so cards in a row share one height. */
const SLOTS = ['Race', 'Qualifying', 'Sprint', 'Sprint Qualifying'];
function App() {
  const limited = useRateLimited();
  const remote = useList<SessionRow>('/sessions');
  useInitialAnchor(!!remote.data || !!remote.error);
  const [filter, setFilter] = useState('Race');
  const [search, setSearch] = useState('');
  const [all, setAll] = useState(false);
  const [switched, setSwitched] = useState(false);
  const [brokenPhotos, setBrokenPhotos] = useState<ReadonlySet<number>>(new Set());
  const canvas = useRef<HTMLCanvasElement>(null);
  const sessions = useMemo(() => remote.data ?? [], [remote.data]);
  const meetings = useMemo(() => {
    const grouped = new Map<number, SessionRow[]>();
    for (const s of sessions) {
      const m = circuitMeta(s.circuit_key);
      const term =
        `${s.circuit_short_name} ${m?.country ?? ''} ${m?.name ?? ''} ${m?.meeting_name ?? ''}`.toLowerCase();
      if (search.trim() && !term.includes(search.trim().toLowerCase())) continue;
      if (filter !== 'All sessions' && s.session_name !== filter) continue;
      grouped.set(s.meeting_key, [...(grouped.get(s.meeting_key) ?? []), s]);
    }
    return [...grouped.values()]
      .map((rows) => rows.sort((a, b) => (b.date_start ?? '').localeCompare(a.date_start ?? '')))
      .sort((a, b) => (b[0].date_start ?? '').localeCompare(a[0].date_start ?? ''));
  }, [sessions, filter, search]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const draw = () => paintScreen(el);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    document
      .querySelectorAll<HTMLAnchorElement>('.home-preview .button-grey')
      .forEach((el) => createPixelButton(el));
  }, [meetings, all, remote.loading, filter, search]);
  return (
    <div className="session-preview home-preview">
      <a className="skip" href="#races">
        Skip to races
      </a>
      <SiteHeader current="races" racesHref="#races" navId="home-nav" />
      <PageGround className="home-ground">
        <main className="session-main home-main">
          <section className="hero-band" aria-labelledby="home-title">
            <div className="home-hero wrap">
              <div className="home-screen" aria-hidden="true">
                <canvas ref={canvas} data-screen="hero" />
              </div>
              <div className="home-intro">
                <h1 id="home-title">
                  The hidden
                  <br />
                  side of
                  <br />
                  racing.
                </h1>
                <div className="home-intro-bottom">
                  <p>
                    F1 keeps its battery data out of sight.
                    <br className="desktop-break" /> Explore where electrical deployment may end, one straight
                    at a time.
                  </p>
                  <a href="#races" className="home-scroll">
                    Choose a race <span aria-hidden="true">↓</span>
                  </a>
                </div>
              </div>
            </div>
          </section>
          <section id="races" tabIndex={-1} aria-labelledby="races-title" className="band">
            <div className="wrap home-races">
              <div className="home-section-heading">
                <h2 id="races-title">Pick your race.</h2>
                <p>Recorded sessions. Estimated deployment.</p>
              </div>
              <div className="race-tools">
                <div className="race-filters" role="group" aria-label="Session type">
                  {['Race', 'Qualifying', 'Sprint', 'All sessions'].map((f) => (
                    <button
                      key={f}
                      aria-pressed={filter === f}
                      onClick={() => {
                        if (f !== filter) setSwitched(true);
                        setFilter(f);
                        setAll(false);
                      }}
                    >
                      {f === 'Race' ? 'Races' : f === 'Sprint' ? 'Sprints' : f}
                    </button>
                  ))}
                </div>
                <label className="race-search">
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    aria-hidden="true"
                  >
                    <circle cx="8.5" cy="8.5" r="5.5" />
                    <path d="m13 13 4 4" />
                  </svg>
                  <input
                    type="search"
                    aria-label="Find a circuit or country"
                    placeholder="Circuit or country"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setAll(false);
                    }}
                  />
                </label>
              </div>
              <p className="race-count" role="status">
                {remote.loading
                  ? `Loading sessions…${limited ? ' The API is rate limited; retrying automatically.' : ''}`
                  : remote.error
                    ? 'Session list unavailable'
                    : `${meetings.length} ${meetings.length === 1 ? 'meeting' : 'meetings'} · ${meetings.filter((rows) => rows.some((s) => s.has_results)).length} with estimates${sessions[0]?.year ? ` · ${sessions[0].year}` : ''}`}
              </p>
              {remote.error ? (
                <div className="home-error" role="alert">
                  <h3>Sessions couldn’t be loaded.</h3>
                  <p>The local API may be unavailable.</p>
                  <button className="button button-secondary" onClick={() => location.reload()}>
                    Try again
                  </button>
                </div>
              ) : !remote.loading && meetings.length === 0 ? (
                <div className="home-empty">
                  <h3>No matching sessions.</h3>
                  <p>Try another circuit, country or session type.</p>
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      setSearch('');
                      setFilter('All sessions');
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div key={filter} className={`race-grid${switched && !remote.loading ? ' switch-in' : ''}`}>
                  {remote.loading
                    ? Array.from({ length: 6 }, (_, i) => (
                        <article key={i} className="session-card race-choice skel" aria-hidden="true">
                          <div className="card-meta utility">
                            <span className="skel-bar" />
                            <span className="skel-bar" />
                          </div>
                          <div className="skel-title">
                            <span className="skel-bar" />
                            <span className="skel-bar" />
                          </div>
                          <span className="skel-bar skel-facts" />
                          <div className="race-choice-bottom">
                            <div className="race-single">
                              <span className="skel-bar" />
                              <span className="skel-bar skel-button" />
                            </div>
                          </div>
                        </article>
                      ))
                    : (all ? meetings : meetings.slice(0, 6)).map((rows, index) => {
                        const s = rows[0],
                          m = circuitMeta(s.circuit_key);
                        const title = m?.meeting_name ?? s.circuit_short_name ?? 'Session';
                        const photo = brokenPhotos.has(s.meeting_key)
                          ? null
                          : circuitHero(s.circuit_key, 900);
                        const single = filter !== 'All sessions';
                        const fold = (x: string) =>
                          x
                            .normalize('NFD')
                            .replace(/[\u0300-\u036f]/g, '')
                            .toLowerCase();
                        const venue = m?.name ?? s.circuit_short_name ?? '';
                        const v = fold(venue);
                        const facts = [
                          v !== fold(title) && v !== fold(m?.location ?? '') ? venue : '',
                          m?.location ?? '',
                          m && m.corners > 0 ? `${m.corners} corners` : '',
                        ].filter(Boolean);
                        const line1 = title.replace(/ Grand Prix$/, '');
                        const line2 = /Grand Prix$/.test(title) ? 'Grand Prix' : '';
                        const slots = single
                          ? rows.filter((r) => r.session_name === filter).slice(0, 1)
                          : SLOTS.map(
                              (name) =>
                                rows.find((r) => r.session_name === name) ??
                                ({
                                  session_key: -1,
                                  session_name: name,
                                  has_results: false,
                                  missing: true,
                                } as SessionRow & { missing?: boolean })
                            );
                        return (
                          <article
                            key={s.meeting_key}
                            className={`session-card race-choice${photo ? '' : ' race-plate'}${all && index >= 6 ? ' switch-in' : ''}`}
                          >
                            {photo && (
                              <div className="race-photo" aria-hidden="true">
                                <img
                                  src={photo}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  onError={() => setBrokenPhotos((prev) => new Set(prev).add(s.meeting_key))}
                                />
                              </div>
                            )}
                            <div className="card-meta utility">
                              <time dateTime={s.date_start ?? undefined}>{date(s)}</time>
                              <span>{m?.country ?? s.circuit_short_name}</span>
                            </div>
                            <h3>
                              {line1}
                              <br />
                              {line2}
                              {!photo && (
                                <span aria-hidden="true">
                                  <CircuitMini
                                    circuit={s.circuit_key}
                                    weight={5}
                                    className="race-plate-map"
                                  />
                                </span>
                              )}
                            </h3>
                            <p className="race-facts">
                              {facts.length ? facts.join(' · ') : (m?.country ?? '')}
                            </p>
                            <div className="race-choice-bottom">
                              {single ? (
                                <div className="race-single">
                                  <span className="race-single-label">
                                    <SessionIcon kind={filter === 'All sessions' ? '' : filter} />
                                    {filter}
                                  </span>
                                  {slots[0]?.has_results ? (
                                    // The anchor text must stay a constant string: hover.js owns its children.
                                    <a
                                      className="button button-grey"
                                      data-pixel-rest="#1b1b19"
                                      data-pixel-rest-text="#f4f4ef"
                                      data-pixel-active="#f4f4ef"
                                      data-pixel-active-text="#030303"
                                      href={href(slots[0])}
                                      aria-label={`View estimates, ${title} ${filter}`}
                                    >
                                      View estimates
                                    </a>
                                  ) : (
                                    <span className="race-unavailable-note">No results</span>
                                  )}
                                </div>
                              ) : (
                                <div className="race-chips">
                                  {slots.map((row) =>
                                    !(row as { missing?: boolean }).missing && row.has_results ? (
                                      // The anchor text must stay a constant string: hover.js owns its children.
                                      <a
                                        key={row.session_name}
                                        className="button button-grey button-chip"
                                        data-pixel-rest="#1b1b19"
                                        data-pixel-rest-text="#f4f4ef"
                                        data-pixel-active="#f4f4ef"
                                        data-pixel-active-text="#030303"
                                        data-pixel-icon="none"
                                        data-pixel-label={row.session_name}
                                        data-kind={row.session_name}
                                        href={href(row)}
                                        aria-label={`View estimates, ${title} ${row.session_name}`}
                                      >
                                        {row.session_name}
                                      </a>
                                    ) : (
                                      <span
                                        key={row.session_name}
                                        className="race-chip-off"
                                        data-kind={row.session_name}
                                        title={filter === 'All sessions' ? 'Not held' : 'No results'}
                                      >
                                        {row.session_name}
                                        <span className="sr-only">
                                          {filter === 'All sessions' ? ', not held' : ', no results'}
                                        </span>
                                      </span>
                                    )
                                  )}
                                </div>
                              )}
                            </div>
                          </article>
                        );
                      })}
                </div>
              )}
              {meetings.length > 6 && (
                <button
                  className="button button-secondary race-show"
                  onClick={() => setAll((v) => !v)}
                  aria-expanded={all}
                >
                  {all ? 'Show fewer races' : `Show all ${meetings.length} meetings`}
                  <span aria-hidden="true">{all ? '−' : '+'}</span>
                </button>
              )}
            </div>
          </section>
          <section id="research" tabIndex={-1} aria-labelledby="research-title" className="band band-solid">
            <div className="wrap home-research">
              <h2 id="research-title">
                An estimate.
                <br />
                An honest answer.
              </h2>
              <div className="research-copy">
                <p>Can an earlier deployment cut-off predict an overtake?</p>
                <p>
                  The pre-registered test found <strong>no detectable effect beyond the controls.</strong>{' '}
                  Pace difference explained more. The analysis covers straights where a cut-off was detected;
                  it does not prove energy management never matters.
                </p>
                <details>
                  <summary>
                    What these estimates can tell you <span aria-hidden="true">+</span>
                  </summary>
                  <p>
                    Cut-offs are inferred from public telemetry under assumptions about mass, drag and engine
                    power. They are energy-management proxies, not measured battery power or state of charge.
                    The explorer shows recorded estimates and uncertainty, not a live feed.
                  </p>
                </details>
                <a className="home-text-link" href={pageUrl('findings')}>
                  Read the findings <span aria-hidden="true">↗</span>
                </a>
              </div>
            </div>
          </section>
        </main>
      </PageGround>
      <SiteFooter
        className="home-footer"
        notes={
          <>
            Data: OpenF1 / f1-battery.
            <br />
            Circuit reference: MultiViewer.
            <br />
            Typeface: Formula 1, Kurppa Hosk Type, Vercel.
          </>
        }
        top={{ href: '#home-title', label: 'Back to top ↑' }}
      />
    </div>
  );
}
createRoot(document.getElementById('home-root')!).render(<App />);
