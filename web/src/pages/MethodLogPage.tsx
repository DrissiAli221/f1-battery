import log from "../content/method-log.json";
import { Card, Label, Pill, type PillTone } from "../components/system";
import { Readout } from "../components/Readout";
import { RecordStrip } from "../landing/RecordStrip";
import { RECORD, nums, type Status } from "../landing/recordData";
import { scrollToTarget, usePage } from "../motion";
import "../landing/landing.css";
import "../method/method.css";

const REPO = "https://github.com/DrissiAli221/f1-battery/blob/main/";

type Entry = (typeof log.entries)[number] & {
  figure?: { src: string; alt: string; caption: string };
};

const when = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const entries = log.entries as Entry[];
const fails = entries.filter((e) => RECORD[e.id]?.status === "fail").length;

/** The record's status words as pill tones: fail and pass carry meaning, the rest stay neutral. */
const TONE: Record<Status, PillTone> = { fail: "bad", pass: "good", "not demonstrated": "neutral", explained: "neutral" };

/*
 * The method log (DESIGN.md v3 "Method"): the record strip as the opener, on its card, then the
 * entries as cards in one 760 px reading column. On wide screens each entry's number, date,
 * phase and outcome sit in the gutter to the card's left. The first cut-off estimator (the hinge
 * detector) is crossed out in the strip and marked "replaced" here (D18, D19).
 */
export function MethodLogPage() {
  const page = usePage<HTMLDivElement>();

  const toEntry = (id: string) => {
    scrollToTarget(`#${id}`, -88);
    document.getElementById(`${id}-h`)?.focus({ preventScroll: true });
  };

  return (
    <div ref={page} className="mlog">
      <header className="wrap mlog__top">
        <h1 className="mlog__h1" data-intro>
          {log.title}
        </h1>
        <p className="mlog__intro" data-intro data-delay="0.1">
          {nums(log.intro)}
        </p>
      </header>

      <RecordStrip card title="The record" onPick={toEntry} more={false} />

      <section className="wrap mlog__entries" aria-labelledby="mlog-h">
        <h2 id="mlog-h" className="mlog__h2" data-reveal>
          The entries
        </h2>
        <ol className="mlog__list">
          {entries.map((e, i) => {
            const r = RECORD[e.id] ?? { status: "explained" as Status, line: e.title };
            const meta = (
              <>
                <Label className="mentry__n">{String(i + 1).padStart(2, "0")}</Label>
                <Label>
                  <time dateTime={e.date}>{when(e.date)}</time>
                </Label>
                <Label>{e.phase}</Label>
                <span className="mentry__pills">
                  <Pill tone={TONE[r.status]}>{r.status}</Pill>
                  {r.crossed && <Pill>replaced</Pill>}
                </span>
              </>
            );
            return (
              <li key={e.id} id={e.id} className={`mentry ${r.crossed ? "is-crossed" : ""}`}>
                <article aria-labelledby={`${e.id}-h`} data-reveal>
                  <div className="mentry__gutter">{meta}</div>
                  <Card className="mentry__card">
                    <div className="mentry__meta">{meta}</div>
                    <h3 id={`${e.id}-h`} className="mentry__title" tabIndex={-1}>
                      {r.crossed ? (
                        <>
                          <s>{e.title}</s>
                          <span className="sr-only"> (replaced)</span>
                        </>
                      ) : (
                        nums(e.title)
                      )}
                    </h3>
                    {r.crossed && (
                      <p className="mentry__replaced">
                        Replaced. The threshold crossing became the primary cut-off for Phases <span className="num">4</span> and{" "}
                        <span className="num">5</span> (D18); the hinge ramp start is kept as experimental only (D19).
                      </p>
                    )}
                    <p className="mentry__tried">{nums(e.tried)}</p>
                    <dl className="mentry__fields">
                      <div>
                        <dt>Check</dt>
                        <dd>{nums(e.check)}</dd>
                      </div>
                      <div>
                        <dt>Found</dt>
                        <dd>{nums(e.found)}</dd>
                      </div>
                      <div>
                        <dt>Decision</dt>
                        <dd>{nums(e.consequence)}</dd>
                      </div>
                    </dl>
                    {e.figure && (
                      <figure className="mentry__fig">
                        <img src={`${import.meta.env.BASE_URL}${e.figure.src}`} alt={e.figure.alt} loading="lazy" width={1400} height={900} />
                        <figcaption>{nums(e.figure.caption)}</figcaption>
                      </figure>
                    )}
                    <p className="mentry__src">
                      <span className="label">Source</span>
                      <span>
                        {e.sources.map((s, j) => (
                          <span key={s.path}>
                            {j > 0 && ", "}
                            <a className="link" href={REPO + s.path} target="_blank" rel="noreferrer">
                              {s.label}
                            </a>
                          </span>
                        ))}
                      </span>
                    </p>
                  </Card>
                </article>
              </li>
            );
          })}
        </ol>
      </section>

      <Readout label="The record">
        <p>
          <span className="num">{fails}</span> of <span className="num">{entries.length}</span> checks did not pass
        </p>
      </Readout>
    </div>
  );
}
