import { pageUrl } from '../lib/routes';
import { Info } from './info-tip';
import './reveal';
import { PageGround, SiteFooter, SiteHeader } from './chrome';
import { useInitialAnchor } from './preview-navigation';
import { useRateLimited } from '../lib/api';
import { useEffect, useMemo, useRef, useState, useId, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Driver } from '../lib/types';
import { useSessionData, useCutoffs } from './preview-data';
import { TrackMap, type MapTag } from './session-track';
import { circuitMeta, useCircuit } from '../track/circuits';
import { SessionChart as CutoffChart } from './session-chart';
import { along } from '../lib/track';
import { teamLogo, teamCar, driverName } from '../lib/teams';
import { createPixelButton } from './hover.js';
import { paintScreen } from './session-halftone';
import { SessionSelect, type SelectItem } from './session-select';
import { cssPx } from './css-tokens';
import sessionNotes from '../content/session-notes.json';
import './session.css';
import './refinement.css';

gsap.registerPlugin(ScrollTrigger);
const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const fmt = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : nf.format(v);
const query = new URLSearchParams(location.search);
const sessionKey = Number(query.get('session')) || 11361;
/** The one place the page's selection is written to the URL. */
const selectionUrl = (driver: number, compare: number | null, straight: number | null) => {
  const q = new URLSearchParams({ driver: String(driver) });
  if (straight !== null) q.set('straight', String(straight));
  q.set('compare', compare === null ? '0' : String(compare));
  q.set('session', String(sessionKey));
  return `${location.pathname}?${q}${location.hash}`;
};
function Logo({
  team,
  variant = 'white',
  keepSlot = false,
}: {
  team: string | null;
  variant?: 'white' | 'black';
  keepSlot?: boolean;
}) {
  const src = teamLogo(team, variant);
  return src ? (
    <img
      className="team-logo"
      src={src}
      alt=""
      width="28"
      height="28"
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden';
      }}
    />
  ) : keepSlot ? (
    <span className="team-logo" aria-hidden="true" />
  ) : null;
}
// True only after `flag` has stayed set for `ms`, so fast loads never flicker.
function useDelayed(flag: boolean, ms = 150) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!flag) {
      setOn(false);
      return;
    }
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return flag && on;
}
function Rule({ on }: { on: boolean }) {
  return <div className={`skel-rule rule-slot ${on ? '' : 'is-idle'}`} aria-hidden="true" />;
}
function Flow({ value }: { value: number | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    const changed = previous.current !== null && previous.current !== value;
    previous.current = value;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    if (
      changed &&
      value !== null &&
      document.documentElement.dataset.input !== 'keyboard' &&
      !matchMedia('(prefers-reduced-motion:reduce)').matches
    )
      el.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 160, easing: 'cubic-bezier(.23,1,.32,1)' });
  }, [value]);
  return (
    <span
      ref={ref}
      className={`estimate-value ${value === null ? 'flow-missing' : ''}`}
      aria-label={value === null ? 'No estimate' : fmt(value)}
    >
      {[...fmt(value)].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="digit">
            {ch}
          </span>
        ) : (
          ch
        )
      )}
    </span>
  );
}
function HelpDot() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popId = useId();
  useEffect(() => {
    if (!open) return;
    pop.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btn.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);
  return (
    <div className="help-wrap" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className="help-dot"
        aria-label="How to read this"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      <div
        ref={pop}
        id={popId}
        className="help-pop"
        role="dialog"
        aria-label="How to read this"
        tabIndex={-1}
        data-open={open ? 'true' : 'false'}
        aria-hidden={!open}
      >
        <ol>
          <li>Pick a driver and a straight above.</li>
          <li>The tag on the track marks where the estimate says electrical deployment ends.</li>
          <li>The card shows the session median and the 95% interval in metres into the straight.</li>
          <li>Lap by lap shows every lap's estimate; pick one to compare.</li>
        </ol>
        <a href="#method" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>
          Reading guide <span aria-hidden="true">↓</span>
        </a>
      </div>
    </div>
  );
}
type LapEstimate = { lap: number; m: number };
function LapDistribution({
  samples,
  value,
  lo,
  hi,
  domain,
  selectedLap,
}: {
  samples: LapEstimate[] | null;
  value: number | null;
  lo: number | null;
  hi: number | null;
  domain: [number, number];
  selectedLap: number | null;
}) {
  const id = `lap-band-${useId().replace(/:/g, '')}`;
  const x = (m: number) => 8 + Math.max(0, Math.min(1, (m - domain[0]) / (domain[1] - domain[0]))) * 264;
  // Vertical stacking only prevents overlapping dots; the x coordinate is the actual estimate.
  const lanes: number[][] = Array.from({ length: 7 }, () => []);
  const points = [...(samples ?? [])]
    .sort((a, b) => a.m - b.m)
    .map((s) => {
      const px = x(s.m);
      let lane = lanes.findIndex((xs) => xs.every((other) => Math.abs(px - other) > 4.5));
      if (lane < 0) lane = lanes.reduce((best, row, i) => (row.length < lanes[best].length ? i : best), 0);
      lanes[lane].push(px);
      return { ...s, x: px, y: [22, 16, 28, 10, 34, 4, 40][lane] };
    });
  return (
    <div className="lap-distribution">
      <div className="distribution-caption">
        <span>
          {samples === null ? 'Loading lap estimates' : `${samples.length} lap estimates`}
          <Info label="the lap estimates">
            One point per clean lap, placed by metres into the straight. Together they show how far the laps
            spread around the median.
          </Info>
        </span>
        <span>Metres into straight</span>
      </div>
      <svg
        viewBox="0 0 280 60"
        role="img"
        aria-label={`${samples?.length ?? 0} lap estimates${value !== null ? `, selected cut-off ${fmt(value)} metres` : ''}${lo !== null && hi !== null ? `, 95 percent interval ${fmt(lo)} to ${fmt(hi)} metres` : ''}. Each dot represents one lap.`}
      >
        <defs>
          <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="1" opacity=".35" />
          </pattern>
        </defs>
        {lo !== null && hi !== null && (
          <rect x={x(lo)} y="1" width={Math.max(1, x(hi) - x(lo))} height="42" fill={`url(#${id})`} />
        )}
        <line x1="8" y1="44" x2="272" y2="44" className="distribution-baseline" />
        {points.map((p) => (
          <circle
            key={p.lap}
            data-lap={p.lap}
            cx={p.x}
            cy={p.y}
            r={p.lap === selectedLap ? 3 : 1.8}
            className={p.lap === selectedLap ? 'distribution-dot is-selected' : 'distribution-dot'}
          />
        ))}
        {value !== null && (
          <line x1={x(value)} x2={x(value)} y1="0" y2="44" className="distribution-marker" />
        )}
        <text x="8" y="58">
          {fmt(domain[0])} m
        </text>
        <text x="272" y="58" textAnchor="end">
          {fmt(domain[1])} m
        </text>
      </svg>
      {samples?.length === 0 && <p className="distribution-empty">No lap estimates on this straight.</p>}
    </div>
  );
}
function DriverEstimate({
  d,
  value,
  lo,
  hi,
  samples,
  domain,
  lap,
  other,
  busy = false,
}: {
  d: Driver;
  value: number | null;
  lo: number | null;
  hi: number | null;
  samples: LapEstimate[] | null;
  domain: [number, number];
  lap: number | null;
  other: boolean;
  busy?: boolean;
}) {
  const surname = d.last_name ?? d.full_name?.split(' ').slice(-1)[0] ?? d.name_acronym ?? '';
  const first = d.first_name ?? d.full_name?.split(' ').slice(0, -1).join(' ') ?? '';
  const colour = d.team_colour ?? '#73736b';
  const car = teamCar(d.team_name, 262);
  const span = domain[1] - domain[0];
  const at = (v: number) => Math.min(100, Math.max(0, ((v - domain[0]) / (span || 1)) * 100));
  const ranged =
    lap === null && value !== null && lo !== null && hi !== null && [value, lo, hi].every(Number.isFinite);
  const rgb = colour
    .replace('#', '')
    .match(/.{2}/g)
    ?.map((v) => parseInt(v, 16)) ?? [115, 115, 107];
  const linear = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const ink = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722 > 0.179 ? '#101010' : '#fff';
  return (
    <article
      className={`driver-estimate driver-poster ${other ? 'compare-estimate' : ''}`}
      style={{ '--team': colour, '--poster-ink': ink } as CSSProperties}
      aria-label={`${d.full_name}, estimated cut-off`}
    >
      <div className="driver-poster-art">
        <span className="poster-screen" aria-hidden="true" />
        <span className="poster-number" aria-hidden="true">
          {d.driver_number}
        </span>
        <div className="poster-team">
          <Logo team={d.team_name} variant={ink === '#101010' ? 'black' : 'white'} />
          <span>{d.team_name}</span>
        </div>
        <div className="poster-name">
          <span>{first}</span>
          <h3 style={{ '--surname-length': Math.max(1, surname.length) } as CSSProperties}>{surname}</h3>
        </div>
        {car && (
          <img
            className="poster-car"
            key={car}
            src={car}
            decoding="async"
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
      </div>
      <div className={`driver-poster-data ${busy ? 'is-loading' : ''}`} aria-busy={busy || undefined}>
        <div className="poster-readout">
          <p className="estimate-label">
            <Info term={lap !== null ? `Lap ${lap} cut-off` : 'Median cut-off'} label="the cut-off">
              {lap !== null
                ? 'The estimated point on this straight where electrical deployment ends on the selected lap, in metres from its start. An estimate from public telemetry, not a battery reading.'
                : 'The session median of where the model estimates electrical deployment ends on this straight, in metres from its start. An estimate from public telemetry, not a battery reading.'}
            </Info>
          </p>
          <p className="estimate-number">
            <Flow value={value} />
            {value !== null && <span className="estimate-unit">m est.</span>}
          </p>
        </div>
        {ranged ? (
          <div className="rng" aria-label={`95% interval ${fmt(lo)} to ${fmt(hi)} metres`}>
            <p className="rng-cap">
              <Info term="95% interval" label="the 95% interval">
                The range the cut-off falls in across laps, from a 95% bootstrap interval. A wide band means
                the laps disagree.
              </Info>
            </p>
            <div className="rng-track">
              <i
                style={{
                  left: `${at(lo)}%`,
                  width: `${Math.min(100 - at(lo), Math.max(0.5, at(hi) - at(lo)))}%`,
                }}
              />
              <b style={{ left: `${at(value)}%` }} />
            </div>
            <div className="rng-lab">
              <span>{fmt(lo)}</span>
              <span>{fmt(hi)}</span>
            </div>
          </div>
        ) : (
          <div className="rng rng-text">
            <span>{lap !== null ? 'Estimate' : value === null ? 'Session median' : '95% interval'}</span>
            <strong>
              {value === null ? 'Unavailable' : lap !== null ? 'Single lap' : `${fmt(lo)}–${fmt(hi)} m`}
            </strong>
          </div>
        )}
        <LapDistribution samples={samples} value={value} lo={lo} hi={hi} domain={domain} selectedLap={lap} />
      </div>
    </article>
  );
}
function App() {
  const limited = useRateLimited();
  const initialStraight = useRef(false);
  const data = useSessionData(sessionKey);
  useInitialAnchor(
    data.ready || !!data.sessionsError || !!data.loadError || (data.sessionsLoaded && !data.session)
  );
  const circuit = useCircuit(data.session?.circuit_key);
  const meta = circuitMeta(data.session?.circuit_key);
  const place = data.session?.circuit_short_name ?? 'Session';
  useEffect(() => {
    const s = data.session;
    document.title = s
      ? `${meta?.meeting_name ?? s.circuit_short_name ?? place} ${s.session_name ?? ''}`
          .trim()
          .replace(/ (Race|Sprint|Qualifying)$/, (m) => m.toLowerCase()) + ' / F1 Battery'
      : 'Session / F1 Battery';
  }, [data.session, meta, place]);
  const [driver, setDriver] = useState(Number(query.get('driver')) || 1);
  const [compare, setCompare] = useState<number | null>(
    query.has('compare') ? Number(query.get('compare')) || null : 3
  );
  const [sid, setSid] = useState(Number(query.get('straight')) || 2);
  // The URL only carries a straight the visitor chose or arrived with; the coverage default stays implicit.
  const [pickedStraight, setPickedStraight] = useState(query.has('straight'));
  const [lap, setLap] = useState<number | null>(null);
  const [compactMap, setCompactMap] = useState(() => matchMedia('(max-width:720px)').matches);
  useEffect(() => {
    const mq = matchMedia('(max-width:720px)');
    const update = () => setCompactMap(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const [wideStage, setWideStage] = useState(() => matchMedia('(min-width:1000px)').matches);
  useEffect(() => {
    const mq = matchMedia('(min-width:1000px)');
    const update = () => setWideStage(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const [activeNav, setActiveNav] = useState('track');
  const tower = useRef<HTMLDivElement>(null);
  const revealDriver = (n: number) => {
    const box = tower.current;
    const row = box?.querySelector<HTMLButtonElement>(`[data-driver="${n}"]`);
    if (box && row) {
      box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
      row.focus({ preventScroll: true });
    }
  };
  const hero = useRef<HTMLElement>(null);
  const background = useRef<HTMLCanvasElement>(null);
  const main = useRef<HTMLElement>(null);
  const footer = useRef<HTMLElement>(null);
  const pCutRequest = useCutoffs(sessionKey, driver, !!data.session?.has_results);
  const cCutRequest = useCutoffs(sessionKey, compare, !!data.session?.has_results);
  const pCut = pCutRequest.data;
  const cCut = cCutRequest.data;
  const pBusy = useDelayed(pCutRequest.loading);
  const cBusy = useDelayed(compare !== null && cCutRequest.loading);
  const straight = data.straights.find((s) => s.straight_id === sid) ?? data.straights[0];
  const picked = data.drivers.find((d) => d.driver_number === driver);
  const compared = data.drivers.find((d) => d.driver_number === compare);
  const primaryMedian = data.medians.get(driver)?.get(straight?.straight_id);
  const compareMedian = compare !== null ? data.medians.get(compare)?.get(straight?.straight_id) : undefined;
  const relative = (v: number | null | undefined) =>
    v === null || v === undefined || !straight || !data.lap
      ? null
      : Math.max(0, along(straight, v, data.lap));
  const pDistance = lap !== null ? pCut?.get(lap)?.get(sid) : primaryMedian?.m;
  const cDistance = lap !== null ? cCut?.get(lap)?.get(sid) : compareMedian?.m;
  const pValue = relative(pDistance);
  const cValue = relative(cDistance);
  const lapSamples = (cut: typeof pCut): LapEstimate[] | null =>
    cut === null
      ? null
      : [...cut].flatMap(([n, byStraight]) => {
          const m = relative(byStraight.get(sid));
          return m === null ? [] : [{ lap: n, m }];
        });
  const primarySamples = lapSamples(pCut);
  const comparisonSamples = lapSamples(cCut);
  const positions = [...(primarySamples ?? []), ...(compare !== null ? (comparisonSamples ?? []) : [])].map(
    (s) => s.m
  );
  for (const md of [primaryMedian, compareMedian])
    for (const v of [md?.lo, md?.hi]) {
      const m = relative(v);
      if (m !== null) positions.push(m);
    }
  const bound = straight?.len ?? 1;
  const span = positions.length ? Math.max(...positions) - Math.min(...positions) : bound;
  const pad = Math.max(15, span * 0.12);
  const domain: [number, number] = positions.length
    ? [
        Math.max(0, Math.floor((Math.min(...positions) - pad) / 10) * 10),
        Math.min(bound, Math.ceil((Math.max(...positions) + pad) / 10) * 10),
      ]
    : [0, bound];
  if (domain[1] <= domain[0]) domain[1] = domain[0] + 1;
  const noEstimates = pDistance == null && cDistance == null;
  const straightsWithData = new Set(
    data.straights
      .filter(
        (s) =>
          data.medians.get(driver)?.has(s.straight_id) ||
          (compare !== null && data.medians.get(compare)?.has(s.straight_id))
      )
      .map((s) => s.straight_id)
  );
  /** Drivers with a published cut-off on each straight, from the session summary. */
  const driversPerStraight = useMemo(() => {
    const out = new Map<number, number>();
    for (const m of data.medians.values()) for (const id of m.keys()) out.set(id, (out.get(id) ?? 0) + 1);
    return out;
  }, [data.medians]);
  const coveredStraights = data.straights.filter((s) => driversPerStraight.has(s.straight_id)).length;
  const selectedCoverage = driversPerStraight.get(sid) ?? 0;
  const coverageLow =
    data.ready &&
    !data.summaryError &&
    data.straights.length > 0 &&
    (coveredStraights * 2 < data.straights.length || selectedCoverage < 12);
  const coverageNote = coverageLow
    ? ((sessionNotes as Record<string, string>)[String(sessionKey)] ??
      `Few estimates here: most straights on this circuit are too short for the 250 km/h cut-off rule, so only ${coveredStraights} of ${data.straights.length} straights carry results.`)
    : null;
  const pool = useMemo(
    () =>
      [...(data.withResults.length ? data.withResults : data.drivers)].sort((a, b) =>
        (a.name_acronym ?? '').localeCompare(b.name_acronym ?? '')
      ),
    [data.withResults, data.drivers]
  );
  const laps = data.laps.get(driver) ?? [];
  const tags: MapTag[] = [];
  for (const [d, position] of [
    [picked, pDistance],
    [compared, cDistance],
  ] as const) {
    if (d && position !== null && position !== undefined && data.lap) {
      tags.push({
        id: d.driver_number,
        code: d.name_acronym ?? String(d.driver_number),
        colour: d.team_colour ?? '#f4f4ef',
        d: position,
        on: d.driver_number === driver,
        note: `${fmt(relative(position))} m`,
      });
    }
  }
  useEffect(() => {
    history.replaceState(null, '', selectionUrl(driver, compare, pickedStraight ? sid : null));
  }, [driver, compare, sid, pickedStraight]);
  useEffect(() => {
    if (!data.ready) return;
    if (pool.length && !pool.some((d) => d.driver_number === driver)) setDriver(pool[0].driver_number);
    if (compare !== null && (compare === driver || !pool.some((d) => d.driver_number === compare)))
      setCompare(null);
    if (data.straights.length && !data.straights.some((s) => s.straight_id === sid))
      setSid(data.straights[0].straight_id);
  }, [data.ready, pool, driver, compare, data.straights, sid]);
  // Open a newly chosen session on a straight with data; explicit deep links keep their selection.
  useEffect(() => {
    if (initialStraight.current || !data.ready || !data.straights.length) return;
    initialStraight.current = true;
    if (!query.has('straight')) {
      let best: number | null = null;
      let most = 0;
      for (const s of data.straights) {
        const n = driversPerStraight.get(s.straight_id) ?? 0;
        if (n > most) {
          most = n;
          best = s.straight_id;
        }
      }
      if (best !== null) setSid(best);
    }
  }, [data.ready, data.straights, driversPerStraight]);
  useEffect(() => {
    document
      .querySelectorAll<HTMLAnchorElement>('.session-preview a.button-light, .session-preview a.button-grey')
      .forEach((el) => createPixelButton(el));
  }, [data.ready]);
  useEffect(() => {
    const canvas = background.current;
    if (!canvas) return;
    const draw = () => paintScreen(canvas);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!data.ready) return;
    const media = gsap.matchMedia();
    media.add('(min-width:1000px) and (prefers-reduced-motion:no-preference)', () => {
      const ctx = gsap.context(() => {
        if (background.current && hero.current)
          gsap.to(background.current, {
            y: 32,
            ease: 'none',
            scrollTrigger: { trigger: hero.current, start: 'top top', end: 'bottom top', scrub: true },
          });
        if (footer.current && main.current)
          gsap.fromTo(
            footer.current.querySelector('.footer-inner'),
            { y: 32 },
            {
              y: 0,
              ease: 'none',
              scrollTrigger: {
                trigger: main.current,
                start: 'bottom bottom',
                end: () => `+=${footer.current!.offsetHeight}`,
                scrub: true,
                invalidateOnRefresh: true,
              },
            }
          );
      });
      return () => ctx.revert();
    });
    document.fonts.ready.then(() => ScrollTrigger.refresh());
    return () => media.revert();
  }, [data.ready]);
  useEffect(() => {
    if (!data.ready) return;
    let pending = false;
    // A section is current once its top passes this line: the pinned header plus a 116px reading gap (180 on desktop).
    const line = cssPx('--sticky-stack', 64) + 116;
    const check = () => {
      pending = false;
      let active = 'track';
      for (const id of ['track', 'lap-chart', 'method'])
        if ((document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) < line) active = id;
      setActiveNav(active);
    };
    const onScroll = () => {
      if (!pending) {
        pending = true;
        requestAnimationFrame(check);
      }
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [data.ready]);
  const selectDriver = (n: number) => {
    setDriver(n);
    if (n === compare) setCompare(null);
    setLap(null);
  };
  const selectStraight = (n: number) => {
    setPickedStraight(true);
    setSid(n);
    setLap(null);
  };
  const driverOption = (d: (typeof pool)[number]): SelectItem => ({
    value: String(d.driver_number),
    name: d.full_name ?? d.name_acronym ?? String(d.driver_number),
    code: d.name_acronym ?? undefined,
    team: d.team_name,
    detail: d.team_name ?? undefined,
    colour: d.team_colour,
  });
  const details = [
    { d: picked, md: primaryMedian, value: pValue, other: false },
    { d: compared, md: compareMedian, value: cValue, other: true },
  ];
  return (
    <div className="session-preview">
      <a className="skip" href="#track">
        Skip to track
      </a>
      <SiteHeader
        current="races"
        replayHref={pageUrl('replay', { session: sessionKey, driver })}
        navId="session-nav-links"
      />
      <PageGround>
        <main ref={main} className="session-main">
          <section ref={hero} className="hero-band" aria-labelledby="race-title">
            <div className="race-hero wrap">
              <div className="race-halftone" aria-hidden="true">
                <canvas ref={background} data-screen="hero" />
              </div>
              <div>
                <h1
                  id="race-title"
                  style={
                    place.length > 6
                      ? {
                          fontSize: `clamp(25px,calc((100vw - 2 * var(--gutter)) / ${place.length + 1} * 1.05),122px)`,
                        }
                      : undefined
                  }
                >
                  {place}.
                </h1>
                {(() => {
                  const mn = meta?.meeting_name;
                  const alt = [meta?.country, meta?.name ?? place].filter(Boolean).join(' / ');
                  const v =
                    mn && mn.toLowerCase() !== place.toLowerCase()
                      ? mn
                      : alt.toLowerCase() !== place.toLowerCase()
                        ? alt
                        : (meta?.country ?? '');
                  return v && v.toLowerCase() !== place.toLowerCase() ? (
                    <p className="race-venue">{v}</p>
                  ) : null;
                })()}
              </div>
              {data.session && (
                <p className="race-date">
                  {data.session?.session_name}
                  <span aria-hidden="true"> / </span>
                  <time dateTime={data.session?.date_start ?? undefined}>
                    {data.session?.date_start
                      ? new Intl.DateTimeFormat('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          timeZone: 'UTC',
                        }).format(new Date(data.session.date_start))
                      : ''}
                  </time>
                </p>
              )}
            </div>
          </section>
          {data.ready && (
            <nav className="section-rail" aria-label="Session sections">
              <div className="wrap page-sections session-sections">
                <div>
                  {[
                    ['track', 'Track'],
                    ['lap-chart', 'Laps'],
                    ['method', 'Reading guide'],
                  ].map(([id, label]) => (
                    <a key={id} href={`#${id}`} aria-current={activeNav === id ? 'location' : undefined}>
                      {label}
                    </a>
                  ))}
                </div>
                <a href={pageUrl('replay', { session: sessionKey, driver, mode: 'review' })}>
                  Review a lap <span aria-hidden="true">↗</span>
                </a>
              </div>
            </nav>
          )}
          {data.sessionsLoaded && !data.session ? (
            <section role="alert">
              <div className="wrap load-state">
                <h2>Session not found.</h2>
                <p>This recorded session is not in the archive. Choose another race to continue.</p>
                <a className="button button-secondary" href={`${pageUrl('home')}#races`}>
                  Choose a race <span aria-hidden="true">↗</span>
                </a>
              </div>
            </section>
          ) : data.sessionsError || data.loadError ? (
            <section role="alert">
              <div className="wrap load-state">
                <h2>Session couldn’t be loaded.</h2>
                <p>The recorded data is unavailable right now. Retry, or choose another race.</p>
                <div className="recovery-actions">
                  <button className="button button-secondary" onClick={() => location.reload()}>
                    Try again
                  </button>
                  <a className="inline-link" href={`${pageUrl('home')}#races`}>
                    Choose another race ↗
                  </a>
                </div>
              </div>
            </section>
          ) : !data.ready ? (
            <>
              <section
                id="track"
                aria-label={`${place} track and selected estimates, loading`}
                aria-busy="true"
                className="band"
              >
                <div className="wrap track-section session-skeleton">
                  <p className="skeleton-status" role="status">
                    Loading {place}’s recorded estimates…
                    {limited && ' The API is rate limited; retrying automatically.'}
                  </p>
                  <div className="session-controls">
                    {['Driver', 'Compare', 'Straight'].map((l) => (
                      <div className="session-select" key={l}>
                        <span className="select-label">{l}</span>
                        <div className="skel select-skel" />
                      </div>
                    ))}
                  </div>
                  <div className="coverage-note" aria-hidden={!coverageNote}>
                    <span className="coverage-ghost" aria-hidden="true">
                      Few estimates here: most straights on this circuit are too short for the 250 km/h
                      cut-off rule, so only 00 of 00 straights carry results.
                    </span>
                    {coverageNote && <p role="note">{coverageNote}</p>}
                  </div>
                  <div className="map-stage">
                    <div className="map-surface skel map-skel" />
                    <aside className="estimate-stack" data-count="2" aria-hidden="true">
                      <article className="driver-estimate driver-poster skel" />
                      <article className="driver-estimate driver-poster compare-estimate skel" />
                      <div className="estimate-actions">
                        <span className="text-toggle" style={{ visibility: 'hidden' }}>
                          Use session median
                        </span>
                        <div className="button skel" />
                      </div>
                    </aside>
                  </div>
                </div>
              </section>
              <section aria-hidden="true">
                <div className="wrap analysis-layout">
                  <div className="driver-tower">
                    <div className="analysis-heading">
                      <h2>Drivers.</h2>
                      <span className="utility">Cut-off / m est.</span>
                    </div>
                    <p className="quiet-note">Alphabetical order · session medians</p>
                    <div className="tower-rows">
                      {Array.from({ length: 9 }, (_, i) => (
                        <div key={i} className="tower-row skel" />
                      ))}
                    </div>
                  </div>
                  <div className="lap-panel">
                    <div className="analysis-heading">
                      <h2>Lap by lap.</h2>
                    </div>
                    <Rule on />
                    <p className="quiet-note">
                      Compare estimates across laps. Select a lap to inspect both drivers.
                    </p>
                    <div className="lap-selector">
                      <div className="skel lap-select-skel" />
                    </div>
                    <div className="skel chart-skel" />
                  </div>
                </div>
              </section>
            </>
          ) : (
            <>
              {data.summaryError && (
                <aside role="alert" className="availability-band">
                  <div className="wrap availability-notice">
                    <p>
                      Cut-off estimates couldn’t be loaded. The track and lap records are still available.
                    </p>
                    <button className="text-toggle" onClick={() => location.reload()}>
                      Try again ↗
                    </button>
                  </div>
                </aside>
              )}
              {!data.session?.has_results && (
                <aside className="availability-band">
                  <div className="wrap availability-notice">
                    <p>No published estimates for this session. Choose another race to compare cut-offs.</p>
                    <a href={`${pageUrl('home')}#races`}>Choose a race ↗</a>
                  </div>
                </aside>
              )}
              <section
                id="track"
                tabIndex={-1}
                aria-label={`${place} track and selected estimates`}
                className="band"
              >
                <div className="wrap track-section">
                  <div className="session-controls">
                    <SessionSelect
                      pending={!data.ready && !data.loadError && !data.sessionsError}
                      label="Driver"
                      value={String(driver)}
                      items={pool.map(driverOption)}
                      onChange={(v) => selectDriver(Number(v))}
                    />
                    <SessionSelect
                      pending={!data.ready && !data.loadError && !data.sessionsError}
                      label="Compare"
                      value={compare === null ? '' : String(compare)}
                      items={[
                        { value: '', name: 'No comparison' },
                        ...pool.filter((d) => d.driver_number !== driver).map(driverOption),
                      ]}
                      onChange={(v) => {
                        setCompare(v ? Number(v) : null);
                        setLap(null);
                      }}
                    />
                    <div className="select-info">
                      <SessionSelect
                        pending={!data.ready && !data.loadError && !data.sessionsError}
                        label="Straight"
                        value={String(sid)}
                        items={data.straights.map((s) => ({
                          value: String(s.straight_id),
                          name: s.label ?? `Straight ${s.straight_id}`,
                          code: `S${s.straight_id}`,
                          detail: `${fmt(s.len)} m · ${
                            driversPerStraight.get(s.straight_id)
                              ? `${driversPerStraight.get(s.straight_id)} ${driversPerStraight.get(s.straight_id) === 1 ? 'driver' : 'drivers'}`
                              : 'no estimates'
                          }`,
                        }))}
                        onChange={(v) => selectStraight(Number(v))}
                      />
                      <Info label="the straight">
                        Which straight of the circuit the estimates refer to. Each one is a flat-out stretch
                        where the model looks for the end of electrical deployment.
                      </Info>
                    </div>
                  </div>
                  <div className="coverage-note" aria-hidden={!coverageNote}>
                    <span className="coverage-ghost" aria-hidden="true">
                      Few estimates here: most straights on this circuit are too short for the 250 km/h
                      cut-off rule, so only 00 of 00 straights carry results.
                    </span>
                    {coverageNote && <p role="note">{coverageNote}</p>}
                  </div>
                  <div
                    className="map-stage"
                    style={
                      picked?.team_colour
                        ? ({
                            '--stage-team': picked.team_colour,
                            '--stage-compare': compared?.team_colour ?? 'transparent',
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    <div className="map-surface" data-no-estimates={noEstimates ? 'true' : undefined}>
                      <div className="map-heading">
                        <h2>{straight?.label}</h2>
                        <div className="map-heading-end">
                          <span className="utility">
                            S{sid} / {fmt(straight?.len)} m
                          </span>
                          <Info label="the map tags">
                            Each tag shows a driver code and its estimated cut-off on this straight, in metres
                            from its start. A solid dot is the driver; a ring is the comparison.
                          </Info>
                          <HelpDot />
                        </div>
                      </div>
                      <Rule on={pBusy || cBusy} />
                      {data.outline && straight ? (
                        <TrackMap
                          outline={data.outline}
                          circuit={circuit}
                          straights={data.straights}
                          selected={sid}
                          onSelect={selectStraight}
                          straightsWithData={straightsWithData}
                          tags={tags}
                          arrows={false}
                          blend={
                            compared
                              ? [picked?.team_colour ?? '#f4f4ef', compared.team_colour ?? '#f4f4ef']
                              : null
                          }
                          runs={[picked, compared].filter(Boolean).map((d, i) => ({
                            d0: straight.d0,
                            d1: straight.d1,
                            colour: d!.team_colour ?? '#f4f4ef',
                            offset: compared ? (i === 0 ? -2 : 2) : 0,
                          }))}
                          corners
                          sf
                          straightLabels
                          rotation={data.session?.circuit_key === 39 ? 85 : (meta?.rotation ?? undefined)}
                          fill={wideStage}
                          maxHeight={520}
                          markerScale={compactMap ? 1 : 1.2}
                          label={`${place} track with estimated deployment cut-off markers`}
                        />
                      ) : (
                        <p className="quiet-note">
                          {data.outlineError
                            ? (data.outlineError as { status?: number }).status === 404
                              ? 'No track outline is recorded for this circuit yet.'
                              : 'Track geometry could not be loaded.'
                            : data.outline && data.outline.points.length < 2
                              ? 'No track outline is recorded for this circuit yet.'
                              : 'Track geometry could not be loaded.'}
                        </p>
                      )}
                      <p className="map-status" role="status">
                        {noEstimates
                          ? `No published estimate for ${picked?.name_acronym ?? 'this driver'}${compared ? ` or ${compared.name_acronym}` : ''} on this straight.`
                          : ''}
                      </p>
                      <p className="map-footnote">
                        <span>
                          Tags mark estimated cut-offs.
                          {compare !== null ? ' Solid dot: driver. Ring: comparison.' : ''} Values are metres
                          into the straight; intervals appear in the cards and chart.
                        </span>
                        <span aria-hidden="true">
                          Tags mark estimated cut-offs. Solid dot: driver. Ring: comparison. Values are metres
                          into the straight; intervals appear in the cards and chart.
                        </span>
                      </p>
                    </div>
                    <aside
                      className="estimate-stack"
                      data-count={details.filter((x) => x.d).length}
                      aria-label="Selected driver estimates"
                    >
                      {details.map(({ d, md, value, other }) =>
                        d && straight ? (
                          <DriverEstimate
                            key={other ? 'compare' : 'primary'}
                            d={d}
                            value={value}
                            lo={lap === null ? relative(md?.lo) : null}
                            hi={lap === null ? relative(md?.hi) : null}
                            samples={other ? comparisonSamples : primarySamples}
                            domain={domain}
                            lap={lap}
                            other={other}
                            busy={other ? cBusy : pBusy}
                          />
                        ) : null
                      )}
                      {!compared && (
                        <div className="driver-estimate driver-poster is-empty" aria-hidden="true">
                          <p>Pick a driver to compare</p>
                        </div>
                      )}
                      <div className="estimate-actions">
                        <button
                          className="text-toggle"
                          onClick={() => setLap(null)}
                          aria-hidden={lap === null || undefined}
                          tabIndex={lap === null ? -1 : undefined}
                          style={lap === null ? { visibility: 'hidden' } : undefined}
                        >
                          Use session median
                        </button>
                        <a className="button button-light" href="#lap-chart">
                          Explore laps <span aria-hidden="true">↓</span>
                        </a>
                      </div>
                    </aside>
                  </div>
                </div>
              </section>
              {(pCutRequest.error || cCutRequest.error) && (
                <aside role="alert" className="availability-band">
                  <div className="wrap availability-notice">
                    <p>
                      Lap estimates couldn’t be loaded for one of the selected drivers. Session medians remain
                      available.
                    </p>
                    <button className="text-toggle" onClick={() => location.reload()}>
                      Try again ↗
                    </button>
                  </div>
                </aside>
              )}
              <section aria-label="Driver and lap comparisons">
                <div className="wrap analysis-layout">
                  <div className="driver-tower">
                    <div className="analysis-heading">
                      <h2>
                        Drivers.
                        <Info label="the driver tower">
                          Session medians for every driver on the selected straight, in alphabetical order.
                          Pick a row to set the driver.
                        </Info>
                      </h2>
                      <span className="utility">Cut-off / m est.</span>
                    </div>
                    <p className="quiet-note">Alphabetical order · session medians</p>
                    <div className="tower-selection">
                      {picked && (
                        <button
                          onClick={() => revealDriver(driver)}
                          style={{ '--team': picked.team_colour ?? '#aaa' } as CSSProperties}
                        >
                          <span className="chart-key" />
                          Driver <b>{picked.name_acronym}</b>
                          <span aria-hidden="true">↓</span>
                        </button>
                      )}
                      {compared && (
                        <button
                          onClick={() => revealDriver(compared.driver_number)}
                          style={{ '--team': compared.team_colour ?? '#aaa' } as CSSProperties}
                        >
                          <span className="chart-key is-hollow" />
                          Compare <b>{compared.name_acronym}</b>
                          <span aria-hidden="true">↓</span>
                        </button>
                      )}
                    </div>
                    <div
                      className={`tower-rows ${pBusy ? 'is-loading' : ''}`}
                      aria-busy={pBusy || undefined}
                      ref={tower}
                    >
                      {pool.map((d) => {
                        const med = data.medians.get(d.driver_number)?.get(sid);
                        const v = relative(med?.m);
                        return (
                          <button
                            key={d.driver_number}
                            data-driver={d.driver_number}
                            className={`tower-row ${d.driver_number === driver ? 'selected' : ''} ${d.driver_number === compare ? 'compared' : ''}`}
                            aria-pressed={d.driver_number === driver}
                            aria-label={`Select ${d.full_name}, ${v === null ? 'no published estimate' : `estimated cut-off ${fmt(v)} metres`}${d.driver_number === compare ? ', current comparison' : ''}`}
                            onClick={() => selectDriver(d.driver_number)}
                            style={{ '--team': d.team_colour ?? '#aaa' } as CSSProperties}
                          >
                            <span className="tower-team" />
                            <Logo team={d.team_name} keepSlot />
                            <span className="tower-identity">
                              <span className="tower-fullname">{driverName(d)}</span>
                              <span className="tower-name">{d.team_name}</span>
                            </span>
                            <span className="tower-code">{d.name_acronym}</span>
                            <span className="tower-value">{fmt(v)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="lap-panel" id="lap-chart" tabIndex={-1}>
                    <div className="analysis-heading">
                      <h2>
                        Lap by lap.
                        <Info label="the lap chart">
                          Each dot is one lap&apos;s estimated cut-off on the selected straight. Estimates,
                          not measurements; pick a lap to compare both drivers on it.
                        </Info>
                      </h2>
                      <span className="utility">{straight?.label}</span>
                    </div>
                    <Rule on={pBusy || cBusy} />
                    <p className="quiet-note">
                      Compare estimates across laps. Select a lap to inspect both drivers.
                    </p>
                    <div className="lap-selector">
                      <label htmlFor="lap-pick">Lap</label>
                      <select
                        id="lap-pick"
                        value={lap ?? ''}
                        onChange={(e) => setLap(e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">Session median</option>
                        {laps
                          .filter((l) => pCut?.get(l.lap_number)?.has(sid))
                          .map((l) => (
                            <option key={l.lap_number} value={l.lap_number}>
                              Lap {l.lap_number}
                            </option>
                          ))}
                      </select>
                    </div>
                    {straight && data.lap ? (
                      <CutoffChart
                        straight={straight}
                        lapLen={data.lap}
                        laps={laps}
                        selectedLap={lap}
                        onLap={setLap}
                        drivers={[
                          {
                            number: driver,
                            code: picked?.name_acronym ?? '',
                            colour: picked?.team_colour ?? '#fff',
                            hollow: false,
                            cutoffs: pCut,
                            median: primaryMedian,
                          },
                          ...(compare !== null
                            ? [
                                {
                                  number: compare,
                                  code: compared?.name_acronym ?? '',
                                  colour: compared?.team_colour ?? '#aaa',
                                  hollow: true,
                                  cutoffs: cCut,
                                  median: compareMedian,
                                },
                              ]
                            : []),
                        ]}
                        loading={pCut === null}
                        compareLoading={compare !== null && cCut === null}
                        dim={pBusy}
                        dimCompare={cBusy}
                      />
                    ) : null}
                    <p className="chart-caption">
                      Filled dots identify the driver; hollow dots identify the comparison. Values are
                      estimates in metres from the start of the straight.
                    </p>
                  </div>
                </div>
              </section>
              <section id="method" tabIndex={-1} className="band">
                <div className="wrap method-section">
                  <aside className="notice notice-caution">
                    <svg
                      className="notice-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z" />
                      <path d="M12 7v6m0 3v1" />
                    </svg>
                    <div className="notice-content">
                      <h2>Deployment is estimated.</h2>
                      <p>
                        Battery state and electrical power aren’t public. These values are inferred from
                        telemetry.
                      </p>
                    </div>
                  </aside>
                  <details className="method-note">
                    <summary>
                      How to read these estimates<span aria-hidden="true">+</span>
                    </summary>
                    <div>
                      <p>
                        The cut-off is an energy-management proxy, not a measurement of battery power.
                        Positions are shown in metres from the start of the selected straight. Median
                        intervals describe lap-to-lap uncertainty.
                      </p>
                      <p>
                        Drag, mass and modelling assumptions limit interpretation. A later cut-off does not
                        establish a faster car. The project’s pre-registered analysis found no detectable
                        effect beyond its controls.
                      </p>
                      <p>
                        This page serves recorded session aggregates from the project API. It does not show a
                        live race or raw telemetry samples.
                      </p>
                      <a className="inline-link utility" href={pageUrl('method')}>
                        Read the full method record <span aria-hidden="true">↗</span>
                      </a>
                    </div>
                  </details>
                </div>
              </section>
            </>
          )}
        </main>
      </PageGround>
      <SiteFooter
        ref={footer}
        notes={
          <>
            Data: OpenF1 / f1-battery.
            <br />
            Team marks: Formula 1 media. Circuit reference: MultiViewer.
            <br />
            Typeface: Formula 1, Kurppa Hosk Type, Vercel.
          </>
        }
        top={{ href: '#race-title', label: 'Back to top ↑' }}
      />
    </div>
  );
}
createRoot(document.getElementById('session-root')!).render(<App />);
