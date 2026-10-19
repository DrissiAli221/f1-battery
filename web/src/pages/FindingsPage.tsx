import { scaleLinear, scaleLog } from "d3-scale";
import findings from "../content/findings.json";
import notes from "../content/findings-notes.json";
import { Eyebrow, Reveal, SectionHead } from "../components/ui";
import { date, fixed, int } from "../lib/format";
import { href } from "../lib/router";
import { useSize } from "../lib/useSize";

const REPO = "https://github.com/DrissiAli221/f1-battery/blob/main/";

interface ForestRow {
  label: string;
  sub?: string;
  or: number;
  lo: number;
  hi: number;
  strong?: boolean;
}

/** Odds ratios with intervals on a log axis, a reference line at 1 and an optional threshold. */
function Forest({ rows, threshold, domain }: { rows: ForestRow[]; threshold?: number; domain: [number, number] }) {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  const narrow = W < 640;
  const labelW = narrow ? 0 : Math.min(340, W * 0.34);
  const rowH = narrow ? 76 : 64;
  const H = rows.length * rowH + 48;
  const x = scaleLog().domain(domain).range([labelW + 12, W - 70]);
  const ticks = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.5, 2, 3].filter((t) => t >= domain[0] && t <= domain[1]);
  return (
    <div ref={ref} className="w-full">
      {W > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Odds ratios with 95 % intervals">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={H - 30} stroke={t === 1 ? "var(--ink-3)" : "var(--line-2)"} strokeWidth={t === 1 ? 1.5 : 1} />
              <text x={x(t)} y={H - 10} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fill="var(--ink-3)">
                {t}
              </text>
            </g>
          ))}
          {threshold && (
            <g>
              <line x1={x(threshold)} x2={x(threshold)} y1={0} y2={H - 30} stroke="var(--brand)" strokeDasharray="4 4" strokeWidth={1.5} />
              <text x={x(threshold) + 6} y={12} fontSize={11} fill="var(--brand)">
                pre-registered bar
              </text>
            </g>
          )}
          {rows.map((r, i) => {
            const cy = i * rowH + (narrow ? 50 : rowH / 2) + 8;
            return (
              <g key={r.label}>
                <text x={0} y={narrow ? cy - 26 : cy - (r.sub ? 4 : -5)} fontSize={narrow ? 14 : 15} fontWeight={r.strong ? 600 : 400} fill={r.strong ? "var(--ink-head)" : "var(--ink-2)"}>
                  {r.label}
                </text>
                {r.sub && !narrow && (
                  <text x={0} y={cy + 15} fontSize={12} fill="var(--ink-3)">
                    {r.sub}
                  </text>
                )}
                <line x1={x(Math.max(domain[0], r.lo))} x2={x(Math.min(domain[1], r.hi))} y1={cy} y2={cy} stroke={r.strong ? "var(--ink-head)" : "var(--ink-3)"} strokeWidth={2.5} strokeLinecap="round" />
                <rect x={x(r.or) - 6} y={cy - 6} width={12} height={12} transform={`rotate(45 ${x(r.or)} ${cy})`} fill={r.strong ? "var(--ink-head)" : "var(--ink-2)"} />
                <text x={W - 64} y={cy + 4} fontFamily="var(--font-mono)" fontSize={13} fill="var(--ink-head)">
                  {fixed(r.or, 2)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function PermutationHistogram() {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  const h = findings.permutation.histogram;
  const H = 300;
  const M = { l: 12, r: 12, t: 28, b: 40 };
  const n = h.counts.length;
  const x = scaleLinear().domain([h.lo, h.hi]).range([M.l, W - M.r]);
  const y = scaleLinear().domain([0, Math.max(...h.counts)]).range([H - M.b, M.t]);
  const bw = (h.hi - h.lo) / n;
  const obs = findings.permutation.observed;
  const q = findings.permutation.q95_abs;
  return (
    <div ref={ref} className="w-full">
      {W > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Distribution of the permuted coefficients with the observed value">
          <rect x={x(-q)} y={M.t} width={x(q) - x(-q)} height={H - M.b - M.t} fill="white" opacity={0.03} />
          {h.counts.map((c, i) => (
            <rect key={i} x={x(h.lo + i * bw) + 1} width={Math.max(1, x(h.lo + (i + 1) * bw) - x(h.lo + i * bw) - 2)} y={y(c)} height={H - M.b - y(c)} fill="var(--ink-4)" />
          ))}
          <line x1={x(obs)} x2={x(obs)} y1={M.t - 8} y2={H - M.b} stroke="var(--brand)" strokeWidth={2.5} />
          <text x={x(obs) + 8} y={M.t} fontSize={12} fill="var(--ink-head)">
            observed {fixed(obs, 3)}
          </text>
          <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} stroke="var(--line)" />
          {[-0.2, -0.1, 0, 0.1, 0.2].filter((t) => t > h.lo && t < h.hi).map((t) => (
            <text key={t} x={x(t)} y={H - M.b + 20} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fill="var(--ink-3)">
              {t}
            </text>
          ))}
          <text x={W - M.r} y={H - 4} textAnchor="end" fontSize={11} fill="var(--ink-4)">
            cut-off coefficient, log-odds per SD · shaded: central 95 % of permutations
          </text>
        </svg>
      )}
    </div>
  );
}

function MakerBars() {
  const rows = [...findings.makers].sort((a, b) => a.mean_offset_m - b.mean_offset_m);
  const ext = Math.max(...rows.map((r) => Math.abs(r.mean_offset_m) + r.sd_offset_m)) * 1.05;
  const pos = (v: number) => ((v + ext) / (2 * ext)) * 100;
  return (
    <div className="divide-y divide-line-2 rounded-xs bg-surface">
      {rows.map((r) => (
        <div key={r.maker} className="grid items-center gap-4 px-6 py-6 md:grid-cols-[200px_1fr_300px] md:px-8">
          <div>
            <p className="font-display text-[15px] font-bold uppercase text-ink-head">{r.maker}</p>
            <p className="text-[13px] text-ink-3">{r.cells} session × straight cells</p>
          </div>
          <div className="relative h-8" aria-hidden="true">
            <span className="absolute inset-y-0 left-1/2 w-px bg-ink-3" />
            <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" style={{ left: `${pos(r.mean_offset_m - r.sd_offset_m)}%`, width: `${pos(r.mean_offset_m + r.sd_offset_m) - pos(r.mean_offset_m - r.sd_offset_m)}%` }} />
            <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-head" style={{ left: `${pos(r.mean_offset_m)}%` }} />
          </div>
          <p className="num text-[15px] text-ink-2 md:text-right">
            <span className="text-ink-head">{r.mean_offset_m > 0 ? "+" : r.mean_offset_m < 0 ? "−" : ""}{fixed(Math.abs(r.mean_offset_m), 1)} m</span> · sd {fixed(r.sd_offset_m, 0)} · earliest {Math.round(r.share_earliest * 100)} %
          </p>
        </div>
      ))}
      <p className="px-6 py-4 text-[13px] text-ink-3 md:px-8">
        Offset: the maker's median cut-off minus the mean of all makers' medians in the same session and straight (race sessions). Earlier is left. Bar: ±1 sd across cells.
      </p>
    </div>
  );
}

export function FindingsPage() {
  const s = findings.sample;
  const runs = findings.runs;
  const termName = notes.terms as Record<string, string>;
  // The cut-off term is reported in the frozen direction (earlier cut-off) in the runs block; the
  // full-model table keeps the fitted direction (later cut-off), so it is labelled as such.
  const terms = findings.terms.map((t) => ({
    label: termName[t.term] ?? t.term,
    sub: `${t.unit}${t.term === "cutoff_dev_defender" ? ", later cut-off" : ""} · p ${t.p < 0.001 ? "< 0.001" : `= ${fixed(t.p, 3)}`}`,
    or: t.or,
    lo: t.lo,
    hi: t.hi,
    strong: t.p < 0.05,
  }));

  return (
    <>
      <section className="wrap pb-20 pt-16 md:pb-28 md:pt-24">
        <Eyebrow>Findings · {findings.source.model_version}</Eyebrow>
        <h1 className="display mt-8 max-w-[18ch] text-[44px] md:text-[80px]">{notes.question}</h1>
        <div className="mt-12 flex flex-wrap items-center gap-4">
          <span className="badge badge-warn">{findings.verdict}</span>
          <span className="label">Pre-registered, frozen {date(`${notes.frozen}T00:00:00Z`, "short")}</span>
        </div>
        <p className="mt-8 max-w-[44ch] text-[24px] font-semibold leading-snug tracking-[-0.02em] text-ink-head md:text-[34px]">{notes.verdict_sentence}</p>
        <p className="mt-6 max-w-[64ch] text-[16px] leading-relaxed text-ink-3">{notes.caveat}</p>
      </section>

      <section className="border-y border-line-2 bg-surface">
        <div className="wrap grid grid-cols-2 divide-line-2 md:grid-cols-4 md:divide-x">
          {[
            ["Passes extracted", int(s.events_extracted)],
            ["Passes tested", int(s.events_tested)],
            ["Close-following non-passes", int(s.non_events_tested)],
            ["Sessions in the model", int(s.sessions_in_model)],
          ].map(([l, v]) => (
            <div key={l} className="py-12 md:px-8 md:py-16 md:first:pl-0">
              <p className="label">{l}</p>
              <p className="big mt-4 text-[48px] leading-none md:text-[72px]">{v}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap section">
        <SectionHead eyebrow="The frozen test" title="Three runs, none near the bar">
          Logistic regression of being passed on the defender's cut-off deviation on the approach straight, with pace, tyre age, lap,
          Overtake availability and a session effect. The median cut-off is known only to its bootstrap interval, so the test runs three
          times: at the point estimate and at both interval edges. Odds ratio per 1 SD earlier cut-off.
        </SectionHead>
        <Reveal>
          <Forest
            domain={[0.6, 1.6]}
            threshold={1.3}
            rows={[
              { label: "Point estimate", sub: "deviation from the median", ...runs.point, strong: true },
              { label: "Lower interval edge", sub: "deviation from ci_high", ...runs.lower_edge },
              { label: "Upper interval edge", sub: "deviation from ci_low", ...runs.upper_edge },
            ]}
          />
        </Reveal>
        <p className="mt-8 max-w-[70ch] text-[15px] leading-relaxed text-ink-3">
          All three sit below 1: an earlier cut-off goes with slightly lower odds of being passed, the opposite of the hypothesis, and
          two of the three intervals include 1. The energy terms together add nothing detectable beyond the controls (likelihood ratio χ²{" "}
          <span className="num">{fixed(findings.energy_terms_lr.chi2, 2)}</span>, {findings.energy_terms_lr.df} df, p ={" "}
          <span className="num">{fixed(findings.energy_terms_lr.p, 2)}</span>).
        </p>
      </section>

      <section className="border-y border-line-2 bg-surface/40">
        <div className="wrap section">
          <SectionHead eyebrow="What did predict passes" title="Pace, not energy">
            The full model at the point estimate. Bold terms have p below 0.05. An odds ratio below 1 for pace delta means a faster attacker
            makes a pass more likely.
          </SectionHead>
          <Reveal>
            <Forest domain={[0.5, 3.5]} rows={terms} />
          </Reveal>
        </div>
      </section>

      <section className="wrap section">
        <div className="grid gap-16 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHead full eyebrow="Permutation control" title="Indistinguishable from shuffled data">
              The three energy variables were shuffled within each session {int(findings.permutation.n)} times and the model refitted. The
              observed coefficient is less extreme than {fixed(findings.permutation.pct_abs, 1)} % of the shuffled ones; the frozen
              requirement was more than 95 %. Two-sided p = {fixed(findings.permutation.p_two_sided, 2)}.
            </SectionHead>
          </div>
          <Reveal className="lg:col-span-7 lg:pt-24">
            <PermutationHistogram />
          </Reveal>
        </div>
      </section>

      <section className="border-y border-line-2 bg-surface/40">
        <div className="wrap section">
          <SectionHead eyebrow="Spot checks" title="Five moments, checked against the estimator">
            Fixed before any model output existed (docs/spot-checks.md). Three fail, one passes, one cannot be tested. Expected signs were not
            changed after the fact.
          </SectionHead>
          <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {notes.spot_checks.map((c) => (
              <li key={c.n} className="flex flex-col rounded-xs bg-surface p-8">
                <div className="flex items-center justify-between">
                  <span className="num text-[14px] text-ink-3">#{c.n}</span>
                  <span className={`badge ${c.result === "pass" ? "badge-ok" : c.result === "fail" ? "badge-pink" : "badge-muted"}`}>{c.result}</span>
                </div>
                <p className="mt-6 text-[19px] font-semibold leading-snug text-ink-head">{c.moment}</p>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-3">{c.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="wrap section">
        <SectionHead eyebrow="Power-unit makers" title="Where each maker cuts, on average">
          Not part of the frozen test. Per race session and straight, each maker's median cut-off against the average of all makers. Cut-off
          position also depends on drag and mass assumptions that cannot be separated here, so a difference is not a difference in energy
          capacity.
        </SectionHead>
        <Reveal>
          <MakerBars />
        </Reveal>
      </section>

      <section className="border-t border-line-2 bg-surface/40">
        <div className="wrap section">
          <SectionHead eyebrow="Limits" title="What this cannot say" />
          <dl className="grid gap-x-16 gap-y-12 md:grid-cols-2 xl:grid-cols-3">
            {notes.limits.map(([t, d]) => (
              <div key={t} className="border-t-2 border-line pt-6">
                <dt className="text-[18px] font-semibold text-ink-head">{t}</dt>
                <dd className="mt-3 text-[15px] leading-relaxed text-ink-3">{d}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-20 max-w-[70ch] text-[14px] leading-relaxed text-ink-3">
            Numbers on this page are generated from the output of{" "}
            <a className="prose-link" href={REPO + findings.source.script} target="_blank" rel="noreferrer">
              {findings.source.script}
            </a>{" "}
            for run <span className="num">{findings.source.run_id.slice(0, 8)}</span>. Full write-up:{" "}
            <a className="prose-link" href={REPO + "docs/findings.md"} target="_blank" rel="noreferrer">
              docs/findings.md
            </a>
            . How the method got here: <a className="prose-link" href={href.method}>method log</a>.
          </p>
        </div>
      </section>
    </>
  );
}
