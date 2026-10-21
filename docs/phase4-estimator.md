# Phase 4: energy-management estimator (proxy mode, D10)

Code: `model/f1battery_model/estimate.py` (writer), `pipeline.py`, `derate.py`, `regimes.py`, `physics.py`.
Run: `cd model && PYTHONPATH=. ../.venv/bin/python -m f1battery_model.estimate --all [--run-id UUID]`
(or `--session KEY`). Method and Phase 3 numbers: `docs/phase3-regimes.md`.

## Run

Published run (2026-10-21, D33): `model_version = 'proxy-0.2'`, `run_id = 26862846-4455-495b-98c0-3cb1dff4fcb3`,
45 sessions, no failures; every row of the previous run is unchanged and straight 1 gains rows after a
non-green previous lap (counts on PR #10). The run below is the frozen findings run (docs/findings.md); it stays
in the table under `proxy-0.1`, unpublished.

`model_version = 'proxy-0.1'`, `run_id = 6f9df732-b7d1-42b5-b084-a2dc08f91662`. 45 sessions
written, Hungary race 11342 skipped (D17), no failures. **2,136,042 rows in 373 s**
(about 501 MB with indexes). The run was done twice: the first run (2,237,303 rows) was deleted and
replaced after the hinge rule below; the same run_id was reused. Unit-of-work is one session per
transaction; inserts are `INSERT ... SELECT FROM unnest(...) ON CONFLICT (unique index) DO UPDATE` in
batches of 5000, so re-running with the same `--run-id` rewrites the same rows (checked: re-running Singapore
left the count unchanged). Note an upsert never deletes: if the rules change so that a row is no longer
produced, delete that run's rows first.

## What is written

Distances: metres from the start/finish line of the lap the straight is attributed to; **negative before the
line** (only the straight across the line, id 1 at most circuits). Speeds kph. A straight with no usable
full-throttle run (>= 4 s, >= 2.5 s after guards) on a lap has no rows for that lap.

The straight across the line is placed by measuring back from the lap's own line crossing, so its first part
lies in the previous lap. It is analysed when that previous lap is consecutive and its closing samples are
usable (`pipeline.tail_usable`: resolved bounds, not neutralised, not an in-lap, no telemetry gap over
`MAX_GAP_S`, at least `MIN_SAMPLES` samples). The previous lap does not have to be green: out-laps, cool-down
laps, length outliers, `no_start` laps and a race's standing-start lap 1 all count. Until D33 it had to be
green, which left the main straight without rows or speed profile in every qualifying session (the lap
before a flying lap is the out-lap). `profile.py` applies the same rule. For a row whose window starts in a
non-green lap only `cutoff_detected`, `cutoff_distance_m`, `cutoff_speed_kph`, `plateau_accel_ms2` and
`entry_speed_kph` are written: the hinge model fits those runs badly, so `hinge_*` and `deploy_energy_rel`
stay unwritten, and the pooled CdA is fitted on the strict (previous lap green) rows only (D33). After an
out-lap the cut-off can sit earlier than after a flying lap (Baku Q 11373: −1,072 m against −577 m).

Per straight per lap (`lap_number` = lap, `straight_id`):
| variable | meaning |
|---|---|
| `cutoff_detected` | 1/0: the threshold-crossing estimator found a cut-off |
| `cutoff_distance_m`, `cutoff_speed_kph` | **primary**: first point at v > 250 kph where acceleration is below 0.5 m/s^2 for four 0.25 s steps, over the whole full-throttle run. This is the estimator that reproduced the spike (within 5.2 m, docs/phase3-regimes.md). It has no end guard (the 1.5 s guard variant detects only 20-80 % of Lesmo-Ascari laps), so on laps with an early lift it may include the lift leak |
| `plateau_accel_ms2` | mean acceleration from the crossing to the end of the guarded run (needs >= 1 s) |
| `entry_speed_kph` | speed 150 m into the full-throttle run |
| `deploy_energy_rel` | **J/kg (m^2/s^2)**: integral of (p - p_plateau) dt over the deploy phase (guarded run start to hinge ramp end, or to the guarded run end if no hinge ramp), p = specific excess power with the session CdA, p_plateau = the car's median fitted plateau level on that straight. Relative, not electrical energy |
| `hinge_detected` | **experimental**, 1/0 |
| `hinge_cutoff_distance_m`, `hinge_cutoff_speed_kph`, `hinge_rate_w_per_kg_s` | **experimental**, written only when `hinge_detected` = 1 |

Per lap (`straight_id` NULL): `regime_share_{deploy,plateau,lift,brake}` (share of the lap's 50 m bins; the rest is
"other"), `deploy_energy_rel_lap` (sum over the lap's straights, J/kg), `regime_bin_<n>` (n = 0 at the line, value
0 deploy, 1 plateau, 2 lift, 3 brake; bins labelled "other" have no row).

Per driver per session (`lap_number` 0, per straight): `cutoff_distance_median_m` (+ `ci_low/ci_high`, 1000-lap
bootstrap, 95 %), `cutoff_distance_std_m`, `cutoff_speed_median_kph`, `cutoff_detect_fraction` (threshold
estimator, detected / analysable laps; medians need >= 3 laps). Experimental: `ramp_detect_fraction` and
`hinge_cutoff_distance_median_m` (+ CI) for the hinge. Per session at `driver_number` 0, `lap_number` 0:
`session_cda_m2`, the session-wide CdA (m^2, at rho 1.2) used by the hinge and the energy (range 0.4-1.6;
values at the grid edge 0.4 or 1.6 are bounds, not estimates, and 16 of 45 sessions sit there).

## Why `hinge_*` is experimental

* Singapore straight 3: the hinge flags 27.5 % of laps (limit 10 %) although the spike and the primary
  estimator see no cut (primary `cutoff_detect_fraction` there averages 0.08, max 0.33 across cars); the flag
  is a threshold cut through a smooth plateau-acceleration distribution (docs/phase3-regimes.md).
* Investigation (docs/investigations/singapore-straight3.md, coordinator): on 62 % of Singapore straight-3 laps
  and 85 % of Monza T1->Roggia laps the fitted ramp start sat at the earliest index the fit allows, so it was not a
  measurement. **Rule applied here:** a hinge result counts only if the ramp start is interior (later than the
  search's earliest index) with at least 1 s of deploy level before it; otherwise `hinge_detected` = 0 and the other
  `hinge_*` values are NULL (no row). The primary variables and the 1.0 m/s^2 plateau limit are unchanged.
  `deploy_energy_rel`, `plateau_accel_ms2` and the CdA use the unfiltered hinge fit. After the rule 61 of 2847
  Singapore race straight-laps carry a valid hinge ramp.
* The hinge start also depends on CdA (40-150 m per m^2) and sits 280-500 m before the crossing.

## Spot checks (Result column filled in docs/spot-checks.md)

| # | Result |
|---|---|
| 1 Norris, Suzuka | fail: main-straight cut-off on laps 47-51 not >2 std earlier than his median (best -65 m = 1.9 std on lap 51); lap 48 energy 2.4 std low but with a later cut-off |
| 2 Hamilton/Verstappen, Canada | fail: Hamilton's lap 62 cut-off is earlier (-55 m), not later; Verstappen within noise |
| 3 Ferrari vs Mercedes, Monza | fail: straight 2 earlier as expected (Hamilton 1458 vs 1483/1474, CI overlaps Antonelli by 2 m); straight 4 opposite (3599 vs 3528/3530) |
| 4 Singapore no derating | already "pass (spike)"; unchanged. Pipeline: primary detect fraction 0 / 0.08 / 0.01 / 0 on straights 1/3/5/6 (means) |
| 5 Piastri, harvest limit | not testable: no harvest-under-throttle regime is stored |

Expected signs were not changed. Three of four testable checks fail; this is a plain result, not an artifact fix.
Caveats: single-car laps include tow and traffic (entry speed is stored for controlling); the cut-off in checks
1-2 is a distance with lap-to-lap std 15-60 m, so effects under ~2 std are not resolvable.

## Open decisions

1. Primary estimator has no end guard; a guarded variant is available but under-detects. Decide which is the
   Phase 5 variable (D18 says unguarded).
2. `session_cda_m2` hits the grid bounds in many sessions (not identifiable); the energy and hinge inherit that.
3. `deploy_energy_rel` is dominated by speed gain on the straight; whether it carries energy-management signal is untested.
4. Rate: `derate_rate_kw_per_s` is NULL for all events; hinge uses 100 kW/s (flagged `rate_default` in code only, not stored).
5. Spot checks 1-3 failing may reflect resolution limits rather than absence of the effect; HYPOTHESIS.md stays frozen.
6. Disk: model_result is 501 MB; free space on the host was 2-6 GB during the run.
