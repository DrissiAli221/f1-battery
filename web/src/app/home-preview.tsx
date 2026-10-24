import './reveal';
import { PageGround, SiteFooter, SiteHeader } from './chrome';
import { useInitialAnchor } from './preview-navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useList, useRateLimited } from '../lib/api';
import type { SessionRow } from '../lib/types';
import { circuitMeta } from '../track/circuits';
import { createPixelButton } from './hover.js';
import { paintScreen } from './session-halftone';
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
const href = (s: SessionRow) => `/session.html?session=${s.session_key}`;
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
  const canvas = useRef<HTMLCanvasElement>(null);
  const sessions = useMemo(() => remote.data ?? [], [remote.data]);
  const feature = sessions.find((s) => s.session_key === 11361 && s.has_results);
  const hasFeature = !!feature;
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
      .querySelectorAll<HTMLAnchorElement>('.home-preview .button-light')
      .forEach((el) => createPixelButton(el));
  }, [hasFeature]);
  return (
    <div className="session-preview home-preview">
      <a className="skip" href="#races">
        Skip to races
      </a>
      <SiteHeader current="races" racesHref="#races" navId="home-nav" />
      <PageGround className="home-ground">
        <main className="session-main home-main">
          <section aria-labelledby="home-title">
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
          <section aria-label="Start exploring at Monza">
            <div className="home-feature wrap">
              {feature ? (
                <article className="session-card home-feature-card">
                  <div className="card-meta utility">
                    <time dateTime={feature.date_start ?? undefined}>{date(feature)}</time>
                    <span>Italy / {feature.session_name}</span>
                  </div>
                  <div className="home-feature-title">
                    <h2>
                      Italian
                      <br />
                      Grand Prix
                      <span className="card-grain" aria-hidden="true">
                        Italian
                        <br />
                        Grand Prix
                      </span>
                    </h2>
                    <p className="utility">Autodromo Nazionale Monza</p>
                  </div>
                  <div className="home-feature-bottom">
                    <p>
                      Start with Monza.
                      <br />
                      <span>Compare drivers’ estimated cut-offs on the long straights.</span>
                    </p>
                    <a className="button button-light" href={href(feature)}>
                      Explore Monza
                    </a>
                  </div>
                </article>
              ) : remote.loading ? (
                <article className="session-card home-feature-card skel" aria-hidden="true">
                  <div className="home-feature-skel" />
                </article>
              ) : null}
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
                          <div className="race-skel" />
                        </article>
                      ))
                    : (all ? meetings : meetings.slice(0, 6)).map((rows, index) => {
                        const s = rows[0],
                          m = circuitMeta(s.circuit_key);
                        const title = m?.meeting_name ?? s.circuit_short_name ?? 'Session';
                        return (
                          <article
                            key={s.meeting_key}
                            className={`session-card race-choice${all && index >= 6 ? ' switch-in' : ''}`}
                          >
                            <div className="card-meta utility">
                              <time dateTime={s.date_start ?? undefined}>{date(s)}</time>
                              <span>{m?.country ?? s.circuit_short_name}</span>
                            </div>
                            <h3>
                              {title.replace(/ Grand Prix$/, '')}
                              <br />
                              {/Grand Prix$/.test(title) ? 'Grand Prix' : ''}
                              <span className="card-grain" aria-hidden="true">
                                {title.replace(/ Grand Prix$/, '')}
                                <br />
                                {/Grand Prix$/.test(title) ? 'Grand Prix' : ''}
                              </span>
                            </h3>
                            <p className="race-facts">
                              {(() => {
                                const fold = (x: string) =>
                                  x
                                    .normalize('NFD')
                                    .replace(/[\u0300-\u036f]/g, '')
                                    .toLowerCase();
                                const venue = m?.name ?? s.circuit_short_name ?? '';
                                const v = fold(venue);
                                const parts = [
                                  v !== fold(title) && v !== fold(m?.location ?? '') ? venue : '',
                                  m?.location ?? '',
                                  m && m.corners > 0 ? `${m.corners} corners` : '',
                                ].filter(Boolean);
                                return parts.length ? parts.join(' · ') : (m?.country ?? '');
                              })()}
                            </p>
                            <div className="race-choice-bottom">
                              <div className="race-session-links">
                                {(filter === 'All sessions'
                                  ? SLOTS.map(
                                      (name) =>
                                        rows.find((r) => r.session_name === name) ??
                                        ({
                                          session_key: -1,
                                          session_name: name,
                                          has_results: false,
                                          missing: true,
                                        } as SessionRow & { missing?: boolean })
                                    )
                                  : rows
                                ).map((row) =>
                                  (row as { missing?: boolean }).missing ? (
                                    <span key={row.session_name} className="race-unavailable race-not-held">
                                      <span>{row.session_name}</span>
                                      <span>Not held</span>
                                    </span>
                                  ) : row.has_results ? (
                                    <a
                                      key={row.session_key}
                                      href={href(row)}
                                      aria-label={`Explore ${s.circuit_short_name} ${row.session_name}`}
                                    >
                                      <span>{row.session_name}</span>
                                      <span className="race-link-action">
                                        View estimates <span aria-hidden="true">↗</span>
                                      </span>
                                    </a>
                                  ) : (
                                    <span key={row.session_key} className="race-unavailable">
                                      <span>{row.session_name}</span>
                                      <span>No results</span>
                                    </span>
                                  )
                                )}
                              </div>
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
                <a className="home-text-link" href="/findings.html">
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
