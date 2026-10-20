/*
 * 404 (DESIGN.md v3): one card, centred: the status code, one sentence, the way back.
 */
import { Card } from "../components/system";
import { Cta } from "../components/Cta";
import { href } from "../lib/router";
import { usePage } from "../motion";
import "../findings/findings.css";

export function NotFoundPage({ path }: { path: string }) {
  const root = usePage<HTMLElement>();
  return (
    <section ref={root} className="wrap nf" aria-labelledby="nf-h1">
      <Card className="nf__card">
        <div data-intro>
          <p className="nf__code" aria-hidden="true">
            404
          </p>
          <h1 id="nf-h1" className="nf__h1">
            No data beyond this point.
          </h1>
          <p className="nf__p">
            Nothing is recorded at <span className="fx-mono nf__path">{path}</span>.
          </p>
          <div className="nf__cta">
            <Cta href={href.landing}>Back to the start</Cta>
          </div>
        </div>
      </Card>
    </section>
  );
}
