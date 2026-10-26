export type Page = 'home' | 'session' | 'findings' | 'method' | 'replay';

/** Clean page path (no .html) plus an optional query string. The host maps each path to its HTML file. */
export function pageUrl(page: Page, params?: Record<string, string | number | undefined>): string {
  const path = page === 'home' ? '/' : `/${page}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
