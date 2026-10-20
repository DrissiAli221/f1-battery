/*
 * 404 (DESIGN.md "Composition plan"): the straight's distance axis, drawn and then cut off
 * part way, where the data stops. No trace is drawn: there is no data to draw, and the site
 * never invents one. The ticks are the instrument's own (every 200 m, mono, muted).
 */
import { Cta } from "../components/Cta";
import { Readout } from "../components/Readout";
import { href } from "../lib/router";
import { useSize } from "../lib/useSize";
import { usePage } from "../motion";
import "../findings/findings.css";

function Axis() {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  const H = W < 600 ? 170 : 250;
  const y = H - 44; // the distance axis
  const top = 24; // the top of the speed range (300 kph)
  const grid = [100, 200, 300].map((v) => ({ v, y: y - 10 - (v / 300) * (y - 10 - top) }));
  const end = Math.round(W * 0.56);
  const step = W < 600 ? 2 : 1; // label every tick on wide screens, every other on phones
  const ticks = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ m: i * 200, x: Math.round((i / 6) * end) }));
  return (
    <div ref={ref} aria-hidden="true">
      {W > 0 && (
        <svg className="nf__axis" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          {/* The instrument's empty speed grid, stopping where the data stops. */}
          {grid.map((g) => (
            <g key={g.v}>
              <line className="nf__grid" x1={0} x2={end} y1={g.y} y2={g.y} />
              <text className="nf__num" x={0} y={g.y - 6}>
                {g.v === 300 ? "300 kph" : g.v}
              </text>
            </g>
          ))}
          <line className="nf__axisline" x1={0} x2={end} y1={y} y2={y} />
          <line className="nf__beyond" x1={end + 8} x2={W} y1={y} y2={y} />
          {ticks.map((t, i) => (
            <g key={t.m}>
              <line className="nf__axisline" x1={t.x} x2={t.x} y1={y} y2={y + 6} />
              {i % step === 0 && i < ticks.length - 1 && (
                <text className="nf__num" x={t.x} y={y + 22} textAnchor={i === 0 ? "start" : "middle"}>
                  {i === 0 ? "0 m" : t.m.toLocaleString("en-US")}
                </text>
              )}
            </g>
          ))}
          <line className="nf__end" x1={end} x2={end} y1={top - 8} y2={y + 10} />
          <text className="nf__num" x={end + 10} y={top} style={{ fill: "var(--ink)" }}>
            end of data
          </text>
        </svg>
      )}
    </div>
  );
}

export function NotFoundPage({ path }: { path: string }) {
  const root = usePage<HTMLElement>();
  return (
    <section ref={root} className="wrap nf" aria-labelledby="nf-h1">
      <Readout label="Status">404</Readout>
      <div data-intro>
        <Axis />
      </div>
      <h1 id="nf-h1" className="nf__h1" data-intro data-delay="0.1">
        No data beyond this point.
      </h1>
      <p className="nf__p" data-intro data-delay="0.15">
        Nothing is recorded at <span className="fx-mono">{path}</span>. The straight starts again at the beginning.
      </p>
      <div className="nf__cta" data-intro data-delay="0.2">
        <Cta href={href.landing}>Back to the start</Cta>
      </div>
    </section>
  );
}
