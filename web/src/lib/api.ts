import { useEffect, useState } from "react";
import type { Page, StraightProfileResponse } from "./types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | undefined | null>;

export function url(path: string, params: Params = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const qs = q.toString();
  return `${BASE}/api${path}${qs ? `?${qs}` : ""}`;
}

/*
 * Responses are immutable per model run (docs/api-contract.md), so successful GETs are kept
 * for the lifetime of the page. This keeps navigation between pages and scrubbing back over
 * laps already seen from spending the per-IP rate limit. Failed requests are dropped so a
 * retry goes to the network.
 */
const cache = new Map<string, Promise<unknown>>();

async function fetchJson<T>(href: string): Promise<T> {
  const res = await fetch(href, { headers: { Accept: "application/json" } });
  if (res.status === 429) {
    const wait = res.headers.get("Retry-After");
    throw new ApiError(429, `Rate limited by the API. Try again in ${wait ?? "a few"} seconds.`);
  }
  if (!res.ok) throw new ApiError(res.status, `The API answered ${res.status} for ${new URL(href, window.location.origin).pathname}.`);
  return (await res.json()) as T;
}

export function getJson<T>(href: string): Promise<T> {
  let p = cache.get(href) as Promise<T> | undefined;
  if (!p) {
    p = fetchJson<T>(href);
    cache.set(href, p);
    p.catch(() => cache.delete(href));
  }
  return p;
}

/** Every item of a paginated list endpoint (page size 1000, the API maximum). */
export async function getAll<T>(path: string, params: Params = {}): Promise<T[]> {
  const first = await getJson<Page<T>>(url(path, { ...params, size: 1000, page: 0 }));
  const items = [...first.items];
  const pages = Math.ceil(first.total / 1000);
  for (let page = 1; page < pages; page++) {
    const next = await getJson<Page<T>>(url(path, { ...params, size: 1000, page }));
    items.push(...next.items);
  }
  return items;
}

export interface Remote<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

/**
 * Runs `load` whenever `key` changes (null skips it). With `keepPrevious` the last value stays
 * visible while the next one loads, so a panel does not flash empty on every lap change.
 */
export function useLoad<T>(key: string | null, load: () => Promise<T>, keepPrevious = false): Remote<T> {
  const [state, setState] = useState<Remote<T> & { key: string | null }>({
    key: null,
    data: null,
    error: null,
    loading: key !== null,
  });
  useEffect(() => {
    if (key === null) {
      setState({ key, data: null, error: null, loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ key, data: keepPrevious ? s.data : null, error: null, loading: true }));
    load()
      .then((data) => live && setState({ key, data, error: null, loading: false }))
      .catch((error: Error) => live && setState({ key, data: null, error, loading: false }));
    return () => {
      live = false;
    };
    // `load` is expected to be derived from `key`; keying on it alone avoids refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Between a key change and the effect, don't hand out the previous key's result as current.
  if (state.key !== key) return key === null ? { data: null, error: null, loading: false } : { data: keepPrevious ? state.data : null, error: null, loading: true };
  return state;
}

/** Fetches one JSON document; null skips the request. */
export function useRemote<T>(href: string | null, keepPrevious = false): Remote<T> {
  return useLoad<T>(href, () => getJson<T>(href as string), keepPrevious);
}

/** All items of a list endpoint; null skips the request. */
export function useList<T>(path: string | null, params: Params = {}): Remote<T[]> {
  const key = path === null ? null : url(path, params);
  return useLoad<T[]>(key, () => getAll<T>(path as string, params));
}

export const apiBase = BASE;

/** URL of one driver's cross-lap speed profile on one straight (D30). */
export function profileUrl(sessionKey: number, straightId: number, driver: number): string {
  return url(`/sessions/${sessionKey}/straights/${straightId}/profile`, { driver });
}

/** One driver's cross-lap speed profile on one straight; feed it to `toProfile` for the instrument. */
export function getProfile(sessionKey: number, straightId: number, driver: number): Promise<StraightProfileResponse> {
  return getJson<StraightProfileResponse>(profileUrl(sessionKey, straightId, driver));
}
