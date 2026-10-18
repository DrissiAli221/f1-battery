import { useId } from "react";

export interface Point {
  x: number;
  y: number;
}

export interface Series {
  name: string;
  color: string;
  points: Point[];
}

export interface Band {
  mid: number;
  lo: number | null;
  hi: number | null;
  label: string;
}

interface Props {
  series: Series[];
  band?: Band | null;
  marker?: number | null;
  xLabel: string;
  yLabel: string;
  title: string;
}

const W = 640;
const H = 260;
const M = { l: 52, r: 14, t: 12, b: 38 };

function ticks(lo: number, hi: number, n: number): number[] {
  if (hi === lo) return [lo];
  const raw = (hi - lo) / n;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

/** Plain SVG line/dot chart with an optional median line and confidence band. */
export function SeriesChart({ series, band, marker, xLabel, yLabel, title }: Props) {
  const clip = useId();
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;

  const ys = all.map((p) => p.y);
  if (band) ys.push(band.mid, ...(band.lo !== null ? [band.lo] : []), ...(band.hi !== null ? [band.hi] : []));
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const padY = (y1 - y0 || 1) * 0.12;
  y0 -= padY;
  y1 += padY;
  const x0 = Math.min(...all.map((p) => p.x));
  const x1 = Math.max(...all.map((p) => p.x));
  const sx = (x: number) => M.l + ((x - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const sy = (y: number) => H - M.b - ((y - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);

  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <defs>
          <clipPath id={clip}>
            <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} />
          </clipPath>
        </defs>
        {ticks(y0, y1, 4).map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} className="gridline" />
            <text x={M.l - 8} y={sy(t) + 4} textAnchor="end" className="tick">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {ticks(x0, x1, 6).map((t) => (
          <text key={t} x={sx(t)} y={H - M.b + 16} textAnchor="middle" className="tick">
            {Math.round(t)}
          </text>
        ))}
        <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle" className="axis">
          {xLabel}
        </text>
        <text transform={`translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis">
          {yLabel}
        </text>
        <g clipPath={`url(#${clip})`}>
          {band && band.lo !== null && band.hi !== null && (
            <rect x={M.l} width={W - M.l - M.r} y={sy(band.hi)} height={Math.max(0, sy(band.lo) - sy(band.hi))} className="band" />
          )}
          {band && <line x1={M.l} x2={W - M.r} y1={sy(band.mid)} y2={sy(band.mid)} className="median" />}
          {marker !== null && marker !== undefined && (
            <line x1={sx(marker)} x2={sx(marker)} y1={M.t} y2={H - M.b} className="marker" />
          )}
          {series.map((s) => (
            <g key={s.name}>
              <polyline fill="none" stroke={s.color} strokeWidth="1.5" points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")} />
              {s.points.map((p) => (
                <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r="3" fill={s.color}>
                  <title>{`${s.name}, lap ${p.x}: ${p.y.toFixed(0)}`}</title>
                </circle>
              ))}
            </g>
          ))}
        </g>
      </svg>
      <ul className="legend">
        {series.map((s) => (
          <li key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </li>
        ))}
        {band && (
          <li>
            <i className="swatch-band" />
            {band.label}
          </li>
        )}
      </ul>
    </div>
  );
}
