import type { ReactNode } from "react";
import { date, int } from "../lib/format";
import type { SessionRow } from "../lib/types";
import { circuitMeta, eventName } from "../track/circuits";
import { Flag } from "./system";
import "./circuit-poster.css";

const NB = " ";

/*
 * Event-branding intro at the top of a session page (reference: the Jeddah GP event identity):
 * red halftone fade, the Grand Prix name in heavy display caps, diagonal stripe bars, a short
 * mono intro and four numbers. No track drawing here: the interactive map below is the drawing.
 */
export function CircuitPoster({
  session,
  laps,
  lapLength,
  intro,
  cutoff,
}: {
  session: SessionRow;
  laps: number;
  /** Lap length in metres, from the telemetry. */
  lapLength: number | null;
  /** One or two plain sentences introducing the session; mono, small. */
  intro?: ReactNode;
  /** The selected driver's median cut-off on the selected straight, already formatted. */
  cutoff?: { label: string; value: ReactNode } | null;
}) {
  const meta = circuitMeta(session.circuit_key);
  const event = eventName(session.circuit_key, session.circuit_short_name);
  const where = meta ? `${meta.location && meta.location !== meta.name ? `${meta.location}, ` : ""}${meta.country}` : "";
  const km = (m: number) => (m / 1000).toFixed(3);
  const stats: { label: string; value: ReactNode; unit?: string }[] = [
    ...(laps > 0 ? [{ label: "Laps", value: int(laps) }] : []),
    ...(lapLength ? [{ label: "Lap length", value: km(lapLength), unit: "km" }] : []),
    ...(laps > 0 && lapLength ? [{ label: "Distance", value: km(laps * lapLength), unit: "km" }] : []),
    ...(cutoff ? [{ label: cutoff.label, value: cutoff.value }] : []),
  ];

  return (
    <section className="cposter" aria-label={`${event}, ${session.session_name ?? "session"}`}>
      <div className="cposter__halftone" aria-hidden="true" />
      <div className="wrap cposter__inner">
        <div className="cposter__top">
          <span className="cposter__mono">
            {session.session_name ?? "Session"} · {date(session.date_start, "short")}
          </span>
          <span className="cposter__where">
            <Flag iso2={meta?.iso2} title={meta?.country} size={40} className="cposter__flag" />
            <span className="cposter__mono">
              {meta?.name ?? session.circuit_short_name}
              {where && `, ${where}`}
            </span>
          </span>
        </div>

        <h1 className="cposter__title">{event}</h1>

        <div className="cposter__bar" aria-hidden="true">
          <span className="cposter__stripes" />
          <span className="cposter__bar-line" />
          <span className="cposter__stripes cposter__stripes--r" />
        </div>

        <div className="cposter__body">
          {intro && <p className="cposter__intro">{intro}</p>}
          <dl className="cposter__stats">
            {stats.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd>
                  {s.value}
                  {s.unit && (
                    <span className="cposter__unit">
                      {NB}
                      {s.unit}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

