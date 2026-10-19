/** Formatting helpers. Numbers use en-US grouping so the view reads the same everywhere. */

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function int(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? "–" : intFmt.format(Math.round(v));
}

export function fixed(v: number | null | undefined, digits: number): string {
  return v === null || v === undefined || Number.isNaN(v)
    ? "–"
    : v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Signed metres, with a real minus sign. */
export function signed(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const r = Math.round(v);
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${intFmt.format(Math.abs(r))}`;
}

/** 85.162 -> "1:25.162". */
export function lapTime(s: number | null | undefined): string {
  if (s === null || s === undefined) return "–";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

export function date(iso: string | null | undefined, style: "long" | "short" = "long"): string {
  if (!iso) return "no date";
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: style === "long" ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function percent(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined ? "–" : `${(v * 100).toFixed(digits)} %`;
}

/** "lap_quality" reasons are snake_case identifiers; shown as words. */
export function reason(r: string | null | undefined): string {
  return r ? r.replace(/_/g, " ") : "excluded";
}
