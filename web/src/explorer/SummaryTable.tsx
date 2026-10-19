import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "../components/Driver";
import { int } from "../lib/format";
import { driverCode, driverName, teamColour } from "../lib/teams";
import { along, type TrackStraight } from "../lib/track";
import type { RegimeLabel, SummaryDriver } from "../lib/types";
import type { Median } from "./data";
import { REGIME_VAR } from "./TrackMap";

const REGIMES: RegimeLabel[] = ["deploy", "plateau", "lift", "brake"];
const SHOWN = 10;

interface Props {
  rows: SummaryDriver[];
  straights: TrackStraight[];
  lap: number;
  selected: number | null;
  primary: number | null;
  compare: number | null;
  onPick: (driver: number) => void;
}

/**
 * Ranking rows: median cut-off per straight as a range bar on a scale shared by all drivers
 * for that straight, ranked by the selected straight, latest cut-off first.
 */
export function SummaryTable({ rows, straights, lap, selected, primary, compare, onPick }: Props) {
  const [expanded, setExpanded] = useState(false);
  const med = (r: SummaryDriver, sid: number): Median | null => {
    const s = r.straights.find((x) => x.straight_id === sid);
    return s && s.cutoff_distance_median_m !== null ? { m: s.cutoff_distance_median_m, lo: s.ci_low, hi: s.ci_high } : null;
  };
  const sel = straights.find((s) => s.straight_id === selected) ?? straights[0];
  const key = (r: SummaryDriver) => {
    const m = sel ? med(r, sel.straight_id) : null;
    return m && sel ? along(sel, m.m, lap) : -Infinity;
  };
  const ranked = rows.filter((r) => r.straights.some((s) => s.cutoff_distance_median_m !== null)).sort((a, b) => key(b) - key(a) || a.driver_number - b.driver_number);
  const without = rows.filter((r) => !ranked.includes(r));
  const visible = expanded ? ranked : ranked.slice(0, SHOWN);

  // Shared scale per straight, in metres along the straight.
  const scales = new Map(
    straights.map((s) => {
      const vals = ranked.flatMap((r) => {
        const m = med(r, s.straight_id);
        return m ? [m.lo ?? m.m, m.hi ?? m.m].map((v) => along(s, v, lap)) : [];
      });
      const lo = vals.length ? Math.min(...vals) : 0;
      const hi = vals.length ? Math.max(...vals) : 1;
      const pad = Math.max(5, (hi - lo) * 0.08);
      return [s.straight_id, { lo: lo - pad, hi: hi + pad }];
    }),
  );
  const pos = (s: TrackStraight, v: number) => {
    const sc = scales.get(s.straight_id)!;
    return ((along(s, v, lap) - sc.lo) / (sc.hi - sc.lo || 1)) * 100;
  };

  const gridCols = `48px minmax(180px,1.4fr) repeat(${straights.length}, minmax(0,1fr)) 150px`;

  return (
    <div>
      <div className="overflow-hidden rounded-xs bg-surface">
        {/* Desktop header */}
        <div className="hidden items-end gap-4 border-b-2 border-line px-6 pb-4 pt-6 lg:grid" style={{ gridTemplateColumns: gridCols }}>
          <span className="cap">Pos</span>
          <span className="cap">Driver</span>
          {straights.map((s) => (
            <span key={s.straight_id} className={`text-[12px] leading-tight ${s.straight_id === sel?.straight_id ? "text-ink-head" : "text-ink-3"}`}>
              <span className="font-display font-bold">S{s.straight_id}</span>
              {s.straight_id === sel?.straight_id && <span className="ml-1 text-brand">↓</span>}
              <span className="block truncate">{s.label}</span>
            </span>
          ))}
          <span className="cap text-right">Regimes</span>
        </div>
        <ol>
          <AnimatePresence initial={false}>
            {visible.map((r, i) => {
              const isP = r.driver_number === primary;
              const isC = r.driver_number === compare;
              const m = sel ? med(r, sel.straight_id) : null;
              return (
                <motion.li
                  key={r.driver_number}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`row-hover border-b border-line-2 last:border-b-0 ${isP ? "bg-brand-deep/60" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => onPick(r.driver_number)}
                    className="grid w-full items-center gap-4 px-4 py-3 text-left lg:px-6"
                    style={{ gridTemplateColumns: undefined }}
                  >
                    <div className="grid items-center gap-4 lg:hidden" style={{ gridTemplateColumns: "32px 1fr auto" }}>
                      <span className="num text-[18px] text-ink-head">{i + 1}</span>
                      <DriverCell r={r} isP={isP} isC={isC} />
                      <span className="num text-right text-[18px] text-ink-head">{m ? int(m.m) : <span className="text-ink-4">no cut</span>}</span>
                    </div>
                    <div className="hidden items-center gap-4 lg:grid" style={{ gridTemplateColumns: gridCols }}>
                      <span className="num text-[20px] text-ink-head">{i + 1}</span>
                      <DriverCell r={r} isP={isP} isC={isC} />
                      {straights.map((s) => {
                        const v = med(r, s.straight_id);
                        const on = s.straight_id === sel?.straight_id;
                        return (
                          <span key={s.straight_id} className="flex items-center gap-3">
                            <span className="relative h-5 flex-1" aria-hidden="true">
                              <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
                              {v && v.lo !== null && v.hi !== null && (
                                <span
                                  className="absolute top-1/2 h-2 -translate-y-1/2 rounded-[1px]"
                                  style={{
                                    left: `${pos(s, v.lo)}%`,
                                    width: `${Math.max(1.5, pos(s, v.hi) - pos(s, v.lo))}%`,
                                    background: on ? "var(--ink-2)" : "var(--ink-4)",
                                  }}
                                />
                              )}
                              {v && (
                                <span
                                  className="absolute top-0 h-5 w-[2px] -translate-x-1/2"
                                  style={{ left: `${pos(s, v.m)}%`, background: on ? "var(--ink-head)" : "var(--ink-2)" }}
                                />
                              )}
                            </span>
                            <span className={`num w-[52px] text-right text-[14px] ${on ? "text-ink-head" : "text-ink-2"}`}>{v ? int(v.m) : <span className="text-ink-4">–</span>}</span>
                          </span>
                        );
                      })}
                      <RegimeBar shares={r.regime_shares} />
                    </div>
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        {ranked.length > SHOWN ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? "Show top 10" : `Show all ${ranked.length} drivers`}
          </button>
        ) : (
          <span />
        )}
        <p className="text-[13px] text-ink-3">
          Lap distance in metres, median over green laps; bars are the 95 % range on a shared scale per straight. Click a row to select that driver.
          {without.length > 0 && ` No cut-off on any straight: ${without.map((r) => driverCode(r)).join(", ")}.`}
        </p>
      </div>
    </div>
  );
}

function DriverCell({ r, isP, isC }: { r: SummaryDriver; isP: boolean; isC: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: teamColour(r) }} />
      <Avatar d={r} size={36} />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="font-display text-[15px] font-bold uppercase text-ink-head">{driverCode(r)}</span>
          {isP && <span className="badge badge-pink">Selected</span>}
          {isC && <span className="badge badge-line text-ink-2">Compare</span>}
        </span>
        <span className="block truncate text-[12px] text-ink-3">
          {driverName(r)} · {r.team_name}
        </span>
      </span>
    </span>
  );
}

function RegimeBar({ shares }: { shares: Partial<Record<RegimeLabel, number>> }) {
  const total = REGIMES.reduce((a, k) => a + (shares[k] ?? 0), 0);
  if (!total) return <span className="text-right text-[12px] text-ink-4">–</span>;
  return (
    <span className="flex h-2.5 overflow-hidden rounded-full" title={REGIMES.map((k) => `${k} ${Math.round(((shares[k] ?? 0) / total) * 100)} %`).join(", ")}>
      {REGIMES.map((k) => (
        <span key={k} style={{ width: `${((shares[k] ?? 0) / total) * 100}%`, background: REGIME_VAR[k] }} />
      ))}
    </span>
  );
}
