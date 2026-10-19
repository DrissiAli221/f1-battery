import { useEffect, useState } from "react";
import log from "../content/method-log.json";
import { Eyebrow, Reveal } from "../components/ui";
import { date } from "../lib/format";

const REPO = "https://github.com/DrissiAli221/f1-battery/blob/main/";

type Entry = (typeof log.entries)[number] & {
  figure?: { src: string; alt: string; caption: string };
};

function Field({ name, children }: { name: string; children: string }) {
  return (
    <div>
      <h3 className="label">{name}</h3>
      <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{children}</p>
    </div>
  );
}

/** Tracks which entry is in view, for the sticky index. */
function useActive(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids]);
  return active;
}

const ids = log.entries.map((e) => e.id);

export function MethodLogPage() {
  const active = useActive(ids);
  return (
    <>
      <section className="wrap pb-16 pt-16 md:pb-24 md:pt-24">
        <Eyebrow>Method log</Eyebrow>
        <h1 className="display mt-6 text-[48px] md:text-[88px]">{log.title}</h1>
        <p className="lede mt-8 max-w-[70ch]">{log.intro}</p>
      </section>
      <section className="wrap pb-32">
        <div className="grid gap-16 lg:grid-cols-12">
          <nav className="hidden lg:col-span-3 lg:block" aria-label="Entries">
            <ol className="sticky top-[calc(var(--header-h)+40px)] space-y-1 border-l border-line-2">
              {(log.entries as Entry[]).map((e, i) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => document.getElementById(e.id)?.scrollIntoView({ behavior: "smooth" })}
                    className={`-ml-px flex w-full gap-3 border-l-2 py-2 pl-4 text-left text-[14px] leading-snug transition-colors ${
                      active === e.id ? "border-brand text-ink-head" : "border-transparent text-ink-3 hover:text-ink"
                    }`}
                  >
                    <span className="num shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    {e.title}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <ol className="space-y-24 lg:col-span-9 lg:space-y-32">
            {(log.entries as Entry[]).map((e, i) => (
              <li key={e.id} id={e.id} className="scroll-mt-28">
                <Reveal>
                  <article>
                    <header className="border-t-2 border-line pt-8">
                      <div className="flex flex-wrap items-center gap-4">
                        <span className="num text-[15px] font-semibold text-brand">{String(i + 1).padStart(2, "0")}</span>
                        <span className="badge badge-muted">{e.phase}</span>
                        <time dateTime={e.date} className="num text-[14px] text-ink-3">
                          {date(`${e.date}T00:00:00Z`, "short")}
                        </time>
                      </div>
                      <h2 className="mt-6 max-w-[30ch] text-[28px] font-semibold leading-tight tracking-[-0.03em] text-ink-head md:text-[40px]">{e.title}</h2>
                    </header>
                    <div className="mt-12 grid gap-x-16 gap-y-10 md:grid-cols-2">
                      <Field name="Tried">{e.tried}</Field>
                      <Field name="Check">{e.check}</Field>
                      <Field name="Found">{e.found}</Field>
                      <Field name="Consequence">{e.consequence}</Field>
                    </div>
                    {e.figure && (
                      <figure className="mt-12 overflow-hidden rounded-xs bg-white p-4">
                        <img src={`${import.meta.env.BASE_URL}${e.figure.src}`} alt={e.figure.alt} loading="lazy" className="h-auto w-full" />
                        <figcaption className="mt-3 text-[13px] text-neutral-600">{e.figure.caption}</figcaption>
                      </figure>
                    )}
                    <p className="mt-10 text-[14px] text-ink-3">
                      Sources:{" "}
                      {e.sources.map((s, j) => (
                        <span key={s.path}>
                          {j > 0 && ", "}
                          <a className="prose-link" href={REPO + s.path} target="_blank" rel="noreferrer">
                            {s.label}
                          </a>
                        </span>
                      ))}
                    </p>
                  </article>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
