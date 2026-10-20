import { useCallback, useEffect, useState } from "react";

/*
 * Hash routing, kept on purpose: the view is a static bundle that can sit on any bucket or
 * CDN without rewrite rules, and the routes are few. Query parameters after the path carry
 * shareable explorer state, e.g. "#/session/11361?driver=1&compare=63&straight=2&lap=40".
 *
 *   #/                 landing
 *   #/sessions         sessions index
 *   #/session/<key>    session explorer
 *   #/findings         findings
 *   #/method           method log
 *   #/live             live replay index
 *   #/live/<key>       live replay for one session
 *   #/dev/straight     instrument preview on a fixture (dev server only, temporary)
 */

export type Route =
  | { name: "landing" }
  | { name: "sessions" }
  | { name: "session"; key: number }
  | { name: "findings" }
  | { name: "method" }
  | { name: "live"; key: number | null }
  | { name: "dev-straight" }
  | { name: "missing"; path: string };

export interface Location {
  route: Route;
  path: string;
  query: URLSearchParams;
}

function parse(hash: string): Location {
  const raw = hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  const query = new URLSearchParams(qs);
  let m: RegExpExecArray | null;
  let route: Route;
  if (path === "/" || path === "") route = { name: "landing" };
  else if (path === "/sessions") route = { name: "sessions" };
  else if ((m = /^\/session\/(\d+)\/?$/.exec(path))) route = { name: "session", key: Number(m[1]) };
  else if (path === "/findings") route = { name: "findings" };
  else if (path === "/method") route = { name: "method" };
  else if (path === "/live") route = { name: "live", key: null };
  else if ((m = /^\/live\/(\d+)\/?$/.exec(path))) route = { name: "live", key: Number(m[1]) };
  else if (path === "/dev/straight" && import.meta.env.DEV) route = { name: "dev-straight" };
  else route = { name: "missing", path };
  return { route, path, query };
}

export function useLocation(): Location {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parse(hash);
}

/**
 * Explorer state in the query string. Updates use replaceState so scrubbing laps does not
 * flood the history, and do not fire hashchange (the caller already holds the state).
 */
export function useQueryState(): [URLSearchParams, (patch: Record<string, string | number | null>) => void] {
  const [query, setQuery] = useState(() => parse(window.location.hash).query);
  useEffect(() => {
    const on = () => setQuery(parse(window.location.hash).query);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const update = useCallback((patch: Record<string, string | number | null>) => {
    const { path, query: current } = parse(window.location.hash);
    const next = new URLSearchParams(current);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    const qs = next.toString();
    window.history.replaceState(null, "", `#${path}${qs ? `?${qs}` : ""}`);
    setQuery(next);
  }, []);
  return [query, update];
}

export const href = {
  landing: "#/",
  sessions: (type?: string) => (type ? `#/sessions?type=${encodeURIComponent(type)}` : "#/sessions"),
  session: (key: number, q?: Record<string, string | number>) =>
    `#/session/${key}${q ? `?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString()}` : ""}`,
  findings: "#/findings",
  method: "#/method",
  live: (key?: number) => (key ? `#/live/${key}` : "#/live"),
};
