import log from "../content/method-log.json";
import { Readout } from "../components/Readout";
import { SectionIntro } from "../components/Section";
import { RecordStrip } from "../landing/RecordStrip";
import { RECORD, STATUS_VAR, nums, type Status } from "../landing/recordData";
import { scrollToTarget, usePage } from "../motion";
import { useFigData } from "../figures/cutoff/data";
import { Fig1 } from "../figures/cutoff/Figure";
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

/*
 * The method log (DESIGN.md "Method log"): the record strip at full size as the opener, then
 * the entries as one long document, then Fig. 1. Each entry hangs from column 5; its date,
 * phase and status sit in mono in columns 1 to 4. The first cut-off estimator (the hinge
 * detector) is crossed out in the strip and marked "replaced" here (D18, D19).
 */
export function MethodLogPage() {
  const fig = useFigData();
  const page = usePage<HTMLDivElement>(undefined, [fig.settled, fig.data !== null]);

  const toEntry = (id: string) => {
    scrollToTarget(`#${id}`, -88);
    document.getElementById(`${id}-h`)?.focus({ preventScroll: true });
  };

  return (
    <div ref={page}>
      <RecordStrip title={log.title} level="h1" onPick={toEntry} more={false} />

      <section className="mlog" aria-labelledby="mlog-h">
        <div className="wrap">
          <div className="mlog__lede">
            <h2 id="mlog-h" className="mlog__h" data-reveal>
              The entries
            </h2>
            <p className="mlog__intro" data-reveal>
              {nums(log.intro)}
            </p>
          </div>
          <ol className="mlog__list">
            {entries.map((e, i) => {
              const r = RECORD[e.id] ?? { status: "explained" as Status, line: e.title };
              return (
                <li key={e.id} id={e.id} className={`mentry ${r.crossed ? "is-crossed" : ""}`}>
                  <article aria-labelledby={`${e.id}-h`}>
                    <div className="mentry__meta" data-reveal>
                      <span className="mentry__n num">{String(i + 1).padStart(2, "0")}</span>
                      <time dateTime={e.date} className="num">
                        {when(e.date)}
                      </time>
                      <span>{nums(e.phase)}</span>
                      <span className="mentry__status" style={{ ["--status" as string]: STATUS_VAR[r.status] }}>
                        {r.status}
                        {r.crossed ? " · replaced" : ""}
                      </span>
                    </div>
                    <div className="mentry__body">
                      <h3 id={`${e.id}-h`} className="mentry__title" tabIndex={-1} data-reveal>
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
                        <p className="mentry__replaced" data-reveal>
                          Replaced. The threshold crossing became the primary cut-off for Phases <span className="num">4</span> and{" "}
                          <span className="num">5</span> (D18); the hinge ramp start is kept as experimental only (D19).
                        </p>
                      )}
                      <p className="mentry__tried" data-reveal>
                        {nums(e.tried)}
                      </p>
                      <dl className="mentry__fields">
                        <div data-reveal>
                          <dt>Check</dt>
                          <dd>{nums(e.check)}</dd>
                        </div>
                        <div data-reveal>
                          <dt>Found</dt>
                          <dd>{nums(e.found)}</dd>
                        </div>
                        <div data-reveal>
                          <dt>Decision</dt>
                          <dd>
                            {nums(e.consequence)}
                            <span className="mentry__src">
                              {e.sources.map((s, j) => (
                                <span key={s.path}>
                                  {j > 0 && ", "}
                                  <a className="link" href={REPO + s.path} target="_blank" rel="noreferrer">
                                    {s.label}
                                  </a>
                                </span>
                              ))}
                            </span>
                          </dd>
                        </div>
                      </dl>
                      {e.figure && (
                        <figure className="mentry__fig" data-reveal>
                          <div className="mentry__img">
                            <img src={`${import.meta.env.BASE_URL}${e.figure.src}`} alt={e.figure.alt} loading="lazy" width={1400} height={900} />
                          </div>
                          <figcaption>{nums(e.figure.caption)}</figcaption>
                        </figure>
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {fig.data && (
        <section className="mfig fig1 iso" aria-labelledby="mfig-h">
          <div className="wrap">
            <SectionIntro id="mfig-h" title="The estimator, as a bench">
              The primary cut-off since D18, built as an instrument: every number in the figure comes from the profile its cam is cut
              to.
            </SectionIntro>
            <div className="mfig__plate" data-reveal>
              <Fig1 data={fig.data} />
            </div>
          </div>
        </section>
      )}

      <Readout label="The record">
        <p>
          <span className="num">{fails}</span> of <span className="num">{entries.length}</span> checks did not pass
        </p>
      </Readout>
    </div>
  );
}
