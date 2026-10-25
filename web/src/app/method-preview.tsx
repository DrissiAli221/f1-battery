import './reveal';
import { PageGround, SiteFooter, SiteHeader } from './chrome';
import { useInitialAnchor } from './preview-navigation';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import log from '../content/method-log.json';
import logUrl from '../content/method-log.json?url';
import { createPixelButton } from './hover.js';
import { paintScreen } from './session-halftone';
import './session.css';
import './method.css';
import './refinement.css';
import './section-nav.css';

gsap.registerPlugin(ScrollTrigger);
// These labels summarise the recorded consequences; they do not turn mixed checks into passes.
const outcomes: Record<string, { label: string; tone: string; group: string; short: string }> = {
  'phase-s-super-clip': {
    label: 'Artifact removed',
    tone: 'bad',
    group: 'Feasibility',
    short:
      'The apparent harvest segments came from braking leaking through the smoothing window. They were not claimed.',
  },
  'phase-s-taper': {
    label: 'Not demonstrated',
    tone: 'warn',
    group: 'Feasibility',
    short:
      'The expected power-taper break could not be separated from tow, Overtake state and unobserved active aero.',
  },
  'phase3-differentiation': {
    label: 'SG-9 retained',
    tone: 'neutral',
    group: 'Estimator',
    short:
      'The short Savitzky–Golay window performed best outside the discarded brake-onset region. Synthetic truth remains idealised.',
  },
  'phase3-hinge-detector': {
    label: 'Experimental',
    tone: 'warn',
    group: 'Estimator',
    short:
      'The hinge detector failed its Singapore reproduction check. Threshold crossing became the primary cut-off.',
  },
  'drag-area-identifiability': {
    label: 'Limitation retained',
    tone: 'warn',
    group: 'Estimator',
    short:
      'Per-car drag could not be identified reliably. A session-wide value is used and flagged as an assumption.',
  },
  'data-quality': {
    label: 'Exclusions recorded',
    tone: 'neutral',
    group: 'Data quality',
    short:
      'Coverage and clock checks found a truncated backup, a confirmed feed gap and unusable Hungary race timing.',
  },
  'spot-checks': {
    label: '3 failed',
    tone: 'bad',
    group: 'Validation',
    short: 'Three checks failed, one passed and one was not testable. Their expected signs were not changed.',
  },
  'frozen-hypothesis-test': {
    label: 'No effect',
    tone: 'neutral',
    group: 'Validation',
    short:
      'The frozen test found no detectable signal beyond its controls with this estimator and selected sample.',
  },
};
const steps = [
  [
    'Public telemetry',
    'Speed, throttle, brake and position are available. Battery state and electrical power are hidden.',
  ],
  [
    'Clean, aligned laps',
    'Timing and telemetry are aligned. Gaps, neutralised laps and inconsistent lap lengths are excluded.',
  ],
  [
    'Estimate the cut-off',
    'A sustained low-acceleration threshold marks a candidate end to deployment on each straight.',
  ],
  [
    'Test against passes',
    'The frozen model controls for pace, tyre age, lap number, Overtake availability and session.',
  ],
];
const date = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso + 'T00:00:00Z'));
function App() {
  useInitialAnchor();
  const [filter, setFilter] = useState('All entries');
  const [switched, setSwitched] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hero = useRef<HTMLElement>(null);
  const entries = log.entries.filter((e) => filter === 'All entries' || outcomes[e.id]?.group === filter);
  useEffect(() => {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.page-sections > div a[href^="#"]')
    );
    const secs = links
      .map((a) => document.getElementById(a.hash.slice(1)))
      .filter((s): s is HTMLElement => !!s);
    if (!secs.length || !('IntersectionObserver' in window)) return;
    const live = new Set<Element>();
    const set = () => {
      let cur: HTMLElement | null = null;
      secs.forEach((s) => {
        if (live.has(s)) cur = s;
      });
      if (cur)
        links.forEach((a) => {
          if (a.hash === '#' + cur!.id) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        });
    };
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((e) => (e.isIntersecting ? live.add(e.target) : live.delete(e.target)));
        set();
      },
      { rootMargin: '-30% 0px -70% 0px' }
    );
    secs.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const media = gsap.matchMedia();
    media.add('(min-width:1000px) and (prefers-reduced-motion:no-preference)', () => {
      if (canvas.current && hero.current)
        gsap.to(canvas.current, {
          y: 32,
          ease: 'none',
          scrollTrigger: { trigger: hero.current, start: 'top top', end: 'bottom top', scrub: true },
        });
    });
    document.fonts.ready.then(() => ScrollTrigger.refresh());
    return () => media.revert();
  }, []);
  useEffect(() => {
    document
      .querySelectorAll<HTMLAnchorElement>('.method-preview .button-light')
      .forEach((el) => createPixelButton(el));
    const c = canvas.current;
    if (!c) return;
    const draw = () => paintScreen(c);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="session-preview method-preview">
      <a className="skip" href="#method-record">
        Skip to method record
      </a>
      <SiteHeader current="method" />
      <PageGround className="method-ground">
        <main className="session-main method-main">
          <section ref={hero} className="hero-band" aria-labelledby="method-title">
            <div className="wrap method-hero">
              <div className="method-screen" aria-hidden="true">
                <canvas ref={canvas} data-screen="hero" />
              </div>
              <div className="method-lead">
                <p className="finding-eyebrow" data-reveal>
                  How the estimate is built · {steps.length} steps
                </p>
                <h1 id="method-title">
                  The
                  <br />
                  method.
                </h1>
              </div>
              <div className="method-hero-copy">
                <h2>
                  Speed is public.
                  <br />
                  Battery power isn’t.
                </h2>
                <p>
                  This project estimates where electrical deployment may end using public telemetry. It then
                  tests whether that proxy predicts being passed.
                </p>
                <p className="method-small">
                  The checks, failures and changes are part of the record. No state-of-charge numbers are
                  claimed.
                </p>
                <a href="#method-record" className="method-jump">
                  Read the record <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
          </section>
          <nav className="section-rail" aria-label="Method sections">
            <div className="wrap page-sections">
              <div>
                <a href="#process">Overview</a>
                <a href="#estimator">Estimator</a>
                <a href="#method-record">The record</a>
              </div>
              <a href="/findings.html">
                See the findings <span aria-hidden="true">↗</span>
              </a>
            </div>
          </nav>
          <section
            id="process"
            tabIndex={-1}
            aria-label="From public telemetry to the hypothesis test"
            className="band"
          >
            <div className="wrap method-process">
              <ol>
                {steps.map(([title, description], i) => (
                  <li key={title}>
                    <span className="process-number">{String(i + 1).padStart(2, '0')}</span>
                    <h2>{title}</h2>
                    <p>{description}</p>
                    <span className="process-arrow" aria-hidden="true">
                      →
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
          <section id="estimator" tabIndex={-1} aria-labelledby="estimator-title">
            <div className="wrap method-estimator">
              <div className="session-card method-plate">
                <h2 id="estimator-title">
                  A cut-off.
                  <br />
                  Not a<br />
                  charge level.
                  <span className="card-grain" aria-hidden="true">
                    A cut-off.
                    <br />
                    Not a<br />
                    charge level.
                  </span>
                </h2>
                <p>The primary threshold-crossing estimator</p>
              </div>
              <div className="estimator-copy">
                <h3>What marks the point?</h3>
                <p>
                  The primary cut-off is the first point above 250 km/h where acceleration stays below 0.5
                  m/s² for four consecutive 0.25-second steps.
                </p>
                <dl className="estimator-rules">
                  <div>
                    <dt>
                      250<span>km/h</span>
                    </dt>
                    <dd>Minimum speed</dd>
                  </div>
                  <div>
                    <dt>
                      0.5<span>m/s²</span>
                    </dt>
                    <dd>Acceleration threshold</dd>
                  </div>
                  <div>
                    <dt>
                      4<span>steps</span>
                    </dt>
                    <dd>Sustained crossing</dd>
                  </div>
                </dl>
                <p>
                  Per-car session medians and lap-bootstrap intervals summarise the estimates. The explorer
                  places them in metres from the start of each straight.
                </p>
                <details className="method-explainer">
                  <summary>
                    What the threshold cannot establish <span aria-hidden="true">+</span>
                  </summary>
                  <p>
                    It is an energy-management proxy, not a measurement of electrical power. Drag, mass,
                    engine behaviour and unobserved aero limit interpretation. The primary estimator may
                    include lift leakage. A separate hinge-ramp detector remains experimental and is not used
                    in the frozen test.
                  </p>
                </details>
                <p className="method-small">
                  These are estimator rules, not FIA power limits. Source: the Phase 3–4 estimator and
                  findings notes.
                </p>
              </div>
            </div>
          </section>
          <section id="method-record" tabIndex={-1} aria-labelledby="record-title" className="band">
            <div className="wrap method-record">
              <div className="method-section-heading">
                <h2 id="record-title">
                  The record.
                  <br />
                  Including the failures.
                </h2>
                <p>
                  Pre-set checks stay as written. A later change is recorded as a separate decision, rather
                  than rewriting the original outcome.
                </p>
              </div>
              <div className="record-filters" role="group" aria-label="Method topic">
                {['All entries', 'Feasibility', 'Data quality', 'Estimator', 'Validation'].map((f) => (
                  <button
                    key={f}
                    aria-pressed={filter === f}
                    onClick={() => {
                      if (f !== filter) setSwitched(true);
                      setFilter(f);
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <p className="record-count" role="status">
                {entries.length} of {log.entries.length} recorded entries
              </p>
              <div key={filter} className={`method-entries${switched ? ' switch-in' : ''}`}>
                {entries.map((e) => {
                  const outcome = outcomes[e.id];
                  const index = log.entries.findIndex((x) => x.id === e.id);
                  return (
                    <details className={`method-entry outcome-${outcome.tone}`} id={e.id} key={e.id}>
                      <summary>
                        <span className="entry-number">{String(index + 1).padStart(2, '0')}</span>
                        <span className="entry-overview">
                          <span className="entry-title">{e.title}</span>
                          <span className="entry-meta">
                            {e.phase} <span aria-hidden="true">/</span>{' '}
                            <time dateTime={e.date}>{date(e.date)}</time>
                          </span>
                          <span className="entry-short">{outcome.short}</span>
                        </span>
                        <span className="entry-status">{outcome.label}</span>
                        <span className="entry-toggle" aria-hidden="true">
                          +
                        </span>
                      </summary>
                      <div className="entry-detail">
                        <dl>
                          {[
                            ['Tried', e.tried],
                            ['Pre-set check', e.check],
                            ['Found', e.found],
                            ['Changed', e.consequence],
                          ].map(([label, copy]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>{copy}</dd>
                            </div>
                          ))}
                        </dl>
                        <div className="entry-sources">
                          <span>Source notes</span>
                          <ul>
                            {e.sources.map((source) => (
                              <li key={source.path}>
                                <code>{source.label}</code>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {e.id === 'phase-s-taper' && (
                          <p className="regulation-reference">
                            Regulation reference: FIA Section C, Issue 20 (5 August 2026), Article C5.2.8, as
                            recorded in docs/regulations.md. Per-event limits remain flagged where unknown.
                          </p>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          </section>
          <section aria-labelledby="boundaries-title" className="band band-solid">
            <div className="wrap method-boundaries">
              <h2 id="boundaries-title">
                Keep the
                <br />
                uncertainty in view.
              </h2>
              <div>
                <p>
                  There is no public battery ground truth. Coarse, integer-speed telemetry and modelling
                  assumptions limit what can be inferred.
                </p>
                <p>
                  The frozen test’s “no effect” result applies to this estimator and the sample with detected
                  approach-straight cut-offs. It does not establish that energy management never matters.
                </p>
                <div className="method-next-actions">
                  <a className="button button-light" href="/findings.html">
                    Read the findings
                  </a>
                  <a className="method-download" href={logUrl} download="f1-battery-method-log.json">
                    Download the method record <span aria-hidden="true">↓</span>
                  </a>
                </div>
              </div>
            </div>
          </section>
        </main>
      </PageGround>
      <SiteFooter
        className="method-footer"
        notes={
          <>
            Data: OpenF1 / f1-battery.
            <br />
            All energy outputs are estimates.
            <br />
            Typeface: Formula 1, Kurppa Hosk Type, Vercel.
          </>
        }
        top={{ href: '#method-title', label: 'Back to top ↑' }}
      />
    </div>
  );
}
createRoot(document.getElementById('method-root')!).render(<App />);
