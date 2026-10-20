import { useMemo, useState } from "react";
import log from "../content/method-log.json";
import { href } from "../lib/router";
import { RECORD, STATUS_VAR, nums, type Status } from "./recordData";

const when = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

interface Entry {
  id: string;
  title: string;
  date: string;
  phase: string;
  status: Status;
  line: string;
  crossed: boolean;
}

/*
 * The record (DESIGN.md "THE RECORD"): the method log as ticks on one long axis, in log order.
 * Desktop: a horizontal axis across the full viewport; hovering or focusing a tick lights it
 * and sets the one-line summary under the axis. Phones: a vertical axis with every summary
 * shown (no hover to reveal them). Every tick links to the method log.
 */
export function RecordStrip({
  title = "The record",
  level = "h2",
  onPick,
  more = true,
}: {
  title?: string;
  level?: "h1" | "h2";
  /** On the method log itself: a tick scrolls to its entry instead of following the link. */
  onPick?: (id: string) => void;
  more?: boolean;
} = {}) {
  const H = level;
  const entries = useMemo<Entry[]>(
    () =>
      log.entries.map((e) => {
        const r = RECORD[e.id] ?? { status: "explained" as Status, line: e.title };
        return { id: e.id, title: e.title, date: e.date, phase: e.phase, status: r.status, line: r.line, crossed: !!r.crossed };
      }),
    [],
  );
  const [on, setOn] = useState(entries.length - 1);
  const fails = entries.filter((e) => e.status === "fail").length;
  const cur = entries[on];

  return (
    <section className="record" aria-labelledby="record-h">
      <div className="wrap">
        <div className="section-intro">
          <H id="record-h" className="section-intro__title" data-reveal>
            {title}
          </H>
          <p className="section-intro__text" data-reveal>
            Every check was set before its result was seen. <span className="num">{fails}</span> of{" "}
            <span className="num">{entries.length}</span> did not pass, and they stay in the log as recorded.
          </p>
        </div>
      </div>

      <div className="record__strip">
        <ol className="record__axis" style={{ ["--n" as string]: entries.length }}>
          {entries.map((e, i) => (
            <li key={e.id} className="record__li" data-reveal style={{ ["--status" as string]: STATUS_VAR[e.status] }}>
              <a
                href={href.method}
                className={`record__tick ${i === on ? "is-on" : ""} ${e.crossed ? "is-crossed" : ""} is-${e.status.replace(" ", "-")}`}
                aria-describedby={`rec-${e.id}`}
                onPointerEnter={() => setOn(i)}
                onFocus={() => setOn(i)}
                onClick={
                  onPick
                    ? (ev) => {
                        ev.preventDefault();
                        onPick(e.id);
                      }
                    : undefined
                }
              >
                <span className="record__status">{e.status}</span>
                <span className="record__mark" aria-hidden="true" />
                <span className="record__date num">{when(e.date)}</span>
                <span className="record__title">
                  {e.crossed ? (
                    <>
                      <s>{e.title}</s>
                      <span className="sr-only"> (replaced as the primary estimator)</span>
                    </>
                  ) : (
                    e.title
                  )}
                </span>
                <span id={`rec-${e.id}`} className="record__line">
                  {nums(e.line)}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </div>

      <div className="wrap record__readout" aria-hidden="true">
        <p className="record__readout-k">
          <span className="num">{when(cur.date)}</span> · {cur.phase} ·{" "}
          <span className="record__key" style={{ ["--status" as string]: STATUS_VAR[cur.status] }}>
            {cur.status}
          </span>
        </p>
        <p className="record__readout-v">{nums(cur.line)}</p>
      </div>
      {more && (
        <p className="wrap record__more">
          <a href={href.method} className="link">
            Open the method log
          </a>
        </p>
      )}
    </section>
  );
}
