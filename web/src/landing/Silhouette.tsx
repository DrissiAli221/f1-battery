import { useMemo } from "react";
import { circuitMeta } from "../track/circuits";

/*
 * A circuit's outline at card size, from the local index (CircuitMeta.silhouette, every fourth
 * centreline point; no request). Turned to the broadcast orientation the same way the track
 * map turns it (lib/track.ts `project`: y flipped to screen, then rotation - 90 degrees), so a
 * card and the map agree. A map outline, not an illustration: one 2 px road-edge stroke.
 */
export function Silhouette({ circuitKey, className = "", label }: { circuitKey: number | null; className?: string; label?: string }) {
  const path = useMemo(() => {
    const meta = circuitMeta(circuitKey);
    const pts = meta?.silhouette;
    if (!pts || pts.length < 3) return null;
    const a = (((meta.rotation ?? 90) - 90) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const rot = pts.map(([x, y0]) => {
      const y = -y0;
      return [x * c - y * s, x * s + y * c] as const;
    });
    const xs = rot.map((p) => p[0]);
    const ys = rot.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 || 1;
    const h = Math.max(...ys) - y0 || 1;
    // Fit into a 100 x 100 box, centred, 4 units of room for the stroke.
    const k = 92 / Math.max(w, h);
    const ox = (100 - w * k) / 2;
    const oy = (100 - h * k) / 2;
    return `${rot.map((p, i) => `${i ? "L" : "M"}${(ox + (p[0] - x0) * k).toFixed(1)},${(oy + (p[1] - y0) * k).toFixed(1)}`).join("")}Z`;
  }, [circuitKey]);
  if (!path) return <span className={`sil sil--none ${className}`} aria-hidden="true" />;
  return (
    <svg className={`sil ${className}`} viewBox="0 0 100 100" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <path d={path} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
