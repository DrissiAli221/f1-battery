# Findings: does a defender's energy management predict being passed? (2026 season, proxy mode)

Status: Phase 5 result. Every number below is produced by
`model/f1battery_model/hypothesis_test.py` (commands at the end) from the
`proxy-0.1` run `6f9df732-b7d1-42b5-b084-a2dc08f91662`. All energy quantities
are **estimates under stated assumptions**, never measurements. Not affiliated
with F1, FIA or FOM.

## 1. Question

F1 does not publish 2026 battery or active-aero data. Drivers say that energy
state decides fights ("I literally had 5% of my battery coming out the last
corner. There was no point of trying to defend."). The pre-registered question
(HYPOTHESIS.md, frozen 2026-10-18): does a defender's energy management on the
lap before, and on the approach straight, predict being passed, after
controlling for pace difference, tyre age, lap number and Overtake availability?

## 2. Data

* OpenF1 free tier, 2026 season: `car_data` (speed, throttle, brake, rpm, gear at about 3.7 Hz,
  integer-valued), `location`, `laps`, `stints`, `pit`, `position`, `intervals`,
  `overtakes`, `race_control`. Cached locally in Postgres; raw data is never published.
* Hidden: battery state of charge, MGU-K power, deployment mode, active-aero
  state, per-event energy limits for races, and the true drag area.
* Sources for rules: FIA 2026 Section C regulations as summarised in
  `docs/regulations.md` (issue and article cited there).
* Excluded: Hungary race 11342 (lap and pit timestamps disagree with telemetry by 3-6 min, D17).
  Sakhir and Jeddah produce no events (no overtake, lap or telemetry rows).
* Event set: 830 clean on-track passes in Race and Sprint sessions; non-event
  set: 3,889 close-following pair-laps (HYPOTHESIS.md definitions; accounting in
  `docs/phase5-events.md`).

## 3. Method

**Alignment (Phase 2).** Telemetry and timing are put on one clock and each
lap's samples are turned into distance from the start/finish line by integrating
speed; laps whose integrated length disagrees with the median by more than 3 %,
neutralised laps, in/out laps and laps with data gaps are excluded
(`lap_quality`). Straights come from curated sections files or are derived
from the fastest green lap (`docs/phase2-alignment.md`).

**Estimator (Phase 3-4, proxy mode).** Speed is differentiated (Phase 3 compared
several methods on a synthetic straight with known truth) and each full-throttle
run is labelled into regimes per 50 m bin: deploy, plateau, lift, brake.
*Proxy mode* (D10) means no state of charge is estimated: the spike showed that
the taper and the engine curve are not identifiable from this data. What is
estimated instead is (i) the **primary cut-off distance**: the first point above
250 kph where acceleration stays below 0.5 m/s^2 for four 0.25 s steps, per
straight per lap, with per-car medians and 1,000-lap bootstrap intervals;
(ii) **relative deploy energy** (J/kg above the car's plateau level); (iii)
regime labels. Details and assumptions (838 kg start mass, 100 kW/s derate rate
flagged as unknown, session-wide drag area): `docs/phase3-regimes.md`,
`docs/phase4-estimator.md`, D18.

**The Phase S artifact and how it was caught.** The first spike pass reported
"super-clip" harvest segments. They were a smoothing artifact: none survived a
brake-onset guard (the 1.5 s guard before braking), which removed them (D10).
Later, the hinge-ramp detector failed its Singapore check (flagged 27.5 % of laps
on a circuit with no derating, limit 10 %). The investigation
(`docs/investigations/singapore-straight3.md`, D19) found the ramp start sat at the
earliest index the fit allows on 62 % of those laps and 85 % of Monza T1->Roggia
laps, so it was not a measurement. The hinge outputs are therefore experimental
and unused here; the threshold-crossing cut-off is the primary variable (D18).

## 4. The frozen test

Implemented literally from HYPOTHESIS.md. Logistic regression (statsmodels
`Logit`) of event on `cutoff_dev_defender`, `deploy_rel_diff`, `defender_lift`,
`pace_delta`, `tyre_age_diff`, `lap_number`, `overtake_available` and a session fixed
effect; continuous covariates standardised.

### 4.1 Joining the energy variables (implementation choices, where the frozen text leaves them open)

* Previous lap = lap - 1 of each car's own lap at the event time (the defender's lap is looked up from the lap table so a lapped car is not mis-indexed).
* `cutoff_dev_defender` = defender's `cutoff_distance_m` on the approach straight on its previous lap minus its lap-0 `cutoff_distance_median_m` for that straight and session. Band edges: the median is known only to its bootstrap CI, so the lower edge uses deviation = cut-off - ci_high and the upper edge deviation = cut-off - ci_low.
* `deploy_rel_diff` = defender minus attacker `deploy_energy_rel_lap` on their previous laps.
* `defender_lift` = 1 when the defender's previous-lap regime bins hold a run of at least 4 consecutive 50 m bins labelled lift (value 2) inside the approach-straight window (bin counted if its centre is inside; a run on a straight across the line is not joined over the line). 4 bins is 200 m, about 2.4 s at 300 kph, an approximation of the frozen "at least 1 s below full throttle outside the brake guard". The lift label already excludes braking and includes the 1 s re-application burst.
* Rows with a missing variable are dropped. Reasons are counted by first hit in the order listed and, separately, by any hit (a row can miss several).
* Two sessions (Monte Carlo 11299 and the Singapore sprint 11383) have only non-events after dropping; their session coefficient is not finite (perfect separation) and they carry no information on the other coefficients, so they are removed from the fit. Counts are shown.

| reason | event | first_hit | any_hit |
|---|---|---|---|
| no_approach_straight | 1 | 0 | 0 |
| no_approach_straight | 0 | 0 | 0 |
| defender_lap_unknown | 1 | 0 | 0 |
| defender_lap_unknown | 0 | 0 | 0 |
| defender_no_cutoff_prev_lap | 1 | 445 | 445 |
| defender_no_cutoff_prev_lap | 0 | 2515 | 2515 |
| defender_no_median | 1 | 1 | 217 |
| defender_no_median | 0 | 8 | 1696 |
| no_deploy_energy | 1 | 17 | 169 |
| no_deploy_energy | 0 | 36 | 600 |
| no_regime_bins | 1 | 0 | 122 |
| no_regime_bins | 0 | 0 | 419 |
| no_pace_delta | 1 | 0 | 92 |
| no_pace_delta | 0 | 0 | 291 |
| no_tyre_age | 1 | 3 | 16 |
| no_tyre_age | 0 | 3 | 48 |

**Sample.** The dominant reason is that the defender has no detected cut-off on
the approach straight on its previous lap (the primary estimator finds a cut-off
only where there is one: short straights and derating-free circuits such as
Singapore give none). This is a selection: the test applies to events whose
approach straight carries a detectable cut-off.

| events_before | non_events_before | events_complete | non_events_complete | single_class_sessions_removed | events_after | non_events_after | sessions_in_model | bfgs_fallbacks |
|---|---|---|---|---|---|---|---|---|
| 830 | 3889 | 364 | 1327 | [11299, 11383] | 364 | 1324 | 19 | 4 |

Minimum sample (150 events, 300 non-events) is met: 364 events and 1,324 non-events in 19 sessions.
Four fits (of all fits in the run, including permutations) used the BFGS fallback because Newton did not converge.

### 4.2 Three runs: odds ratios per 1 SD (binary terms: 1 vs 0), 95 % intervals

Point estimates:

| term | unit | OR | 95 % CI | p |
|---|---|---|---|---|
| cutoff_dev_defender | per 1 SD | 1.090 | [0.959, 1.239] | 0.186 |
| deploy_rel_diff | per 1 SD | 1.067 | [0.929, 1.224] | 0.359 |
| defender_lift | binary (1 vs 0) | 1.422 | [0.597, 3.387] | 0.426 |
| pace_delta | per 1 SD | 0.633 | [0.550, 0.729] | 1.78e-10 |
| tyre_age_diff | per 1 SD | 0.853 | [0.743, 0.979] | 0.0233 |
| lap_number | per 1 SD | 0.829 | [0.717, 0.959] | 0.0116 |
| overtake_available | binary (1 vs 0) | 1.723 | [1.223, 2.428] | 0.00186 |

Lower band edge (deviation = cut-off - ci_high):

| term | unit | OR | 95 % CI | p |
|---|---|---|---|---|
| cutoff_dev_defender | per 1 SD | 1.171 | [1.010, 1.359] | 0.0366 |
| deploy_rel_diff | per 1 SD | 1.056 | [0.919, 1.213] | 0.441 |
| defender_lift | binary (1 vs 0) | 1.557 | [0.664, 3.648] | 0.309 |
| pace_delta | per 1 SD | 0.633 | [0.550, 0.728] | 1.85e-10 |
| tyre_age_diff | per 1 SD | 0.851 | [0.741, 0.976] | 0.0214 |
| lap_number | per 1 SD | 0.829 | [0.717, 0.959] | 0.0116 |
| overtake_available | binary (1 vs 0) | 1.733 | [1.229, 2.442] | 0.00169 |

Upper band edge (deviation = cut-off - ci_low):

| term | unit | OR | 95 % CI | p |
|---|---|---|---|---|
| cutoff_dev_defender | per 1 SD | 1.066 | [0.939, 1.210] | 0.324 |
| deploy_rel_diff | per 1 SD | 1.072 | [0.934, 1.230] | 0.324 |
| defender_lift | binary (1 vs 0) | 1.473 | [0.622, 3.487] | 0.378 |
| pace_delta | per 1 SD | 0.634 | [0.551, 0.729] | 1.84e-10 |
| tyre_age_diff | per 1 SD | 0.853 | [0.744, 0.979] | 0.0236 |
| lap_number | per 1 SD | 0.830 | [0.717, 0.960] | 0.0119 |
| overtake_available | binary (1 vs 0) | 1.723 | [1.223, 2.427] | 0.00187 |

The frozen direction is "earlier cut-off (negative deviation) -> more likely passed", so the quantity tested is the inverse of the deviation OR (OR per 1 SD earlier cut-off):

| run | or | lo | hi |
|---|---|---|---|
| point | 0.917 | 0.807 | 1.043 |
| lower_edge | 0.854 | 0.736 | 0.990 |
| upper_edge | 0.938 | 0.826 | 1.065 |

An earlier cut-off is associated with a slightly *lower* odds of being passed in all three runs (OR below 1); the point and upper-edge intervals include 1, the lower-edge interval barely excludes 1 in the opposite direction. SD of the deviation is about 121 m with heavy tails (min -1,362 m, max 826 m).

### 4.3 Permutation control

The three main variables were permuted jointly across rows within each session (1,000 permutations, seed 20261018) and the model refitted.

```
{
  "observed": 0.08636856980442617,
  "n_perm": 1000,
  "failed_fits": 0,
  "pct_abs": 79.2,
  "pct_one_sided": 10.5,
  "perm_p_two_sided": 0.208,
  "perm_mean": -2.8670355140607563e-05,
  "perm_sd": 0.07049366923967057,
  "perm_abs_q95": 0.1377194757525153
}
```

The observed coefficient (+0.086 log-odds per SD, wrong sign for the hypothesis) is more extreme than 79.2 % of permuted coefficients in absolute value (two-sided permutation p = 0.208); the frozen requirement was more than 95 %. The control fails.

*Correction (2026-10-19): this sentence first said "less extreme than"; the script ranks the observed coefficient as more extreme than 79.2 % of permutations (p = 0.208). The numbers and the verdict are unchanged.*

![permutation](../model/out/findings/permutation.png)

### 4.4 Verdict, in the frozen vocabulary

Minimum sample: met. Smallest effect (OR >= 1.3 per SD earlier cut-off, 95 % interval excluding 1, in all three runs, permutation passed): not met in any of the three runs; the permutation control also fails.

**Verdict: no effect.** On this data the defender's primary cut-off deviation on the approach straight does not predict being passed once pace and Overtake availability are controlled. Pace delta dominates (OR 0.63 per SD, p < 1e-9; attacker faster, more passes); Overtake availability has OR 1.72 [1.22, 2.43]. The energy terms are not significant. This matches the expectation recorded in HYPOTHESIS.md. "No effect" here means no effect detectable with this estimator and sample, not proof of absence (see limits).

## 5. Spot checks, reported as-is (docs/spot-checks.md, frozen)

Three fail, one passes, one is not testable. Expected signs were not changed.

| # | Moment | Result |
|---|---|---|
| 1 | Norris, Suzuka, laps 47-51 | **fail**: main-straight cut-off not far earlier than his median (+51, +63, -41, -10, -65 m; lap 51 is 1.9 std, below the 2 std bar); lap 48 energy 2.4 std low but with a later cut-off |
| 2 | Hamilton vs Verstappen, Canada lap 62 | **fail**: Hamilton's cut-off on lap 62 is earlier (-55 m), not later; Verstappen within noise |
| 3 | Ferrari earlier than Mercedes at Monza | **fail**: straight 2 matches in direction but intervals overlap Antonelli's by 2 m; straight 4 opposite; Leclerc retired early |
| 4 | Singapore has no derating | **pass** (spike, 2026-10-17) |
| 5 | Piastri, harvest limit at Monza vs Baku | **not testable**: proxy-0.1 stores no harvest-under-throttle regime |

**Post-hoc, not pre-registered:** one possible reading of the three failures is a resolution floor. The cut-off is a distance with a lap-to-lap standard deviation of 15-60 m, so effects under about 2 std (the bar used in checks 1-2) are not resolvable, and 3.7 Hz integer speed limits the estimator further. This is an explanation offered after seeing the results; it was not tested and does not change the recorded outcomes.

## 6. Sensitivities (NOT pre-registered)

These were chosen after the frozen result and do not change the verdict.

**(a) Without `deploy_rel_diff`.** `deploy_energy_rel` inherits the session drag-area fit, which sits at a grid bound (0.4 or 1.6 m^2) in 16 of 45 sessions (13 at 0.4, 3 at 1.6), so it is not identifiable there.

| term | unit | OR | 95 % CI | p |
|---|---|---|---|---|
| cutoff_dev_defender | per 1 SD | 1.094 | [0.962, 1.243] | 0.171 |
| defender_lift | binary (1 vs 0) | 1.375 | [0.577, 3.279] | 0.472 |
| pace_delta | per 1 SD | 0.634 | [0.550, 0.729] | 1.91e-10 |
| tyre_age_diff | per 1 SD | 0.853 | [0.744, 0.979] | 0.0238 |
| lap_number | per 1 SD | 0.825 | [0.713, 0.954] | 0.00929 |
| overtake_available | binary (1 vs 0) | 1.702 | [1.209, 2.394] | 0.00228 |

CdA-affected counts (sessions with the fit at a grid bound):

```
{
  "cda_edge_sessions_total": 16,
  "cda_edge_sessions_with_events": [
    11240,
    11245,
    11286,
    11291,
    11299,
    11348,
    11353,
    11369,
    11383
  ],
  "cda_edge_sessions_in_event_set": [
    11240,
    11245,
    11286,
    11291,
    11348,
    11353,
    11369
  ],
  "cda_edge_counts_before_dropping": {
    "events": 203,
    "non_events": 1484,
    "events_all": 830,
    "non_events_all": 3889
  },
  "cda_edge_counts": {
    "events": 66,
    "non_events": 364,
    "events_all": 364,
    "non_events_all": 1324
  },
  "lr_energy_vs_controls": {
    "stat": 3.69405902302492,
    "df": 3,
    "p": 0.29645165264500056,
    "llf_full": -773.7249934942198,
    "llf_restricted": -775.5720230057323
  },
  "lr_energy_vs_pace_only": {
    "stat": 25.257625521187265,
    "df": 6,
    "p": 0.0003059103816992895,
    "llf_full": -773.7249934942198,
    "llf_restricted": -786.3538062548134
  }
}
```

Before dropping, 203 of 830 events and 1,484 of 3,889 non-events are in the 16 edge sessions; in the analysis frame 66 of 364 events and 364 of 1,324 non-events (7 sessions) are. Excluding those sessions entirely, with all terms:

| term | unit | OR | 95 % CI | p |
|---|---|---|---|---|
| cutoff_dev_defender | per 1 SD | 1.083 | [0.934, 1.254] | 0.291 |
| deploy_rel_diff | per 1 SD | 1.103 | [0.940, 1.294] | 0.229 |
| defender_lift | binary (1 vs 0) | 2.141 | [0.771, 5.946] | 0.144 |
| pace_delta | per 1 SD | 0.641 | [0.548, 0.749] | 2.5e-08 |
| tyre_age_diff | per 1 SD | 0.873 | [0.752, 1.014] | 0.0762 |
| lap_number | per 1 SD | 0.866 | [0.737, 1.017] | 0.0797 |
| overtake_available | binary (1 vs 0) | 2.248 | [1.526, 3.312] | 4.14e-05 |

**(b) Races only (no sprints).**

| term | unit | OR | 95 % CI | p |
|---|---|---|---|---|
| cutoff_dev_defender | per 1 SD | 1.089 | [0.948, 1.251] | 0.226 |
| deploy_rel_diff | per 1 SD | 1.056 | [0.910, 1.226] | 0.475 |
| defender_lift | binary (1 vs 0) | 1.596 | [0.657, 3.873] | 0.302 |
| pace_delta | per 1 SD | 0.637 | [0.547, 0.740] | 4.67e-09 |
| tyre_age_diff | per 1 SD | 0.829 | [0.715, 0.962] | 0.0133 |
| lap_number | per 1 SD | 0.845 | [0.730, 0.979] | 0.025 |
| overtake_available | binary (1 vs 0) | 1.617 | [1.130, 2.315] | 0.00859 |

**(c) How much do the energy terms add?** Likelihood-ratio tests: full model against the model with only controls (3 df, `lr_energy_vs_controls` above: chi2 3.69, p = 0.296), and against a pace-delta-only model with the session effect (6 df, chi2 25.26, p = 0.0003, which mostly reflects the other controls). Beyond the controls the energy terms add nothing detectable.

Pace-delta-only model:

| term | unit | OR | 95 % CI | p |
|---|---|---|---|---|
| pace_delta | per 1 SD | 0.616 | [0.540, 0.704] | 7.81e-13 |

Controls-only model:

| term | unit | OR | 95 % CI | p |
|---|---|---|---|---|
| pace_delta | per 1 SD | 0.634 | [0.551, 0.730] | 1.95e-10 |
| tyre_age_diff | per 1 SD | 0.851 | [0.742, 0.976] | 0.0215 |
| lap_number | per 1 SD | 0.820 | [0.710, 0.948] | 0.00735 |
| overtake_available | binary (1 vs 0) | 1.703 | [1.211, 2.396] | 0.00222 |

None of the sensitivities moves the cut-off term to the pre-registered threshold.

## 7. Power-unit maker comparison

Maker mapping (team_name -> maker): Mercedes: Mercedes, McLaren, Williams, Alpine; Ferrari: Ferrari, Haas, Cadillac; Honda: Aston Martin; Audi: Audi; Red Bull Ford: Red Bull Racing, Racing Bulls. For each session and straight, the median primary cut-off distance over all green laps of the maker's cars, with a 95 % bootstrap interval (1,000 resamples of laps, pooled over cars). The interval describes lap scatter only; laps of a car are correlated and some makers have only 2 cars, so car-to-car variation is not covered (`n_cars` is listed). Full table for all 45 sessions: `model/out/findings/maker_by_session.csv`.

Figures: `model/out/findings/maker_monza_11361.png`, `model/out/findings/maker_baku_11377.png`.

![monza](../model/out/findings/maker_monza_11361.png)
![baku](../model/out/findings/maker_baku_11377.png)

Monza race (11361), median cut-off distance in metres from the start/finish line (straight 1 crosses the line):

| straight_id | label | maker | median_m | ci_low | ci_high | n_laps | n_cars |
|---|---|---|---|---|---|---|---|
| 1 | Straight | Audi | 36 | 10 | 88 | 85 | 2 |
| 1 | Straight | Ferrari | 49 | 41 | 60 | 210 | 5 |
| 1 | Straight | Honda | -14 | -66 | 18 | 23 | 2 |
| 1 | Straight | Mercedes | 45 | 37 | 59 | 302 | 8 |
| 1 | Straight | Red Bull Ford | 28 | 20 | 33 | 168 | 4 |
| 2 | Straight | Audi | 1429 | 1419 | 1436 | 93 | 2 |
| 2 | Straight | Ferrari | 1414 | 1411 | 1418 | 226 | 5 |
| 2 | Straight | Honda | 1396 | 1391 | 1403 | 39 | 2 |
| 2 | Straight | Mercedes | 1477 | 1473 | 1479 | 342 | 8 |
| 2 | Straight | Red Bull Ford | 1428 | 1426 | 1430 | 184 | 4 |
| 3 | Straight | Mercedes | 1461 | 1455 | 1481 | 15 | 3 |
| 4 | Straight | Audi | 3560 | 3545 | 3572 | 89 | 2 |
| 4 | Straight | Ferrari | 3537 | 3518 | 3552 | 222 | 5 |
| 4 | Straight | Honda | 3549 | 3542 | 3567 | 38 | 2 |
| 4 | Straight | Mercedes | 3588 | 3573 | 3600 | 315 | 8 |
| 4 | Straight | Red Bull Ford | 3561 | 3556 | 3566 | 172 | 4 |
| 5 | Straight | Audi | 4769 | 4700 | 4790 | 87 | 2 |
| 5 | Straight | Ferrari | 4739 | 4706 | 4779 | 200 | 5 |
| 5 | Straight | Honda | 4501 | 4486 | 4563 | 23 | 2 |
| 5 | Straight | Mercedes | 4817 | 4808 | 4828 | 309 | 8 |
| 5 | Straight | Red Bull Ford | 4688 | 4648 | 4711 | 166 | 4 |

Baku race (11377):

| straight_id | label | maker | median_m | ci_low | ci_high | n_laps | n_cars |
|---|---|---|---|---|---|---|---|
| 1 | Straight | Audi | -1391 | -1403 | -1373 | 77 | 2 |
| 1 | Straight | Ferrari | -857 | -866 | -843 | 227 | 6 |
| 1 | Straight | Honda | -1330 | -1353 | -1318 | 20 | 2 |
| 1 | Straight | Mercedes | -1313 | -1332 | -967 | 259 | 8 |
| 1 | Straight | Red Bull Ford | -867 | -884 | -835 | 158 | 4 |
| 2 | Straight | Audi | 1201 | 1164 | 1216 | 18 | 2 |
| 2 | Straight | Ferrari | 1206 | 1199 | 1215 | 76 | 6 |
| 2 | Straight | Honda | 1066 | 1044 | 1195 | 10 | 2 |
| 2 | Straight | Mercedes | 1196 | 1188 | 1208 | 96 | 7 |
| 2 | Straight | Red Bull Ford | 1191 | 1183 | 1198 | 39 | 4 |
| 3 | Straight | Audi | 3248 | 3239 | 3260 | 78 | 2 |
| 3 | Straight | Ferrari | 3268 | 3259 | 3278 | 189 | 6 |
| 3 | Straight | Honda | 3247 | 3239 | 3256 | 23 | 2 |
| 3 | Straight | Mercedes | 3253 | 3250 | 3256 | 258 | 8 |
| 3 | Straight | Red Bull Ford | 3263 | 3260 | 3269 | 166 | 4 |

At Monza the Mercedes-powered cars' median cut-off is the latest on straights 2, 4 and 5 and Ferrari-powered cars cut earlier on straights 2 and 4, with non-overlapping lap-bootstrap intervals; Honda (Aston Martin, 2 cars, 23-39 laps) is earliest on straights 2 and 5. This is in the direction named by spot check 3 on straight 2 but opposite on straight 4 at the maker level (pooling the Ferrari-powered Haas and Cadillac with Ferrari; the frozen check was on named drivers and is reported as a fail above). At Baku, straight 1 shows two clusters (Ferrari and Red Bull Ford about -860 m, Mercedes, Audi and Honda about -1,300 m before the line); the Mercedes interval there is wide ([-1,335, -968]), which suggests a mixed distribution and warrants caution; no reading of why is offered.

Season table (race sessions; cells = (session, straight) with at least 3 makers present; offset = maker median minus the mean of the makers' medians in that cell; `share_earliest` = share of cells where the maker's median is the earliest):

| maker | cells | mean_offset_m | sd_offset_m | share_earliest |
|---|---|---|---|---|
| Mercedes | 44 | 6.37 | 35.99 | 0.05 |
| Ferrari | 46 | 8.26 | 49.25 | 0.15 |
| Honda | 43 | -24.55 | 58.89 | 0.65 |
| Audi | 42 | -2.78 | 53.20 | 0.17 |
| Red Bull Ford | 44 | 11.63 | 45.04 | 0.05 |

Honda (2 cars) cuts earliest in most cells; the other four makers are within about 15 m of each other on average, much less than the spread across cells (sd 36-59 m). The cut-off position depends on the car's own drag and mass assumptions that cannot be separated here (limits below), so a maker difference in this proxy is not a difference in energy capacity.

## 8. Limits

* **No ground truth.** No public battery data exists; spot checks are the only external anchors, and three of four testable ones failed.
* **Drag area not identifiable** from full-throttle data; a session-wide value is used and sits at a grid bound in 16 of 45 sessions. `deploy_energy_rel` inherits this (about 50 m systematic on the hinge start, sensitivity (a)).
* **Hungary excluded** (D17); Sakhir and Jeddah have no data; Shanghai and Suzuka lose 94-121 laps each to the lap-length rule.
* **Hinge detector is experimental.** It failed its Singapore check, and its ramp start is pinned at the fit boundary on most laps at Monza T1->Roggia and Singapore (D19); it is not used in the test.
* **Per-event energy limits for races are not public** (qualifying forecasts only); the 100 kW/s derate rate is an assumption flagged as unknown.
* **3.7 Hz integer data**: speed is integer kph, so acceleration over 0.25 s is quantised; cut-off distances carry tens of metres of lap-to-lap scatter.
* **Selection**: only events whose approach straight has a detected defender cut-off on the previous lap (364 of 830 events) enter the test. The primary estimator has no end guard and may include a lift leak.
* **Position of events** is taken from the attacker's aligned `car_data`; a pass logged just before the braking point maps to the previous straight.
* **Heavy-tailed deviations** (min -1,362 m, max 826 m) make the SD-standardised OR sensitive to a few laps; the frozen standardisation was kept.
* Hypothesis-relevant caveat: lap-level proxies may be too coarse to detect an effect that acts within a single straight.

## 9. Prior art and what this adds

* Energymind (rahul2006malik/Energymind on GitHub) is a physics-informed hidden Markov model per race for all drivers, with an attacker/defender "counter-harvest" game; per race, not validated against an observable outcome (DECISIONS.md D1, D7). Similar small per-race tools (Markov-switching regimes at Spa qualifying, a Modena thesis on MGU-K reconstruction from GPS) are listed there.
* arXiv 2603.01290 models a rival's ERS with an explicit derate state on simulated data and defines the cut-off as the distance where speed starts falling from the sector maximum; it does not use real telemetry.
* The Overcut (substack) is a single rule-based regime analysis (deploy / brake harvest / lift-and-coast / super-clip / idle) on testing data with a constant 250 kW assumption (`docs/research-2026-10-17.md`); no code, no overtake test. Media accounts describe derating in words (speeds peak in the first half of a straight, then plateau or fall) without per-car distances.
* Driver quotes (from the discourse note, The Race and pitdebrief, 2026): Norris: "It's just my battery deploys, I don't want it to deploy, but I can't control it." Norris: "I literally had 5% of my battery coming out the last corner. There was no point of trying to defend." Alonso: "You just press one button and you overtake if you have a better power unit than the car in front." Ocon: "Boost usage has been a nightmare, if you use it, you actually go backwards." Domenicali (Autosport, 31 Jul 2026): "No one is interested in how you drive your car."

What this adds: a season-wide (45 sessions) derating cut-off per car per straight with bootstrap intervals, a pre-registered test against 830 real passes and 3,889 close-following non-events, a permutation control, spot checks reported including failures, and a plain null result. It does not show that energy management is irrelevant; it shows that this proxy, at this resolution, does not predict passes beyond pace and Overtake availability.

## 10. Reproducibility

```
# one-time: statsmodels is required (installed into .venv for this phase)
.venv/bin/pip install statsmodels
cd model
# events (regenerate if missing)
../.venv/bin/python -m f1battery_model.events --all
# Phase 4 run (already in the database as proxy-0.1, run_id 6f9df732-b7d1-42b5-b084-a2dc08f91662)
PYTHONPATH=. ../.venv/bin/python -m f1battery_model.estimate --all --run-id 6f9df732-b7d1-42b5-b084-a2dc08f91662
# Phase 5: test, permutation, sensitivities, maker comparison, figures, tables
PYTHONPATH=. ../.venv/bin/python -m f1battery_model.hypothesis_test
# tests
PYTHONPATH=. ../.venv/bin/python -m pytest tests/test_hypothesis_test.py
```

Outputs in `model/out/findings/`: `tables.md` (every table above), `results.json`, `drops.csv`, `analysis_frame.csv`, `model_*.csv`, `sens_*.csv`, `maker_by_session.csv`, `maker_season.csv`, figures. Seeds: 20261018 (permutation and maker bootstrap). Database: postgres localhost:55432, db f1battery.
