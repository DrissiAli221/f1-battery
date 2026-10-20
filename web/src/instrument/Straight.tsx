/*
 * The straight (DESIGN.md "Concept card"): one straight's cross-lap speed profile drawn as a
 * static SVG, and a cursor that runs down it. Everything the cursor says comes from
 * `readAt(profile, d)` (driver.ts); this file maps the reading to pixels.
 *
 * Performance contract: the trace, grid, band and cut-off are drawn once per profile and size
 * (React render). Per frame only the cursor group, the coloured clip and the floating readout
 * move, with transforms set from one gsap.ticker callback; readout text and ARIA values change
 * only when the cursor enters another bin. The ticker callback is removed while the instrument
 * is off screen.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useSize } from "../lib/useSize";
import { isTouch, prefersReducedMotion } from "../motion";
import {
  REGIME_VAR,
  REGIME_WORD,
  binIndexAt,
  readAt,
  regimeSpans,
  restingD,
  speedDomain,
  tracePath,
  type Profile,
  type Reading,
} from "./driver";
import "./straight.css";

export type StraightInput =
  /** Controlled: the page owns d (metres), e.g. a lap scrubber. Arrow keys call `onSeek`. */
  | number
  /** Creeps at walking pace and wraps; the pointer takes over while it is over the trace. */
  | { mode: "idle" }
  /** Follows the pointer; rests at the cut-off until the pointer arrives. */
  | { mode: "pointer" }
  /** Scroll progress through `trigger` (default: the instrument) runs d from 0 to the end. */
  | {
      mode: "scroll";
      trigger?: RefObject<HTMLElement | null>;
      start?: string;
      end?: string;
    }
  /**
   * Progress (0 to 1) owned by the page, read every tick: e.g. the hero's one parallax
   * ScrollTrigger writes it. At 0 (page at the top) the idle creep runs instead.
   */
  | { mode: "progress"; progress: { current: number } };

export interface StraightLabels {
  circuit?: string;
  /** e.g. "main straight" */
  straight?: string;
  /** three-letter code, e.g. "NOR" */
  driver?: string;
  /** clean laps behind the medians: renders "median of N laps (est.)" */
  laps?: number;
}

export interface StraightProps {
  /** null draws the skeleton of the axis (loading or no data). */
  profile: Profile | null;
  d?: StraightInput;
  /** hero: edge to edge, poster scale. panel: inside a column. row: tiny inline trace for index rows. */
  size?: "hero" | "panel" | "row";
  labels?: StraightLabels;
  /** Controlled mode: keyboard seeks ask the page to move d. */
  onSeek?: (d: number) => void;
  /** Called when the cursor enters another bin (and once on mount): feed the page readout. */
  onReading?: (r: Reading) => void;
  /** No profile yet and still loading: the skeleton's axis shimmers (it is still once the answer is "none"). */
  pending?: boolean;
  /** row only: light the trace and run its cursor (the index row's hover). */
  active?: boolean;
  /**
   * Where the readout sits. auto: rides the cursor, stacked under the plot when the
   * instrument is narrower than 640 px. float: always rides the cursor. none: the page shows
   * it elsewhere (feed it from onReading).
   */
  readout?: "auto" | "float" | "none";
  /** Seconds for one idle pass down the straight. */
  creepSeconds?: number;
  /**
   * A second driver's profile on the same straight, drawn as a thinner trace in `colour` (the
   * explorer's compare driver). It shares the axes; the cursor still reads `profile`.
   */
  compare?: { profile: Profile; colour: string } | null;
  className?: string;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-GB");
const fmtA = (a: number) => `${a > 0 ? "+" : a < 0 ? "−" : ""}${Math.abs(a).toFixed(1)}`;

interface Geometry {
  W: number;
  H: number;
  padX: number;
  top: number; // top of the speed range, px
  axisY: number;
  sx: (m: number) => number;
  sy: (kph: number) => number;
  inv: (px: number) => number;
}

const LAYOUT = {
  hero: { top: 84, axis: 40, band: 4 },
  panel: { top: 68, axis: 36, band: 3 },
  row: { top: 3, axis: 3, band: 0 },
} as const;

/** The speed axis covers both traces when a compare profile is drawn. */
function domainOf(p: Profile | null, extra?: Profile | null): [number, number] {
  if (!p) return [0, 350];
  const [lo, hi] = speedDomain(p);
  if (!extra?.bins.length) return [lo, hi];
  const [lo2, hi2] = speedDomain(extra);
  return [Math.min(lo, lo2), Math.max(hi, hi2)];
}

function geometry(p: Profile | null, size: "hero" | "panel" | "row", W: number, H: number, extra?: Profile | null): Geometry {
  const L = LAYOUT[size];
  const padX = size === "hero" ? 24 : 0; // the gutter (tokens.css --gutter)
  const axisY = H - L.axis;
  const top = L.top;
  const length = p?.length_m || 1;
  const [lo, hi] = domainOf(p, extra);
  const bottom = size === "row" ? H - 3 : axisY - 10;
  const sx = (m: number) => padX + (m / length) * (W - 2 * padX);
  const sy = (v: number) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
  const inv = (px: number) => ((px - padX) / Math.max(1, W - 2 * padX)) * length;
  return { W, H, padX, top, axisY, sx, sy, inv };
}

function inputKey(d: StraightInput | undefined): string {
  if (d === undefined) return "idle";
  if (typeof d === "number") return "value";
  return d.mode;
}

export function Straight({
  profile,
  d = { mode: "idle" },
  size = "panel",
  labels,
  onSeek,
  onReading,
  active = false,
  pending = false,
  creepSeconds = 24,
  readout = "auto",
  className = "",
  compare = null,
}: StraightProps) {
  const uid = useId().replace(/:/g, "");
  const [plotRef, { w, h }] = useSize<HTMLDivElement>();
  const plotEl = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<SVGGElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const clipRef = useRef<SVGRectElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const textRefs = useRef<Record<string, HTMLElement | null>>({});

  const cmp = compare?.profile.bins.length ? compare.profile : null;
  const geo = useMemo(() => geometry(profile, size, w, h, cmp), [profile, size, w, h, cmp]);
  const spans = useMemo(() => (profile ? regimeSpans(profile) : []), [profile]);
  const path = useMemo(() => (profile && w > 0 ? tracePath(profile, geo.sx, geo.sy) : ""), [profile, geo, w]);
  const cmpPath = useMemo(() => (cmp && profile && w > 0 ? tracePath(cmp, geo.sx, geo.sy) : ""), [cmp, profile, geo, w]);

  // Live values the ticker reads without re-rendering.
  const live = useRef({
    target: 0,
    shown: 0,
    hovering: false,
    manual: false,
    lastBin: -2,
    flipped: false,
    geo,
    profile,
    onReading,
  });
  live.current.geo = geo;
  live.current.profile = profile;
  live.current.onReading = onReading;

  const mode = inputKey(d);
  const controlled = typeof d === "number" ? d : null;
  const scrollOpts = typeof d === "object" && d.mode === "scroll" ? d : null;
  const progressSrc = typeof d === "object" && d.mode === "progress" ? d.progress : null;
  const progressRef = useRef(progressSrc);
  progressRef.current = progressSrc;
  const interactive = size !== "row" && !!profile;

  /** Places the cursor at distance `dist`; text changes only on a bin change. */
  const apply = (dist: number) => {
    const s = live.current;
    const p = s.profile;
    if (!p) return;
    const g = s.geo;
    const r = readAt(p, dist);
    const x = g.sx(r.d);
    if (cursorRef.current) gsap.set(cursorRef.current, { x });
    if (dotRef.current) gsap.set(dotRef.current, { y: g.sy(r.v) });
    if (clipRef.current) gsap.set(clipRef.current, { x });
    if (floatRef.current) gsap.set(floatRef.current, { x });
    if (r.bin === s.lastBin) return;
    s.lastBin = r.bin;
    const b = p.bins[r.bin];
    const t = textRefs.current;
    const speed = `${fmtInt(b.v_kph)}`;
    const accel = `${fmtA(b.a_ms2)}`;
    const dist50 = `${fmtInt(b.d_start_m)}–${fmtInt(Math.min(p.length_m, b.d_start_m + p.bin_m))} m`;
    for (const k of ["v", "v2"]) if (t[k]) t[k]!.textContent = speed;
    for (const k of ["a", "a2"]) if (t[k]) t[k]!.textContent = accel;
    for (const k of ["d", "d2"]) if (t[k]) t[k]!.textContent = dist50;
    for (const k of ["r", "r2"]) {
      const el = t[k];
      if (!el) continue;
      el.textContent = REGIME_WORD[r.regime];
      el.style.setProperty("--regime", REGIME_VAR[r.regime]);
    }
    const flip = r.x > 0.78;
    if (flip !== s.flipped && floatRef.current) {
      s.flipped = flip;
      floatRef.current.classList.toggle("is-flipped", flip);
    }
    if (dotRef.current) dotRef.current.style.setProperty("--regime", REGIME_VAR[r.regime]);
    const slider = plotEl.current;
    if (slider && interactive) {
      slider.setAttribute("aria-valuenow", String(Math.round(r.d)));
      slider.setAttribute(
        "aria-valuetext",
        `${dist50}: ${speed} kph, ${accel} metres per second squared, ${REGIME_WORD[r.regime]}${r.pastCutoff ? ", past the estimated cut-off" : ""}`,
      );
    }
    s.onReading?.(r);
  };

  // Re-place the cursor when the drawing changes size or data (no motion of its own).
  useLayoutEffect(() => {
    if (!profile || w === 0) return;
    live.current.lastBin = -2;
    apply(live.current.shown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, profile]);

  // The input: ticker, scroll trigger, visibility. Re-wired when the mode or data changes.
  useLayoutEffect(() => {
    const p = profile;
    const el = plotEl.current;
    if (!p || !el) return;
    const s = live.current;
    const L = p.length_m;
    const reduced = prefersReducedMotion();
    const touch = isTouch();
    const canCreep = !reduced && !touch && (mode === "idle" || mode === "progress" || (size === "row" && active));

    // Starting point: the controlled value, or the cut-off (the best still frame); the idle
    // creep carries on from there and wraps at the end of the straight.
    const start = controlled ?? restingD(p);
    if (s.lastBin === -2 || controlled !== null) {
      s.target = s.shown = start;
      s.lastBin = -2;
      apply(start);
    }

    const ctx = gsap.context(() => {
      if (mode === "scroll" && !reduced) {
        const trig = scrollOpts?.trigger?.current ?? el;
        ScrollTrigger.create({
          trigger: trig,
          start: scrollOpts?.start ?? (scrollOpts?.trigger ? "top top" : "top 80%"),
          end: scrollOpts?.end ?? (scrollOpts?.trigger ? "bottom bottom" : "bottom 20%"),
          onUpdate: (st) => {
            s.manual = false;
            s.target = st.progress * L;
          },
          onRefresh: (st) => {
            if (!s.manual) s.target = st.progress * L;
          },
        });
      }
    });

    const tick = (_t: number, dt: number) => {
      const pr = mode === "progress" && !reduced ? (progressRef.current?.current ?? 0) : 0;
      if (pr > 0.002) {
        s.manual = false;
        s.hovering = false;
        s.target = pr * L;
      } else if (canCreep && !s.hovering && !s.manual) {
        s.target += (L / creepSeconds) * (dt / 1000);
        if (s.target > L) {
          s.target -= L;
          s.shown = s.target; // wrap without easing back across the straight
        }
      }
      const k = reduced ? 1 : 1 - Math.pow(mode === "scroll" || pr > 0.002 ? 0.75 : 0.86, gsap.ticker.deltaRatio());
      const next = s.shown + (s.target - s.shown) * k;
      if (Math.abs(next - s.shown) < 0.01 && Math.abs(s.target - s.shown) < 0.01) return;
      s.shown = Math.abs(s.target - next) < 0.05 ? s.target : next;
      apply(s.shown);
    };

    let ticking = false;
    const setTicking = (on: boolean) => {
      if (on === ticking) return;
      ticking = on;
      if (on) gsap.ticker.add(tick);
      else gsap.ticker.remove(tick);
    };
    const io = new IntersectionObserver(([e]) => setTicking(e.isIntersecting), {
      rootMargin: "64px",
    });
    io.observe(el);

    return () => {
      io.disconnect();
      setTicking(false);
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, mode, size, active, creepSeconds, scrollOpts?.trigger, scrollOpts?.start, scrollOpts?.end]);

  // Controlled value changes: ease toward it (or jump under reduced motion, via the tick).
  useEffect(() => {
    if (controlled === null) return;
    live.current.target = controlled;
  }, [controlled]);

  // Row: when it stops being active, the cursor returns to rest.
  useEffect(() => {
    if (size !== "row" || !profile || active) return;
    live.current.target = restingD(profile);
  }, [size, active, profile]);

  // ---------------------------------------------------------------- input handlers

  const fine = () => !isTouch();
  const toD = (clientX: number) => {
    const el = plotEl.current;
    const p = live.current.profile;
    if (!el || !p) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(p.length_m, live.current.geo.inv(clientX - r.left)));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive || e.pointerType !== "mouse" || !fine() || mode === "scroll" || controlled !== null) return;
    const s = live.current;
    s.hovering = true;
    s.manual = false;
    s.target = toD(e.clientX);
  };
  const onPointerLeave = () => {
    live.current.hovering = false;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    const dist = toD(e.clientX);
    if (controlled !== null) {
      onSeek?.(dist);
      return;
    }
    live.current.manual = true;
    live.current.target = dist;
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const p = profile;
    if (!p || !interactive) return;
    const s = live.current;
    const bin = binIndexAt(p, s.target);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(p.bins.length - 1, bin + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, bin - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = p.bins.length - 1;
    if (next === null) return;
    e.preventDefault();
    const dist = p.bins[next].d_start_m + p.bin_m / 2;
    if (controlled !== null) {
      onSeek?.(dist);
      return;
    }
    s.manual = true;
    s.target = dist;
  };

  // ---------------------------------------------------------------- drawing

  const L = profile?.length_m ?? 0;
  const { sx, sy, axisY, top, padX, W } = geo;
  const ticks: number[] = [];
  if (profile) for (let m = 0; m <= L + 1e-6; m += 200) ticks.push(m);
  const [lo, hi] = domainOf(profile, cmp);
  const grid: number[] = [];
  for (let v = Math.ceil(lo / 100) * 100; v <= hi; v += 100) if (v > lo) grid.push(v);

  const cut = profile?.cutoff_median_m ?? null;
  const ciLo = profile?.ci_low_m ?? null;
  const ciHi = profile?.ci_high_m ?? null;
  const cutX = cut !== null ? sx(cut) : 0;
  const cutLabelRight = cut !== null && W - sx(ciHi ?? cut) > 150;
  const cutLabelX = cut === null ? 0 : cutLabelRight ? sx(ciHi ?? cut) + 10 : sx(ciLo ?? cut) - 10;
  const isRow = size === "row";
  const ready = w > 0 && h > 0;

  const caption =
    labels &&
    [labels.circuit, labels.straight, labels.driver].filter(Boolean).join(", ") +
      (labels.laps ? `, median of ${labels.laps} laps (est.)` : "");

  const summary = profile
    ? `Speed along ${labels?.straight ?? "the straight"}: from ${fmtInt(profile.bins[0]?.v_kph ?? 0)} to ${fmtInt(
        Math.max(...profile.bins.map((b) => b.v_kph)),
      )} kph over ${fmtInt(L)} m.${
        cut !== null
          ? ` Estimated cut-off at ${fmtInt(cut)} m${ciLo !== null && ciHi !== null ? `, interval ${fmtInt(ciLo)} to ${fmtInt(ciHi)} m` : ""}.`
          : ""
      }`
    : "Speed profile loading.";

  const svg = ready && (
    <svg className="st__svg" width={W} height={h} viewBox={`0 0 ${W} ${h}`} aria-hidden="true" focusable="false">
      <defs>
        <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className="st__hatch" />
        </pattern>
        <clipPath id={`${uid}-extent`}>
          <rect x={sx(0)} y={0} width={Math.max(0, sx(L) - sx(0))} height={h} />
        </clipPath>
        <clipPath id={`${uid}-behind`}>
          {/* Moves with the cursor: everything left of it is coloured by regime. */}
          <rect ref={clipRef} x={-W} y={0} width={W} height={h} />
        </clipPath>
        {spans.map((sp, i) => (
          <clipPath key={i} id={`${uid}-span-${i}`}>
            <rect
              x={i === 0 ? 0 : sx(sp.from_m)}
              y={0}
              width={(i === spans.length - 1 ? W : sx(sp.to_m)) - (i === 0 ? 0 : sx(sp.from_m))}
              height={h}
            />
          </clipPath>
        ))}
      </defs>

      {!isRow && (
        <g className="st__grid">
          {grid.map((v) => (
            <g key={v}>
              <line x1={sx(0)} x2={sx(L || 1)} y1={sy(v)} y2={sy(v)} />
              <text x={sx(0)} y={sy(v) - 6} className="st__num">
                {v === grid[grid.length - 1] ? `${v} kph` : v}
              </text>
            </g>
          ))}
          {ticks.slice(1).map((m) => (
            <line key={m} className="st__vgrid" x1={sx(m)} x2={sx(m)} y1={top - 8} y2={axisY} />
          ))}
        </g>
      )}

      {/* Estimated: the cut-off's interval is hatched (DESIGN.md "Drawing rule"). */}
      {profile && ciLo !== null && ciHi !== null && (
        <rect
          className="st__ci"
          x={sx(ciLo)}
          y={isRow ? 0 : top - 8}
          width={Math.max(1, sx(ciHi) - sx(ciLo))}
          height={(isRow ? h : axisY) - (isRow ? 0 : top - 8)}
          fill={`url(#${uid}-hatch)`}
        />
      )}

      {/* Lead-in and lead-out: the road continues past the measured straight (hero only). */}
      {profile && size === "hero" && padX > 0 && (
        <g className="st__lead">
          <line x1={0} x2={sx(0)} y1={sy(profile.bins[0].v_kph)} y2={sy(profile.bins[0].v_kph)} />
          <line
            x1={sx(L)}
            x2={W}
            y1={sy(profile.bins[profile.bins.length - 1].v_kph)}
            y2={sy(profile.bins[profile.bins.length - 1].v_kph)}
          />
        </g>
      )}

      {/* The compare driver: thinner, in that driver's team colour, under the main trace. */}
      {cmpPath && (
        <path className="st__trace st__trace--compare" d={cmpPath} clipPath={`url(#${uid}-extent)`} style={{ stroke: compare!.colour }} />
      )}

      {/* The measured trace: solid ink, then coloured by regime behind the cursor. */}
      {path && <path className={`st__trace ${isRow && !active ? "is-quiet" : ""}`} d={path} />}
      {path && (!isRow || active) && (
        <g clipPath={`url(#${uid}-behind)`}>
          {spans.map((sp, i) => (
            <path
              key={i}
              className="st__trace st__trace--regime"
              d={path}
              clipPath={`url(#${uid}-span-${i})`}
              style={{ stroke: REGIME_VAR[sp.regime] }}
            />
          ))}
        </g>
      )}

      {!isRow && (
        <g className="st__axis">
          <line x1={sx(0)} x2={sx(L || 1)} y1={axisY} y2={axisY} className="st__axisline" />
          {spans.map((sp, i) => (
            <rect
              key={i}
              x={sx(sp.from_m)}
              y={axisY + 1}
              width={Math.max(0, sx(sp.to_m) - sx(sp.from_m))}
              height={LAYOUT[size].band}
              style={{ fill: REGIME_VAR[sp.regime] }}
            />
          ))}
          {ticks.map((m, i) => (
            <g key={m}>
              <line x1={sx(m)} x2={sx(m)} y1={axisY} y2={axisY + LAYOUT[size].band + 6} className="st__tick" />
              <text x={sx(m)} y={axisY + LAYOUT[size].band + 22} className="st__num" textAnchor={i === 0 ? "start" : "middle"}>
                {i === 0 ? "0 m" : fmtInt(m)}
              </text>
            </g>
          ))}
        </g>
      )}

      {profile && cut !== null && (
        <g className="st__cut">
          <line
            x1={cutX}
            x2={cutX}
            y1={isRow ? 0 : sy(readAt(profile, cut).v) + 8}
            y2={isRow ? h : axisY + LAYOUT[size].band + 10}
            className="st__cutline"
          />
          {!isRow && ciLo !== null && ciHi !== null && <path className="st__bracket" d={`M${sx(ciLo)},${axisY - 18}v6H${sx(ciHi)}v-6`} />}
          {!isRow && (
            <text x={cutLabelX} y={axisY - 30} className="st__cutlabel" textAnchor={cutLabelRight ? "start" : "end"}>
              <tspan className="st__cutlabel-k">cut-off est. </tspan>
              <tspan>{fmtInt(cut)} m</tspan>
              {ciLo !== null && ciHi !== null && (
                <tspan x={cutLabelX} dy="16" className="st__cutlabel-k">
                  {fmtInt(ciLo)}–{fmtInt(ciHi)} m
                </tspan>
              )}
            </text>
          )}
        </g>
      )}

      {profile && (!isRow || active) && (
        <g ref={cursorRef} className="st__cursor">
          <line x1={0} x2={0} y1={isRow ? 0 : 0} y2={isRow ? h : axisY + LAYOUT[size].band} />
          <circle ref={dotRef} cx={0} cy={0} r={isRow ? 2.5 : size === "hero" ? 5.5 : 4.5} className="st__dot" />
        </g>
      )}
    </svg>
  );

  if (isRow) {
    return (
      <div
        ref={(n) => (plotRef(n), (plotEl.current = n))}
        className={`st st--row ${active ? "is-active" : ""} ${className}`}
        aria-hidden="true"
      >
        {svg}
      </div>
    );
  }

  return (
    <figure className={`st st--${size} ${readout === "auto" ? "st--auto" : ""} ${className}`}>
      <div
        ref={(n) => (plotRef(n), (plotEl.current = n))}
        className="st__plot"
        role={interactive ? "slider" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? `Distance along ${labels?.straight ?? "the straight"}` : undefined}
        aria-valuemin={interactive ? 0 : undefined}
        aria-valuemax={interactive ? Math.round(L) : undefined}
        aria-orientation={interactive ? "horizontal" : undefined}
        aria-busy={!profile && pending ? true : undefined}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        {svg}
        {profile && readout !== "none" && (
          <div ref={floatRef} className="st__float" aria-hidden="true">
            <div className="st__float-in">
              <p className="st__v">
                <span ref={(n) => (textRefs.current.v = n)} />
                <span className="st__unit"> kph</span>
              </p>
              <p className="st__meta">
                <span ref={(n) => (textRefs.current.a = n)} /> m/s²
              </p>
              <p className="st__regime" ref={(n) => (textRefs.current.r = n)} />
            </div>
          </div>
        )}
        {!profile && <div className={`st__skeleton ${pending ? "shimmer" : ""}`} />}
      </div>

      {profile && readout === "auto" && (
        <dl className="st__stack" aria-hidden="true">
          <div>
            <dt>Speed</dt>
            <dd>
              <span ref={(n) => (textRefs.current.v2 = n)} /> kph
            </dd>
          </div>
          <div>
            <dt>Accel.</dt>
            <dd>
              <span ref={(n) => (textRefs.current.a2 = n)} /> m/s²
            </dd>
          </div>
          <div>
            <dt>Bin</dt>
            <dd ref={(n) => (textRefs.current.d2 = n)} />
          </div>
          <div>
            <dt>Regime</dt>
            <dd className="st__regime" ref={(n) => (textRefs.current.r2 = n)} />
          </div>
        </dl>
      )}

      <figcaption className="st__caption">
        {caption && <span className="st__label">{caption}</span>}
        <span className="sr-only">{summary}</span>
      </figcaption>
    </figure>
  );
}
