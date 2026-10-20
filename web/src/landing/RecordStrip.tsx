import { useMemo, useState } from "react";
import log from "../content/method-log.json";
import { Card, SectionHead } from "../components/system";
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
  card = false,
}: {
  title?: string;
  level?: "h1" | "h2";
  /** On the method log itself: a tick scrolls to its entry instead of following the link. */
  onPick?: (id: string) => void;
  more?: boolean;
  /** The landing's v3 form: a section head, the strip inside a card, no full-viewport rhythm. */
  card?: boolean;
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

  const strip = (
    <>
      <div className="record__strip">
        <ol className="record__axis" style={{ ["--n" as string]: entries.length }}>
          {entries.map((e, i) => (
            <li key={e.id} className="record__li" style={{ ["--status" as string]: STATUS_VAR[e.status] }}>
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

      <div className={`${card ? "" : "wrap "}record__readout`} aria-hidden="true">
        <p className="record__readout-k">
          <span className="num">{when(cur.date)}</span> · {cur.phase} ·{" "}
          <span className="record__key" style={{ ["--status" as string]: STATUS_VAR[cur.status] }}>
            {cur.status}
          </span>
        </p>
        <p className="record__readout-v">{nums(cur.line)}</p>
      </div>
    </>
  );
  const intro = (
    <>
      Every check was set before its result was seen. <span className="num">{fails}</span> of <span className="num">{entries.length}</span> did not
      pass, and they stay in the log as recorded.
    </>
  );

  if (card) {
    return (
      <section className="lp-section wrap" aria-labelledby="record-h">
        <SectionHead
          label="Method log"
          title={<span id="record-h">{title}</span>}
          aside={
            more ? (
              <a href={href.method} className="lp-more">
                Open the method log
              </a>
            ) : undefined
          }
        >
          <p>{intro}</p>
        </SectionHead>
        <Card className="record record--card">{strip}</Card>
      </section>
    );
  }

  return (
    <section className="record" aria-labelledby="record-h">
      <div className="wrap">
        <div className="section-intro">
          <H id="record-h" className="section-intro__title" data-reveal>
            {title}
          </H>
          <p className="section-intro__text" data-reveal>
            {intro}
          </p>
        </div>
      </div>
      {strip}
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
