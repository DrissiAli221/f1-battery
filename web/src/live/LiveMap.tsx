import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { gsap } from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { Avatar } from "../components/Driver";
import { REGIME_VAR } from "../explorer/TrackMap";
import { driverCode, teamColour } from "../lib/teams";
import { project, wrap, type TrackStraight } from "../lib/track";
import { useSize } from "../lib/useSize";
import { prefersReducedMotion } from "../motion";
import type { Driver, Outline } from "../lib/types";
import type { LiveState } from "./useLive";

gsap.registerPlugin(DrawSVGPlugin);

export interface TrailPoint {
  d: number;
  regime: LiveState["regime"];
}

interface Props {
  outline: Outline;
  straights: TrackStraight[];
  drivers: Map<number, Driver>;
  states: LiveState[];
  selected: number | null;
  trail: TrailPoint[];
  /** Paused: the tags hold where they are. */
  paused: boolean;
}

const TAG = 26;

/*
 * The live map (DESIGN.md "Live"): the circuit outline as large as the box allows, the
 * straights as quiet thick segments, start/finish as a bar across the line, and one tag per
 * car: the headshot on its team-colour ring. Tags glide toward their latest estimated lap
 * distance on gsap.ticker (wrapping over the line), so a 4 Hz feed reads as motion. The
 * selected car carries its code and a trail coloured by its live regime.
 *
 * Positions are `lap_distance_est` mod the outline's lap (docs/phase7-replay.md): pace and
 * wrap-around are right, the absolute place along the lap is approximate and drifts.
 */
export function LiveMap({ outline, straights, drivers, states, selected, trail, paused }: Props) {
  const [box, { w: W, h: H }] = useSize<HTMLDivElement>();
  const wide = W >= 560;
  const T = useMemo(
    () => (W > 0 && H > 0 ? project(outline, W, H, wide ? { l: 56, r: 56, t: 48, b: 48 } : { l: 28, r: 28, t: 28, b: 28 }) : null),
    [outline, W, H, wide],
  );
  const svg = useRef<SVGSVGElement>(null);
  const tags = useRef(new Map<number, HTMLDivElement>());
  const shown = useRef(new Map<number, number>());
  const targets = useRef(new Map<number, number>());

  for (const s of states) targets.current.set(s.driver_number, s.lap_distance_est);

  // One draw-in of the outline per circuit, along the direction of travel.
  useLayoutEffect(() => {
    const el = svg.current;
    if (!el || !T || prefersReducedMotion()) return;
    const tw = gsap.fromTo(el.querySelectorAll("[data-draw]"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 1.6, ease: "taper" });
    return () => {
      tw.progress(1).kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outline, T !== null]);

  // The tags' clock: ease each tag toward its target distance; nothing moves while paused.
  useEffect(() => {
    if (!T) return;
    const place = (n: number, d: number) => {
      const el = tags.current.get(n);
      if (!el) return;
      const p = T.at(d);
      el.style.transform = `translate(${(p.x - TAG / 2).toFixed(1)}px, ${(p.y - TAG / 2).toFixed(1)}px)`;
    };
    const tick = (_t: number, dtMs: number) => {
      if (paused) return;
      const k = prefersReducedMotion() ? 1 : 1 - Math.exp(-Math.min(dtMs, 50) / 250);
      for (const [n, target] of targets.current) {
        const cur = shown.current.get(n);
        if (cur === undefined) {
          shown.current.set(n, target);
          place(n, target);
          continue;
        }
        const delta = wrap(target - cur + T.lap / 2, T.lap) - T.lap / 2;
        const next = Math.abs(delta) > T.lap / 3 ? target : cur + delta * k;
        shown.current.set(n, next);
        place(n, next);
      }
    };
    for (const [n, d] of shown.current) place(n, d);
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [T, paused]);

  // The selected car's trail, split into runs of one regime.
  const trailPaths = useMemo(() => {
    if (!T || trail.length < 2) return [];
    const out: { d: string; regime: TrailPoint["regime"] }[] = [];
    let start = 0;
    for (let i = 1; i <= trail.length; i++) {
      if (i === trail.length || trail[i].regime !== trail[start].regime) {
        const a = trail[start].d;
        const b = trail[Math.min(i, trail.length - 1)].d;
        if (wrap(b - a, T.lap) > 1 && wrap(b - a, T.lap) < T.lap / 2) out.push({ d: T.sub(a, b), regime: trail[start].regime });
        start = i;
      }
    }
    return out;
  }, [T, trail]);

  const sf = T ? T.pose(0) : null;
  const ids = states.map((s) => s.driver_number);

  return (
    <div ref={box} className="lv-map">
      {T && (
        <svg ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="lv-map__svg" aria-hidden="true">
          <path d={T.pathD} className="lv-map__road" data-draw />
          {straights.map((s) => (
            <path key={s.straight_id} d={T.sub(s.d0, s.d1)} className="lv-map__straight" />
          ))}
          {trailPaths.map((p, i) => (
            <path key={i} d={p.d} className="lv-map__trail" stroke={REGIME_VAR[p.regime]} />
          ))}
          {sf && (
            <g>
              <line
                x1={sf.x - sf.nx * 10}
                y1={sf.y - sf.ny * 10}
                x2={sf.x + sf.nx * 10}
                y2={sf.y + sf.ny * 10}
                className="lv-map__sf"
              />
              <text x={sf.x - sf.nx * 24} y={sf.y - sf.ny * 24 + 4} textAnchor="middle" className="lv-map__sfl">
                S/F
              </text>
            </g>
          )}
        </svg>
      )}
      {T && (
        <div className="lv-map__tags">
          {ids.map((n) => {
            const d = drivers.get(n);
            const on = n === selected;
            return (
              <div
                key={n}
                ref={(el) => {
                  if (el) tags.current.set(n, el);
                  else tags.current.delete(n);
                }}
                className={`lv-tag ${on ? "is-on" : ""}`}
                style={{ ["--team" as string]: d ? teamColour(d) : "var(--muted)" }}
              >
                {d ? <Avatar d={d} size={TAG} /> : <span className="lv-tag__n num">{n}</span>}
                {on && <span className="lv-tag__code">{d ? driverCode(d) : n}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
