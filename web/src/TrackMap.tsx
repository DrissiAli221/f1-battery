import { useMemo } from "react";
import type { Outline, RegimeBin, RegimeLabel, Straight } from "./types";

export const REGIME_COLORS: Record<RegimeLabel, string> = {
  deploy: "var(--deploy)",
  plateau: "var(--plateau)",
  lift: "var(--lift)",
  brake: "var(--brake)",
};

interface Props {
  outline: Outline;
  straights: Straight[];
  regimes: RegimeBin[];
}

/**
 * SVG track map. The outline is one downsampled lap; straights arrive as lap fractions
 * (0-100 %) and regime bins as 50 m bins, so both are located on the outline by their
 * fraction of the lap rather than by absolute distance (the outline's distance is in the
 * source's position units).
 */
export function TrackMap({ outline, straights, regimes }: Props) {
  const geo = useMemo(() => {
    const pts = outline.points;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const pad = 0.06 * span;
    // Flip y so that north is up as in a plan view.
    const sx = (x: number) => x - minX + pad;
    const sy = (y: number) => maxY - y + pad;
    return { w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad, sx, sy };
  }, [outline]);

  const total = outline.points[outline.points.length - 1]?.d || 1;
  const nBins = regimes.length ? Math.max(...regimes.map((r) => r.bin)) + 1 : 0;
  const byBin = new Map(regimes.map((r) => [r.bin, r.label]));

  const segments = outline.points.slice(1).map((p, i) => {
    const a = outline.points[i];
    const frac = (a.d + p.d) / 2 / total;
    const bin = nBins ? Math.min(nBins - 1, Math.floor(frac * nBins)) : -1;
    return { a, b: p, frac, label: byBin.get(bin) };
  });

  const straightSegs = (s: Straight) =>
    segments.filter((g) => g.frac * 100 >= s.start_pct && g.frac * 100 <= s.end_pct);
  const d = (g: { a: { x: number; y: number }; b: { x: number; y: number } }) =>
    `M${geo.sx(g.a.x)},${geo.sy(g.a.y)}L${geo.sx(g.b.x)},${geo.sy(g.b.y)}`;
  const stroke = geo.w / 70;

  return (
    <div>
      <svg
        className="map"
        viewBox={`0 0 ${geo.w} ${geo.h}`}
        role="img"
        aria-label="Track outline with straights highlighted and regimes for the selected lap"
      >
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={segments.map(d).join("")} stroke="var(--track)" strokeWidth={stroke * 1.9} />
          {straights.map((s) => (
            <path key={s.straight_id} d={straightSegs(s).map(d).join("")} stroke="var(--straight)" strokeWidth={stroke * 2.6} opacity="0.55">
              <title>{s.label ?? `Straight ${s.straight_id}`}</title>
            </path>
          ))}
          {segments.map((g, i) => (
            <path key={i} d={d(g)} stroke={g.label ? REGIME_COLORS[g.label] : "var(--track-core)"} strokeWidth={stroke} />
          ))}
        </g>
        {outline.points.length > 0 && (
          <circle cx={geo.sx(outline.points[0].x)} cy={geo.sy(outline.points[0].y)} r={stroke * 1.6} fill="var(--ink)">
            <title>Start/finish reference</title>
          </circle>
        )}
      </svg>
      <ul className="legend" aria-label="Legend">
        {(Object.keys(REGIME_COLORS) as RegimeLabel[]).map((k) => (
          <li key={k}>
            <i style={{ background: REGIME_COLORS[k] }} />
            {k}
          </li>
        ))}
        <li>
          <i className="swatch-straight" />
          straight
        </li>
      </ul>
    </div>
  );
}
