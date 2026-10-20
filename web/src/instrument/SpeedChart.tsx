import { useId, useMemo, useRef } from "react";
import type { Store } from "../explorer/store";
import { useSize } from "../lib/useSize";
import { useEasedCursor, seekKey } from "./cursor";
import { REGIME_VAR, REGIME_WORD, readAt, regimeSpans, speedAt, speedDomain, tracePath, type Profile } from "./driver";
import "./telemetry.css";

/*
 * The straight's speed profile, drawn the way the telemetry sites draw it (DESIGN.md v3
 * "Telemetry"): grid in the line colour, the speed axis on the left in mono, the distance axis
 * in metres with the cut-off estimate marked on it, one trace per driver (the selected driver
 * in white, the compare driver in team colour), the shown lap's regimes as a thin strip under
 * the distance axis, and a vertical cursor with a tooltip card that follows the page's shared
 * cursor. Traces are medians of clean laps in 50 m bins, so the caption says so.
 *
 * The drawing renders once per profile and size; the cursor moves by attribute writes.
 */

interface Props {
  profile: Profile;
  code: string;
  compare?: { profile: Profile; colour: string; code: string } | null;
  cursor: Store<number | null>;
  /** The shown lap's own cut-off, metres into the straight, and its lap number. */
  lapCut: number | null;
  lapNo: number | null;
  lapColour: string;
  label: string;
}

const M = { l: 46, r: 14, t: 30, b: 50 };
const fmtA = (a: number) => `${a > 0 ? "+" : a < 0 ? "−" : ""}${Math.abs(a).toFixed(1)}`;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function SpeedChart({ profile, code, compare = null, cursor, lapCut, lapNo, lapColour, label }: Props) {
  const uid = useId().replace(/:/g, "");
  const [box, { w: W, h: H }] = useSize<HTMLDivElement>();
  const cmp = compare?.profile.bins.length ? compare.profile : null;
  const L = profile.length_m || 1;

  const geo = useMemo(() => {
    const [lo1, hi1] = speedDomain(profile);
    const [lo2, hi2] = cmp ? speedDomain(cmp) : [lo1, hi1];
    const lo = Math.min(lo1, lo2);
    const hi = Math.max(hi1, hi2);
    const axisY = H - M.b;
    const sx = (m: number) => M.l + (Math.max(0, Math.min(L, m)) / L) * Math.max(1, W - M.l - M.r);
    const sy = (v: number) => axisY - 6 - ((v - lo) / (hi - lo || 1)) * Math.max(1, axisY - 6 - M.t);
    return { lo, hi, axisY, sx, sy };
  }, [profile, cmp, W, H, L]);
  const { lo, hi, axisY, sx, sy } = geo;
  const ready = W > 0 && H > 0;

  const path = useMemo(() => (ready ? tracePath(profile, sx, sy) : ""), [profile, sx, sy, ready]);
  const cmpPath = useMemo(() => (ready && cmp ? tracePath(cmp, sx, sy) : ""), [cmp, sx, sy, ready]);
  const spans = useMemo(() => regimeSpans(profile), [profile]);

  const vStep = hi - lo > 200 ? 100 : 50;
  const vTicks: number[] = [];
  for (let v = Math.ceil(lo / vStep) * vStep; v <= hi; v += vStep) vTicks.push(v);
  const dStep = L > 700 ? 200 : 100;
  const dTicks: number[] = [];
  for (let m = 0; m <= L + 1e-6; m += dStep) dTicks.push(m);

  const cut = profile.cutoff_median_m;
  const ciLo = profile.ci_low_m;
  const ciHi = profile.ci_high_m;

  // ---- the cursor: attribute and text writes only
  const curRef = useRef<SVGGElement>(null);
  const dotP = useRef<SVGCircleElement>(null);
  const dotC = useRef<SVGCircleElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const t = useRef<Record<string, HTMLElement | null>>({});
  const slider = useRef<HTMLDivElement | null>(null);
  const lastBin = useRef(-1);

  useEasedCursor(
    cursor,
    (d) => {
      if (!ready) return;
      const r = readAt(profile, d);
      const x = sx(r.d);
      curRef.current?.setAttribute("transform", `translate(${x.toFixed(1)},0)`);
      dotP.current?.setAttribute("cy", sy(r.v).toFixed(1));
      if (cmp) dotC.current?.setAttribute("cy", sy(speedAt(cmp, r.d)).toFixed(1));
      const el = tip.current;
      if (el) {
        const gap = 14;
        const flip = x + gap + el.offsetWidth > W - 4;
        const left = Math.max(0, Math.min(W - el.offsetWidth, flip ? x - gap - el.offsetWidth : x + gap));
        el.style.transform = `translate(${left.toFixed(1)}px, 0)`;
      }
      const tx = t.current;
      if (tx.d) tx.d.textContent = `${fmt(r.d)} m`;
      if (tx.v) tx.v.textContent = fmt(r.v);
      if (cmp && tx.vc) tx.vc.textContent = fmt(speedAt(cmp, r.d));
      if (r.bin === lastBin.current) return;
      lastBin.current = r.bin;
      if (tx.a) tx.a.textContent = fmtA(r.a);
      if (tx.r) {
        tx.r.textContent = REGIME_WORD[r.regime];
        tx.r.style.setProperty("--regime", REGIME_VAR[r.regime]);
      }
      slider.current?.setAttribute("aria-valuenow", String(Math.round(r.d)));
      slider.current?.setAttribute("aria-valuetext", `${fmt(r.d)} metres: ${fmt(r.v)} kph, ${fmtA(r.a)} metres per second squared, ${REGIME_WORD[r.regime]}`);
    },
    [ready, profile, cmp, sx, sy, W],
  );

  const toD = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(L, ((clientX - r.left - M.l) / Math.max(1, r.width - M.l - M.r)) * L));
  };

  const summary = `Speed along ${label}: ${code} from ${fmt(profile.bins[0]?.v_kph ?? 0)} to ${fmt(Math.max(...profile.bins.map((b) => b.v_kph)))} kph over ${fmt(L)} m${
    cut !== null ? `; cut-off estimate at ${fmt(cut)} m` : ""
  }.`;

  return (
    <div
      ref={(n) => {
        box(n);
        slider.current = n;
      }}
      className="tl"
      role="slider"
      tabIndex={0}
      aria-label={`Distance along ${label}. ${summary}`}
      aria-valuemin={0}
      aria-valuemax={Math.round(L)}
      onPointerMove={(e) => e.pointerType === "mouse" && cursor.set(toD(e.clientX, e.currentTarget))}
      onPointerDown={(e) => cursor.set(toD(e.clientX, e.currentTarget))}
      onKeyDown={(e) => seekKey(e, cursor, L)}
    >
      {ready && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="tl__svg" aria-hidden="true">
          <defs>
            <pattern id={`${uid}-h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="tl__hatch" />
            </pattern>
          </defs>

          {/* Grid */}
          {vTicks.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} className="tl__grid" />
              <text x={M.l - 10} y={sy(v) + 4} textAnchor="end" className="tl__num">
                {v}
              </text>
            </g>
          ))}
          <text x={M.l - 10} y={M.t - 14} textAnchor="end" className="tl__unit">
            kph
          </text>
          {dTicks.map((m) => (
            <line key={m} x1={sx(m)} x2={sx(m)} y1={M.t - 6} y2={axisY} className="tl__grid" />
          ))}

          {/* The cut-off estimate: its interval hatched, the median dashed. */}
          {cut !== null && (
            <g>
              {ciLo !== null && ciHi !== null && (
                <rect x={sx(ciLo)} y={M.t - 6} width={Math.max(1, sx(ciHi) - sx(ciLo))} height={axisY - M.t + 6} fill={`url(#${uid}-h)`} />
              )}
              <line x1={sx(cut)} x2={sx(cut)} y1={M.t - 6} y2={axisY} className="tl__cut" />
              <text x={sx(cut) + (sx(cut) > W - 140 ? -8 : 8)} y={M.t - 14} textAnchor={sx(cut) > W - 140 ? "end" : "start"} className="tl__num tl__num--ink">
                cut-off est. {fmt(cut)} m
              </text>
            </g>
          )}

          {/* Traces */}
          {cmpPath && <path d={cmpPath} className="tl__trace tl__trace--cmp" style={{ stroke: compare!.colour }} />}
          {path && <path d={path} className="tl__trace" />}

          {/* Distance axis, the regime strip of the shown lap, the cut-off tick */}
          <line x1={M.l} x2={W - M.r} y1={axisY} y2={axisY} className="tl__axis" />
          {spans.map((s, i) => (
            <rect key={i} x={sx(s.from_m)} y={axisY + 5} width={Math.max(0, sx(s.to_m) - sx(s.from_m))} height={4} rx={1} style={{ fill: REGIME_VAR[s.regime] }} />
          ))}
          {dTicks.map((m, i) => (
            <text key={m} x={sx(m)} y={axisY + 28} textAnchor={i === 0 ? "start" : m > L - dStep / 2 ? "end" : "middle"} className="tl__num">
              {i === 0 ? "0 m" : fmt(m)}
            </text>
          ))}
          {cut !== null && <path d={`M${sx(cut)},${axisY + 1}l-4.5,-7h9z`} className="tl__cutmark" />}
          {lapCut !== null && lapCut >= 0 && lapCut <= L && (
            <g transform={`translate(${sx(lapCut).toFixed(1)},${axisY})`}>
              <line y1={0} y2={-14} stroke={lapColour} strokeWidth={2} />
              <rect x={-17} y={-30} width={34} height={16} rx={4} fill={lapColour} />
              <text y={-18.5} textAnchor="middle" className="tl__chip">
                L{lapNo}
              </text>
            </g>
          )}

          {/* Cursor */}
          <g ref={curRef} className="tl__cursor">
            <line x1={0} x2={0} y1={M.t - 6} y2={axisY + 9} />
            {cmp && <circle ref={dotC} r={4} cx={0} cy={0} style={{ fill: compare!.colour }} className="tl__dot" />}
            <circle ref={dotP} r={4.5} cx={0} cy={0} className="tl__dot tl__dot--p" />
          </g>
        </svg>
      )}
      {ready && (
        <div ref={tip} className="tl-tip" style={{ top: M.t }} aria-hidden="true">
          <p className="tl-tip__d" ref={(n) => (t.current.d = n)} />
          <p className="tl-tip__row">
            <i style={{ background: "var(--ink)" }} />
            <span className="tl-tip__k">{code}</span>
            <b ref={(n) => (t.current.v = n)} />
            <span className="tl-tip__u">kph</span>
          </p>
          {cmp && compare && (
            <p className="tl-tip__row">
              <i style={{ background: compare.colour }} />
              <span className="tl-tip__k">{compare.code}</span>
              <b ref={(n) => (t.current.vc = n)} />
              <span className="tl-tip__u">kph</span>
            </p>
          )}
          <p className="tl-tip__row">
            <i className="tl-tip__blank" />
            <span className="tl-tip__k">accel</span>
            <b ref={(n) => (t.current.a = n)} />
            <span className="tl-tip__u">m/s²</span>
          </p>
          <p className="tl-tip__regime" ref={(n) => (t.current.r = n)} />
        </div>
      )}
    </div>
  );
}
