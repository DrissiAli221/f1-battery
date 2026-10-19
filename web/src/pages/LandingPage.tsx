import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import findings from "../content/findings.json";
import notes from "../content/findings-notes.json";
import { Arrow, Eyebrow, Reveal } from "../components/ui";
import { TrackArt } from "../components/TrackArt";
import { url, useList, useRemote } from "../lib/api";
import { date, fixed, int } from "../lib/format";
import { href } from "../lib/router";
import type { Outline, SessionRow } from "../lib/types";

/** Counts up once when scrolled into view (the one number animation on the page). */
function CountUp({ to, digits = 0 }: { to: number; digits?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -60px 0px" });
  const reduce = useReducedMotion();
  const [v, setV] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(0, to, { duration: 1.1, ease: [0.22, 1, 0.36, 1], onUpdate: setV });
    return () => c.stop();
  }, [inView, to, reduce]);
  return <span ref={ref}>{digits ? fixed(v, digits) : int(v)}</span>;
}

export function LandingPage() {
  const sessions = useList<SessionRow>("/sessions");
  const models = useRemote<{ items: { model_version: string; run_id: string }[] }>(url("/models"));
  const withResults = useMemo(() => (sessions.data ?? []).filter((s) => s.has_results), [sessions.data]);
  // Hero art: the latest race with results.
  const latestRace = useMemo(
    () =>
      [...withResults]
        .filter((s) => s.session_name === "Race" && s.circuit_key !== null)
        .sort((a, b) => (b.date_start ?? "").localeCompare(a.date_start ?? ""))[0] ?? null,
    [withResults],
  );
  const outline = useRemote<Outline>(latestRace ? url(`/circuits/${latestRace.circuit_key}/outline`) : null);
  const model = models.data?.items[0];
  const run = findings.runs.point;
  const s = findings.sample;

  return (
    <>
      {/* ---------- Hero: the question ---------- */}
      <section className="relative isolate overflow-hidden border-b border-line-2">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "radial-gradient(70% 60% at 0% 0%, rgba(255,255,255,.04), transparent 60%)" }}
        />
        {outline.data && outline.data.points.length > 1 && (
          <div className="pointer-events-none absolute bottom-[10%] right-0 top-[14%] -z-10 w-full opacity-25 md:right-[2%] md:w-[52%] md:opacity-70">
            <TrackArt outline={outline.data} width={900} height={700} stroke={4} className="h-full w-full" />
          </div>
        )}
        <div className="wrap flex min-h-[calc(100svh-var(--header-h))] flex-col justify-center py-24">
          <div className="flex items-center gap-4">
            <span className="slash h-4" aria-hidden="true">
              <i className="w-8 bg-brand" />
              <i className="w-3 bg-ink-head" />
              <i className="w-1.5 bg-ink-3" />
            </span>
            <span className="label">
              2026 season · {sessions.data ? `${withResults.length} sessions modelled` : "loading"}
              {model ? ` · model ${model.model_version}` : ""}
            </span>
          </div>
          <motion.h1
            className="display mt-8 max-w-[15ch] text-[46px] sm:text-[64px] lg:text-[96px] xl:text-[112px]"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            {notes.question}
          </motion.h1>
          <motion.p
            className="lede mt-10 max-w-[52ch]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            {notes.hidden_fact}
          </motion.p>
          <motion.div
            className="mt-12 flex flex-wrap items-center gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.45 }}
          >
            <button type="button" onClick={() => document.getElementById("verdict")?.scrollIntoView({ behavior: "smooth" })} className="btn btn-primary">
              See the answer <Arrow className="rotate-90" />
            </button>
            <a href={href.sessions()} className="btn btn-secondary">
              Open the explorer
            </a>
          </motion.div>
          {latestRace && (
            <p className="mt-auto pt-16 text-[13px] text-ink-3">
              Track: {latestRace.circuit_short_name}, {date(latestRace.date_start, "short")}
            </p>
          )}
        </div>
      </section>

      {/* ---------- The verdict ---------- */}
      <section id="verdict" className="wrap section scroll-mt-16">
        <Reveal>
          <div className="flex flex-wrap items-center gap-4">
            <span className="badge badge-warn">{findings.verdict}</span>
            <span className="label">Pre-registered test · frozen {date(`${notes.frozen}T00:00:00Z`, "short")}</span>
          </div>
        </Reveal>
        <div className="mt-10 grid gap-12 lg:grid-cols-12 lg:gap-16">
          <Reveal className="lg:col-span-8">
            <p className="text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink-head md:text-[48px]">{notes.verdict_sentence}</p>
            <p className="mt-8 max-w-[60ch] text-[18px] leading-relaxed text-ink-2">
              Odds ratio <span className="num text-ink-head">{fixed(run.or, 2)}</span> per standard deviation earlier cut-off, 95 % interval{" "}
              <span className="num text-ink-head">
                {fixed(run.lo, 2)}–{fixed(run.hi, 2)}
              </span>
              ; permutation <span className="num text-ink-head">p = {fixed(findings.permutation.p_two_sided, 2)}</span>. The pre-registered bar
              was an odds ratio of at least <span className="num text-ink-head">1.3</span> with the interval excluding 1.
            </p>
          </Reveal>
          <Reveal className="lg:col-span-4 lg:pt-3" delay={0.1}>
            <div className="border-l-2 border-brand pl-6">
              <p className="label">Caveat</p>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{notes.caveat}</p>
              <a href={href.findings} className="mt-6 inline-flex items-center gap-2 font-semibold text-ink-head hover:text-brand">
                Read the findings <Arrow />
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- Three stats ---------- */}
      <section className="border-y border-line-2 bg-surface">
        <div className="wrap grid divide-y divide-line-2 md:grid-cols-3 md:divide-x md:divide-y-0">
          <Stat label="Passes tested" sub={`of ${int(s.events_extracted)} clean on-track passes with a visible defender cut-off`}>
            <CountUp to={s.events_tested} />
            <span className="ml-2 text-[28px] text-ink-4 md:text-[36px]">/{int(s.events_extracted)}</span>
          </Stat>
          <Stat label="Odds ratio" sub={`per SD earlier cut-off, 95 % interval ${fixed(run.lo, 2)}–${fixed(run.hi, 2)}`}>
            <CountUp to={run.or} digits={2} />
          </Stat>
          <Stat label="Sessions modelled" sub="races, sprints and qualifying with published estimates">
            {sessions.data ? <CountUp to={withResults.length} /> : "–"}
          </Stat>
        </div>
      </section>

      {/* ---------- Entry points ---------- */}
      <section className="wrap section">
        <Eyebrow>Go deeper</Eyebrow>
        <div className="mt-10 grid gap-4 md:grid-cols-3 md:gap-6">
          <Entry n="01" title="Findings" to={href.findings} text="The frozen test, the permutation control, five spot checks and the limits." />
          <Entry n="02" title="Explorer" to={href.sessions()} text="Every session: cut-offs on the track map, lap by lap, driver against driver." />
          <Entry n="03" title="Method log" to={href.method} text="What was tried, what each check said, and why proxy mode replaced the first estimator." />
        </div>
      </section>
    </>
  );
}

function Stat({ label, sub, children }: { label: string; sub: string; children: ReactNode }) {
  return (
    <div className="px-0 py-14 md:px-10 md:py-20 md:first:pl-0 md:last:pr-0">
      <p className="label">{label}</p>
      <p className="big mt-5 text-[72px] leading-none md:text-[96px]">{children}</p>
      <p className="mt-5 max-w-[34ch] text-[15px] text-ink-3">{sub}</p>
    </div>
  );
}

function Entry({ n, title, text, to }: { n: string; title: string; text: string; to: string }) {
  return (
    <a href={to} className="group relative flex min-h-[260px] flex-col rounded-xs bg-surface p-8 transition-colors hover:bg-[var(--color-surface-btn-other--pressed)] md:p-10">
      <span className="num text-[14px] font-semibold text-brand">{n}</span>
      <span className="mt-auto font-display text-[24px] font-bold uppercase text-ink-head md:text-[28px]">{title}</span>
      <span className="mt-3 max-w-[36ch] text-[15px] leading-relaxed text-ink-3">{text}</span>
      <Arrow className="absolute right-8 top-8 text-ink-3 transition-transform group-hover:translate-x-1 group-hover:text-ink-head md:right-10 md:top-10" />
    </a>
  );
}
