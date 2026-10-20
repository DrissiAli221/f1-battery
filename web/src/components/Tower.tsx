import type { ReactNode } from "react";
import { driverCode, driverName, headshotHd, teamColour } from "../lib/teams";
import type { Driver } from "../lib/types";

/*
 * The timing tower (DESIGN.md v3): the broadcast table. Position, the team bar, a small
 * headshot, the code and name, then the page's own columns (mono numbers right-aligned).
 * Rows can be buttons that select a driver. Tone classes on cells carry TV meaning only
 * where it is true (best, improved, slower); estimates stay neutral.
 */

export interface TowerColumn<R> {
  key: string;
  head: ReactNode;
  /** Right-aligned mono number column. */
  num?: boolean;
  cell: (row: R) => ReactNode;
  /** Optional tone per cell: "best" (purple), "good" (green), "warn" (yellow), "muted". */
  tone?: (row: R) => "best" | "good" | "warn" | "muted" | null;
  width?: string;
  /** Hide below this width class ("md" hides under 768 px, "lg" under 1024 px). */
  hide?: "md" | "lg";
}

export interface TowerRow {
  driver: Driver;
  /** Position label; a number or e.g. "–". */
  pos: ReactNode;
  dim?: boolean;
}

export function Tower<R extends TowerRow>({
  rows,
  columns,
  selected = null,
  onPick,
  compact = false,
  showName = true,
  showTeam = false,
  caption,
  className = "",
}: {
  rows: R[];
  columns: TowerColumn<R>[];
  selected?: number | null;
  onPick?: (driver: number) => void;
  compact?: boolean;
  showName?: boolean;
  showTeam?: boolean;
  caption?: string;
  className?: string;
}) {
  return (
    <table className={`tower ${compact ? "tower--compact" : ""} ${className}`}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead>
        <tr>
          <th className="tower__pos" scope="col">
            Pos
          </th>
          <th scope="col">Driver</th>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={`${c.num ? "is-num" : ""} ${c.hide ? `hide-${c.hide}` : ""}`} style={c.width ? { width: c.width } : undefined}>
              {c.head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const n = r.driver.driver_number;
          const on = n === selected;
          const colour = teamColour(r.driver);
          const hd = headshotHd(r.driver);
          return (
            <tr
              key={n}
              className={`tower__row ${on ? "is-on" : ""} ${r.dim ? "is-dim" : ""} ${onPick ? "is-pick" : ""}`}
              style={{ ["--team" as string]: colour }}
              onClick={onPick ? () => onPick(n) : undefined}
              tabIndex={onPick ? 0 : undefined}
              role={onPick ? "button" : undefined}
              aria-pressed={onPick ? on : undefined}
              onKeyDown={
                onPick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onPick(n);
                      }
                    }
                  : undefined
              }
            >
              <td className="tower__pos">{r.pos}</td>
              <td>
                <span className="tower__driver">
                  <i className="teambar" style={{ background: colour }} aria-hidden="true" />
                  {!compact && (hd ? <img className="tower__avatar" src={hd} alt="" loading="lazy" decoding="async" /> : <span className="tower__avatar" aria-hidden="true" />)}
                  <span className="tower__code">{driverCode(r.driver)}</span>
                  {showName && <span className="tower__name hide-md">{r.driver.last_name ?? driverName(r.driver)}</span>}
                  {showTeam && <span className="tower__team hide-lg">{r.driver.team_name}</span>}
                </span>
              </td>
              {columns.map((c) => {
                const tone = c.tone?.(r) ?? null;
                return (
                  <td key={c.key} className={`${c.num ? "is-num" : ""} ${tone ? `is-${tone}` : ""} ${c.hide ? `hide-${c.hide}` : ""}`}>
                    {c.cell(r)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
