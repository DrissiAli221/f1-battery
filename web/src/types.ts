export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface SessionRow {
  session_key: number;
  meeting_key: number;
  circuit_key: number | null;
  circuit_short_name: string | null;
  session_name: string;
  date_start: string | null;
  date_end: string | null;
  year: number | null;
  has_results: boolean;
}

export interface Driver {
  driver_number: number;
  name_acronym: string | null;
  full_name: string | null;
  team_name: string | null;
}

export interface Lap {
  driver_number: number;
  lap_number: number;
  date_start: string | null;
  lap_duration: number | null;
  green: boolean | null;
  reason: string | null;
}

export interface Straight {
  straight_id: number;
  label: string | null;
  start_pct: number;
  end_pct: number;
}

export interface OutlinePoint {
  d: number;
  x: number;
  y: number;
  z: number;
}

export interface Outline {
  session_key: number;
  driver_number: number;
  lap_number: number;
  points: OutlinePoint[];
}

export type RegimeLabel = "deploy" | "plateau" | "lift" | "brake";

export interface RegimeBin {
  bin: number;
  d_start_m: number;
  label: RegimeLabel;
}

export interface ResultRow {
  session_key: number;
  driver_number: number;
  lap_number: number;
  straight_id: number | null;
  variable: string;
  value: number | null;
  ci_low: number | null;
  ci_high: number | null;
}

export interface SummaryDriver extends Driver {
  straights: {
    straight_id: number;
    cutoff_distance_median_m: number | null;
    ci_low: number | null;
    ci_high: number | null;
  }[];
  regime_shares: Partial<Record<RegimeLabel, number>>;
}

export interface CompareDriver {
  driver_number: number;
  name_acronym: string | null;
  team_name: string | null;
  series: {
    lap_number: number;
    straight_id: number | null;
    cutoff_distance_m: number | null;
    ci_low: number | null;
    ci_high: number | null;
  }[];
}

export interface Compare {
  session_key: number;
  model_version: string | null;
  straight_id: number | null;
  drivers: CompareDriver[];
}
