/*
 * FIXTURE. Invented numbers, shaped like a Monza main-straight profile, for the dev preview
 * (#/dev/straight) and for judging the instrument before the profile endpoint serves real
 * data. It is not a result and is never shown in production: only the dev-server route
 * imports it. Real profiles come from `getProfile` (lib/api.ts) through `toProfile`.
 *
 * Shape: about 1,100 m in 22 bins of 50 m; out of Parabolica at about 85 kph, rising to about
 * 335 kph, flattening over bins 16 to 18; accelerations are central differences of the bin
 * speeds, rounded; cut-off median 830 m with a ±40 m interval.
 */
import type { Profile } from "./driver";

const V = [85, 120, 150, 176, 199, 219, 237, 253, 268, 281, 293, 304, 313, 321, 327, 331, 333, 334, 334, 335, 332, 298];
const A = [5.5, 5.9, 6.4, 6.6, 6.6, 6.4, 6.2, 6.0, 5.8, 5.4, 5.2, 4.7, 4.1, 3.5, 2.5, 1.5, 0.4, 0.3, 0.3, 0.1, -6.5, -16.5];

export const MONZA_MAIN_FIXTURE: Profile = {
  length_m: 1100,
  bin_m: 50,
  bins: V.map((v_kph, bin) => ({
    bin,
    d_start_m: bin * 50,
    v_kph,
    a_ms2: A[bin],
  })),
  cutoff_median_m: 830,
  ci_low_m: 790,
  ci_high_m: 870,
  regimes: [
    { d_start_m: 0, label: "deploy" },
    { d_start_m: 800, label: "plateau" },
    { d_start_m: 1000, label: "lift" },
    { d_start_m: 1050, label: "brake" },
  ],
};

export const MONZA_MAIN_FIXTURE_LABELS = {
  circuit: "Monza",
  straight: "main straight",
  driver: "NOR",
  laps: 52,
};
