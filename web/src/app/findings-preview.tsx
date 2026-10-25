import './reveal';
import { PageGround, SiteFooter, SiteHeader } from './chrome';
import { useInitialAnchor } from './preview-navigation';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import findings from '../content/findings.json';
import notes from '../content/findings-notes.json';
import reportUrl from '../content/findings.json?url';
import { createPixelButton } from './hover.js';
import { ModelStrip } from './model-strip';
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
/** Width of an element in CSS px, tracked live, so charts draw 1px lines and square marks at true size. */
function useWidth<T extends HTMLElement>(initial: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.max(120, Math.round(el.getBoundingClientRect().width)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
const OR_MIN = 0.6,
  OR_MAX = 1.6,
  OR_PAD = 14,
  OR_THRESHOLD = 1.3,
  OR_TICKS = [0.6, 0.8, 1, 1.2, 1.4, 1.6];
function ForestLines({ x, y1, y2 }: { x: (v: number) => number; y1: number; y2: number }) {
  return (
    <>
      {OR_TICKS.map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={y1} y2={y2} className="forest-grid" />
      ))}
      <line x1={x(1)} x2={x(1)} y1={y1} y2={y2} className="forest-null" />
      <line x1={x(OR_THRESHOLD)} x2={x(OR_THRESHOLD)} y1={y1} y2={y2} className="forest-threshold" />
    </>
  );
}
function RunChart() {
  const [ref, w] = useWidth<HTMLDivElement>(300);
  const ROW_H = w < 400 ? 52 : 76;
  const x = (v: number) =>
    OR_PAD +
    ((Math.log(Math.min(OR_MAX, Math.max(OR_MIN, v))) - Math.log(OR_MIN)) /
      (Math.log(OR_MAX) - Math.log(OR_MIN))) *
      (w - OR_PAD * 2);
  return (
    <figure
      className="run-figure forest"
      aria-label="Odds ratios per one standard deviation earlier defender cut-off, with 95 percent confidence intervals"
    >
      <div className="forest-grid-box">
        <div className="forest-head">
          <span className="forest-col forest-col-name">Test run</span>
          <div className="forest-plot-head" ref={ref}>
            <svg width={w} height={26} aria-hidden="true">
              <text x={x(1)} y={12} textAnchor="middle" className="forest-tag">
                No effect
              </text>
              <text x={x(OR_THRESHOLD)} y={12} textAnchor="middle" className="forest-tag forest-tag-red">
                {w < 340 ? '1.3' : '1.3 threshold'}
              </text>
              <ForestLines x={x} y1={20} y2={26} />
            </svg>
          </div>
          <span className="forest-col forest-col-value">Odds ratio / 95% interval</span>
        </div>
        {runs.map((r) => (
          <div className="forest-row" key={r.name}>
            <div className="forest-name">
              <h3>{r.name}</h3>
              <p>{r.detail}</p>
            </div>
            <svg className="forest-plot" width={w} height={ROW_H} aria-hidden="true">
              <rect
                x={OR_PAD - 6}
                y={ROW_H / 2 - 2}
                width={w - OR_PAD * 2 + 12}
                height={4}
                className="forest-band"
              />
              <ForestLines x={x} y1={0} y2={ROW_H} />
              {Number.isFinite(r.lo) && Number.isFinite(r.hi) && (
                <line x1={x(r.lo)} x2={x(r.hi)} y1={ROW_H / 2} y2={ROW_H / 2} className="forest-ci" />
              )}
              <rect x={x(r.or) - 3.5} y={ROW_H / 2 - 3.5} width={7} height={7} className="forest-point" />
            </svg>
            <div className="forest-value">
              <strong>{fmt(r.or)}</strong>{' '}
              <span>
                [{fmt(r.lo)}, {fmt(r.hi)}]
              </span>
            </div>
          </div>
        ))}
        <div className="forest-axis-row">
          <svg width={w} height={26} aria-hidden="true">
            <ForestLines x={x} y1={0} y2={6} />
            {OR_TICKS.map((t) => (
              <text key={t} x={x(t)} y={21} textAnchor="middle" className="forest-tick">
                {fmt(t, 1)}
              </text>
            ))}
          </svg>
        </div>
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
        <span>
          <i className="point-key" />
          Square is the point estimate, bar the 95% interval; log scale
        </span>
      </figcaption>
    </figure>
  );
}
const HIST_H = 176;
function Permutation() {
  const p = findings.permutation;
  const h = p.histogram;
  const [ref, w] = useWidth<HTMLDivElement>(520);
  const pad = 10,
    base = HIST_H,
    maxBar = HIST_H - 40,
    max = Math.max(...h.counts);
  const x = (n: number) => pad + ((n - h.lo) / (h.hi - h.lo)) * (w - pad * 2);
  const binW = (w - pad * 2) / h.counts.length;
  return (
    <figure className="permutation-figure">
      <div ref={ref}>
        <svg
          width={w}
          height={base + 30}
          role="img"
          aria-label={`${int(p.n)} within-session permutations. Observed coefficient ${fmt(p.observed, 3)}, two-sided p value ${fmt(p.p_two_sided, 3)}.`}
        >
          {h.counts.map((n, i) => (
            <rect
              key={i}
              x={pad + i * binW + 0.5}
              y={base - (n / max) * maxBar}
              width={Math.max(1, binW - 1)}
              height={(n / max) * maxBar}
              className="perm-bar"
            />
          ))}
          <line x1={pad} x2={w - pad} y1={base + 0.5} y2={base + 0.5} className="perm-base" />
          {[-p.q95_abs, p.q95_abs].map((n) => (
            <line key={n} x1={x(n)} x2={x(n)} y1={18} y2={base} className="perm-limit" />
          ))}
          <text x={x(p.q95_abs) + 6} y={12} className="perm-tag">
            95th pct
          </text>
          <line x1={x(p.observed)} x2={x(p.observed)} y1={4} y2={base} className="perm-observed" />
          <text x={x(p.observed) - 6} y={12} textAnchor="end" className="perm-tag perm-tag-red">
            observed
          </text>
          {[
            [-0.2, '−0.2'],
            [0, '0'],
            [0.2, '+0.2'],
          ].map(([n, label]) => (
            <g key={label}>
              <line x1={x(Number(n))} x2={x(Number(n))} y1={base} y2={base + 5} className="perm-tick" />
              <text x={x(Number(n))} y={base + 21} textAnchor="middle" className="perm-label">
                {label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <figcaption>
        <span>
          <i className="observed-key" />
          Observed coefficient {fmt(p.observed, 3)}: more extreme than {fmt(p.pct_abs, 1)}% of the {int(p.n)}{' '}
          shuffles (two-sided p = {fmt(p.p_two_sided, 3)})
        </span>
        <span>
          <i className="limit-key" />
          95th percentile of absolute shuffled coefficients (±{fmt(p.q95_abs, 3)})
        </span>
      </figcaption>
    </figure>
  );
}
const runPass = Object.values(findings.per_run_pass).filter(Boolean).length;
const runTotal = Object.keys(findings.per_run_pass).length;
const verdictFlags = [
  `Verdict: ${findings.verdict}`,
  runPass === runTotal
    ? 'All runs pass'
    : runPass === 0
      ? 'No run passes'
      : `${runPass} of ${runTotal} runs pass`,
  findings.min_sample_ok ? 'Minimum sample met' : 'Minimum sample not met',
  findings.perm_ok ? 'Permutation control passed' : 'Permutation control failed',
];
const flagState = (f: string) =>
  /fail|not met|^no run/i.test(f) ? 'is-fail' : /pass|met\b/i.test(f) ? 'is-pass' : 'is-neutral';
const SD_UNIT: Record<string, string> = {
  cutoff_dev_defender: 'm',
  deploy_rel_diff: 'relative units',
  pace_delta: 's',
  tyre_age_diff: 'laps',
  lap_number: 'laps',
};
const fmtSd = (n: number) => (n >= 100 ? int(Math.round(n)) : String(Number(n.toPrecision(3))));
const pText = (p: number) => (p < 0.001 ? '<0.001' : fmt(p, 3));
/** One range-bar row mark: a zero/null line, an interval (line or band) and a square marker, in true pixels. */
function RangeBar({
  w,
  h,
  x,
  zero,
  lo,
  hi,
  v,
  ink,
  band,
}: {
  w: number;
  h: number;
  x: (n: number) => number;
  zero: number;
  lo: number;
  hi: number;
  v: number;
  ink: boolean;
  band?: boolean;
}) {
  const interval = Number.isFinite(lo) && Number.isFinite(hi);
  return (
    <svg className="range-bar" width={w} height={h} aria-hidden="true">
      <line x1={x(zero)} x2={x(zero)} y1={0} y2={h} className="range-zero" />
      {!interval ? null : band ? (
        <rect x={x(lo)} y={h / 2 - 4} width={Math.max(1, x(hi) - x(lo))} height={8} className="range-band" />
      ) : (
        <line x1={x(lo)} x2={x(hi)} y1={h / 2} y2={h / 2} className={ink ? 'range-ci is-ink' : 'range-ci'} />
      )}
      <rect
        x={x(v) - 3}
        y={h / 2 - 3}
        width={6}
        height={6}
        className={ink ? 'range-point is-ink' : 'range-point'}
      />
    </svg>
  );
}
const TERM_W = 160,
  TERM_MIN = 0.5,
  TERM_MAX = 3.5,
  TERM_TICKS = [0.5, 1, 2, 3];
const termX = (v: number) =>
  4 +
  ((Math.log(Math.min(TERM_MAX, Math.max(TERM_MIN, v))) - Math.log(TERM_MIN)) /
    (Math.log(TERM_MAX) - Math.log(TERM_MIN))) *
    (TERM_W - 8);
function TermRows() {
  return (
    <div className="term-rows" role="list" aria-label="Full model odds ratios">
      <div className="term-row term-head" aria-hidden="true">
        <span>Term</span>
        <svg width={TERM_W} height={20}>
          {TERM_TICKS.map((n) => (
            <text
              key={n}
              x={termX(n)}
              y={14}
              textAnchor={n === TERM_MIN ? 'start' : 'middle'}
              className="forest-tick"
            >
              {fmt(n, 1)}
            </text>
          ))}
        </svg>
        <span>Odds ratio / 95% interval / p</span>
      </div>
      {findings.terms.map((t) => {
        const ink = t.lo > 1 || t.hi < 1;
        return (
          <div className="term-row" role="listitem" key={t.term}>
            <span className="term-label">
              {(notes.terms as Record<string, string>)[t.term]}
              <em>
                {t.unit}
                {t.sd != null && ` · 1 SD = ${fmtSd(t.sd)} ${SD_UNIT[t.term] ?? ''}`.trimEnd()}
              </em>
            </span>
            <RangeBar w={TERM_W} h={18} x={termX} zero={1} lo={t.lo} hi={t.hi} v={t.or} ink={ink} />
            <span className="term-value">
              <strong>{fmt(t.or, 3)}</strong>{' '}
              <span>
                [{fmt(t.lo, 3)}, {fmt(t.hi, 3)}]
              </span>
              <small>p {pText(t.p)}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}
const MAKER_MIN = -100,
  MAKER_MAX = 100;
function MakerRows() {
  const [ref, w] = useWidth<HTMLDivElement>(300);
  const x = (v: number) =>
    8 + ((Math.min(MAKER_MAX, Math.max(MAKER_MIN, v)) - MAKER_MIN) / (MAKER_MAX - MAKER_MIN)) * (w - 16);
  return (
    <div className="maker-rows">
      <div className="maker-row maker-head" aria-hidden="true">
        <span />
        <div ref={ref}>
          <svg width={w} height={20}>
            {[
              [MAKER_MIN, '−100 m · earlier'],
              [0, '0'],
              [MAKER_MAX, '+100 m · later'],
            ].map(([n, label]) => (
              <text
                key={label}
                x={x(Number(n))}
                y={14}
                textAnchor={n === MAKER_MIN ? 'start' : n === MAKER_MAX ? 'end' : 'middle'}
                className="forest-tick"
              >
                {label}
              </text>
            ))}
          </svg>
        </div>
        <span />
      </div>
      {findings.makers.map((m) => (
        <div className="maker-row" key={m.maker}>
          <span className="maker-name">{m.maker}</span>
          <RangeBar
            w={w}
            h={34}
            x={x}
            zero={0}
            lo={m.mean_offset_m - m.sd_offset_m}
            hi={m.mean_offset_m + m.sd_offset_m}
            v={m.mean_offset_m}
            ink
            band
          />
          <strong>
            {m.mean_offset_m > 0 ? '+' : ''}
            {fmt(m.mean_offset_m, 1)} m
          </strong>
          <span className="maker-detail">
            ±{fmt(m.sd_offset_m, 1)} m SD · {m.cells} cells · earliest in {fmt(m.share_earliest * 100, 1)}% of
            cells
          </span>
        </div>
      ))}
    </div>
  );
}
const TEAM_FERRARI = '#e8002d',
  TEAM_REDBULL = '#3671c6',
  TEAM_MERCEDES = '#27f4d2';
type SpotCheck = (typeof notes.spot_checks)[number];
const sgn = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
function Hatch({ id }: { id: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" className="cv-hatch" />
    </pattern>
  );
}
/** Check 1: five lap offsets as a dot-and-stem strip around zero, with the 2 std bar. */
function VisNorris({ w, c }: { w: number; c: SpotCheck }) {
  const v = c.visual as { offsets_m: number[]; laps: number[]; std_m: number };
  const R = 100,
    x = (m: number) => 12 + ((m + R) / (2 * R)) * (w - 24),
    cy = 44,
    two = 2 * v.std_m;
  return (
    <>
      <line x1={x(-R)} x2={x(R)} y1={cy} y2={cy} className="cv-axis" />
      {[-two, two].map((m) => (
        <line key={m} x1={x(m)} x2={x(m)} y1={cy - 24} y2={cy + 4} className="cv-bar" />
      ))}
      <text x={x(-two)} y={11} textAnchor="middle" className="cv-text">
        −2 std
      </text>
      <text x={x(two)} y={11} textAnchor="middle" className="cv-text">
        +2 std
      </text>
      <line x1={x(0)} x2={x(0)} y1={cy - 24} y2={cy + 24} className="cv-zero" />
      {v.offsets_m.map((m, i) => {
        const last = i === v.offsets_m.length - 1;
        return (
          <g key={i}>
            <line x1={x(0)} x2={x(m)} y1={cy} y2={cy} className="cv-stem" />
            <circle cx={x(m)} cy={cy} r={4} className={last ? 'cv-dot is-red' : 'cv-dot'} />
          </g>
        );
      })}
      <text x={x(-R)} y={92} className="cv-text">
        −100 m · earlier
      </text>
      <text x={x(R)} y={92} textAnchor="end" className="cv-text">
        +100 m
      </text>
      <text x={x(v.offsets_m[4])} y={cy + 22} textAnchor="start" className="cv-text is-ink">
        lap 51 · {sgn(v.offsets_m[4])} m · 1.9 std
      </text>
    </>
  );
}
/** Check 2: Hamilton and Verstappen on one metre axis; Verstappen sits in a hatched noise band. */
function VisCanada({ w, c, id }: { w: number; c: SpotCheck; id: string }) {
  const v = c.visual as { hamilton_m: number; verstappen_m: number; verstappen_std_m: number };
  const R = 100,
    x = (m: number) => 12 + ((m + R) / (2 * R)) * (w - 24);
  const rows = [30, 66];
  return (
    <>
      <defs>
        <Hatch id={id} />
      </defs>
      <rect
        x={x(-v.verstappen_std_m)}
        y={4}
        width={x(v.verstappen_std_m) - x(-v.verstappen_std_m)}
        height={74}
        fill={`url(#${id})`}
        className="cv-noise"
      />
      <line x1={x(0)} x2={x(0)} y1={4} y2={78} className="cv-zero" />
      <line x1={x(-R)} x2={x(R)} y1={rows[0]} y2={rows[0]} className="cv-axis" />
      <line x1={x(-R)} x2={x(R)} y1={rows[1]} y2={rows[1]} className="cv-axis" />
      <circle cx={x(v.hamilton_m)} cy={rows[0]} r={5} fill={TEAM_FERRARI} />
      <text x={x(v.hamilton_m) + 10} y={rows[0] - 8} className="cv-text is-ink">
        Hamilton {sgn(v.hamilton_m)} m
      </text>
      <circle cx={x(v.verstappen_m)} cy={rows[1]} r={5} fill={TEAM_REDBULL} />
      <text x={x(v.verstappen_std_m) + 8} y={rows[1] - 8} className="cv-text is-ink">
        Verstappen
      </text>
      <text x={x(v.verstappen_std_m) + 8} y={rows[1] + 14} className="cv-text">
        within noise
      </text>
      <text x={x(-R)} y={92} className="cv-text">
        −100 m · earlier
      </text>
      <text x={x(R)} y={92} textAnchor="end" className="cv-text">
        +100 m
      </text>
    </>
  );
}
/** Check 3: interval bars per straight, from the bootstrap bounds recorded in docs/spot-checks.md. */
function VisMonza({ w, c }: { w: number; c: SpotCheck }) {
  const v = c.visual as {
    straights: { n: number; hamilton: number[]; antonelli: number[] }[];
  };
  const labelW = 76;
  return (
    <>
      {v.straights.map((s, i) => {
        const lo = Math.min(s.hamilton[1], s.antonelli[1]) - 6,
          hi = Math.max(s.hamilton[2], s.antonelli[2]) + 6,
          x = (m: number) => labelW + ((m - lo) / (hi - lo)) * (w - labelW - 8),
          y0 = 4 + i * 38;
        const olo = Math.max(s.hamilton[1], s.antonelli[1]),
          ohi = Math.min(s.hamilton[2], s.antonelli[2]),
          ov = ohi - olo;
        return (
          <g key={s.n}>
            <text x={0} y={y0 + 10} className="cv-text is-ink">
              Straight {s.n}
            </text>
            {ov > 0 && (
              <rect
                x={x(olo)}
                y={y0 - 2}
                width={Math.max(2, x(ohi) - x(olo))}
                height={30}
                className="cv-overlap"
              />
            )}
            {[
              ['Ferrari', s.hamilton, TEAM_FERRARI, y0 + 5],
              ['Mercedes', s.antonelli, TEAM_MERCEDES, y0 + 21],
            ].map(([name, b, col, y]) => {
              const [m, l, h] = b as number[];
              return (
                <g key={name as string}>
                  <line
                    x1={x(l)}
                    x2={x(h)}
                    y1={y as number}
                    y2={y as number}
                    stroke={col as string}
                    strokeWidth={4}
                  />
                  <circle cx={x(m)} cy={y as number} r={3.5} fill={col as string} />
                </g>
              );
            })}
            <text x={0} y={y0 + 24} className="cv-text">
              {ov > 0 ? `${ov} m overlap` : 'no overlap'}
            </text>
          </g>
        );
      })}
      <text x={0} y={92} className="cv-text">
        <tspan fill={TEAM_FERRARI}>●</tspan> Hamilton <tspan fill={TEAM_MERCEDES}>●</tspan> Antonelli ·
        bootstrap intervals
      </text>
    </>
  );
}
/** Check 4: a flat line, no stated magnitude. */
function VisSingapore({ w }: { w: number }) {
  return (
    <>
      <line x1={12} x2={w - 12} y1={48} y2={48} className="cv-flat" />
      <circle cx={w - 12} cy={48} r={4} className="cv-dot is-pass" />
      <text x={12} y={34} className="cv-text is-ink">
        no derate step
      </text>
      <text x={12} y={72} className="cv-text">
        Singapore 11388 · any straight, any car
      </text>
    </>
  );
}
/** Check 5: Monza vs Baku; Baku hatched because the proxy stores no harvest regime. */
function VisPiastri({ w, c, id }: { w: number; c: SpotCheck; id: string }) {
  const v = c.visual as { monza_limit_mj: string; baku_limit_mj: number };
  const gap = 12,
    cw = (w - gap) / 2;
  return (
    <>
      <defs>
        <Hatch id={id} />
      </defs>
      <rect x={0.5} y={6.5} width={cw - 1} height={56} className="cv-col" />
      <rect x={cw + gap + 0.5} y={6.5} width={cw - 1} height={56} fill={`url(#${id})`} className="cv-col" />
      <text x={cw / 2} y={30} textAnchor="middle" className="cv-text is-ink">
        Monza
      </text>
      <text x={cw / 2} y={46} textAnchor="middle" className="cv-text">
        {v.monza_limit_mj} MJ limits
      </text>
      <text x={cw + gap + cw / 2} y={30} textAnchor="middle" className="cv-text is-ink">
        Baku
      </text>
      <text x={cw + gap + cw / 2} y={46} textAnchor="middle" className="cv-text">
        {v.baku_limit_mj} MJ
      </text>
      <text x={w / 2} y={86} textAnchor="middle" className="cv-text is-ink">
        no harvest-under-throttle regime stored
      </text>
    </>
  );
}
function CheckVisual({ c }: { c: SpotCheck }) {
  const [ref, w] = useWidth<HTMLDivElement>(300);
  const id = `hatch-${c.n}`;
  return (
    <div className="cc-visual" ref={ref}>
      <svg width={w} height={96} aria-hidden="true">
        {c.n === 1 && <VisNorris w={w} c={c} />}
        {c.n === 2 && <VisCanada w={w} c={c} id={id} />}
        {c.n === 3 && <VisMonza w={w} c={c} />}
        {c.n === 4 && <VisSingapore w={w} />}
        {c.n === 5 && <VisPiastri w={w} c={c} id={id} />}
      </svg>
    </div>
  );
}
function CheckCard({ c }: { c: SpotCheck }) {
  return (
    <li className={`cc check-${c.result.replace(' ', '-')}`} id={`check-${c.n}`}>
      <div className="cc-top">
        <span className="cc-number">{String(c.n).padStart(2, '0')}</span>
        <span className="cc-pill">
          <i aria-hidden="true" />
          {c.result}
        </span>
      </div>
      <h3>{c.moment}</h3>
      <p className="cc-expected">
        <span>Expected</span> {c.expected}
      </p>
      <CheckVisual c={c} />
      <p className="cc-result">{c.detail}</p>
    </li>
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
      .querySelectorAll<HTMLAnchorElement>('.findings-preview .button-light, .findings-preview .button-grey')
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
          <section ref={hero} className="hero-band" aria-labelledby="finding-title">
            <div className="wrap finding-hero">
              <div className="finding-screen" aria-hidden="true">
                <canvas ref={canvas} data-screen="hero" />
              </div>
              <div className="finding-lead">
                <p className="finding-eyebrow" data-reveal>
                  Pre-registered test · {findings.sample.sessions_in_model} sessions
                </p>
                <h1 id="finding-title">
                  No
                  <br />
                  effect.
                </h1>
                <p className="finding-hero-stats" data-reveal>
                  <span>{int(findings.sample.events_tested)} passes tested</span>
                  <span>odds ratio {fmt(findings.runs.point.or)}</span>
                  <span>{findings.sample.sessions_in_model} sessions</span>
                </p>
                <ul className="finding-flags" aria-label="Frozen test criteria" data-reveal>
                  {verdictFlags.map((f) => (
                    <li key={f} className={flagState(f)}>
                      <i aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
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
                <a href="#evidence">
                  <b>01</b>Evidence
                </a>
                <a href="#checks">
                  <b>02</b>Spot checks
                </a>
                <a href="#limitations">
                  <b>03</b>Limits
                </a>
                <a href="#provenance">
                  <b>04</b>Source
                </a>
              </div>
              <a href="/method.html">
                How it works <span aria-hidden="true">↗</span>
              </a>
            </div>
          </nav>
          <section aria-label="Sample used in the frozen test">
            <div className="wrap finding-sample-wrap">
              <ModelStrip frozen={findings.source.model_version} />
              <div className="finding-sample">
                {[
                  [
                    int(findings.sample.events_tested),
                    'Passes tested',
                    `against ${int(findings.sample.non_events_tested)} close-following non-passes`,
                  ],
                  [
                    fmt(findings.runs.point.or),
                    'Odds ratio, point run',
                    '95% interval ' + fmt(findings.runs.point.lo) + '–' + fmt(findings.runs.point.hi),
                  ],
                  [String(findings.sample.sessions_in_model), 'Sessions in the model', ''],
                  [
                    fmt(findings.permutation.p_two_sided, 3),
                    'Permutation p',
                    'two-sided, ' + int(findings.permutation.n) + ' shuffles',
                  ],
                ].map(([n, label, sub]) => (
                  <div key={label} className={label === 'Odds ratio, point run' ? 'is-answer' : undefined}>
                    <strong>{n}</strong>
                    <span>{label}</span>
                    {sub && <small>{sub}</small>}
                  </div>
                ))}
              </div>
              {findings.runs.point.or < 1 && (
                <p className="finding-sample-verdict">
                  Odds ratio below 1: opposite to the proposed direction.
                </p>
              )}
            </div>
          </section>
          <section id="evidence" tabIndex={-1} aria-labelledby="evidence-title" className="band">
            <div className="wrap finding-evidence">
              <p className="section-no">
                <b>01</b>Evidence
              </p>
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
                <div className="finding-block read-note">
                  <h3 className="finding-block-title">How to read the odds ratio</h3>
                  <p>
                    An odds ratio above 1 means higher odds of being passed per one standard deviation earlier
                    cut-off; below 1 means lower odds. The horizontal line is the 95% confidence interval. The
                    pre-registered result required an odds ratio of at least 1.3, an interval excluding 1 in
                    all three runs, and a passed permutation control.
                  </p>
                  <p>
                    The pre-registered minimum sample is 150 events and 300 non-events; below that the result
                    would be reported as insufficient data.
                  </p>
                </div>
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
              <p className="section-no">
                <b>02</b>Spot checks
              </p>
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
              <ul className="check-cards" aria-label="Spot-check results">
                {notes.spot_checks.map((c) => (
                  <CheckCard key={c.n} c={c} />
                ))}
              </ul>
            </div>
          </section>
          <section aria-labelledby="more-title">
            <div className="wrap finding-more">
              <p className="section-no">In detail</p>
              <div className="finding-section-intro">
                <h2 id="more-title">Look closer.</h2>
                <p>
                  The full model and the maker comparison add context. Maker differences are descriptive; they
                  do not measure energy capacity.
                </p>
              </div>
              <div className="finding-block full-model">
                <h3 className="finding-block-title">Full model coefficients</h3>
                <p>
                  Point-estimate fit. Continuous terms are per one standard deviation; binary terms compare 1
                  against 0. The cut-off deviation here is the fitted <strong>later-cut-off</strong>{' '}
                  direction.
                </p>
                <TermRows />
                <p className="finding-small term-note">
                  Square is the odds ratio, line the 95% interval, on a log scale; the tick marks 1, no
                  association. Terms whose interval excludes 1 are drawn in white.
                </p>
                <p>
                  The energy terms together add no detectable improvement over the controls: likelihood-ratio
                  χ² {fmt(findings.energy_terms_lr.chi2)}, {findings.energy_terms_lr.df} degrees of freedom, p
                  = {fmt(findings.energy_terms_lr.p, 3)}. This comparison is a post-hoc sensitivity check.
                </p>
              </div>
              <div className="finding-block maker-details">
                <h3 className="finding-block-title">Power-unit makers across races</h3>
                <p>
                  Descriptive analysis outside the frozen test. Mean offset from all makers’ mean in each
                  race/straight cell with at least three makers. Bands show ±1 standard deviation across
                  cells, not confidence intervals.
                </p>
                <MakerRows />
                <p>
                  Honda represents two cars. Drag, mass assumptions and car-to-car differences cannot be
                  separated here. A difference in this proxy is not a difference in battery or energy
                  capacity.
                </p>
              </div>
            </div>
          </section>
          <section id="limitations" tabIndex={-1} aria-labelledby="limits-title" className="band band-solid">
            <div className="wrap finding-limits">
              <p className="section-no">
                <b>03</b>Limits
              </p>
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
                      {detail}
                      {title === 'Unknown limits' && ' The model uses assumptions flagged as unknown.'}
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
              <p className="section-no in-grid">
                <b>04</b>Source
              </p>
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
                <div className="finding-block source-accounting">
                  <h3 className="finding-block-title">Source and sample accounting</h3>
                  <dl className="source-list">
                    <div>
                      <dt>Script</dt>
                      <dd>
                        <code>{findings.source.script}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Run</dt>
                      <dd>
                        <code>{findings.source.run_id}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Extracted</dt>
                      <dd>
                        {int(findings.sample.events_extracted)} passes and{' '}
                        {int(findings.sample.non_events_extracted)} close-following non-passes were extracted.
                      </dd>
                    </div>
                    <div>
                      <dt>Selected</dt>
                      <dd>
                        Complete-case selection and removal of single-class sessions leave{' '}
                        {int(findings.sample.events_tested)} passes and{' '}
                        {int(findings.sample.non_events_tested)} non-passes in{' '}
                        {findings.sample.sessions_in_model} sessions.
                      </dd>
                    </div>
                    <div>
                      <dt>Largest drop</dt>
                      <dd>Missing previous-lap cut-offs on the approach straight.</dd>
                    </div>
                  </dl>
                </div>
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
