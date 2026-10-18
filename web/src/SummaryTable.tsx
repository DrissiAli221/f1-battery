import { url, useRemote } from "./api";
import type { Page, RegimeLabel, Straight, SummaryDriver } from "./types";
import { Async, Empty, fmt, label } from "./ui";
import { REGIME_COLORS } from "./TrackMap";

const REGIMES: RegimeLabel[] = ["deploy", "plateau", "lift", "brake"];

export function SummaryTable({ session, straights, hasResults }: { session: number; straights: Straight[]; hasResults: boolean }) {
  const summary = useRemote<Page<SummaryDriver>>(hasResults ? url(`/sessions/${session}/summary`, { size: 1000 }) : null);
  if (!hasResults) return <Empty title="Model results not published for this session">Run the model for this session to fill the summary.</Empty>;
  return (
    <Async remote={summary}>
      {(page) => {
        if (!page.items.length) return <Empty title="The summary is empty" />;
        const rows = [...page.items].sort((a, b) => (a.team_name ?? "").localeCompare(b.team_name ?? "") || a.driver_number - b.driver_number);
        const ids = straights.length ? straights.map((s) => s.straight_id) : [...new Set(rows.flatMap((r) => r.straights.map((s) => s.straight_id)))].sort((a, b) => a - b);
        return (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Driver</th>
                  {ids.map((id) => (
                    <th key={id} className="num">{straights.find((s) => s.straight_id === id)?.label ?? `Straight ${id}`} (m)</th>
                  ))}
                  {REGIMES.map((r) => (
                    <th key={r} className="num"><i className="dot" style={{ background: REGIME_COLORS[r] }} />{r}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.driver_number}>
                    <td>{r.team_name ?? "n/a"}</td>
                    <td>{label(r)}</td>
                    {ids.map((id) => {
                      const s = r.straights.find((x) => x.straight_id === id);
                      return (
                        <td key={id} className="num">
                          {s && s.cutoff_distance_median_m !== null ? (
                            <>
                              {fmt(s.cutoff_distance_median_m)} <span className="muted">[{fmt(s.ci_low)}, {fmt(s.ci_high)}]</span>
                            </>
                          ) : (
                            "n/a"
                          )}
                        </td>
                      );
                    })}
                    {REGIMES.map((k) => (
                      <td key={k} className="num">{r.regime_shares[k] === undefined ? "n/a" : `${(r.regime_shares[k]! * 100).toFixed(0)} %`}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }}
    </Async>
  );
}
