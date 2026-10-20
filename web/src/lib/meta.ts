import { useEffect, useLayoutEffect } from "react";
import type { Route } from "./router";

/*
 * Per-route document title and description (hash routing, D28: one HTML document, so the
 * head is set at runtime). The shell sets the route's default in a layout effect; a page that
 * knows more (the session's circuit, say) calls `useMeta` in a normal effect, which runs after
 * every layout effect and so wins.
 */

const SITE = "f1-battery";

export const ROUTE_META: Record<Route["name"], { title: string; description: string }> = {
  landing: {
    title: `${SITE}: does energy management predict being passed?`,
    description:
      "Where 2026 F1 cars stop deploying battery energy on each straight, read off public telemetry, and a pre-registered test of whether it predicts being passed.",
  },
  sessions: {
    title: `Sessions · ${SITE}`,
    description: "Every ingested 2026 F1 session by race weekend, with the median estimated cut-off on each main straight.",
  },
  session: {
    title: `Explorer · ${SITE}`,
    description: "One session, straight by straight: the speed trace, the estimated deployment cut-off per driver and per lap.",
  },
  findings: {
    title: `Findings · ${SITE}`,
    description:
      "The pre-registered test, frozen 18 Oct 2026: an earlier deployment cut-off did not predict being passed. Odds ratios, permutation test and limits.",
  },
  method: {
    title: `Method log · ${SITE}`,
    description: "Every check set before its result was seen, the ones that failed included, and how the cut-off estimator reads a speed trace.",
  },
  live: {
    title: `Live · ${SITE}`,
    description: "A session replayed on the circuit map with the running order and each car's estimated energy regime.",
  },
  "dev-map": { title: `Track map (dev) · ${SITE}`, description: "Map preview." },
  "dev-straight": { title: `The straight (fixture) · ${SITE}`, description: "Instrument preview." },
  missing: {
    title: `Not found · ${SITE}`,
    description: "No data beyond this point.",
  },
};

function setMeta(attr: "name" | "property", key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = value;
}

function apply(title: string, description: string) {
  document.title = title;
  setMeta("name", "description", description);
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
}

/** The shell: the route's default title and description. */
export function useRouteMeta(name: Route["name"]) {
  useLayoutEffect(() => {
    const m = ROUTE_META[name];
    apply(m.title, m.description);
  }, [name]);
}

/** A page's own title and description; omitted fields keep the route's default. */
export function useMeta(title?: string | null, description?: string | null) {
  useEffect(() => {
    if (!title && !description) return;
    apply(title || document.title, description || document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content || "");
  }, [title, description]);
}
