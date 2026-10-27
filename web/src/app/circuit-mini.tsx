import { useEffect, useState } from 'react';
import { getJson, url } from '../lib/api';
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

type Pts = Array<[number, number]>;

/** Closed outline path in the session map's orientation (y flipped, turned by rotation - 90 degrees). */
function layout(sil: Pts, rotation: number): Mini | null {
  if (sil.length <= 3) return null;
  const turn = (a: number) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return sil.map(([x, y]) => ({ x: x * c + y * s, y: x * s - y * c }));
  };
  // Same rule as the session map: broadcast turn of (rotation - 90) degrees, then a further
  // quarter when the shape would stand tall in a wide box.
  let a = ((rotation - 90) * Math.PI) / 180;
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
  return { d, w, h, tick };
}

function build(circuit: number): Mini | null {
  const hit = CACHE.get(circuit);
  if (hit !== undefined) return hit;
  const meta = circuitMeta(circuit);
  const sil = meta?.silhouette;
  const out = sil ? layout(sil as Pts, meta?.rotation ?? 90) : null;
  CACHE.set(circuit, out);
  return out;
}

/** Fallback outlines from the recorded lap, for circuits with no stored silhouette. */
const RECORDED = new Map<number, Mini | null>();
const PENDING = new Map<number, Promise<void>>();

function fetchRecorded(circuit: number): Promise<void> {
  const open = PENDING.get(circuit);
  if (open) return open;
  const p = getJson<{ points: Array<{ x: number; y: number }> }>(url(`/circuits/${circuit}/outline`))
    .then((r) => {
      RECORDED.set(
        circuit,
        layout(
          r.points.map((p) => [p.x, p.y]),
          circuitMeta(circuit)?.rotation ?? 90
        )
      );
    })
    .catch((e: unknown) => {
      // Only a 404 means there is no outline; anything else retries on the next mount.
      if ((e as { status?: number } | null)?.status === 404) RECORDED.set(circuit, null);
    })
    .finally(() => {
      PENDING.delete(circuit);
    });
  PENDING.set(circuit, p);
  return p;
}

function useRecorded(circuit: number | null | undefined, enabled: boolean): Mini | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled || circuit === null || circuit === undefined || RECORDED.has(circuit)) return;
    let live = true;
    fetchRecorded(circuit).finally(() => {
      if (live) bump((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [circuit, enabled]);
  return enabled && circuit !== null && circuit !== undefined ? (RECORDED.get(circuit) ?? null) : null;
}

/** A small outline of a circuit from its stored silhouette, or the recorded lap when none is stored. Pure for stored ones; the box is reserved even without one. */
export function CircuitMini({
  circuit,
  className,
  label,
  weight = 5,
}: {
  circuit: number | null | undefined;
  className?: string;
  label?: string;
  /** Stroke width in CSS px (non-scaling), so it can be matched to the type weight beside it. */
  weight?: number;
}) {
  const stored = circuit === null || circuit === undefined ? null : build(circuit);
  const recorded = useRecorded(circuit, !stored);
  const mini = stored ?? recorded;
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
      strokeWidth={weight}
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
          <path
            d={mini.tick}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="butt"
            strokeWidth={weight * 1.3}
          />
        </>
      ) : null}
    </svg>
  );
}
