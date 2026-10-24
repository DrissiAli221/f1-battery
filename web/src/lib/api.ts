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

/*
 * The API rate-limits per client address (60 requests a minute, refilled one token a second)
 * and a page load is around nine requests, so a burst of reloads empties the bucket. A 429 is
 * not a failure: the API's Retry-After names the time to the next token, so limited requests
 * queue through one shared slot, one per Retry-After, and go again. The skeleton stays up
 * meanwhile. Only after a long run of refusals does the error reach the page.
 */
const RETRY_BUDGET_MS = 45000;
const RETRY_CAP_MS = 8000;
let nextSlot = 0;
/** True while limited requests are queued; pages show a note next to their loading line. */
let limitedUntil = 0;
const limitListeners = new Set<() => void>();
function markLimited(ms: number) {
  limitedUntil = Date.now() + ms;
  limitListeners.forEach((l) => l());
  setTimeout(() => limitListeners.forEach((l) => l()), ms + 50);
}
/** Whether the client is currently waiting on the API's rate limit. */
export function useRateLimited(): boolean {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    limitListeners.add(l);
    return () => {
      limitListeners.delete(l);
    };
  }, []);
  return Date.now() < limitedUntil;
}

function queueSlot(afterMs: number): number {
  const now = Date.now();
  nextSlot = Math.max(now, nextSlot) + afterMs;
  return nextSlot - now;
}

async function fetchJson<T>(href: string, started = Date.now()): Promise<T> {
  const res = await fetch(href, { headers: { Accept: "application/json" } });
  if (res.status === 429) {
    const header = res.headers.get("Retry-After");
    const seconds = Number(header);
    const after = Math.min(RETRY_CAP_MS, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1500);
    if (Date.now() - started < RETRY_BUDGET_MS) {
      const wait = queueSlot(after) + Math.random() * 150;
      markLimited(wait);
      await new Promise((r) => setTimeout(r, wait));
      return fetchJson<T>(href, started);
    }
    throw new ApiError(429, `Rate limited by the API. Try again in ${header ?? "a few"} seconds.`);
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
