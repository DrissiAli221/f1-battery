import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dots, FaceText, IsoFigure, Line, Plate, Solid } from "../iso/draw";
import { asksForStillness, follow, useInView, useLoop, useReadout } from "../iso/live";
import { axisVector } from "../iso/iso-kit";
import { accelAt, fmtA, fmtM, lampsAt, readProfile, readoutAt, type Reading } from "./model";
import { HEIGHT, LAMP_POINTS, P, PIN_UP, REST_TOP, WIDTH, buildArt, buildCarriage, camOf, needleAt, shift, at, type Cam } from "./geometry";
import type { Profile } from "../../instrument/driver";
import type { FigData } from "./data";
import "../iso/iso.css";
import "./cutoff.css";

/*
 * Fig. 1, "How a cut-off is read" (DESIGN.md, Method log). A carriage rides a rail down the
 * straight; its follower rides a cam cut to the median speed profile; the dial reads the
 * median acceleration under the follower; when the needle stays under 0.5 m/s² for four
 * 0.25 s ticks above 250 kph, the pin drops and a mark slides back to where the run began:
 * the cut-off. Static art is built once per profile; per frame only transforms, the needle's
 * path and a few attributes change, from one callback on gsap.ticker.
 */

const TOUR = { wait: 1.2, run: 8.5, hold: 2.2, back: 1.4 };
const TOUR_T = TOUR.wait + TOUR.run + TOUR.hold + TOUR.back;
const IDLE_BACK_MS = 3600;
const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};
function tourAt(t: number, L: number) {
  const s = t % TOUR_T;
  if (s < TOUR.wait) return 0;
  if (s < TOUR.wait + TOUR.run) return L * smooth((s - TOUR.wait) / TOUR.run);
  if (s < TOUR.wait + TOUR.run + TOUR.hold) return L;
  return L * (1 - smooth((s - TOUR.wait - TOUR.run - TOUR.hold) / TOUR.back));
}

const CAR = buildCarriage();

const Static = memo(function Static({ profile, reading, cam }: { profile: Profile; reading: Reading; cam: Cam }) {
  const A = useMemo(() => buildArt(profile, reading, cam), [profile, reading, cam]);
  return (
    <g>
      <path className="iso-halo" d={A.base.halo} />
      {A.base.feet.map((parts, i) => (
        <g key={i}>
          <Solid paths={parts[0]} tone="lo" />
          <Solid paths={parts[1]} tone="mid" />
        </g>
      ))}
      <Solid paths={A.base.slab} tone="mid" />
      <Line d={A.base.groove} tone="lo" />
      <Line d={A.base.screwRings} tone="lo" />
      <Dots points={A.base.screws} size={0.5} tone="mid" />
      <Solid paths={A.base.label} tone="lo" crease="none" />
      <Line d={A.base.labelLine} tone="faint" />
      <Line d={A.base.labelRule} tone="lo" free />
      <Dots points={A.base.labelScrews} size={0.45} tone="mid" />

      <Solid paths={A.cam.bed} tone="mid" inner={<Line d={A.cam.bedSeam} tone="faint" />} />
      <Dots points={A.cam.bedScrews} size={0.45} tone="mid" />
      <Solid paths={A.cam.plate} tone="hi" crease="lo" />
      <Line d={A.cam.grid} tone="faint" />
      <Line d={A.cam.gate} tone="mid" />
      <Dots points={A.cam.bolts} size={0.42} tone="lo" />
      <Line d={A.cam.ticks} tone="lo" />
      {A.cam.clamps.map((c, i) => (
        <Solid key={i} paths={c} tone="mid" />
      ))}
      <Dots points={A.cam.clampScrews} size={0.42} tone="mid" />

      <Solid paths={A.rail.stops[0]} tone="mid" />
      <Solid paths={A.rail.bar} tone="mid" />
      <Dots points={A.rail.screws} size={0.42} tone="mid" />
      <Solid paths={A.rail.stops[1]} tone="mid" />
      <Dots points={A.rail.stopScrews} size={0.42} tone="mid" />

      <Solid paths={A.ruler.strip} tone="lo" crease="none" />
      <Line d={A.ruler.minor} tone="lo" />
      <Line d={A.ruler.major} tone="mid" />
      <Line d={A.ruler.zero} tone="hi" />
      <Line d={A.ruler.bracket} tone="mid" />
    </g>
  );
});

const Marker = memo(function Marker({ cam }: { cam: Cam }) {
  const A = useMemo(() => buildArt({ length_m: 1, bin_m: 1, bins: [], cutoff_median_m: null, ci_low_m: null, ci_high_m: null }, { ticks: [], q: null, cutoff: null, confirm: null, domain: [0, 1] }, cam), [cam]);
  return (
    <>
      <Solid paths={A.marker.body} tone="hi" lit />
      <Line d={A.marker.index} tone="lit" />
    </>
  );
});

export function CutoffFigure({ data }: { data: FigData }) {
  const { profile } = data;
  const reading = useMemo(() => readProfile(profile), [profile]);
  const cam = useMemo(() => camOf(profile, reading), [profile, reading]);
  const L = cam.L;
  const best = reading.confirm !== null ? Math.min(L, reading.confirm + 40) : L * 0.75;

  const root = useRef<HTMLDivElement>(null);
  const { anchor, say } = useReadout<HTMLDivElement>();
  const carriage = useRef<SVGGElement>(null);
  const followB = useRef<SVGGElement>(null);
  const followF = useRef<SVGGElement>(null);
  const needle = useRef<SVGPathElement>(null);
  const pin = useRef<SVGGElement>(null);
  const marker = useRef<SVGGElement>(null);
  const lamps = useRef<(SVGCircleElement | null)[]>([]);

  const inView = useInView(root);
  const [engaged, setEngaged] = useState(false);
  const [idle, setIdle] = useState(true);
  const [poke, setPoke] = useState(0);
  const st = useRef({ d: 0, target: 0, clock: 0, pin: 0, mark: 0, markOn: false, needle: 0 });

  const draw = useCallback(() => {
    const s = st.current;
    const x = cam.xOf(s.d);
    const dz = cam.topAt(s.d) - REST_TOP;
    carriage.current?.setAttribute("transform", shift(x));
    followB.current?.setAttribute("transform", shift(0, dz));
    followF.current?.setAttribute("transform", shift(0, dz));
    needle.current?.setAttribute("d", needleAt(s.needle));
    pin.current?.setAttribute("transform", shift(0, PIN_UP * (1 - s.pin)));
    if (pin.current) pin.current.toggleAttribute("data-down", s.pin > 0.5);
    if (marker.current) {
      marker.current.setAttribute("transform", shift(cam.xOf(s.mark)));
      marker.current.style.opacity = s.markOn ? "1" : "0";
    }
    const on = lampsAt(reading, s.d);
    lamps.current.forEach((el, i) => el?.toggleAttribute("data-on", i < on));
    say(readoutAt(reading, profile, s.d));
    const el = root.current;
    if (el) {
      el.setAttribute("aria-valuenow", String(Math.round(s.d)));
      el.setAttribute("aria-valuetext", readoutAt(reading, profile, s.d).replace(/·/g, ","));
    }
  }, [cam, reading, profile, say]);

  const touring = inView && idle && !engaged;

  const tick = useCallback(
    (dt: number, calm: boolean) => {
      const s = st.current;
      if (touring && !calm) {
        s.clock += dt;
        s.target = tourAt(s.clock, L);
      }
      s.d = follow(s.d, s.target, dt, touring ? 0.05 : 0.22, calm);
      s.needle = follow(s.needle, accelAt(profile, s.d), dt, 0.12, calm);
      const down = reading.confirm !== null && s.d >= reading.confirm;
      s.pin = follow(s.pin, down ? 1 : 0, dt, 0.07, calm);
      if (down) {
        if (!s.markOn) {
          s.markOn = true;
          s.mark = reading.confirm as number;
        }
        s.mark = follow(s.mark, reading.cutoff as number, dt, 0.28, calm);
      } else s.markOn = false;
      draw();
      const settled = !touring && s.d === s.target && s.pin === (down ? 1 : 0) && (!down || s.mark === reading.cutoff);
      return inView && !settled;
    },
    [touring, L, profile, reading, draw, inView],
  );

  const kick = useLoop(tick, inView);

  // Rest pose and reduced motion: the best frame, just past the confirmation.
  useEffect(() => {
    const s = st.current;
    const start = asksForStillness() ? best : 0;
    Object.assign(s, { d: start, target: start, clock: 0, needle: accelAt(profile, start), pin: 0, markOn: false });
    if (asksForStillness()) {
      s.pin = reading.confirm !== null && start >= reading.confirm ? 1 : 0;
      s.markOn = s.pin === 1;
      s.mark = reading.cutoff ?? 0;
    }
    draw();
  }, [profile, reading, best, draw]);

  useEffect(() => {
    if (engaged) {
      setIdle(false);
      return;
    }
    const t = window.setTimeout(() => setIdle(!asksForStillness()), IDLE_BACK_MS);
    return () => window.clearTimeout(t);
  }, [engaged, poke]);

  useEffect(() => {
    if (touring) kick();
  }, [touring, kick]);

  const steer = (d: number) => {
    st.current.target = Math.max(0, Math.min(L, d));
    setIdle(false);
    setPoke((n) => n + 1);
    kick();
  };

  const dAt = (clientX: number) => {
    const svg = root.current?.querySelector("svg");
    const box = svg?.getBoundingClientRect();
    if (!box || !box.width) return null;
    const sx = ((clientX - box.left) / box.width) * WIDTH;
    const ex = axisVector(P, [1, 0, 0])[0];
    const x = (sx - at([0, 0, 0])[0]) / ex;
    return cam.mOf(x);
  };

  const label = `A cam follower bench reading one straight. The cam's top edge is cut to the median speed profile of ${data.source}, ${fmtM(L)} m long. A carriage on a rail carries a roller along the cam and a dial that reads the median acceleration under it. A tick every 0.25 s; when the dial stays under 0.5 m/s² for four ticks above 250 kph, a pin drops and marks the cut-off on the ruler${reading.cutoff !== null ? `, at ${fmtM(reading.cutoff)} m` : ""}.`;

  const lampRef = (i: number) => (el: SVGCircleElement | null) => {
    lamps.current[i] = el;
  };
  const r = CAR.roller;

  return (
    <div
      ref={(el) => {
        (root as React.MutableRefObject<HTMLDivElement | null>).current = el;
        (anchor as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      className="fig1__stage"
      role="slider"
      tabIndex={0}
      aria-label="Fig. 1, the carriage's distance down the straight. Arrow keys move it 50 m, Shift with an arrow 250 m."
      aria-valuemin={0}
      aria-valuemax={Math.round(L)}
      aria-valuenow={0}
      onPointerEnter={(e) => e.pointerType === "mouse" && setEngaged(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setEngaged(false)}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") e.currentTarget.setPointerCapture(e.pointerId);
        const d = dAt(e.clientX);
        if (d !== null) steer(d);
      }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse" && !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const d = dAt(e.clientX);
        if (d !== null) steer(d);
      }}
      onFocus={() => setEngaged(true)}
      onBlur={() => setEngaged(false)}
      onKeyDown={(e) => {
        const by = e.shiftKey ? 250 : 50;
        const now = st.current.target;
        let to: number | null = null;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") to = now + by;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") to = now - by;
        else if (e.key === "Home") to = 0;
        else if (e.key === "End") to = L;
        if (to === null) return;
        e.preventDefault();
        steer(to);
      }}
    >
      <IsoFigure width={WIDTH} height={HEIGHT} label={label}>
        <Static profile={profile} reading={reading} cam={cam} />
        <g ref={carriage} transform={shift(cam.xOf(0))}>
          <path className="iso-halo fig1__shadow" d={CAR.halo} />
          <Solid paths={CAR.gib} tone="mid" crease="none" />
          <Solid paths={CAR.plate} tone="mid" inner={<Line d={CAR.plateSeam} tone="faint" />} />
          <Dots points={CAR.rivets} size={0.4} tone="lo" />
          <Line d={CAR.lampRings} tone="lo" />
          <g className="fig1__lamps">
            {LAMP_POINTS.map(([x, y], i) => (
              <circle key={i} ref={lampRef(i)} cx={x} cy={y} r={0.7} />
            ))}
          </g>
          <g ref={followB}>
            <Solid paths={CAR.forkBack} tone="mid" crease="none" />
            <g className="iso-solid">
              <path className="iso-fill" d={r.fill} />
              <path className="iso-shade" data-shade={1} d={r.fill} />
              <path className="iso-top" d={r.face} />
              <Line d={r.web} tone="lo" />
              <path className="iso-line iso-edge" data-tone="hi" d={r.rim} />
            </g>
            <Solid paths={CAR.forkFront} tone="mid" crease="none" />
            <Dots points={[CAR.axle]} size={0.6} tone="hi" />
            <Solid paths={CAR.arm} tone="mid" />
            <Dots points={CAR.armScrews} size={0.42} tone="mid" />
          </g>
          <Solid paths={CAR.collar} tone="mid" />
          <Dots points={CAR.collarScrews} size={0.42} tone="mid" />
          <Solid paths={CAR.column} tone="mid" crease="none" inner={<Line d={CAR.columnSeams} tone="faint" />} />
          <g ref={followF}>
            <Solid paths={CAR.head} tone="mid" inner={<Line d={CAR.headSeam} tone="faint" />} />
            <Dots points={CAR.headScrews} size={0.42} tone="mid" />
            <Solid paths={CAR.knob} tone="mid" />
            <Line d={CAR.knobKnurl} tone="lo" />
          </g>
          <Solid paths={CAR.bracket} tone="mid" />
          <Dots points={CAR.bracketScrews} size={0.42} tone="mid" />
          <Solid paths={CAR.puck} tone="hi" crease="lo" inner={<Line d={CAR.band} tone="faint" />} />
          <Line d={CAR.bezelKnurl} tone="faint" />
          <Line d={CAR.bezel} tone="lo" />
          <Line d={CAR.face} tone="faint" />
          <Line d={CAR.below} tone="lo" />
          <Line d={CAR.minor} tone="lo" />
          <Line d={CAR.major} tone="mid" />
          <Line d={CAR.gate} tone="hi" />
          <FaceText transform={CAR.label} size={2.4} tone="lo" anchor="middle">
            m/s²
          </FaceText>
          <Line d={CAR.hub} tone="mid" />
          <path ref={needle} className="iso-line fig1__needle" data-tone="lit" data-free="start" d={needleAt(0)} />
          <Dots points={[CAR.hubDot]} size={0.7} tone="hi" />
          <Solid paths={CAR.crown} tone="mid" />
          <Solid paths={CAR.crownCap} tone="mid" />
          <Solid paths={CAR.housing} tone="mid" />
          <Dots points={CAR.housingScrews} size={0.4} tone="mid" />
          <g ref={pin} className="fig1__pin" transform={shift(0, PIN_UP)}>
            <Solid paths={CAR.pin} tone="hi" crease="none" />
            <Line d={CAR.pinTip} tone="mid" />
          </g>
          {CAR.eyes.map((e, i) => (
            <Solid key={i} paths={e} tone="mid" />
          ))}
        </g>
        <g ref={marker} style={{ opacity: 0 }}>
          <Marker cam={cam} />
        </g>
      </IsoFigure>
    </div>
  );
}

/** The card around the figure, in the site's voice. */
export function Fig1({ data }: { data: FigData }) {
  const reading = useMemo(() => readProfile(data.profile), [data.profile]);
  const p = data.profile;
  const cut = reading.cutoff;
  const median = p.cutoff_median_m;
  return (
    <Plate
      fig="Fig. 1"
      title="How a cut-off is read"
      hint="Point along the bench, or use the arrow keys"
      readout={`d 0 m · ${fmtA(accelAt(p, 0))} m/s²`}
      keys={[
        { mark: "raised", label: "Cam cut to the median speed (est.)" },
        { mark: "lit", label: "Needle, pin and mark: the reading" },
        { mark: "edge", label: "A tick every 0.25 s along the cam" },
      ]}
      caption={
        <>
          The cam is cut to the median speed of {data.source}, {fmtM(p.length_m)} m. The dial reads the median acceleration under the
          roller. When it stays under 0.5 m/s² for four ticks above 250 kph, the pin drops and the mark slides back to where the run
          began{cut !== null ? <>: {fmtM(cut)} m on this profile</> : null}.
          {median !== null && p.ci_low_m !== null && p.ci_high_m !== null ? (
            <>
              {" "}
              The bracket on the ruler is the session's median cut-off over every lap, {fmtM(median)} m (95 % interval{" "}
              {fmtM(p.ci_low_m)} to {fmtM(p.ci_high_m)} m); a median profile's cut-off need not equal the median of the laps'.
            </>
          ) : null}
        </>
      }
    >
      <CutoffFigure data={data} />
    </Plate>
  );
}
