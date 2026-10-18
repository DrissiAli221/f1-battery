# Phase 3: physics baseline, regimes, derate detector (reproduction check FAILED)

Status: **the Phase 3 reproduction check did not pass, so Phase 4 was not started.**
Monza reproduces the spike to within 6 m and regime agreement passes, but the hinge
detector flags a ramp on 27.5 % of Singapore laps on one straight (limit 10 %).
Numbers below come from `python -m f1battery_model.check_phase3` (writes
`model/out/phase3_check.json`, gitignored; about 25 s). Nothing was written to the database.

Code: `model/f1battery_model/{physics,regimes,derate,pipeline,check_phase3}.py`,
tests `model/tests/test_derate.py` (27 tests pass with the existing ones).

## Method

* **Trace** (`physics.py`). One driver's whole `car_data` stream is resampled to a
  0.25 s grid and differentiated once (Savitzky-Golay, window 9, polynomial 2,
  docs/phase3-differentiation.md), so the straight across the start/finish line is not
  cut by a lap edge. Laps come from the Phase 2 bounds (`alignment.align_driver`;
  all sessions use lap-table boundaries, `lap_quality.boundary_source = 'laps'`).
  Distance is the integral of speed from the lap start. The 1.5 s brake-onset guard
  is kept (also applied to the end of every full-throttle run, because a lift leaks
  the same way as a brake).
* **Slope.** `sin(theta)` from `location.z` (tenths of a metre) as the elevation
  difference over a 75 m window of travelled distance (+-37.5 m), never sample to sample.
* **Specific excess power** `p = (a + g sin(theta)) v + rho CdA v^3 / (2 m)` in W/kg
  (g = 9.80665, rho = 1.2 kg/m^3 fixed, so CdA is "at rho 1.2").
* **Regimes** (`regimes.py`). 50 m bins by lap distance, label = most frequent sample
  label (ties: brake, lift, deploy, plateau, other). Codes: deploy 0, plateau 1, lift 2,
  brake 3, other (not stored). Deploy = full throttle (>= 98 %), a > 0.5 m/s^2; plateau =
  full throttle, |a| <= 0.5; lift = throttle < 98 % outside braking, plus full-throttle
  samples in the 1.0 s after a lift that began above 200 kph (the ~200 kW reapplication
  burst); brake = brake on. Full-throttle samples inside the brake guard, or
  decelerating by more than 0.5, are "other". Agreement = over the bins that are deploy
  or plateau in two consecutive green laps, the fraction with the same label (mean over pairs).
* **Derate detector** (`derate.py`). Per straight per green lap: the full-throttle run
  (single-step dips bridged, at least 4 s) that overlaps the straight window; skip 1.0 s
  after throttle application and 1.5 s before run end / brake onset; fit the hinge to
  samples above 200 kph; the cut-off is the **ramp start**. Fit by least squares over a
  grid of ramp starts (every 0.25 s) and ramp durations (0.25-8 s); for each pair the plateau
  and deploy levels are solved in closed form. A ramp is feasible only if its slope
  does not exceed the C5.12.6 rate divided by the mass.
  Detected = drop >= 100 kW, hinge removes >= 50 % of the variance of a constant fit,
  ramp start >= 210 kph (C5.12.7), mean acceleration on the plateau <= 1.0 m/s^2 in absolute value.
  The straight across the line is attributed to the lap that starts at the line; its
  distances are measured from that line and are **negative before it**.
* **Deviation from the brief, and why: the hinge is on `p`, not on acceleration.**
  Acceleration is not flat during deployment. On Monza lap 11 (car 63) it falls from 12.3 m/s^2
  at 181 kph to 3.0 at 285 kph and 1.5 at 293 kph while power is unchanged, because drag grows with v^2.
  "Flat deploy level, ramp, plateau" is only true of `p` (about 650-750 W/kg during
  deployment), and the C5.12.6 limit is a power rate (kW/s / mass = W/kg/s, independent of speed).
* **Threshold-crossing estimate.** The spike's definition (first point at v > 250 kph with a < 0.5
  for four grid steps, whole run, no guards) is computed alongside as `cross_spike_*`, and a
  guarded version (`cross_*`: after the start guard, before the end guard) as a robustness check.
* **Relative deploy energy** (`derate.deploy_energy`): sum of (a - a_plateau) v dt over the
  deploy phase (usable run start to ramp end; whole usable run if no ramp), in m^2/s^2 (J/kg).
  a_plateau is the car's median fitted plateau acceleration on that straight (>= 5 detected laps),
  else the car's median over all straights, else 0. A relative measure, not electrical energy.
* **Summaries** (`pipeline.summarise_straights`): median, std, 95 % bootstrap interval over laps
  (1000 resamples) of the ramp start, median cut-off speed, entry speed (speed 150 m into the
  run), plateau acceleration, detection fraction.

## Assumptions

**Mass.** `docs/regulations.md` holds no mass figure. The 768 kg dry minimum is from the
secondary sources in docs/improvements-2026-10-18.md (Red Bull regulations guide, F1technical),
not from the Section C text we hold. Fuel is an **assumption**: 70 kg at the start of a Race
(that note says ~70 kg was a projection, not a rule), 23 kg for a Sprint, a flat 15 kg in qualifying-type
sessions, burning linearly to zero from first lap start to last lap end. A Race therefore starts at
838 kg and averages 803 kg, which is where the brief's "800 kg" comes from; 800 kg at the start
would put the dry mass below 768 kg, so it was not used. Mass enters p and the rate bound only.

**CdA.** The brief's recipe (regression of `m (a + g sin) v` on `v^3` over full-throttle, top-two-gear
samples, 220-290 kph, derate ramps excluded) is implemented (`physics.fit_cda`: upper quartile per 10 kph
bin, then a line; bootstrap over laps for the spread). **It is poorly identified and should not be
read as a drag area**: on the deploy phase before the ramp the speed range is only about 220-250 kph,
and P is not constant. Regression values at Monza run from -0.28 to 2.02 m^2 across cars (R^2 0.13-1.00),
at Singapore from -0.49 to 4.19. By power-unit maker (median regression / median profile value, m^2):

| PU maker | Monza regression | Monza profile | Singapore regression | Singapore profile |
|---|---|---|---|---|
| Mercedes | 0.35 | 0.46 | 1.49 | 0.91 |
| Ferrari | 0.31 | 0.52 | 1.83 | 1.24 |
| Red Bull Ford | 0.61 | 0.62 | 1.46 | 1.05 |
| Honda | 1.72 | 0.55 | 2.61 | 0.40 |
| Audi | 0.15 | 0.66 | 1.00 | 1.03 |

(Per-car values with their bootstrap spread: `cda_monza` and `cda_singapore` in `phase3_check.json`.
Spread per car is typically 0.1-0.4, up to 1.0 for cars with few samples.)

The hinge therefore uses a **session-wide CdA chosen by profile**: for each CdA on a grid (0.4-1.6
m^2) the hinge is fitted on every analysable straight of every driver, and the CdA with the smallest
pooled residual is used (parabolic refinement). That is "the CdA that makes p flattest before the
cut". Result: **Monza 0.55 m^2, Singapore 0.94 m^2** (higher drag in the Singapore
configuration is plausible). Per-car profile minima sit within about 0.4-0.7 at Monza, but several hit the grid
floor of 0.4, so they are bounds, not estimates. Using a single pooled value keeps car-to-car noise in the
CdA fit from becoming a fake cut-off difference between cars.

**Sensitivity of the ramp start to CdA** (Monza, hinge median over laps, detection fraction in brackets):

| car, straight | 0.4 | 0.7 | 1.0 | 1.3 | 1.6 |
|---|---|---|---|---|---|
| 63, T1->Roggia | 1115 (1.0) | 1130 (1.0) | 1164 (1.0) | 1212 (1.0) | 1261 (1.0) |
| 63, Lesmo->Ascari | 3031 (0.89) | 3078 (0.89) | 3117 (0.87) | 3158 (0.76) | none (0.0) |
| 44, T1->Roggia | 1114 (1.0) | 1118 (1.0) | 1121 (1.0) | 1134 (1.0) | 1186 (0.96) |
| 44, Lesmo->Ascari | 3074 (0.76) | 3102 (0.74) | 3136 (0.70) | 3112 (0.07) | none (0.0) |

So the ramp start moves by roughly 40-150 m over a 1.2 m^2 change in CdA, and the ramp is
lost at high CdA. A CdA error is common to a session (it shifts every car together) but the absolute ramp
start has a systematic uncertainty of order +-50 m that the bootstrap interval does not contain.

**Derate rate.** `regulation_event.derate_rate_kw_per_s` is NULL for every session (the per-event
power-limited distance is not public). The detector uses **100 kW/s as the default and the run
is flagged `rate_default`** (`SessionContext.rate_default`). At Monza the fitted ramps imply a median
66-77 kW/s (ramp 2.8-5.0 s for a ~200-350 kW drop), below the default bound, so the bound is not
what shapes the fit there; whether Monza is a 50 kW/s event cannot be decided from this.

**Slope.** z is quantised to 0.1 m; over 75 m the quantisation contributes about 0.01 m/s^2,
negligible against the real gradient (Monza lap: |sin(theta)| up to 0.02, i.e. 0.2 m/s^2).

## Reproduction check

### Monza race 11361: threshold-crossing estimate, pipeline vs spike (tolerance +-60 m)

Median cut-off distance from the lap start; std over laps in brackets. All ten comparisons pass
(largest difference 5.2 m).

| car | T1->Roggia spike | pipeline | diff | Lesmo->Ascari spike | pipeline | diff |
|---|---|---|---|---|---|---|
| 63 | 1479 (38.7) | 1482.5 (39.4) | +3.5 | 3525 (53.7) | 3527.8 (52.8) | +2.8 |
| 44 | 1457 (33.1) | 1458.2 (31.8) | +1.2 | 3595 (25.8) | 3598.8 (25.5) | +3.8 |
| 3 | 1434 (36.7) | 1436.8 (36.6) | +2.8 | 3577 (37.7) | 3579.5 (39.9) | +2.5 |
| 18 | 1382 (17.9) | 1387.2 (19.6) | +5.2 | 3555 (74.9) | 3555.8 (75.7) | +0.8 |
| 27 | 1416 (41.0) | 1420.6 (42.8) | +4.6 | 3545 (44.1) | 3550.2 (46.1) | +5.2 |

With the 1.5 s end guard applied (the pipeline's own cleaner version) the crossing is found on all
laps of T1->Roggia but on only 20-80 % of laps of Lesmo->Ascari (car 44: 20 %), because a lift before the braking
point shortens the usable run. The spike's Lesmo->Ascari "cut" on laps with an early lift may include
the lift leak; the hinge, which uses the guard, is unaffected.

### Monza: hinge ramp start (reported separately)

| car | T1->Roggia ramp start (95 % CI) | speed kph | detected | Lesmo->Ascari ramp start (CI) | detected |
|---|---|---|---|---|---|
| 63 | 1120 (1114-1130) | 235 | 1.00 | 3059 (3041-3069) | 0.89 |
| 44 | 1115 (1111-1121) | 228 | 1.00 | 3093 (3076-3100) | 0.74 |
| 3 | 1108 (1103-1112) | 224 | 1.00 | 3087 (3075-3095) | 0.80 |
| 18 | 1103 (1100-1109) | 219 | 1.00 | 3052 (3014-3062) | 0.81 |
| 27 | 1105 (1103-1109) | 222 | 1.00 | 3085 (3075-3096) | 0.87 |

The hinge start is **280-360 m (T1->Roggia) and 465-505 m (Lesmo->Ascari) before the threshold crossing**,
i.e. about 4 s and 5-6 s of travel, more than the "up to ~3 s" expected from the synthetic study. The
ramps are slow (2.8-5.0 s) and the plateau is only reached later. The bootstrap intervals are narrow (+-5-15 m)
because laps are very repeatable; they do not include the CdA systematic above.

### Singapore race 11388: **FAIL**

Detected ramps as a share of analysable laps, pooled over all 22 cars:

| straight | analysed laps | detected | share |
|---|---|---|---|
| 1 (main) | 962 | 0 | 0.0 % |
| 3 | 989 | 272 | **27.5 %** |
| 5 | 112 | 0 | 0.0 % |
| 6 | 1018 | 0 | 0.0 % |

For the spike's five cars on straight 3: car 63 2 %, 44 38 %, 3 15 %, 18 33 %, 27 48 %.
Requirement: no detected ramp for >= 90 % of laps on every straight (share <= 10 %). **Not met on
straight 3.** On that straight the fit finds a ~140 kW drop in p starting at ~235 kph, but the
car keeps accelerating on the "plateau" at 0.5-1.2 m/s^2, so it is at the edge of the plateau acceptance (1.0 m/s^2).
This is a borderline case, not noise: the plateau acceleration at Monza Lesmo->Ascari is 0.4-0.9 m/s^2.

History (disclosed because the detector was changed once after seeing a failure): the first version had
no plateau-acceleration condition and detected 26 % / 93 % / 90 % of laps on Singapore straights 1 / 3 / 6.
The plateau condition is what the model means by "then a plateau" (near-zero acceleration), its
limit was set to 1.0 m/s^2 from the late regain seen at Monza (docs/phase3-differentiation.md), and
it was not tuned afterwards. Post-hoc sensitivity only, not adopted: with the limit at 0.5 m/s^2 Singapore passes
(worst straight 1.3 %), but Monza Lesmo->Ascari detection falls to 0-54 % per car and T1->Roggia to
87-100 % (`--plateau-a-max 0.5`).

### Regime agreement: pass

Mean lap-to-lap agreement on full-throttle bins: Monza cars 63 / 44 / 3 / 18 / 27 =
0.919 / 0.913 / 0.905 / 0.933 / 0.916 (minimum pair 0.75-0.86; spike 0.79-0.86). Singapore: all 22
cars at least 0.981 (spike cars 0.981-1.000). Requirement 0.80: met.

## Verdict

| check | result |
|---|---|
| Monza cut-offs within +-60 m of the spike (10 comparisons) | pass (max 5.2 m) |
| Singapore: no ramp on >= 90 % of laps, every straight | **fail** (straight 3: 27.5 % detected) |
| Regime agreement >= 0.80 | pass (min mean 0.905 at Monza, 0.981 at Singapore) |

Phase 4 is not started. Regime maps for every session (Phase 3 exit condition) were not produced.

## Open decisions for the owner

1. **Detection rule.** Plateau limit 1.0 m/s^2 fails Singapore straight 3; 0.5 passes Singapore but
   loses most Monza Lesmo->Ascari detections (the spike saw a cut there on 91-100 % of laps). Options:
   (a) accept 0.5 and treat Lesmo->Ascari as weakly detected; (b) decide "a ramp exists" from the
   spike's crossing and use the hinge only for the position; (c) accept that Singapore straight 3 has a
   real power reduction that the spike's 0.5 m/s^2 test cannot see (140 kW drop at 235 kph with a ~1 m/s^2
   plateau), and change the Singapore expectation. This changes the pre-stated exit condition, so it is yours to make.
2. **CdA is not identifiable from full-throttle samples alone** (regression -0.5 to 4.2 m^2). The hinge uses
   a session-wide profile value; a lift-and-coast or qualifying fit might do better. The brief's
   per-car regression is implemented and reported but not used.
3. **Hinge on p instead of acceleration** (deviation, numbers above). The ramp start depends on CdA by 40-150 m
   per m^2 and sits 280-500 m before the spike's crossing.
4. **Energy definition.** Brief's (a - a_plateau) v is implemented; (p - p_plateau) would include drag
   and be a closer "energy above ICE-only"; not implemented.
5. **Rate.** `regulation_event` has no per-event rate; default 100 kW/s is flagged. Fitted Monza ramps imply ~70 kW/s.
6. **Mass.** Dry 768 kg is secondary-sourced and the fuel loads are assumptions (838 kg Race start).
7. Straight across the line: distances are negative before the line; Phase 4 would have to store them that way or add the lap length.
