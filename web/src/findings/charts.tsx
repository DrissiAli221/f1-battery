/*
 * The findings charts, redrawn in the system (DESIGN.md "Drawing rule"): no boxes, hairline
 * axes, estimates shown with their construction. An odds ratio is a tick (the point estimate)
 * over a bracket (its 95 % interval), the same bracket the straight draws under its cut-off.
 * Positions are percentages of the plot column, so the rows need no measuring; only the
 * histogram measures its width.
 */
import { useId } from "react";
import { useSize } from "../lib/useSize";
import { fixed } from "../lib/format";

export const NB = " "; // non-breaking space before units and %

const minus = (s: string) => s.replace(/^-/, "−");
export const num = (v: number, d: number) => minus(fixed(v, d));

export interface ForestRow {
  label: string;
  sub?: string;
  or: number;
  lo: number;
  hi: number;
  strong?: boolean;
}

export function Forest({
  rows,
  domain,
  ticks,
  bar,
  caption,
}: {
  rows: ForestRow[];
  domain: [number, number];
  ticks: number[];
  /** The pre-registered bar, drawn in the accent. */
  bar?: number;
  caption: string;
}) {
  const [a, b] = domain.map(Math.log);
  const pct = (v: number) => ((Math.log(Math.min(domain[1], Math.max(domain[0], v))) - a) / (b - a)) * 100;
  return (
    <figure className={`fx-forest ${bar ? "fx-forest--bar" : ""}`} data-reveal>
      <div className="fx-forest__over" aria-hidden="true">
        <span />
        <div className="fx-forest__lines">
          <span className="fx-forest__ref" style={{ left: `${pct(1)}%` }}>
            {!bar && <span className="fx-forest__reflabel">1{NB}={NB}no change</span>}
          </span>
          {bar && (
            <span className="fx-forest__bar" style={{ left: `${pct(bar)}%` }}>
              <span className="fx-forest__barlabel">bar {fixed(bar, 1)}</span>
            </span>
          )}
        </div>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.label} className={`fx-forest__row ${r.strong ? "is-strong" : ""}`}>
            <p className="fx-forest__label">
              {r.label}
              {r.sub && <span>{r.sub}</span>}
            </p>
            <div className="fx-forest__plot" aria-hidden="true">
              {/* Phones: the reference lines are drawn per row, so they never cross the labels. */}
              <span className="fx-forest__ref fx-forest__ref--row" style={{ left: `${pct(1)}%` }} />
              {bar && <span className="fx-forest__bar fx-forest__bar--row" style={{ left: `${pct(bar)}%` }} />}
              <span className="fx-forest__ci" style={{ left: `${pct(r.lo)}%`, width: `${pct(r.hi) - pct(r.lo)}%` }} />
              <span className="fx-forest__pt" style={{ left: `${pct(r.or)}%` }} />
            </div>
            <p className="fx-forest__num">
              <span className="sr-only">odds ratio </span>
              {fixed(r.or, 2)}
              <span>
                <span className="sr-only">95{NB}% interval </span>
                {fixed(r.lo, 2)}–{fixed(r.hi, 2)}
              </span>
            </p>
          </li>
        ))}
      </ul>
      <div className="fx-forest__axis" aria-hidden="true">
        <span />
        <div className="fx-forest__ticks">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${pct(t)}%` }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <p className="fx-forest__key" aria-hidden="true">
        Dashed: 1, no change{bar ? `. Red: the pre-registered bar, ${fixed(bar, 1)}` : ""}.
      </p>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

export interface Histogram {
  lo: number;
  hi: number;
  counts: number[];
}

/** Shuffled coefficients as bars in the line colour; the observed one as the cursor line. */
export function PermutationChart({ h, observed, q95, n }: { h: Histogram; observed: number; q95: number; n: number }) {
  const uid = useId().replace(/:/g, "");
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  const H = W < 600 ? 220 : 300;
  const top = 34;
  const base = H - 30;
  const sx = (v: number) => ((v - h.lo) / (h.hi - h.lo)) * W;
  const max = Math.max(...h.counts);
  const sy = (c: number) => base - (c / max) * (base - top);
  const bw = (h.hi - h.lo) / h.counts.length;
  const gap = W < 600 ? 1 : 2;
  const obsRight = sx(observed) < W - 150;
  return (
    <figure className="fx-hist" data-reveal>
      <div ref={ref}>
        {W > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${uid}-t`}>
            <title id={`${uid}-t`}>
              {`Histogram of ${n} shuffled cut-off coefficients between ${num(h.lo, 2)} and ${num(h.hi, 2)}, centred on zero. The observed coefficient, ${num(observed, 3)}, sits inside the central 95 % band of ±${num(q95, 3)}.`}
            </title>
            <defs>
              <pattern id={`${uid}-h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" className="fx-hist__hatch" />
              </pattern>
            </defs>
            {/* Estimated band: the central 95 % of the permutations, hatched. */}
            <rect x={sx(-q95)} y={top - 14} width={sx(q95) - sx(-q95)} height={base - top + 14} fill={`url(#${uid}-h)`} />
            {h.counts.map((c, i) =>
              c > 0 ? (
                <rect
                  key={i}
                  className="fx-hist__bar"
                  x={sx(h.lo + i * bw) + gap / 2}
                  width={Math.max(1, sx(h.lo + (i + 1) * bw) - sx(h.lo + i * bw) - gap)}
                  y={sy(c)}
                  height={base - sy(c)}
                />
              ) : null,
            )}
            <line className="fx-hist__axis" x1={0} x2={W} y1={base} y2={base} />
            {[-0.2, -0.1, 0, 0.1, 0.2].map((t) => (
              <g key={t}>
                <line className="fx-hist__axis" x1={sx(t)} x2={sx(t)} y1={base} y2={base + 5} />
                <text className="fx-hist__num" x={sx(t)} y={base + 20} textAnchor="middle">
                  {t === 0 ? "0" : num(t, 1)}
                </text>
              </g>
            ))}
            <line className="fx-hist__obs" x1={sx(observed)} x2={sx(observed)} y1={6} y2={base + 5} />
            <text className="fx-hist__obslabel" x={sx(observed) + (obsRight ? 10 : -10)} y={16} textAnchor={obsRight ? "start" : "end"}>
              observed {num(observed, 3)}
            </text>
          </svg>
        )}
      </div>
      <figcaption className="fx-hist__legend">
        <span>
          <i style={{ background: "var(--line-strong)" }} />
          {n.toLocaleString("en-US")} shuffles, cut-off coefficient in log-odds per SD
        </span>
        <span>
          <i style={{ backgroundImage: "repeating-linear-gradient(45deg, var(--line-strong) 0 1px, transparent 1px 5px)" }} />
          central 95{NB}% of the shuffles, ±<span className="fx-mono">{num(q95, 3)}</span>
        </span>
      </figcaption>
    </figure>
  );
}

export interface Maker {
  maker: string;
  cells: number;
  mean_offset_m: number;
  sd_offset_m: number;
  share_earliest: number;
}

/** Per-maker rows: the median offset as a tick on a short axis, ±1 sd as a band. */
export function MakerRows({ makers }: { makers: Maker[] }) {
  const rows = [...makers].sort((a, b) => a.mean_offset_m - b.mean_offset_m);
  const ext = 90; // metres either side of the all-makers mean; every ±1 sd band fits
  const pct = (v: number) => ((Math.max(-ext, Math.min(ext, v)) + ext) / (2 * ext)) * 100;
  const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fixed(Math.abs(v), 1)}`;
  return (
    <div data-reveal>
      <div className="fx-makers__scale" aria-hidden="true">
        <span />
        <div>
          <span>−{ext}{NB}m, earlier</span>
          <span>0</span>
          <span>later, +{ext}{NB}m</span>
        </div>
        <span />
      </div>
      <ul className="fx-makers">
        {rows.map((r) => (
          <li key={r.maker}>
            <p className="fx-makers__name">
              {r.maker}
              <span>
                {r.cells} session{NB}×{NB}straight cells
              </span>
            </p>
            <div className="fx-makers__axis" aria-hidden="true">
              <span className="fx-makers__zero" />
              <span
                className="fx-makers__sd"
                style={{ left: `${pct(r.mean_offset_m - r.sd_offset_m)}%`, width: `${pct(r.mean_offset_m + r.sd_offset_m) - pct(r.mean_offset_m - r.sd_offset_m)}%` }}
              />
              <span className="fx-makers__tick" style={{ left: `${pct(r.mean_offset_m)}%` }} />
            </div>
            <p className="fx-makers__nums">
              <b>
                {signed(r.mean_offset_m)}
                {NB}m
              </b>{" "}
              · sd {fixed(r.sd_offset_m, 0)}
              {NB}m · earliest in {Math.round(r.share_earliest * 100)}
              {NB}%
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
