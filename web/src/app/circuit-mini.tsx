import { circuitMeta } from '../track/circuits';

const SIZE = 200;
const PAD = 0.06;
const TICK = 6;

interface Mini {
  d: string;
  w: number;
  h: number;
  tick: string;
}

const CACHE = new Map<number, Mini | null>();

/** Closed outline path in the session map's orientation (y flipped, turned by rotation - 90 degrees). */
function build(circuit: number): Mini | null {
  const hit = CACHE.get(circuit);
  if (hit !== undefined) return hit;
  const meta = circuitMeta(circuit);
  const sil = meta?.silhouette;
  let out: Mini | null = null;
  if (sil && sil.length > 3) {
    const turn = (a: number) => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      return sil.map(([x, y]) => ({ x: x * c + y * s, y: x * s - y * c }));
    };
    // Same rule as the session map: broadcast turn of (rotation - 90) degrees, then a further
    // quarter when the shape would stand tall in a wide box.
    let a = (((meta?.rotation ?? 90) - 90) * Math.PI) / 180;
    let pts = turn(a);
    const ext = (v: number[]) => Math.max(...v) - Math.min(...v);
    if (ext(pts.map((p) => p.y)) > ext(pts.map((p) => p.x))) {
      a += Math.PI / 2;
      pts = turn(a);
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const bw = Math.max(...xs) - minX || 1;
    const bh = Math.max(...ys) - minY || 1;
    const k = (SIZE * (1 - 2 * PAD)) / Math.max(bw, bh);
    const w = bw * k + SIZE * 2 * PAD;
    const h = bh * k + SIZE * 2 * PAD;
    const px = pts.map((p) => ({ x: (p.x - minX) * k + SIZE * PAD, y: (p.y - minY) * k + SIZE * PAD }));
    const f = (n: number) => n.toFixed(1);
    const d = px.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + 'Z';
    // Start/finish tick, perpendicular to the path at the first point.
    const n = px[1];
    const m = px[px.length - 1];
    const tx = n.x - m.x;
    const ty = n.y - m.y;
    const len = Math.hypot(tx, ty) || 1;
    const nx = (-ty / len) * (TICK / 2);
    const ny = (tx / len) * (TICK / 2);
    const tick = `M${f(px[0].x - nx)} ${f(px[0].y - ny)}L${f(px[0].x + nx)} ${f(px[0].y + ny)}`;
    out = { d, w, h, tick };
  }
  CACHE.set(circuit, out);
  return out;
}

/** A small outline of a circuit from its stored silhouette. Pure; the box is reserved even without one. */
export function CircuitMini({
  circuit,
  className,
  label,
}: {
  circuit: number | null | undefined;
  className?: string;
  label?: string;
}) {
  const mini = circuit === null || circuit === undefined ? null : build(circuit);
  const w = mini?.w ?? SIZE;
  const h = mini?.h ?? SIZE;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w.toFixed(1)} ${h.toFixed(1)}`}
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {label ? <title>{label}</title> : null}
      {mini ? (
        <>
          <path d={mini.d} vectorEffect="non-scaling-stroke" />
          <path d={mini.tick} vectorEffect="non-scaling-stroke" strokeLinecap="butt" strokeWidth={2.4} />
        </>
      ) : null}
    </svg>
  );
}
