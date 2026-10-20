import { Pill } from "../components/system";
import { Tower, type TowerColumn, type TowerRow as BaseRow } from "../components/Tower";
import { REGIME_WORD } from "../track/regimes";
import type { LiveRegime } from "./useLive";

export interface TowerRow extends BaseRow {
  /** Position in this tower's order, 1 first. */
  pos: number;
  /** Gap to the first row, already formatted ("+412 m", "+12.3 s", "+1 lap"), or null. */
  gap: string | null;
  regime: LiveRegime | null;
}

/*
 * The live timing tower: the shared broadcast table (components/Tower, compact) with the gap
 * in mono and, with a feed, the car's regime as a small pill whose dot carries the regime
 * colour. A row selects the car on the map.
 */
export function LiveTower({ rows, selected, onPick, live }: { rows: TowerRow[]; selected: number | null; onPick: (n: number) => void; live: boolean }) {
  const columns: TowerColumn<TowerRow>[] = [
    { key: "gap", head: "Gap", num: true, cell: (r) => r.gap ?? (r.pos === 1 ? "Leader" : ""), tone: (r) => (r.pos === 1 || r.gap === "no laps" ? "muted" : null) },
  ];
  if (live)
    columns.push({
      key: "regime",
      head: "Regime",
      cell: (r) =>
        r.regime ? (
          <Pill dot className={`lv-reg lv-reg--${r.regime}`}>
            {REGIME_WORD[r.regime]}
          </Pill>
        ) : null,
      width: "112px",
    });
  return <Tower rows={rows} columns={columns} selected={selected} onPick={onPick} compact showName caption={live ? "Live order by estimated distance" : "Order at the flag"} className="lv-tower" />;
}
