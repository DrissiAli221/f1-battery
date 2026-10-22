import { useMemo } from "react";
import { useSize } from "../lib/useSize";

type Dir = "down" | "up" | "right" | "left" | "radial";

interface Props {
  /** Solid colour the ramp starts from. */
  a?: string;
  /** Solid colour the ramp ends in: usually the page ground, so the block blends into it. */
  b?: string;
  dir?: Dir;
  /** Grid pitch in CSS px. */
  pitch?: number;
  /** Grid rotation in degrees (45 reads as newsprint). */
  angle?: number;
  /** Where the ramp begins and ends along the axis, 0..1 of the box. */
  start?: number;
  end?: number;
  /** "flip": the poster's two-phase ramp (dots close, ground flips). "grow": one phase, dots of B
   *  grow on A and never close, so the block needs a gradient to finish into the ground. */
  mode?: "flip" | "grow";
  className?: string;
}

/*
 * A regular-grid halftone ramp between two solid colours, the way the Jeddah 2025 GP poster
 * fades red into black: dots of B grow on A until they touch, then the ground flips to B and
 * dots of A shrink away. Pure SVG built from the box's measured size, so it costs nothing to
 * ship and scales to any width. Decorative: aria-hidden, never carries data.
 */
export function Halftone({ a = "#ea0a0a", b = "#000000", dir = "down", pitch = 14, angle = 0, start = 0, end = 1, mode = "flip", className = "" }: Props) {
  const [ref, { w: W, h: H }] = useSize<HTMLDivElement>();
  const paths = useMemo(() => {
    if (W < 1 || H < 1) return null;
    const axis = (x: number, y: number) => {
      let t: number;
      if (dir === "down") t = y / H;
      else if (dir === "up") t = 1 - y / H;
      else if (dir === "right") t = x / W;
      else if (dir === "left") t = 1 - x / W;
      else t = Math.hypot(x - W / 2, y - H / 2) / (Math.min(W, H) / 2);
      return Math.min(1, Math.max(0, (t - start) / (end - start)));
    };
    const circ = (x: number, y: number, r: number) => `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`;
    const rad = (angle * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const diag = Math.hypot(W, H);
    const rmax = mode === "grow" ? pitch * 0.46 : pitch * 0.56;
    let pa = "";
    let pb = "";
    for (let v = -diag; v <= diag; v += pitch) {
      for (let u = -diag; u <= diag; u += pitch) {
        const x = W / 2 + u * c - v * s;
        const y = H / 2 + u * s + v * c;
        if (x < -pitch || y < -pitch || x > W + pitch || y > H + pitch) continue;
        const t = axis(x, y);
        if (t <= 0 || t >= 1) continue;
        if (mode === "grow") pb += circ(x, y, rmax * Math.sqrt(t));
        else if (t < 0.5) pb += circ(x, y, rmax * Math.sqrt(t / 0.5));
        else pa += circ(x, y, rmax * Math.sqrt((1 - t) / 0.5));
      }
    }
    // The ground past the midpoint is B.
    const tm = start + 0.5 * (end - start);
    let far: React.ReactNode = null;
    if (mode === "grow") far = null;
    else if (dir === "radial") far = <circle cx={W / 2} cy={H / 2} r={(tm * Math.min(W, H)) / 2} fill={a} />;
    else if (dir === "down") far = <rect x={0} y={tm * H} width={W} height={H} fill={b} />;
    else if (dir === "up") far = <rect x={0} y={0} width={W} height={(1 - tm) * H} fill={b} />;
    else if (dir === "right") far = <rect x={tm * W} y={0} width={W} height={H} fill={b} />;
    else far = <rect x={0} y={0} width={(1 - tm) * W} height={H} fill={b} />;
    return { pa, pb, far };
  }, [W, H, a, b, dir, pitch, angle, start, end, mode]);

  return (
    <div ref={ref} className={`halftone ${className}`} aria-hidden="true">
      {paths && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
          <rect width={W} height={H} fill={dir === "radial" && mode === "flip" ? b : a} />
          {paths.far}
          <path d={paths.pb} fill={b} />
          <path d={paths.pa} fill={a} />
        </svg>
      )}
    </div>
  );
}
