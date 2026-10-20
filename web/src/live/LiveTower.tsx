import { REGIME_VAR } from "../explorer/TrackMap";
import { driverCode, driverName, teamColour } from "../lib/teams";
import type { Driver } from "../lib/types";
import type { LiveRegime } from "./useLive";

export interface TowerRow {
  driver: Driver;
  /** Position in this tower's order, 1 first. */
  pos: number;
  /** Gap to the first row, already formatted ("+412 m", "+12.3 s", "+1 lap"), or null. */
  gap: string | null;
  regime: LiveRegime | null;
}

const WORD: Record<LiveRegime, string> = {
  deploy: "deploying",
  plateau: "plateau",
  lift: "lifting",
  brake: "braking",
  other: "other",
};

/*
 * The timing tower (DESIGN.md "Live"): position in Orbitron, the team bar, the code, the gap in
 * mono and the regime in words. A row is a button that selects the car on the map; rows light
 * their team bar and slide 4 px along x on hover and focus.
 */
export function LiveTower({
  rows,
  selected,
  onPick,
  caption,
  live,
}: {
  rows: TowerRow[];
  selected: number | null;
  onPick: (n: number) => void;
  caption: string;
  /** With a feed: the regime column. */
  live: boolean;
}) {
  return (
    <div className={`lv-tower ${live ? "" : "lv-tower--flag"}`}>
      <p className="lv-tower__cap">{caption}</p>
      <ol className="lv-tower__list">
        {rows.map((r) => {
          const n = r.driver.driver_number;
          const on = n === selected;
          return (
            <li key={n} className={`lv-row ${on ? "is-on" : ""}`} data-reveal>
              <button
                type="button"
                className="lv-row__btn"
                aria-pressed={on}
                style={{ ["--team" as string]: teamColour(r.driver) }}
                onClick={() => onPick(n)}
              >
                <span className="lv-row__pos">{r.pos}</span>
                <span className="lv-row__bar" aria-hidden="true" />
                <span className="lv-row__code">{driverCode(r.driver)}</span>
                <span className="lv-row__name">{r.driver.last_name ?? driverName(r.driver)}</span>
                <span className="lv-row__gap num">{r.gap ?? ""}</span>
                {live && (
                  <span className="lv-row__reg">
                    {r.regime && (
                      <>
                        <i style={{ background: REGIME_VAR[r.regime] }} aria-hidden="true" />
                        {WORD[r.regime]}
                      </>
                    )}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
