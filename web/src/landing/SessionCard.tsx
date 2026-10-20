import { Flag, Label, Pill, Skeleton } from "../components/system";
import { useNearView } from "../findings/sessionRow";
import { int } from "../lib/format";
import { href } from "../lib/router";
import type { SessionRow } from "../lib/types";
import { circuitMeta, eventName } from "../track/circuits";
import { useMainStraight, type MainStraight } from "./data";
import { Silhouette } from "./Silhouette";

export const dayMonth = (iso: string | null, year = false) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: year ? "numeric" : undefined, timeZone: "UTC" }) : "no date";

/** "Pit straight" mid-sentence reads "pit straight"; "T1 → Roggia" keeps its capital. */
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** The number block shared by the season card and the session tile: median cut-off (est.) or its absence. */
function CutFigure({ session, data }: { session: SessionRow; data: MainStraight }) {
  if (!session.has_results) {
    return (
      <div className="scut">
        <Pill>no estimates</Pill>
        <p className="scut__k">Not modelled yet</p>
      </div>
    );
  }
  if (data.state !== "done") {
    return (
      <div className="scut" aria-busy="true">
        <Skeleton className="scut__skel" />
        <Skeleton className="scut__skel scut__skel--k" />
        <span className="sr-only">loading</span>
      </div>
    );
  }
  if (data.median === null) {
    return (
      <div className="scut">
        <p className="scut__v">
          <span className="scut__n scut__n--none">–</span>
        </p>
        <p className="scut__k">
          {data.withCut ? (
            <>
              <span className="num">{data.withCut}</span> {data.withCut === 1 ? "driver" : "drivers"} with a cut, none on the main straight
            </>
          ) : (
            "No cut-off detected"
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="scut">
      <p className="scut__v">
        <span className="scut__n">{int(data.median)}</span>
        <span className="scut__u">m est.</span>
      </p>
      <p className="scut__k">
        Median cut-off, {lower(data.straightName ?? "main straight")} · <span className="num">{data.cuts.length}</span> {data.cuts.length === 1 ? "driver" : "drivers"}
      </p>
    </div>
  );
}

/*
 * A season card (DESIGN.md v3 "Pages → Landing"): the flag, the Grand Prix, the circuit, the
 * session and date, the circuit's outline, and the median cut-off on the main straight (est.).
 * Its numbers load once the card nears the viewport, through the rate-limit bucket.
 */
export function SessionCard({ session }: { session: SessionRow }) {
  const [ref, near] = useNearView<HTMLAnchorElement>("400px 0px");
  const data = useMainStraight(session, near);
  const meta = circuitMeta(session.circuit_key);
  const gp = eventName(session.circuit_key, session.circuit_short_name);
  return (
    <a ref={ref} href={href.session(session.session_key)} className="card scard" data-reveal>
      <div className="scard__top">
        <div className="scard__id">
          <p className="scard__meta">
            <Flag iso2={meta?.iso2} title={meta?.country} size={40} className="scard__flag" />
            <Label>
              {session.session_name} · <span className="num">{dayMonth(session.date_start)}</span>
            </Label>
          </p>
          <h3 className="scard__gp">{gp}</h3>
          <p className="scard__circuit">{meta?.name ?? session.circuit_short_name}</p>
        </div>
        <Silhouette circuitKey={session.circuit_key} className="scard__sil" />
      </div>
      <CutFigure session={session} data={data} />
    </a>
  );
}

/** A session inside a race weekend's card (the sessions page): type, date and the number. */
export function SessionTile({ session, due }: { session: SessionRow; due: boolean }) {
  const [ref, near] = useNearView<HTMLAnchorElement>("400px 0px");
  const data = useMainStraight(session, due || near);
  return (
    <a ref={ref} href={href.session(session.session_key)} className={`stile ${session.has_results ? "" : "is-muted"}`}>
      <p className="stile__head">
        <span className="stile__type">{session.session_name}</span>
        <span className="stile__date num">{dayMonth(session.date_start)}</span>
      </p>
      <CutFigure session={session} data={data} />
    </a>
  );
}
