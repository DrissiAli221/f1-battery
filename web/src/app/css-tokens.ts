/** Reads a length token (px) from :root once; falls back when the token is missing or not in px. */
export function cssPx(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  return raw.endsWith('px') && Number.isFinite(n) ? n : fallback;
}
