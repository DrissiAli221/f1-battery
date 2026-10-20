import { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { TrackMap, type MapRun, type MapTag, type TrackMapHandle } from "../track/TrackMap";
import { REGIME_VAR } from "../track/regimes";
import { driverCode, teamColour } from "../lib/teams";
import { lapLength, wrap, type CircuitRef, type Projection } from "../lib/track";
import { prefersReducedMotion } from "../motion";
import type { Driver, Outline } from "../lib/types";
import type { LiveState } from "./useLive";

export interface TrailPoint {
  d: number;
  regime: LiveState["regime"];
}

interface Props {
  outline: Outline;
  circuit: CircuitRef | null;
  /** Every car, in tower order. */
  order: Driver[];
  states: LiveState[];
  selected: number | null;
  trail: TrailPoint[];
  /** Paused: the tags hold where they are. */
  paused: boolean;
}

/** Chip box used to keep resting tags apart, px (a three-letter code with padding, plus air). */
const CHIP = { w: 46, h: 24 };
/** The chip sits this far out from its dot (track.css, level 0). */
const OUT = 22;

type Box = { x: number; y: number; w: number; h: number };
const hit = (a: Box, b: Box) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

/*
 * Rest positions without a feed: the cars queue behind the line in tower order. Each one
 * steps back along the road until its chip clears every chip already placed, the corner
 * numbers and the start/finish label, and its dot is far enough from the others that the
 * map does not stack it (track.css stacks dots closer than 26 px). On a small map the lap
 * may be too short for that; the rules then relax step by step, last to even spacing.
 */
function restPositions(T: Projection, n: number): number[] {
  const s0 = T.pose(0);
  const passes: { chip: { w: number; h: number } | null; marks: boolean }[] = [
    { chip: CHIP, marks: true },
    { chip: { w: 40, h: 18 }, marks: false },
    { chip: null, marks: false },
  ];
  for (const pass of passes) {
    const boxes: Box[] = pass.marks ? T.corners.map((c) => ({ x: c.lx, y: c.ly, w: 22, h: 22 })) : [];
    if (pass.marks) boxes.push({ x: s0.x - s0.nx * 40, y: s0.y - s0.ny * 40, w: 110, h: 34 });
    const dots: { x: number; y: number }[] = [];
    const out: number[] = [];
    const step = 2 * T.mpp;
    let d = 0;
    for (let i = 0; i < n && -d < T.lap; i++) {
      for (;;) {
        d -= step;
        if (-d >= T.lap) break;
        const q = T.pose(d);
        if (dots.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 28)) continue;
        if (pass.chip) {
          const chip = { x: q.x - q.nx * OUT, y: q.y - q.ny * OUT, ...pass.chip };
          if (boxes.some((b) => hit(chip, b))) continue;
          boxes.push(chip);
        }
        dots.push(q);
        out.push(wrap(d, T.lap));
        break;
      }
    }
    if (out.length === n) return out;
  }
  return Array.from({ length: n }, (_, i) => wrap(-((i + 1) * T.lap) / (n + 1), T.lap));
}

/*
 * The live map: the shared road (src/track/TrackMap) with one team-colour tag per car. Tags
 * glide toward their latest estimated lap distance on gsap.ticker (wrapping over the line),
 * so a 4 Hz feed reads as motion; nothing moves while paused. The selected car carries a
 * trail coloured by its live regime.
 *
 * Positions are `lap_distance_est` mod the outline's lap (docs/phase7-replay.md): pace and
 * wrap-around are right, the absolute place along the lap is approximate and drifts.
 */
export function LiveMap({ outline, circuit, order, states, selected, trail, paused }: Props) {
  const map = useRef<TrackMapHandle>(null);
  const shown = useRef(new Map<number, number>());
  const targets = useRef(new Map<number, number>());
  // The map's projection, known once it has measured itself (re-read when it changes).
  const [proj, setProj] = useState<Projection | null>(null);
  const projRef = useRef<Projection | null>(null);

  for (const s of states) targets.current.set(s.driver_number, s.lap_distance_est);

  // The tags' clock: ease each tag toward its target distance; nothing moves while paused.
  useEffect(() => {
    const tick = (_t: number, dtMs: number) => {
      const m = map.current;
      const T = m?.projection();
      if (!m || !T) return;
      if (T !== projRef.current) {
        projRef.current = T;
        setProj(T);
      }
      if (paused) return;
      const k = prefersReducedMotion() ? 1 : 1 - Math.exp(-Math.min(dtMs, 50) / 250);
      for (const [n, target] of targets.current) {
        const cur = shown.current.get(n);
        if (cur === undefined) {
          shown.current.set(n, target);
          m.place(n, target);
          continue;
        }
        const delta = wrap(target - cur + T.lap / 2, T.lap) - T.lap / 2;
        const next = Math.abs(delta) > T.lap / 3 ? target : cur + delta * k;
        shown.current.set(n, next);
        m.place(n, next);
      }
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [paused]);

  const lap = useMemo(() => lapLength(outline), [outline]);
  const rest = useMemo(() => (proj ? restPositions(proj, order.length) : null), [proj, order.length]);
  const restAt = (i: number) => rest?.[i] ?? wrap(-(i + 1) * 40, lap);

  const live = useMemo(() => new Set(states.map((s) => s.driver_number)), [states]);

  // Every render places the tags from props, so hand over the eased distance, not the target.
  const tags: MapTag[] = order.map((d, i) => {
    const n = d.driver_number;
    const has = live.has(n);
    return {
      id: n,
      code: driverCode(d),
      colour: teamColour(d),
      d: has ? shown.current.get(n) ?? targets.current.get(n) ?? 0 : restAt(i),
      on: n === selected,
      dim: !has,
    };
  });

  // The selected car's trail, split into runs of one regime.
  const runs = useMemo(() => {
    const out: MapRun[] = [];
    if (trail.length < 2 || !lap) return out;
    let start = 0;
    for (let i = 1; i <= trail.length; i++) {
      if (i === trail.length || trail[i].regime !== trail[start].regime) {
        const a = trail[start].d;
        const b = trail[Math.min(i, trail.length - 1)].d;
        const len = wrap(b - a, lap);
        if (len > 1 && len < lap / 2) out.push({ d0: a, d1: b, colour: REGIME_VAR[trail[start].regime], kind: "trail" });
        start = i;
      }
    }
    return out;
  }, [trail, lap]);

  return <TrackMap ref={map} outline={outline} circuit={circuit} runs={runs} tags={tags} corners compass scale sf className="lv-map" label="Live track map" />;
}
