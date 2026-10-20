import { useMemo } from "react";
import { Cta } from "../components/Cta";
import { SessionHeader } from "../components/SessionHeader";
import { Card, Label, SectionHead, Skeleton } from "../components/system";
import { Tower, type TowerColumn, type TowerRow } from "../components/Tower";
import { int } from "../lib/format";
import { href } from "../lib/router";
import { driverCode, driverName, teamColour } from "../lib/teams";
import type { SessionRow } from "../lib/types";
import { useSize } from "../lib/useSize";
import { TrackMap } from "../track/TrackMap";
import { useCircuit } from "../track/circuits";
import { useMainStraight, type DriverCut } from "./data";

const TOWER_ROWS = 8;

type Row = TowerRow & { cut: DriverCut };

/*
 * "Last race" (DESIGN.md v3 "Pages → Landing"): the latest race or sprint with results, its
 * header, the track map with the main straight lit and every driver's median cut-off on it as
 * a tag (est.), and a short tower of the eight cut-offs furthest into the straight. Ordered by
 * distance only: an earlier cut-off is not slower, so no sector colours.
 */
export function LastRace({ session, loading }: { session: SessionRow | null; loading: boolean }) {
  const data = useMainStraight(session, true);
  const circuit = useCircuit(session?.circuit_key);
  const ready = data.state === "done" && !!data.outline;
  const [boxRef] = useSize<HTMLDivElement>();

  const order = useMemo(() => [...data.cuts].sort((a, b) => b.m - a.m), [data.cuts]);
  const rows = useMemo<Row[]>(() => order.slice(0, TOWER_ROWS).map((c, i) => ({ driver: { ...c.driver, last_name: c.driver.last_name ?? driverName(c.driver).split(" ").slice(-1)[0] }, pos: i + 1, cut: c })), [order]);
  const columns: TowerColumn<Row>[] = [
    { key: "cut", head: "Cut-off est.", num: true, cell: (r) => <span className="num">{int(r.cut.m)}&nbsp;m</span> },
    { key: "ci", head: "Interval", num: true, cell: (r) => (r.cut.half !== null ? <span className="num">±{int(r.cut.half)}&nbsp;m</span> : "–") },
  ];
  const straight = data.straights.find((s) => s.straight_id === data.straightId) ?? null;
  const noCut = data.drivers.length - data.cuts.length;
  // "the pit straight" for a curated name, "straight 3" for a numbered one.
  const raw = data.straightName ?? "main straight";
  const theName = /^straight \d/i.test(raw) ? raw.toLowerCase() : `the ${raw.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())}`;
  const curated = !/^straight \d/i.test(raw);

  return (
    <section className="lp-section wrap" aria-labelledby="last-h">
      <SectionHead label="Last race" title={<span id="last-h">Where deployment stops</span>}>
        <p>
          Every driver's median cut-off on {theName} of the latest race: the point where the car stops gaining speed while still flat out (est.).
        </p>
      </SectionHead>

      <Card className="last" as="article">
        <div className="last__head">
          {session ? (
            <SessionHeader
              session={session}
              size="md"
              facts={[
                { label: "Straight", value: straight ? `${data.straightName} · ${int(straight.len)} m` : data.straightName ?? "–" },
                { label: "Drivers with a cut", value: ready ? `${data.cuts.length} of ${data.drivers.length}` : "–" },
              ]}
            />
          ) : (
            <Skeleton className="last__skel-head" />
          )}
        </div>

        <div className="last__grid">
          <div className="last__map">
            <div ref={boxRef} className="last__mapbox">
            {ready && data.outline ? (
              <TrackMap
                outline={data.outline}
                circuit={circuit}
                straights={straight ? [straight] : []}
                selected={data.straightId}
                tags={data.cuts.map((c) => ({ id: c.driver.driver_number, code: driverCode(c.driver), colour: teamColour(c.driver), d: c.d, note: `${int(c.m)} m` }))}
                corners
                compass
                scale
                sf
                label={`Track map of ${session?.circuit_short_name ?? "the circuit"}, ${theName} lit, each driver's median cut-off as a tag`}
              >
              </TrackMap>
            ) : (
              <Skeleton className="last__skel-map" />
            )}
            </div>
          </div>

          <div className="last__side">
            <Label as="p" className="last__side-h">
              Furthest into the straight
            </Label>
            {ready && rows.length ? (
              <Tower rows={rows} columns={columns} compact showName caption="Eight latest median cut-offs on the main straight (est.)" className="last__tower" />
            ) : ready ? (
              <p className="last__none">No driver has a cut-off on this straight.</p>
            ) : (
              <div className="last__skel-rows">
                {Array.from({ length: TOWER_ROWS }, (_, i) => (
                  <Skeleton key={i} className="last__skel-row" />
                ))}
              </div>
            )}
            {session && (
              <div className="last__cta">
                <Cta href={href.session(session.session_key, data.straightId ? { straight: data.straightId } : undefined)} size="sm">
                  Open the session
                </Cta>
              </div>
            )}
          </div>
        </div>

        <p className="last__cap">
          Median cut-off on the main straight{curated ? "" : ` (${theName}, the straight with the most cut-offs)`}, metres from the straight's
          start, over clean laps (est.). Interval: half the width of the median's bootstrap interval.
          {ready && noCut > 0 && (
            <>
              {" "}
              <span className="num">{noCut}</span> {noCut === 1 ? "driver has" : "drivers have"} no cut-off on this straight and no tag.
            </>
          )}
          {!session && !loading && " No race with published estimates yet."}
        </p>
      </Card>
    </section>
  );
}


/*
 * The drivers' tags as a ladder. Median cut-offs on one straight sit within a few metres of
 * each other, a few pixels apart on the map, so the map's own tag stacking would pile them up.
 * Here each driver keeps a dot on the road at his median cut-off and a leader to a chip in a
 * column beside the straight, ordered top to bottom by where the dots are: the broadcast
 * ladder. Past one column's height the drivers alternate between both sides of the road.
 */
