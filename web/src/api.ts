import { useEffect, useState } from "react";

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

export async function getJson<T>(href: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(href, { signal, headers: { Accept: "application/json" } });
  if (res.status === 429) {
    const wait = res.headers.get("Retry-After");
    throw new ApiError(429, `Rate limited by the API. Try again in ${wait ?? "a few"} seconds.`);
  }
  if (!res.ok) throw new ApiError(res.status, `The API answered ${res.status} for ${new URL(href).pathname}.`);
  return (await res.json()) as T;
}

export interface Remote<T> {
  data: T | null;
  error: ApiError | Error | null;
  loading: boolean;
}

/** Fetches `href` (null skips the request) and refetches when it changes. */
export function useRemote<T>(href: string | null): Remote<T> {
  const [state, setState] = useState<Remote<T>>({ data: null, error: null, loading: href !== null });
  useEffect(() => {
    if (href === null) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const ctl = new AbortController();
    setState((s) => ({ data: s.data, error: null, loading: true }));
    getJson<T>(href, ctl.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error: Error) => {
        if (error.name !== "AbortError") setState({ data: null, error, loading: false });
      });
    return () => ctl.abort();
  }, [href]);
  return state;
}

export const apiBase = BASE;
