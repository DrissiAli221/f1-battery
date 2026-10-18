import log from "./content/method-log.json";

const REPO = "https://github.com/DrissiAli221/f1-battery/blob/main/";

type Entry = (typeof log.entries)[number] & {
  figure?: { src: string; alt: string; caption: string };
};

function Field({ name, children }: { name: string; children: string }) {
  return (
    <div className="ml-field">
      <h3>{name}</h3>
      <p>{children}</p>
    </div>
  );
}

function EntryCard({ e, n }: { e: Entry; n: number }) {
  return (
    <li className="ml-item">
      <article className="card ml-card" id={e.id}>
        <header className="ml-head">
          <span className="ml-num" aria-hidden="true">{n}</span>
          <h2>{e.title}</h2>
          <div className="ml-meta">
            <span className="pill">{e.phase}</span>
            <time dateTime={e.date} className="muted">{e.date}</time>
          </div>
        </header>
        <Field name="Tried">{e.tried}</Field>
        <Field name="Check">{e.check}</Field>
        <Field name="Found">{e.found}</Field>
        {e.figure && (
          <figure className="ml-figure">
            <img src={`${import.meta.env.BASE_URL}${e.figure.src}`} alt={e.figure.alt} loading="lazy" style={{ maxWidth: "100%", height: "auto" }} />
            <figcaption className="muted">{e.figure.caption}</figcaption>
          </figure>
        )}
        <Field name="Consequence">{e.consequence}</Field>
        <p className="ml-sources">
          Sources:{" "}
          {e.sources.map((s, i) => (
            <span key={s.path}>
              {i > 0 && ", "}
              <a href={REPO + s.path} target="_blank" rel="noreferrer">{s.label}</a>
            </span>
          ))}
        </p>
      </article>
    </li>
  );
}

export function MethodLog() {
  return (
    <>
      <p className="crumb"><a href="#/">Sessions</a></p>
      <h1>{log.title}</h1>
      <p className="lede">{log.intro}</p>
      <ol className="ml-timeline">
        {log.entries.map((e, i) => (
          <EntryCard key={e.id} e={e} n={i + 1} />
        ))}
      </ol>
    </>
  );
}
