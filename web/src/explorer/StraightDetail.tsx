import type { ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import { int, signed } from "../lib/format";
import { driverCode } from "../lib/teams";
import { along, type TrackStraight } from "../lib/track";
import { useSize } from "../lib/useSize";
import type { Driver } from "../lib/types";
import type { Cutoffs, Median } from "./data";

export interface StraightDriver {
  d: Driver;
  colour: string;
  medians: Map<number, Median> | undefined;
  cutoffs: Cutoffs | null;
  greenLaps: number;
}

interface Props {
  straight: TrackStraight;
  lap: number;
  selectedLap: number | null;
  primary: StraightDriver;
  compare: StraightDriver | null;
  onLap: (n: number) => void;
}

function lapCuts(dr: StraightDriver, sid: number): { lap: number; d: number }[] {
  const out: { lap: number; d: number }[] = [];
  for (const [lap, m] of dr.cutoffs ?? []) {
    const v = m.get(sid);
    if (v !== undefined) out.push({ lap, d: v });
  }
  return out.sort((a, b) => a.lap - b.lap);
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="border-t-2 border-line pt-4">
      <dt className="cap">{label}</dt>
      <dd className="num mt-2 text-[24px] leading-none text-ink-head md:text-[28px]">{value}</dd>
      {sub && <dd className="mt-2 text-[13px] text-ink-3">{sub}</dd>}
    </div>
  );
}

/** Big numbers for the selected straight, then every lap of both drivers on one axis. */
export function StraightDetail({ straight, lap, selectedLap, primary, compare, onLap }: Props) {
  const sid = straight.straight_id;
  const mp = primary.medians?.get(sid);
  const mc = compare?.medians?.get(sid);
  const pCuts = lapCuts(primary, sid);
  const cCuts = compare ? lapCuts(compare, sid) : [];
  const thisLap = pCuts.find((c) => c.lap === selectedLap);
  const before = mp ? straight.len - along(straight, mp.m, lap) : null;

  return (
    <div>
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <p className="cap">{driverCode(primary.d)} median cut-off</p>
          {mp ? (
            <>
              <p className="big mt-4 text-[88px] leading-[0.85] md:text-[132px]">
                {int(mp.m)}
                <span className="ml-2 text-[28px] tracking-normal text-ink-3 md:text-[36px]">m</span>
              </p>
              <p className="mt-6 max-w-[40ch] text-[17px] leading-relaxed text-ink-2">
                from the start/finish line,{" "}
                <span className="num text-ink-head">{int(before)} m</span> before {straight.into ?? "the end of the straight"}. The
                straight is <span className="num text-ink-head">{int(straight.len)} m</span> long.
              </p>
            </>
          ) : (
            <p className="mt-4 max-w-[40ch] text-[20px] text-ink-2">
              No cut-off detected for {driverCode(primary.d)} on this straight: deployment does not end before the braking zone, or
              the straight is too short for the estimator.
            </p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-10 self-end md:grid-cols-3 lg:col-span-7">
          <Stat label="Range (95 %)" value={mp && mp.lo !== null ? `${int(mp.lo)}–${int(mp.hi)}` : "–"} sub="bootstrap over laps" />
          <Stat
            label={`Lap ${selectedLap ?? "–"}`}
            value={thisLap ? int(thisLap.d) : <span className="text-ink-3">no cut</span>}
            sub={thisLap && mp ? `${signed(thisLap.d - mp.m)} m vs median` : "the scrubber's lap"}
          />
          <Stat
            label="Laps with a cut"
            value={
              <>
                {pCuts.length}
                <span className="text-[16px] text-ink-3"> / {primary.greenLaps}</span>
              </>
            }
            sub="of green laps"
          />
          {compare && (
            <>
              <Stat label={`${driverCode(compare.d)} median`} value={mc ? int(mc.m) : "no cut"} sub={mc && mc.lo !== null ? `range ${int(mc.lo)}–${int(mc.hi)}` : undefined} />
              <Stat
                label="Difference"
                value={mp && mc ? `${signed(mc.m - mp.m)} m` : "–"}
                sub={mp && mc ? `${driverCode(compare.d)} ${mc.m > mp.m ? "later" : mc.m < mp.m ? "earlier" : "level"} than ${driverCode(primary.d)}` : undefined}
              />
              <Stat
                label={`${driverCode(compare.d)} laps with a cut`}
                value={
                  <>
                    {cCuts.length}
                    <span className="text-[16px] text-ink-3"> / {compare.greenLaps}</span>
                  </>
                }
              />
            </>
          )}
        </dl>
      </div>

      <div className="mt-20">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
          <h3 className="h-card">Every lap on this straight</h3>
          <p className="text-[14px] text-ink-3">One dot per lap at its cut-off. Bracket: 95 % range of the median. Click a dot to jump to that lap.</p>
        </div>
        <LapDots
          straight={straight}
          lap={lap}
          rows={[
            { dr: primary, cuts: pCuts, median: mp, hollow: false },
            ...(compare ? [{ dr: compare, cuts: cCuts, median: mc, hollow: true }] : []),
          ]}
          selectedLap={selectedLap}
          onLap={onLap}
        />
      </div>
    </div>
  );
}

interface Row {
  dr: StraightDriver;
  cuts: { lap: number; d: number }[];
  median: Median | undefined;
  hollow: boolean;
}

/** One-dimensional strip: distance along the straight, a row per driver. */
function LapDots({ straight, lap, rows, selectedLap, onLap }: { straight: TrackStraight; lap: number; rows: Row[]; selectedLap: number | null; onLap: (n: number) => void }) {
  const [ref, { w: W }] = useSize<HTMLDivElement>();
  const a = (d: number) => along(straight, d, lap);
  const vals = rows.flatMap((r) => [
    ...r.cuts.map((c) => a(c.d)),
    ...(r.median ? [a(r.median.m), ...(r.median.lo !== null ? [a(r.median.lo)] : []), ...(r.median.hi !== null ? [a(r.median.hi)] : [])] : []),
  ]);
  const left = W < 640 ? 52 : 96;
  const rowH = 76;
  const top = 64;
  const H = top + rows.length * rowH + 40;
  if (!vals.length) {
    return (
      <div ref={ref}>
        <p className="rounded-xs border border-dashed border-line px-6 py-10 text-center text-ink-3">No laps with a cut-off on this straight.</p>
      </div>
    );
  }
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max(10, (hi - lo) * 0.08);
  const x = scaleLinear()
    .domain([Math.max(0, lo - pad), Math.min(straight.len, hi + pad)])
    .range([left, Math.max(left + 50, W - 24)])
    .nice();
  const ov = scaleLinear().domain([0, straight.len]).range([left, Math.max(left + 50, W - 24)]);
  const [z0, z1] = x.domain();
  return (
    <div ref={ref} className="w-full">
      {W > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={`Cut-off of every lap along ${straight.label}`}>
          {/* Overview: the whole straight, with the zoomed zone marked. */}
          <text x={0} y={18} fontSize={12} fill="var(--ink-3)">
            whole
          </text>
          <line x1={ov(0)} x2={ov(straight.len)} y1={14} y2={14} stroke="var(--line)" strokeWidth={4} strokeLinecap="round" />
          <rect x={ov(z0)} y={8} width={Math.max(3, ov(z1) - ov(z0))} height={12} rx={2} fill="var(--ink-head)" opacity={0.85} />
          <text x={ov(0)} y={36} fontFamily="var(--font-mono)" fontSize={11} fill="var(--ink-4)">
            start
          </text>
          <text x={ov(straight.len)} y={36} textAnchor="end" fontFamily="var(--font-mono)" fontSize={11} fill="var(--ink-4)">
            {straight.into ? `braking for ${straight.into}` : "end"} · {int(straight.len)} m
          </text>
          {x.ticks(W < 640 ? 4 : 8).map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={top - 8} y2={top + rows.length * rowH} stroke="var(--line-2)" />
              <text x={x(t)} y={top + rows.length * rowH + 22} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fill="var(--ink-3)">
                {int(t)}
              </text>
            </g>
          ))}
          <text x={W - 24} y={top + rows.length * rowH + 38} textAnchor="end" fontSize={11} fill="var(--ink-4)">
            metres from the start of the straight
          </text>
          {rows.map((r, i) => {
            const cy = top + i * rowH + rowH / 2;
            return (
              <g key={r.dr.d.driver_number}>
                <text x={0} y={cy + 5} fontFamily="var(--font-display)" fontWeight={700} fontSize={14} fill="var(--ink-head)">
                  {driverCode(r.dr.d)}
                </text>
                <rect x={0} y={cy + 12} width={28} height={3} fill={r.dr.colour} />
                {r.median && r.median.lo !== null && r.median.hi !== null && (
                  <path
                    d={`M${x(a(r.median.lo))},${cy - 26}v-6H${x(a(r.median.hi))}v6`}
                    fill="none"
                    stroke="var(--ink-2)"
                    strokeWidth={1.5}
                  />
                )}
                {r.median && <line x1={x(a(r.median.m))} x2={x(a(r.median.m))} y1={cy - 30} y2={cy + 30} stroke="var(--ink-head)" strokeWidth={2} />}
                {r.cuts.map((c) => {
                  // Deterministic vertical jitter by lap so overlapping laps stay visible.
                  const jy = (((c.lap * 37) % 11) - 5) * 3.6;
                  const on = c.lap === selectedLap;
                  return (
                    <g key={c.lap} className="cursor-pointer" onClick={() => onLap(c.lap)}>
                      <title>{`${driverCode(r.dr.d)} lap ${c.lap}: ${int(c.d)} m`}</title>
                      <circle cx={x(a(c.d))} cy={cy + jy} r={10} fill="transparent" />
                      <circle
                        cx={x(a(c.d))}
                        cy={cy + jy}
                        r={on ? 6.5 : 4.5}
                        fill={r.hollow ? "var(--surface)" : r.dr.colour}
                        stroke={on ? "var(--ink-head)" : r.dr.colour}
                        strokeWidth={on ? 2.5 : r.hollow ? 1.8 : 0}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
