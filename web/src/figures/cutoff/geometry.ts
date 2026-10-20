/*
 * Fig. 1's world and its static paths (anatomy: geometry in plain .ts, built once per
 * profile). World units are about one screen px; x runs down the straight, y toward the viewer,
 * z up. The cam is the only part whose shape depends on the data: its top edge is the
 * profile's speed, so the art is rebuilt when a new profile arrives, never per frame.
 *
 * Layout, back to front: the cam bed and the cam plate (y −5 to 0), the floor rail (y 16 to 22)
 * with the carriage on it, the ruler in metres along the front edge (y 44 to 52). The carriage
 * carries a column; the follower head slides on the column, and its arm reaches back over the
 * cam with a roller on the cut edge. A face-up dial on the column top reads acceleration; a
 * drop pin on the carriage front marks the ruler.
 */
import {
  cylinder,
  fitProjection,
  insetPlan,
  iso,
  knurl,
  lineOnTop,
  onTop,
  pathOf,
  planOutline,
  ring,
  segment,
  sideArc,
  sideSeam,
  slabOf,
  topMatrix,
  translateAlong,
  type Flat,
  type Plan,
  type Point3,
  type SolidPaths,
} from "../iso/iso-kit";
import { speedAt, type Profile } from "../../instrument/driver";
import { CROSS_V_MIN_KPH, A_CROSS, type Reading } from "./model";

export const WIDTH = 600;
export const HEIGHT = 320;
export const AZIMUTH = 62;

export const PLATE: Plan = { x: -186, y: -40, w: 372, d: 100, r: 8 };
const PLATE_H = 9;
const FOOT_H = 5;

export const CAM_X0 = -150;
export const CAM_X1 = 150;
const CAM_YB = -5;
const CAM_YF = 0;
const BED_TOP = 5;
const CAM_FLOOR = 12; // cam height above the bed at the lowest speed of the axis
const CAM_RISE = 56; // cam height for the whole speed axis
const BED: Plan = { x: -164, y: -11, w: 328, d: 15, r: 2 };

const RAIL: Plan = { x: -176, y: 16, w: 352, d: 6, r: 1 };
const RAIL_H = 4;
const RULER: Plan = { x: -160, y: 44, w: 320, d: 8.5, r: 1 };
const RULER_Z = 0.8;

const CARRIAGE: Plan = { x: -15, y: 10, w: 30, d: 30, r: 2.5 };
const CAR_Z = RAIL_H;
const CAR_TOP = 10;
const COLUMN: Plan = { x: -4, y: 14, w: 8, d: 8, r: 1.2 };
const COLUMN_TOP = 98;
const ROLLER_R = 4.4;
const ROLLER_Y = -2.5;
/** The follower is built with its roller resting on a cam edge at this height; it moves by dz. */
export const REST_TOP = BED_TOP + CAM_FLOOR;
const ROLLER_Z = REST_TOP + ROLLER_R;
const ARM_Z = ROLLER_Z + 6;
const HEAD: Plan = { x: -7, y: 11, w: 14, d: 14, r: 2 };
const HEAD_Z = ARM_Z - 4;
const HEAD_H = 13;
const DIAL: [number, number] = [0, 18];
const DIAL_R = 15;
const DIAL_Z = COLUMN_TOP + 3;
const DIAL_H = 8;
export const DIAL_TOP = DIAL_Z + DIAL_H;
const PIN: [number, number] = [0, 46.2];
const PIN_R = 1.15;
export const PIN_UP = 3.2; // how far the pin is lifted from the ruler at rest
const HOUSING: Plan = { x: -4.5, y: 40, w: 9, d: 4.4, r: 1 };

/** The dial's scale: −2 to 8 m/s² over 270°, clockwise, 0.5 m/s² per minor tick. */
export const DIAL_MIN = -2;
export const DIAL_MAX = 8;
const SWEEP = (270 * Math.PI) / 180;
const DIAL_FROM = -SWEEP / 2;

export const P = fitProjection(
  [
    [PLATE.x, PLATE.y, -PLATE_H - FOOT_H],
    [PLATE.x + PLATE.w, PLATE.y, -PLATE_H - FOOT_H],
    [PLATE.x, PLATE.y + PLATE.d, -PLATE_H - FOOT_H],
    [PLATE.x + PLATE.w, PLATE.y + PLATE.d, -PLATE_H - FOOT_H],
    [CAM_X0, CAM_YB, BED_TOP + CAM_FLOOR + CAM_RISE],
    [CAM_X1, CAM_YB, BED_TOP + CAM_FLOOR + CAM_RISE],
    [CAM_X0 - DIAL_R, DIAL[1] - DIAL_R, DIAL_TOP],
    [CAM_X1 + DIAL_R, DIAL[1] + DIAL_R, DIAL_TOP],
  ],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: AZIMUTH },
);

export const at = (p: Point3): Flat => iso(p, P);
const S = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const C = (cx: number, cy: number, r: number, z: number, h: number, steps = 24) => cylinder(cx, cy, r, z, h, P, steps);
const seg = (a: Point3, b: Point3) => segment(a, b, P);
const join = (list: string[]) => list.filter(Boolean).join("");

/** Screen translate for a world offset (the carriage along x, the follower along z). */
export const shift = (dx: number, dz = 0) => translateAlong(P, [dx, 0, dz]);

// ---------------------------------------------------------------- the profile on the cam

export interface Cam {
  L: number;
  xOf: (m: number) => number;
  mOf: (x: number) => number;
  /** Height of the cam edge at d metres. */
  topAt: (m: number) => number;
}

export function camOf(p: Profile, r: Reading): Cam {
  const L = p.length_m || 1;
  const [lo, hi] = r.domain;
  const xOf = (m: number) => CAM_X0 + (Math.max(0, Math.min(L, m)) / L) * (CAM_X1 - CAM_X0);
  const mOf = (x: number) => ((x - CAM_X0) / (CAM_X1 - CAM_X0)) * L;
  const topAt = (m: number) => BED_TOP + CAM_FLOOR + ((speedAt(p, m) - lo) / (hi - lo || 1)) * CAM_RISE;
  return { L, xOf, mOf, topAt };
}

function area(points: Flat[]) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    a += ax * by - bx * ay;
  }
  return a / 2;
}
const poly = (points: Flat[]) => pathOf(area(points) < 0 ? [...points].reverse() : points, true);

/** The kit's shade bucket for a vertical face with floor normal n. */
function shadeOf(nx: number, ny: number) {
  const a = (AZIMUTH * Math.PI) / 180;
  const lit = (nx * -Math.sin(a) + ny * Math.cos(a) + 1) / 2;
  return Math.min(3, Math.max(0, Math.floor(lit * 4)));
}

/**
 * The cam plate as a solid: a vertical plate whose top edge is cut to the profile. Visible
 * faces: the front (+y), the cut edge (drawn as the top, the machined surface) and the right
 * end (+x). Built by hand because the kit's prisms stand on the floor; the paths follow the
 * kit's SolidPaths so <Solid> paints it in the same order and tones.
 */
function camSolid(cam: Cam, samples: number[]): SolidPaths {
  const xs = samples.map(cam.xOf);
  const zs = samples.map(cam.topAt);
  const n = xs.length;
  const front: Flat[] = [at([xs[0], CAM_YF, BED_TOP]), at([xs[n - 1], CAM_YF, BED_TOP])];
  for (let i = n - 1; i >= 0; i--) front.push(at([xs[i], CAM_YF, zs[i]]));
  const frontTop = xs.map((x, i) => at([x, CAM_YF, zs[i]]));
  const backTop = xs.map((x, i) => at([x, CAM_YB, zs[i]]));
  const ribbon = [...frontTop, ...[...backTop].reverse()];
  const x1 = xs[n - 1];
  const z1 = zs[n - 1];
  const end = [at([x1, CAM_YF, BED_TOP]), at([x1, CAM_YB, BED_TOP]), at([x1, CAM_YB, z1]), at([x1, CAM_YF, z1])];
  const shades = ["", "", "", ""];
  shades[shadeOf(0, 1)] += poly(front);
  shades[shadeOf(1, 0)] += poly(end);
  const fill = poly(front) + poly(ribbon) + poly(end);
  const outline = join([
    pathOf([at([xs[0], CAM_YF, BED_TOP]), at([xs[0], CAM_YF, zs[0]]), at([xs[0], CAM_YB, zs[0]])]),
    pathOf(backTop),
    pathOf([at([x1, CAM_YB, z1]), at([x1, CAM_YB, BED_TOP]), at([x1, CAM_YF, BED_TOP]), at([xs[0], CAM_YF, BED_TOP])]),
  ]);
  const crease = join([pathOf(frontTop), pathOf([at([x1, CAM_YF, BED_TOP]), at([x1, CAM_YF, z1]), at([x1, CAM_YB, z1])])]);
  return { fill, outline, crease, top: poly(ribbon), shades };
}

// ---------------------------------------------------------------- the static art

const clampXsAll = [-112, 0, 112];

export interface Art {
  base: {
    halo: string;
    feet: SolidPaths[][];
    slab: SolidPaths;
    groove: string;
    screwRings: string;
    screws: Flat[];
    label: SolidPaths;
    labelLine: string;
    labelRule: string;
    labelScrews: Flat[];
  };
  cam: {
    bed: SolidPaths;
    bedSeam: string;
    bedScrews: Flat[];
    plate: SolidPaths;
    gate: string;
    grid: string;
    bolts: Flat[];
    ticks: string;
    clamps: SolidPaths[];
    clampScrews: Flat[];
  };
  rail: { bar: SolidPaths; stops: SolidPaths[]; stopScrews: Flat[]; screws: Flat[] };
  ruler: {
    strip: SolidPaths;
    minor: string;
    major: string;
    zero: string;
    bracket: string;
  };
  marker: { body: SolidPaths; index: string };
}

export function buildArt(p: Profile, r: Reading, cam: Cam): Art {
  // Base plate on feet.
  const feet = [
    [PLATE.x + 22, PLATE.y + 18],
    [PLATE.x + PLATE.w - 22, PLATE.y + 18],
    [PLATE.x + 22, PLATE.y + PLATE.d - 18],
    [PLATE.x + PLATE.w - 22, PLATE.y + PLATE.d - 18],
  ].sort((a, b) => a[0] * 0.47 + a[1] * 0.88 - (b[0] * 0.47 + b[1] * 0.88));
  const screws = [
    [PLATE.x + 9, PLATE.y + 9],
    [PLATE.x + PLATE.w - 9, PLATE.y + 9],
    [PLATE.x + 9, PLATE.y + PLATE.d - 9],
    [PLATE.x + PLATE.w - 9, PLATE.y + PLATE.d - 9],
  ];
  const LABEL: Plan = { x: PLATE.x + 16, y: PLATE.y + 7, w: 46, d: 12, r: 1.6 };

  // Cam: sample the profile every 2 m of cam (about 7 m of straight).
  const samples: number[] = [];
  const n = 150;
  for (let i = 0; i <= n; i++) samples.push((i / n) * cam.L);
  const plate = camSolid(cam, samples);

  // The 250 kph line on the cam face: where the cut edge is above it, edge to edge.
  const [lo, hi] = r.domain;
  const zGate = BED_TOP + CAM_FLOOR + ((CROSS_V_MIN_KPH - lo) / (hi - lo || 1)) * CAM_RISE;
  let gate = "";
  {
    let from: number | null = null;
    for (let m = 0; m <= cam.L; m += 1) {
      const above = cam.topAt(m) > zGate + 0.3;
      if (above && from === null) from = m;
      if ((!above || m + 1 > cam.L) && from !== null) {
        gate += seg([cam.xOf(from), CAM_YF, zGate], [cam.xOf(above ? cam.L : m), CAM_YF, zGate]);
        from = null;
      }
    }
  }
  // Speed lines engraved across the cam face every 50 kph, each from where the cut edge rises
  // above it to the right end (the 250 kph line is the gate, drawn apart in a brighter tone).
  const zOfV = (v: number) => BED_TOP + CAM_FLOOR + ((v - lo) / (hi - lo || 1)) * CAM_RISE;
  const grid: string[] = [];
  for (let v = Math.ceil((lo + 1) / 50) * 50; v < hi; v += 50) {
    if (v === CROSS_V_MIN_KPH) continue;
    const z = zOfV(v);
    let from: number | null = null;
    for (let m = 0; m <= cam.L; m += 1) {
      const above = cam.topAt(m) > z + 0.6;
      if (above && from === null) from = m;
      if ((!above || m + 1 > cam.L) && from !== null) {
        grid.push(seg([cam.xOf(from), CAM_YF, z], [cam.xOf(above ? cam.L : m), CAM_YF, z]));
        from = null;
      }
    }
  }
  const bolts: Flat[] = [];
  for (let x = CAM_X0 + 10; x <= CAM_X1 - 10; x += 20) if (!clampXsAll.some((c) => Math.abs(c - x) < 9)) bolts.push(at([x, CAM_YF, BED_TOP + 3.6]));
  // The 0.25 s grid hangs from the cam's front edge: denser where the car is slow.
  const ticks = join(r.ticks.map((t) => seg([cam.xOf(t.d), CAM_YF, cam.topAt(t.d)], [cam.xOf(t.d), CAM_YF, cam.topAt(t.d) - 3])));
  const clampXs = clampXsAll;

  // Ruler in metres: a minor tick per 50 m bin, a major one per 250 m.
  const minor: string[] = [];
  const major: string[] = [];
  for (let m = 50; m <= cam.L + 1e-6; m += 50) {
    const big = m % 250 === 0;
    (big ? major : minor).push(lineOnTop([cam.xOf(m), RULER.y], [cam.xOf(m), RULER.y + (big ? 4.2 : 2.4)], RULER_Z, P));
  }
  const zero = lineOnTop([cam.xOf(0), RULER.y], [cam.xOf(0), RULER.y + 4.2], RULER_Z, P);
  // The session's median cut-off interval, engraved as a bracket on the front edge.
  let bracket = "";
  if (p.ci_low_m !== null && p.ci_high_m !== null) {
    const a = cam.xOf(p.ci_low_m);
    const b = Math.max(cam.xOf(p.ci_high_m), a + 1.5);
    const yb = RULER.y + 6.4;
    const ye = RULER.y + RULER.d;
    bracket = join([onTop([[a, ye], [a, yb], [b, yb], [b, ye]], RULER_Z, P)]);
  }

  return {
    base: {
      halo: slabOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P).fill,
      feet: feet.map(([x, y]) => [C(x, y, 7, -PLATE_H - FOOT_H, 1.6, 28), C(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, 28)]),
      slab: S(PLATE, -PLATE_H, PLATE_H, 8, 1.6),
      groove: planOutline(insetPlan(PLATE, 4.5), 0, P),
      screwRings: join(screws.map(([x, y]) => ring(x, y, 2.2, 0, P, 16))),
      screws: screws.map(([x, y]) => at([x, y, 0])),
      label: S(LABEL, 0, 0.8, 3),
      labelLine: planOutline(insetPlan(LABEL, 1.5), 0.8, P, 3),
      labelRule: join([0, 1, 2].map((row) => lineOnTop([LABEL.x + 7, LABEL.y + 3.6 + row * 2.4], [LABEL.x + (row === 1 ? 28 : 38), LABEL.y + 3.6 + row * 2.4], 0.8, P))),
      labelScrews: [at([LABEL.x + 3.4, LABEL.y + LABEL.d / 2, 0.8]), at([LABEL.x + LABEL.w - 3.4, LABEL.y + LABEL.d / 2, 0.8])],
    },
    cam: {
      bed: S(BED, 0, BED_TOP, 3, 0.6),
      bedSeam: sideSeam(BED, 2, P, 3),
      bedScrews: [BED.x + 5, BED.x + BED.w - 5].map((x) => at([x, BED.y + 3, BED_TOP])),
      plate,
      gate,
      grid: join(grid),
      bolts,
      ticks,
      clamps: clampXs.map((x) => S({ x: x - 6, y: CAM_YF, w: 12, d: 3.4, r: 0.8 }, BED_TOP, 8, 2, 0.4)),
      clampScrews: clampXs.flatMap((x) => [at([x - 3, CAM_YF + 1.7, BED_TOP + 8]), at([x + 3, CAM_YF + 1.7, BED_TOP + 8])]),
    },
    rail: {
      bar: S(RAIL, 0, RAIL_H, 3, 0.5),
      stops: [RAIL.x - 6, RAIL.x + RAIL.w + 1].map((x) => S({ x, y: RAIL.y - 4, w: 5, d: RAIL.d + 8, r: 1.2 }, 0, 9, 3, 0.5)),
      stopScrews: [RAIL.x - 3.5, RAIL.x + RAIL.w + 3.5].flatMap((x) => [at([x, RAIL.y - 1.5, 9]), at([x, RAIL.y + RAIL.d + 1.5, 9])]),
      screws: [-120, -40, 40, 120].map((x) => at([x, RAIL.y + RAIL.d / 2, RAIL_H])),
    },
    ruler: {
      strip: S(RULER, 0, RULER_Z, 3),
      minor: join(minor),
      major: join(major),
      zero,
      bracket,
    },
    marker: {
      body: S({ x: -1.6, y: RULER.y + 4.6, w: 3.2, d: RULER.d - 4.4, r: 0.6 }, RULER_Z, 1.6, 2),
      index: seg([0, RULER.y + RULER.d + 0.2, RULER_Z + 1.6], [0, RULER.y + RULER.d + 0.2, RULER_Z]),
    },
  };
}

// ---------------------------------------------------------------- the carriage (built at x = 0)

const LAMPS = [6, 8.6, 11.2, 13.8];
export const LAMP_POINTS = LAMPS.map((x) => at([x, CARRIAGE.y + CARRIAGE.d - 3.2, CAR_TOP]));

function forkPlate(y: number) {
  return S({ x: -2, y, w: 4, d: 1, r: 0.3 }, ROLLER_Z - 1.2, ARM_Z - ROLLER_Z + 1.2, 2);
}

/** A roller on an axle along y, seen on its front face: rim, web and hub. */
function roller() {
  const face = (y: number, r: number) => {
    const pts: Flat[] = [];
    for (let i = 0; i < 40; i++) {
      const t = (i / 40) * Math.PI * 2;
      pts.push(at([r * Math.cos(t), y, ROLLER_Z + r * Math.sin(t)]));
    }
    return pts;
  };
  const front = face(ROLLER_Y + 1.4, ROLLER_R);
  const back = face(ROLLER_Y - 1.4, ROLLER_R);
  return {
    fill: poly(hullOf([...back, ...front])),
    face: poly(front),
    rim: pathOf(front, true),
    web: pathOf(face(ROLLER_Y + 1.4, ROLLER_R - 1.1), true),
    hub: at([0, ROLLER_Y + 1.4, ROLLER_Z]),
  };
}

function hullOf(points: Flat[]): Flat[] {
  const s = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Flat, a: Flat, b: Flat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Flat[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Flat[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function dialTicks() {
  const minor: string[] = [];
  const major: string[] = [];
  const steps = (DIAL_MAX - DIAL_MIN) * 2;
  const [cx, cy] = DIAL;
  const outer = DIAL_R - 2.6;
  let gate = "";
  for (let i = 0; i <= steps; i++) {
    const v = DIAL_MIN + i / 2;
    const ang = DIAL_FROM + (i / steps) * SWEEP;
    const big = Number.isInteger(v);
    const isGate = Math.abs(v - A_CROSS) < 1e-9;
    const inner = outer - (isGate ? 4.2 : big ? 2.6 : 1.4);
    const d = lineOnTop([cx + Math.sin(ang) * inner, cy - Math.cos(ang) * inner], [cx + Math.sin(ang) * outer, cy - Math.cos(ang) * outer], DIAL_TOP, P);
    if (isGate) gate = d;
    else (big ? major : minor).push(d);
  }
  return { minor: join(minor), major: join(major), gate };
}

/** The 0.5 m/s² band: an arc on the face from the bottom of the scale to the 0.5 mark. */
function belowArc() {
  const [cx, cy] = DIAL;
  const rr = DIAL_R - 2.6;
  const to = DIAL_FROM + ((A_CROSS - DIAL_MIN) / (DIAL_MAX - DIAL_MIN)) * SWEEP;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = DIAL_FROM + (i / 24) * (to - DIAL_FROM);
    pts.push([cx + Math.sin(t) * rr, cy - Math.cos(t) * rr]);
  }
  return onTop(pts, DIAL_TOP, P);
}

/** The needle at a, in carriage-local screen space (rebuilt per frame; it turns about z). */
export function needleAt(a: number) {
  const v = Math.max(DIAL_MIN - 0.15, Math.min(DIAL_MAX + 0.15, a));
  const ang = DIAL_FROM + ((v - DIAL_MIN) / (DIAL_MAX - DIAL_MIN)) * SWEEP;
  const [cx, cy] = DIAL;
  const s = Math.sin(ang);
  const c = -Math.cos(ang);
  return lineOnTop([cx - s * 3.2, cy - c * 3.2], [cx + s * (DIAL_R - 4), cy + c * (DIAL_R - 4)], DIAL_TOP + 0.2, P);
}

export function buildCarriage() {
  const T = dialTicks();
  const r = roller();
  const KNOB: [number, number] = [4, HEAD.y + 4];
  const BRACKET: Plan = { x: -6, y: 13, w: 12, d: 10, r: 1.4 };
  return {
    halo: slabOf(insetPlan(CARRIAGE, 2), CAR_Z, 0.1, P).fill,
    plate: S(CARRIAGE, CAR_Z, CAR_TOP - CAR_Z, 4, 0.6),
    plateSeam: sideSeam(CARRIAGE, CAR_Z + 2.2, P, 4),
    gib: S({ x: -12, y: RAIL.y + RAIL.d, w: 24, d: 3, r: 0.6 }, 0.6, CAR_Z - 0.6, 2),
    rivets: [-12, 12].flatMap((x) => [at([x, CARRIAGE.y + 3, CAR_TOP]), at([x, CARRIAGE.y + CARRIAGE.d - 7, CAR_TOP])]),
    lampRings: join(LAMPS.map((x) => ring(x, CARRIAGE.y + CARRIAGE.d - 3.2, 1.1, CAR_TOP, P, 16))),
    collar: S(insetPlan(COLUMN, -2), CAR_TOP, 3, 3, 0.4),
    collarScrews: [at([COLUMN.x - 0.6, COLUMN.y + COLUMN.d + 1, CAR_TOP + 3]), at([COLUMN.x + COLUMN.w + 0.6, COLUMN.y + COLUMN.d + 1, CAR_TOP + 3])],
    column: S(COLUMN, CAR_TOP + 3, COLUMN_TOP - CAR_TOP - 3, 3),
    columnSeams: join([40, 70].map((z) => sideSeam(COLUMN, z, P, 3))),
    // The follower: behind the column (forks, roller, arm), then the head that wraps it.
    forkBack: forkPlate(ROLLER_Y - 1.4 - 1.2),
    roller: r,
    forkFront: forkPlate(ROLLER_Y + 1.4 + 0.2),
    axle: at([0, ROLLER_Y + 1.4 + 1.2, ROLLER_Z]),
    arm: S({ x: -2.6, y: ROLLER_Y - 4.2, w: 5.2, d: HEAD.y - ROLLER_Y + 4.2 + 1, r: 1.2 }, ARM_Z, 4, 3, 0.4),
    armScrews: [at([0, ROLLER_Y, ARM_Z + 4]), at([0, HEAD.y - 4, ARM_Z + 4])],
    head: S(HEAD, HEAD_Z, HEAD_H, 4, 0.6),
    headSeam: sideSeam(HEAD, HEAD_Z + 4, P, 4),
    headScrews: [at([HEAD.x + 2.6, HEAD.y + HEAD.d - 2.6, HEAD_Z + HEAD_H]), at([HEAD.x + 2.6, HEAD.y + 2.6, HEAD_Z + HEAD_H])],
    knob: C(KNOB[0], KNOB[1] + 4, 2.4, HEAD_Z + HEAD_H, 3.2, 20),
    knobKnurl: knurl(KNOB[0], KNOB[1] + 4, 2.4, HEAD_Z + HEAD_H, HEAD_Z + HEAD_H + 3.2, 16, P),
    // The dial on the column top.
    bracket: S(BRACKET, COLUMN_TOP, 3, 3, 0.4),
    bracketScrews: [at([BRACKET.x + 2.4, BRACKET.y + BRACKET.d - 2.4, COLUMN_TOP + 3]), at([BRACKET.x + BRACKET.w - 2.4, BRACKET.y + BRACKET.d - 2.4, COLUMN_TOP + 3])],
    puck: C(DIAL[0], DIAL[1], DIAL_R, DIAL_Z, DIAL_H, 64),
    bezelKnurl: knurl(DIAL[0], DIAL[1], DIAL_R, DIAL_TOP - 3, DIAL_TOP, 72, P, 0.3),
    band: sideArc(DIAL[0], DIAL[1], DIAL_R, DIAL_TOP - 3, P, 40),
    bezel: ring(DIAL[0], DIAL[1], DIAL_R - 1, DIAL_TOP, P, 64),
    face: ring(DIAL[0], DIAL[1], DIAL_R - 2.6, DIAL_TOP, P, 64),
    minor: T.minor,
    major: T.major,
    gate: T.gate,
    below: belowArc(),
    hub: ring(DIAL[0], DIAL[1], 1.5, DIAL_TOP, P, 16),
    hubDot: at([DIAL[0], DIAL[1], DIAL_TOP]),
    crown: S({ x: DIAL[0] + DIAL_R - 0.8, y: DIAL[1] - 2.2, w: 4, d: 4.4, r: 1 }, DIAL_Z + 2, 4, 3),
    crownCap: S({ x: DIAL[0] + DIAL_R + 3, y: DIAL[1] - 3, w: 2.4, d: 6, r: 1 }, DIAL_Z + 1.2, 5.6, 3),
    label: topMatrix([DIAL[0], DIAL[1] + 6.2], DIAL_TOP, P, "x"),
    // The drop pin in its housing on the carriage front.
    housing: S(HOUSING, 2, 10, 3, 0.4),
    housingScrews: [at([HOUSING.x + 2, HOUSING.y + 2.2, 12]), at([HOUSING.x + HOUSING.w - 2, HOUSING.y + 2.2, 12])],
    pin: C(PIN[0], PIN[1], PIN_R, RULER_Z, 14, 16),
    pinTip: ring(PIN[0], PIN[1], PIN_R - 0.45, RULER_Z + 14, P, 12),
    eyes: [3.2, 9.6].map((z) => S({ x: -2.4, y: HOUSING.y + HOUSING.d - 0.2, w: 4.8, d: PIN[1] - HOUSING.y - HOUSING.d + PIN_R + 1.4, r: 1.2 }, z, 1.8, 3)),
  };
}

