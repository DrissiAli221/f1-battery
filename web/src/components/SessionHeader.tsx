import type { ReactNode } from "react";
import { date } from "../lib/format";
import type { SessionRow } from "../lib/types";
import { circuitMeta, eventName } from "../track/circuits";
import { Flag, Label } from "./system";

/*
 * The broadcast session header: flag, the Grand Prix name over the circuit, then the
 * session's facts as small label/value pairs (type, date, laps, lap length). Used at the top
 * of the session and live pages and on the landing's "last race" card.
 */
export function SessionHeader({
  session,
  facts = [],
  size = "lg",
  aside,
  className = "",
}: {
  session: SessionRow;
  /** Extra label/value pairs after type and date (laps, lap length, drivers with a cut). */
  facts?: { label: ReactNode; value: ReactNode }[];
  size?: "md" | "lg";
  aside?: ReactNode;
  className?: string;
}) {
  const meta = circuitMeta(session.circuit_key);
  const title = eventName(session.circuit_key, session.circuit_short_name);
  const sub = meta ? `${meta.name}${meta.location && meta.location !== meta.name ? ` · ${meta.location}` : ""}, ${meta.country}` : session.circuit_short_name;
  return (
    <header className={`shead-s shead-s--${size} ${className}`}>
      <div className="shead-s__id">
        <Flag iso2={meta?.iso2} title={meta?.country} size={size === "lg" ? 80 : 40} className="shead-s__flag" />
        <div>
          <h1 className="shead-s__title">{title}</h1>
          {sub && <p className="shead-s__sub">{sub}</p>}
        </div>
      </div>
      <dl className="shead-s__facts">
        <div>
          <dt>
            <Label>Session</Label>
          </dt>
          <dd>{session.session_name}</dd>
        </div>
        <div>
          <dt>
            <Label>Date</Label>
          </dt>
          <dd>{date(session.date_start, "short")}</dd>
        </div>
        {facts.map((f, i) => (
          <div key={i}>
            <dt>
              <Label>{f.label}</Label>
            </dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {aside && <div className="shead-s__aside">{aside}</div>}
    </header>
  );
}
