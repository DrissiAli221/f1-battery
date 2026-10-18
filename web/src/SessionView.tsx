import { useEffect, useMemo, useState } from "react";
import { straightName } from "./types";
import { url, useRemote } from "./api";
import { SeriesChart, type Series } from "./SeriesChart";
import { SummaryTable } from "./SummaryTable";
import { TrackMap } from "./TrackMap";
import type {
  Compare,
  Driver,
  Lap,
  Outline,
  Page,
  RegimeBin,
  ResultRow,
  SessionRow,
  Straight,
} from "./types";
import { Async, Card, Empty, fmt, label } from "./ui";

const COLORS = ["var(--series-a)", "var(--series-b)"];

export function SessionView({ sessionKey }: { sessionKey: number }) {
  const sessions = useRemote<Page<SessionRow>>(url("/sessions", { size: 1000 }));
  const session = sessions.data?.items.find((s) => s.session_key === sessionKey) ?? null;
  const drivers = useRemote<Page<Driver>>(url(`/sessions/${sessionKey}/drivers`, { size: 1000 }));
  const circuit = session?.circuit_key ?? null;
  const straights = useRemote<Page<Straight>>(circuit !== null ? url(`/circuits/${circuit}/straights`, { size: 1000 }) : null);
  const outline = useRemote<Outline>(circuit !== null ? url(`/circuits/${circuit}/outline`) : null);

  const [driver, setDriver] = useState<number | null>(null);
  const [other, setOther] = useState<number | null>(null);
  const [lapNumber, setLapNumber] = useState<number | null>(null);
  const [straightId, setStraightId] = useState<number | null>(null);

  useEffect(() => {
    setDriver(null);
    setOther(null);
    setLapNumber(null);
    setStraightId(null);
  }, [sessionKey]);

  const driverList = drivers.data?.items ?? [];
  useEffect(() => {
    if (driver === null && driverList.length) setDriver(driverList[0].driver_number);
  }, [driver, driverList]);
  const straightList = straights.data?.items ?? [];
  useEffect(() => {
    if (straightId === null && straightList.length) setStraightId(straightList[0].straight_id);
  }, [straightId, straightList]);

  const laps = useRemote<Page<Lap>>(driver !== null ? url(`/sessions/${sessionKey}/laps`, { driver, size: 1000 }) : null);
  const lapList = useMemo(() => laps.data?.items.filter((l) => l.lap_duration !== null) ?? [], [laps.data]);
  useEffect(() => {
    // Start on the fastest green lap (or the fastest lap when no verdicts exist yet).
    if (!lapList.length) {
      setLapNumber(null);
      return;
    }
    if (lapNumber !== null && lapList.some((l) => l.lap_number === lapNumber)) return;
    const pool = lapList.some((l) => l.green) ? lapList.filter((l) => l.green) : lapList;
    setLapNumber(pool.reduce((a, b) => ((a.lap_duration ?? Infinity) <= (b.lap_duration ?? Infinity) ? a : b)).lap_number);
  }, [lapList, lapNumber]);

  const regimes = useRemote<Page<RegimeBin>>(
    driver !== null && lapNumber !== null && session?.has_results
      ? url(`/sessions/${sessionKey}/laps/${lapNumber}/regimes`, { driver, size: 1000 })
      : null,
  );

  if (sessions.error) return <Empty title="Could not load the session">{sessions.error.message}</Empty>;
  if (sessions.data && !session) return <Empty title="Unknown session">There is no session {sessionKey}. <a href="#/">Back to the list</a>.</Empty>;
  if (!session) return <div className="loading" role="status">Loading</div>;

  const idx = Math.max(0, lapList.findIndex((l) => l.lap_number === lapNumber));
  const lap = lapList[idx];
  const hasResults = session.has_results;

  return (
    <>
      <p className="crumb"><a href="#/">Sessions</a></p>
      <h1>
        {session.circuit_short_name ?? "Unknown circuit"} <span className="muted">{session.session_name} {session.year}</span>
      </h1>
      {!hasResults && (
        <div className="banner" role="status">
          <strong>Model results not published for this session.</strong> The track and laps below come from ingested
          telemetry only; cut-off charts, comparison and the summary stay empty until the model has run.
        </div>
      )}

      <div className="controls">
        <label>
          Driver
          <select value={driver ?? ""} onChange={(e) => { setDriver(Number(e.target.value)); setLapNumber(null); }}>
            {driverList.map((d) => (
              <option key={d.driver_number} value={d.driver_number}>
                {label(d)}{d.team_name ? ` (${d.team_name})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Lap {lap ? `${lap.lap_number}${lap.lap_duration ? `, ${lap.lap_duration.toFixed(3)} s` : ""}` : ""}
          <input
            type="range"
            min={0}
            max={Math.max(0, lapList.length - 1)}
            value={idx}
            disabled={lapList.length < 2}
            onChange={(e) => setLapNumber(lapList[Number(e.target.value)].lap_number)}
            aria-label="Lap"
          />
          <span className="hint">
            {lap ? (lap.green === null ? "no lap-quality verdict yet" : lap.green ? "green lap" : `excluded: ${lap.reason ?? "unspecified"}`) : "no timed laps"}
          </span>
        </label>
      </div>

      <div className="grid">
        <Card title="Track map" note="Outline from one reference lap; coloured by regime for the selected lap.">
          <Async remote={outline}>
            {(o) =>
              o.points.length < 2 ? (
                <Empty title="No outline yet">The reference lap has no location samples.</Empty>
              ) : (
                <TrackMap outline={o} straights={straightList} regimes={regimes.data?.items ?? []} />
              )
            }
          </Async>
          {hasResults && regimes.data && regimes.data.items.length === 0 && (
            <p className="note">No regime labels for this lap (it may have been excluded from the model run).</p>
          )}
        </Card>

        <Card title="Cut-off by lap" note="Where deployment ends on a straight, per lap, against the driver's median and confidence interval.">
          <StraightPicker straights={straightList} value={straightId} onChange={setStraightId} />
          <CutoffPanel session={sessionKey} driver={driver} straight={straightId} hasResults={hasResults} marker={lapNumber} />
        </Card>
      </div>

      <Card title="Compare two drivers" note="Per-lap cut-off distance on the selected straight.">
        <div className="controls inline">
          <label>
            Against
            <select value={other ?? ""} onChange={(e) => setOther(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Choose a driver</option>
              {driverList.filter((d) => d.driver_number !== driver).map((d) => (
                <option key={d.driver_number} value={d.driver_number}>{label(d)}</option>
              ))}
            </select>
          </label>
        </div>
        <ComparePanel session={sessionKey} a={driver} b={other} straight={straightId} hasResults={hasResults} />
      </Card>

      <Card title="Session summary" note="Median cut-off distance per straight (metres, 95 % bootstrap interval) and share of lap in each regime on green laps.">
        <SummaryTable session={sessionKey} straights={straightList} hasResults={hasResults} />
      </Card>
    </>
  );
}

function StraightPicker({ straights, value, onChange }: { straights: Straight[]; value: number | null; onChange: (id: number) => void }) {
  if (!straights.length) return <p className="note">No straights defined for this circuit yet.</p>;
  return (
    <div className="tabs" role="tablist" aria-label="Straight">
      {straights.map((s) => (
        <button key={s.straight_id} role="tab" aria-selected={s.straight_id === value} onClick={() => onChange(s.straight_id)}>
          {straightName(s)}
        </button>
      ))}
    </div>
  );
}

function CutoffPanel({ session, driver, straight, hasResults, marker }: { session: number; driver: number | null; straight: number | null; hasResults: boolean; marker: number | null }) {
  const ready = hasResults && driver !== null && straight !== null;
  const laps = useRemote<Page<ResultRow>>(ready ? url("/results", { session, driver, variable: "cutoff_distance_m", straight, size: 1000 }) : null);
  const med = useRemote<Page<ResultRow>>(ready ? url("/results", { session, driver, variable: "cutoff_distance_median_m", straight, lap: 0, size: 1000 }) : null);
  if (!hasResults) return <Empty title="Model results not published for this session" />;
  if (!ready) return <Empty title="Choose a driver and a straight" />;
  return (
    <Async remote={laps}>
      {(page) => {
        const pts = page.items.filter((r) => r.value !== null && r.lap_number > 0).map((r) => ({ x: r.lap_number, y: r.value as number }));
        if (!pts.length) return <Empty title="No cut-off values for this driver on this straight">The detector found no cut-off, or the laps were excluded.</Empty>;
        const m = med.data?.items[0];
        return (
          <SeriesChart
            title="Cut-off distance per lap"
            xLabel="Lap"
            yLabel="Cut-off distance (m)"
            series={[{ name: "Cut-off", color: COLORS[0], points: pts }]}
            band={m && m.value !== null ? { mid: m.value, lo: m.ci_low, hi: m.ci_high, label: `median ${fmt(m.value)} m with interval` } : null}
            marker={marker}
          />
        );
      }}
    </Async>
  );
}

function ComparePanel({ session, a, b, straight, hasResults }: { session: number; a: number | null; b: number | null; straight: number | null; hasResults: boolean }) {
  const ready = hasResults && a !== null && b !== null && straight !== null;
  const cmp = useRemote<Compare>(ready ? url("/compare", { session, drivers: `${a},${b}`, straight }) : null);
  if (!hasResults) return <Empty title="Model results not published for this session" />;
  if (b === null) return <Empty title="Pick a second driver to compare" />;
  if (!ready) return <Empty title="Choose a straight" />;
  return (
    <Async remote={cmp}>
      {(c) => {
        const series: Series[] = c.drivers.map((d, i) => ({
          name: label(d),
          color: COLORS[i],
          points: d.series.filter((p) => p.cutoff_distance_m !== null).map((p) => ({ x: p.lap_number, y: p.cutoff_distance_m as number })),
        }));
        if (series.every((s) => s.points.length === 0)) return <Empty title="No cut-off values for these drivers on this straight" />;
        return <SeriesChart title="Cut-off distance per lap, two drivers" xLabel="Lap" yLabel="Cut-off distance (m)" series={series} />;
      }}
    </Async>
  );
}
