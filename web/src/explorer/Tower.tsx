import { useRef, useState } from "react";
import { Tower, type TowerColumn, type TowerRow } from "../components/Tower";
import { int } from "../lib/format";
import { driverCode } from "../lib/teams";
import { along, type TrackStraight } from "../lib/track";
import type { RegimeLabel, SummaryDriver } from "../lib/types";
import { REGIME_VAR, REGIME_WORD, REGIMES } from "../track/regimes";
import type { Median } from "./data";

const SHOWN = 10;

interface Props {
  rows: SummaryDriver[];
  straights: TrackStraight[];
  lapLen: number;
  selected: number | null;
  primary: number | null;
  compare: number | null;
  onPick: (driver: number) => void;
  onCompare: (driver: number | null) => void;
}

interface Row extends TowerRow {
  s: SummaryDriver;
}

const medOf = (r: SummaryDriver, sid: number): Median | null => {
  const s = r.straights.find((x) => x.straight_id === sid);
  return s && s.cutoff_distance_median_m !== null ? { m: s.cutoff_distance_median_m, lo: s.ci_low, hi: s.ci_high } : null;
};

/*
 * "Median cut-off per straight" on the shared timing tower: one row per driver, ranked by the
 * selected straight's median (latest first); one column per straight with the median in
 * metres into the straight and its 95 % interval as a half-width; the share of green laps in
 * each regime as a stacked bar. Estimates carry no sector colours. A row selects the driver;
 * shift-click or the "vs" button sets the compare driver.
 */
export function SessionTower({ rows, straights: allStraights, lapLen, selected, primary, compare, onPick, onCompare }: Props) {
  const [all, setAll] = useState(false);
  const shift = useRef(false);
  // Only straights where someone has a cut-off get a column (Singapore: one of seven).
  const straights = allStraights.filter((s) => s.straight_id === selected || rows.some((r) => medOf(r, s.straight_id)));
  const sel = straights.find((s) => s.straight_id === selected) ?? straights[0];
  const rel = (s: TrackStraight, v: number) => along(s, v, lapLen);
  const key = (r: SummaryDriver) => {
    const m = sel ? medOf(r, sel.straight_id) : null;
    return m && sel ? rel(sel, m.m) : -Infinity;
  };
  const ranked = rows
    .filter((r) => r.straights.some((s) => s.cutoff_distance_median_m !== null))
    .sort((a, b) => key(b) - key(a) || a.driver_number - b.driver_number);
  const without = rows.filter((r) => !ranked.includes(r));
  const visible: Row[] = (all ? ranked : ranked.slice(0, SHOWN)).map((s, i) => ({ driver: s, pos: i + 1, s }));

  const columns: TowerColumn<Row>[] = [
    ...straights.map(
      (st): TowerColumn<Row> => ({
        key: `s${st.straight_id}`,
        num: true,
        head: (
          <span className={`tw-sh ${st.straight_id === sel?.straight_id ? "is-on" : ""}`} title={st.label ?? undefined}>
            S{st.straight_id}
            <span className="tw-sh__n">{st.into ?? st.label}</span>
          </span>
        ),
        cell: (r) => {
          const v = medOf(r.s, st.straight_id);
          const on = st.straight_id === sel?.straight_id;
          if (!v) return <span className="tw-none">–</span>;
          const half = v.lo !== null && v.hi !== null ? (rel(st, v.hi) - rel(st, v.lo)) / 2 : null;
          return (
            <span className={`tw-m ${on ? "is-on" : ""}`}>
              {int(rel(st, v.m))}
              <span className="tw-ci">{half !== null ? `±${int(half)}` : ""}</span>
            </span>
          );
        },
      }),
    ),
    {
      key: "regimes",
      head: "Regimes",
      width: "150px",
      cell: (r) => <RegimeShare shares={r.s.regime_shares} />,
    },
    {
      key: "vs",
      head: <span className="sr-only">Compare</span>,
      width: "56px",
      cell: (r) => {
        const n = r.driver.driver_number;
        if (n === primary) return null;
        const on = n === compare;
        return (
          <button
            type="button"
            className={`tw-vs ${on ? "is-on" : ""}`}
            aria-pressed={on}
            aria-label={on ? `Stop comparing with ${driverCode(r.driver)}` : `Compare with ${driverCode(r.driver)}`}
            onClick={(e) => {
              e.stopPropagation();
              onCompare(on ? null : n);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            vs
          </button>
        );
      },
    },
  ];

  return (
    <div className="tw">
      <div
        className="tw__scroll"
        data-lenis-prevent-horizontal
        onClickCapture={(e) => {
          shift.current = e.shiftKey;
        }}
        onKeyDownCapture={(e) => {
          shift.current = e.shiftKey;
        }}
      >
        <Tower
          rows={visible}
          columns={columns}
          selected={primary}
          caption={`Median cut-off per straight, ranked by S${sel?.straight_id ?? ""}`}
          onPick={(n) => {
            if (shift.current && n !== primary) {
              shift.current = false;
              onCompare(n === compare ? null : n);
              return;
            }
            onPick(n);
          }}
          className="tw__table"
        />
      </div>
      <div className="tw__foot">
        {ranked.length > SHOWN && (
          <button type="button" className="ss-btn" onClick={() => setAll((a) => !a)} aria-expanded={all}>
            {all ? `Show the first ${SHOWN}` : `Show all ${ranked.length}`}
          </button>
        )}
        <p className="ss-note">
          Metres into each straight, median over green laps (est.), ± half the 95&nbsp;% interval. Select a row to put that driver on the stage;
          shift-click or "vs" to compare.
          {without.length > 0 && ` No cut-off on any straight: ${without.map((r) => driverCode(r)).join(", ")}.`}
        </p>
      </div>
    </div>
  );
}

function RegimeShare({ shares }: { shares: Partial<Record<RegimeLabel, number>> }) {
  const total = REGIMES.reduce((a, k) => a + (shares[k] ?? 0), 0);
  if (!total) return <span className="tw-share tw-share--empty" />;
  return (
    <span className="tw-share" title={REGIMES.map((k) => `${REGIME_WORD[k]} ${Math.round(((shares[k] ?? 0) / total) * 100)} %`).join(", ")}>
      {REGIMES.map((k) => (
        <span key={k} style={{ width: `${((shares[k] ?? 0) / total) * 100}%`, background: REGIME_VAR[k] }} />
      ))}
    </span>
  );
}
