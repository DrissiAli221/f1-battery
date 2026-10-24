import './reveal';
import { PageGround, SiteFooter, SiteHeader } from './chrome';
import { useInitialAnchor } from './preview-navigation';
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import findings from '../content/findings.json';
import notes from '../content/findings-notes.json';
import reportUrl from '../content/findings.json?url';
import { createPixelButton } from './hover.js';
import { paintScreen } from './session-halftone';
import './session.css';
import './findings.css';
import './refinement.css';
import './section-nav.css';

gsap.registerPlugin(ScrollTrigger);
const fmt = (n: number, d = 2) =>
  new Intl.NumberFormat('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const int = (n: number) => n.toLocaleString('en-GB');
const runs = [
  { name: 'Point estimate', detail: 'Deviation from the session median', ...findings.runs.point },
  {
    name: 'Lower interval edge',
    detail: 'Deviation from the upper median bound',
    ...findings.runs.lower_edge,
  },
  {
    name: 'Upper interval edge',
    detail: 'Deviation from the lower median bound',
    ...findings.runs.upper_edge,
  },
];
const OR_MIN = 0.6,
  OR_MAX = 1.6;
const percent = (n: number) => (100 * (n - OR_MIN)) / (OR_MAX - OR_MIN);
function RunChart() {
  return (
    <figure
      className="run-figure"
      aria-label="Odds ratios per one standard deviation earlier defender cut-off, with 95 percent confidence intervals"
    >
      <div className="run-column-head">
        <span>Test run</span>
        <span>Odds ratio / 95% interval</span>
      </div>
      <div className="run-axis" aria-hidden="true">
        <div className="run-axis-space" />
        <div className="run-axis-plot">
          {[0.6, 0.8, 1, 1.3, 1.6].map((n) => (
            <span key={n} style={{ left: `${percent(n)}%` }}>
              {fmt(n, 1)}
            </span>
          ))}
        </div>
        <div className="run-value-space" />
      </div>
      <div className="run-rows">
        {runs.map((r) => (
          <div className="run-row" key={r.name}>
            <div className="run-name">
              <h3>{r.name}</h3>
              <p>{r.detail}</p>
            </div>
            <div className="run-plot">
              <span className="run-null" style={{ left: `${percent(1)}%` }} />
              <span className="run-threshold" style={{ left: `${percent(1.3)}%` }} />
              <span
                className="run-ci"
                style={{ left: `${percent(r.lo)}%`, width: `${percent(r.hi) - percent(r.lo)}%` }}
              />
              <span className="run-point" style={{ left: `${percent(r.or)}%` }} />
            </div>
            <div className="run-value">
              <strong>{fmt(r.or)}</strong>
              <span>
                {fmt(r.lo)}–{fmt(r.hi)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <figcaption>
        <span>
          <i className="null-key" />
          1.0 / no association
        </span>
        <span>
          <i className="threshold-key" />
          1.3 / pre-registered effect threshold
        </span>
      </figcaption>
    </figure>
  );
}
function Permutation() {
  const h = findings.permutation.histogram;
  const w = 580,
    height = 230,
    pad = 28,
    plotW = w - pad * 2,
    plotH = height - 54,
    max = Math.max(...h.counts);
  const x = (n: number) => pad + ((n - h.lo) / (h.hi - h.lo)) * plotW;
  const binW = plotW / h.counts.length;
  return (
    <figure className="permutation-figure">
      <svg
        viewBox={`0 0 ${w} ${height}`}
        role="img"
        aria-label={`${int(findings.permutation.n)} within-session permutations. Observed coefficient ${fmt(findings.permutation.observed, 3)}, two-sided p value ${fmt(findings.permutation.p_two_sided, 3)}.`}
      >
        {[0.5, 1].map((n) => (
          <line
            key={n}
            x1={pad}
            x2={w - pad}
            y1={18 + plotH * (1 - n)}
            y2={18 + plotH * (1 - n)}
            className="perm-grid"
          />
        ))}
        {h.counts.map((n, i) => (
          <rect
            key={i}
            x={pad + i * binW + 1}
            y={18 + plotH - (n / max) * plotH}
            width={Math.max(1, binW - 2)}
            height={(n / max) * plotH}
            className="perm-bar"
          />
        ))}
        <line x1={pad} x2={w - pad} y1={18 + plotH} y2={18 + plotH} className="perm-base" />
        {[-findings.permutation.q95_abs, findings.permutation.q95_abs].map((n) => (
          <line key={n} x1={x(n)} x2={x(n)} y1={12} y2={18 + plotH} className="perm-limit" />
        ))}
        <line
          x1={x(findings.permutation.observed)}
          x2={x(findings.permutation.observed)}
          y1={8}
          y2={18 + plotH}
          className="perm-observed"
        />
        {[-0.2, 0, 0.2].map((n) => (
          <text key={n} x={x(n)} y={height - 12} textAnchor="middle">
            {fmt(n, 1)}
          </text>
        ))}
      </svg>
      <figcaption>
        <span>
          <i className="observed-key" />
          Observed coefficient {fmt(findings.permutation.observed, 3)}
        </span>
        <span>
          <i className="limit-key" />
          95th percentile of absolute shuffled coefficients
        </span>
      </figcaption>
    </figure>
  );
}
function App() {
  useInitialAnchor();
  const canvas = useRef<HTMLCanvasElement>(null);
  const hero = useRef<HTMLElement>(null);
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
      .querySelectorAll<HTMLAnchorElement>('.findings-preview .button-light')
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
    <div className="session-preview findings-preview">
      <a className="skip" href="#evidence">
        Skip to evidence
      </a>
      <SiteHeader current="findings" />
      <PageGround className="findings-ground">
        <main className="session-main findings-main">
          <section ref={hero} aria-labelledby="finding-title">
            <div className="wrap finding-hero">
              <div className="finding-screen" aria-hidden="true">
                <canvas ref={canvas} data-screen="hero" />
              </div>
              <h1 id="finding-title">
                No
                <br />
                effect.
              </h1>
              <div className="finding-answer">
                <h2>An earlier cut-off didn’t predict the pass.</h2>
                <p>
                  Once pace and Overtake availability were controlled, this energy-management proxy added no
                  detectable signal.
                </p>
                <p className="finding-caveat">{notes.caveat}</p>
                <a className="finding-jump" href="#evidence">
                  See the evidence <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
          </section>
          <nav className="section-rail" aria-label="Findings sections">
            <div className="wrap page-sections">
              <div>
                <a href="#evidence">Evidence</a>
                <a href="#checks">Spot checks</a>
                <a href="#limitations">Limits</a>
                <a href="#provenance">Source</a>
              </div>
              <a href="/method.html">
                How it works <span aria-hidden="true">↗</span>
              </a>
            </div>
          </nav>
          <section aria-label="Sample used in the frozen test">
            <div className="wrap finding-sample">
              {[
                [findings.sample.events_tested, 'Passes tested'],
                [findings.sample.non_events_tested, 'Close-following non-passes'],
                [findings.sample.sessions_in_model, 'Sessions in the model'],
              ].map(([n, label]) => (
                <div key={label}>
                  <strong>{int(Number(n))}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </section>
          <section id="evidence" tabIndex={-1} aria-labelledby="evidence-title" className="band">
            <div className="wrap finding-evidence">
              <div className="finding-section-intro">
                <h2 id="evidence-title">
                  Three runs.
                  <br />
                  Same verdict.
                </h2>
                <p>
                  The median cut-off has uncertainty. The frozen test runs at its point estimate and both
                  interval edges, controlling for pace, tyre age, lap number, Overtake availability and
                  session.
                </p>
              </div>
              <RunChart />
              <div className="evidence-explanation">
                <p>
                  All three estimates sit below 1, opposite to the proposed direction. Two intervals include
                  1. None reaches the pre-registered effect threshold of 1.3.
                </p>
                <details className="finding-disclosure">
                  <summary>
                    How to read the odds ratio <span aria-hidden="true">+</span>
                  </summary>
                  <p>
                    An odds ratio above 1 means higher odds of being passed per one standard deviation earlier
                    cut-off; below 1 means lower odds. The horizontal line is the 95% confidence interval. The
                    pre-registered result required an odds ratio of at least 1.3, an interval excluding 1 in
                    all three runs, and a passed permutation control.
                  </p>
                </details>
              </div>
            </div>
          </section>
          <section aria-labelledby="permutation-title" className="band band-solid">
            <div className="wrap finding-permutation">
              <div className="permutation-copy">
                <h2 id="permutation-title">
                  The shuffle
                  <br />
                  check failed.
                </h2>
                <p>
                  The energy variables were shuffled together within each session{' '}
                  {int(findings.permutation.n)} times. The observed coefficient was more extreme than{' '}
                  {fmt(findings.permutation.pct_abs, 1)}% of the shuffled ones. The frozen requirement was
                  more than 95%.
                </p>
                <p className="permutation-p">
                  <span>Two-sided permutation p</span>
                  <strong>{fmt(findings.permutation.p_two_sided, 3)}</strong>
                </p>
                <p className="finding-small">
                  The histogram is the saved permutation output, not a simulated illustration.
                </p>
              </div>
              <div className="permutation-chart">
                <Permutation />
                <p className="finding-small">
                  Coefficient / log-odds per standard deviation of later cut-off. This fitted coefficient uses
                  the inverse direction to the earlier-cut-off odds ratios above.
                </p>
              </div>
            </div>
          </section>
          <section id="checks" tabIndex={-1} aria-labelledby="checks-title" className="band">
            <div className="wrap finding-checks">
              <div className="finding-section-intro">
                <h2 id="checks-title">
                  The checks
                  <br />
                  stay on record.
                </h2>
                <p>
                  Five spot checks, fixed before the model output. Three failed, one passed and one could not
                  be tested. The expected signs were kept.
                </p>
              </div>
              <div className="check-list">
                {notes.spot_checks.map((c) => (
                  <details key={c.n} className={`spot-check check-${c.result.replace(' ', '-')}`}>
                    <summary>
                      <span className="check-number">{String(c.n).padStart(2, '0')}</span>
                      <span className="check-moment">{c.moment}</span>
                      <span className="check-status">{c.result}</span>
                      <span className="check-toggle" aria-hidden="true">
                        +
                      </span>
                    </summary>
                    <p>{c.detail}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>
          <section aria-labelledby="more-title">
            <div className="wrap finding-more">
              <div className="finding-section-intro">
                <h2 id="more-title">Look closer.</h2>
                <p>
                  The full model and the maker comparison add context. Maker differences are descriptive; they
                  do not measure energy capacity.
                </p>
              </div>
              <details className="finding-disclosure full-model">
                <summary>
                  Full model coefficients <span aria-hidden="true">+</span>
                </summary>
                <p>
                  Point-estimate fit. Continuous terms are per one standard deviation; binary terms compare 1
                  against 0. The cut-off deviation here is the fitted <strong>later-cut-off</strong>{' '}
                  direction.
                </p>
                <div
                  className="finding-table-scroll"
                  role="region"
                  aria-label="Full model odds ratios"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Term</th>
                        <th>Odds ratio</th>
                        <th>95% interval</th>
                        <th>p</th>
                      </tr>
                    </thead>
                    <tbody>
                      {findings.terms.map((t) => (
                        <tr key={t.term}>
                          <th scope="row">{(notes.terms as Record<string, string>)[t.term]}</th>
                          <td data-label="Odds ratio">{fmt(t.or, 3)}</td>
                          <td data-label="95% interval">
                            {fmt(t.lo, 3)}–{fmt(t.hi, 3)}
                          </td>
                          <td data-label="p">{t.p < 0.001 ? '<0.001' : fmt(t.p, 3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  The energy terms together add no detectable improvement over the controls: likelihood-ratio
                  χ² {fmt(findings.energy_terms_lr.chi2)}, {findings.energy_terms_lr.df} degrees of freedom, p
                  = {fmt(findings.energy_terms_lr.p, 3)}. This comparison is a post-hoc sensitivity check.
                </p>
              </details>
              <details className="finding-disclosure maker-details">
                <summary>
                  Power-unit makers across races <span aria-hidden="true">+</span>
                </summary>
                <p>
                  Descriptive analysis outside the frozen test. Mean offset from all makers’ mean in each
                  race/straight cell with at least three makers. Bands show ±1 standard deviation across
                  cells, not confidence intervals.
                </p>
                <div className="maker-axis" aria-hidden="true">
                  <span>−100 m</span>
                  <span>0</span>
                  <span>+100 m</span>
                </div>
                <div className="maker-rows">
                  {findings.makers.map((m) => (
                    <div className="maker-row" key={m.maker}>
                      <span>{m.maker}</span>
                      <div className="maker-plot" aria-hidden="true">
                        <i className="maker-zero" />
                        <i
                          className="maker-spread"
                          style={{
                            left: `${50 + (m.mean_offset_m - m.sd_offset_m) / 2}%`,
                            width: `${m.sd_offset_m}%`,
                          }}
                        />
                        <i className="maker-mean" style={{ left: `${50 + m.mean_offset_m / 2}%` }} />
                      </div>
                      <strong>
                        {m.mean_offset_m > 0 ? '+' : ''}
                        {fmt(m.mean_offset_m, 1)} m
                      </strong>
                      <span className="maker-detail">
                        ±{fmt(m.sd_offset_m, 1)} m SD · {m.cells} cells
                      </span>
                    </div>
                  ))}
                </div>
                <p>
                  Honda represents two cars. Drag, mass assumptions and car-to-car differences cannot be
                  separated here. A difference in this proxy is not a difference in battery or energy
                  capacity.
                </p>
              </details>
            </div>
          </section>
          <section id="limitations" tabIndex={-1} aria-labelledby="limits-title" className="band band-solid">
            <div className="wrap finding-limits">
              <div className="finding-section-intro">
                <h2 id="limits-title">
                  What this
                  <br />
                  cannot say.
                </h2>
                <p>
                  No public battery ground truth. No state-of-charge claim. These limitations are part of the
                  finding.
                </p>
              </div>
              <dl>
                {notes.limits.map(([title, detail]) => (
                  <div key={title}>
                    <dt>{title}</dt>
                    <dd>
                      {title === 'Unknown limits'
                        ? 'Per-event race energy limits are not public. The model uses assumptions flagged as unknown.'
                        : detail}
                    </dd>
                  </div>
                ))}
              </dl>
              <aside className="finding-limit-note">
                <span aria-hidden="true">!</span>
                <p>
                  A lap-level proxy may miss an effect that happens inside a single straight. “No effect” here
                  is a result for this estimator and sample.
                </p>
              </aside>
            </div>
          </section>
          <section id="provenance" tabIndex={-1} aria-labelledby="provenance-title">
            <div className="wrap finding-provenance">
              <div>
                <h2 id="provenance-title">Traceable to the run.</h2>
                <p>
                  Pre-registered{' '}
                  {new Intl.DateTimeFormat('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    timeZone: 'UTC',
                  }).format(new Date(notes.frozen + 'T00:00:00Z'))}
                  . Model {findings.source.model_version}.
                </p>
                <details className="finding-disclosure">
                  <summary>
                    Source and sample accounting <span aria-hidden="true">+</span>
                  </summary>
                  <p>
                    Script: <code>{findings.source.script}</code>
                  </p>
                  <p>
                    Run: <code>{findings.source.run_id}</code>
                  </p>
                  <p>
                    {int(findings.sample.events_extracted)} passes and{' '}
                    {int(findings.sample.non_events_extracted)} close-following non-passes were extracted.
                    Complete-case selection and removal of single-class sessions leave{' '}
                    {int(findings.sample.events_tested)} passes and {int(findings.sample.non_events_tested)}{' '}
                    non-passes in {findings.sample.sessions_in_model} sessions. The largest drop is missing
                    previous-lap cut-offs on the approach straight.
                  </p>
                </details>
              </div>
              <div className="provenance-actions">
                <a className="button button-light" href="/#races">
                  Explore the races
                </a>
                <a className="finding-download" href={reportUrl} download="f1-battery-findings.json">
                  Download result summary <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
          </section>
        </main>
      </PageGround>
      <SiteFooter
        className="findings-footer"
        notes={
          <>
            Data: OpenF1 / f1-battery.
            <br />
            All energy outputs are estimates.
            <br />
            Typeface: Formula 1, Kurppa Hosk Type, Vercel.
          </>
        }
        top={{ href: '#finding-title', label: 'Back to top ↑' }}
      />
    </div>
  );
}
createRoot(document.getElementById('findings-root')!).render(<App />);
