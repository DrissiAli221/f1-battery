import type { Driver } from "./types";

/*
 * Team logos load at runtime from the Formula 1 media CDN (docs/design/brief.md, Imagery);
 * nothing is committed. The slug map is keyed by OpenF1 `team_name`, so a renamed team is a
 * one-line change. The files are 96 px square: use them at 16-48 px only.
 */
const LOGO_SLUG: Record<string, string> = {
  Alpine: "alpine",
  "Aston Martin": "astonmartin",
  Audi: "audi",
  Cadillac: "cadillac",
  Ferrari: "ferrari",
  "Haas F1 Team": "haasf1team",
  McLaren: "mclaren",
  Mercedes: "mercedes",
  "Racing Bulls": "racingbulls",
  "Red Bull Racing": "redbullracing",
  Williams: "williams",
};

export function teamLogo(team: string | null | undefined, variant: "" | "white" | "black" = "white"): string | null {
  const slug = team ? LOGO_SLUG[team] : undefined;
  return slug
    ? `https://media.formula1.com/image/upload/q_auto/v1740000001/common/f1/2026/${slug}/2026${slug}logo${variant}.webp`
    : null;
}

/** OpenF1 headshot at a given transform width; `2col-retina` (412 px) suits cards. */
export function headshot(url: string | null | undefined, size: "1col" | "2col" | "2col-retina" | "4col" = "2col-retina"): string | null {
  if (!url) return null;
  return url.replace(/\.transform\/[^/]+\//, `.transform/${size}/`);
}

const FALLBACK = "#6b6b76";

export function teamColour(d: Pick<Driver, "team_colour"> | null | undefined): string {
  return d?.team_colour ?? FALLBACK;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * The team colour darkened towards near-black until white text on it reaches 4.5:1, for
 * team-filled cards (PRNDL fills driver cards with the team colour).
 */
export function deepTeamColour(hex: string | null | undefined): string {
  const base = rgb(hex ?? FALLBACK);
  for (let t = 0; t < 0.9; t += 0.04) {
    const mixed = base.map((v) => Math.round(v * (1 - t) + 11 * t)) as [number, number, number];
    if (1.05 / (luminance(mixed) + 0.05) >= 4.5) return `rgb(${mixed.join(",")})`;
  }
  return "rgb(20,20,26)";
}

export function driverCode(d: Pick<Driver, "name_acronym" | "driver_number">): string {
  return d.name_acronym ?? `#${d.driver_number}`;
}

/** "Lando Norris" from first/last name, falling back to OpenF1's upper-case full name. */
export function driverName(d: Pick<Driver, "first_name" | "last_name" | "full_name" | "driver_number">): string {
  if (d.first_name && d.last_name) return `${d.first_name} ${d.last_name}`;
  if (d.full_name) return d.full_name.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase());
  return `Car ${d.driver_number}`;
}
