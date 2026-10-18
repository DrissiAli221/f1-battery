# Ways to elevate the project (research, 2026-10-18)

Researched by Claude. Proposals only: nothing here changes PLAN.md until Ali
accepts an item and it gets a DECISIONS.md entry. Ranked by value/effort.

## 1. Second data source: TracingInsights/2026 (high value, low effort)

[TracingInsights/2026](https://github.com/TracingInsights/2026), Apache-2.0,
~4.3 GB, last push 2026-10-18 (still updating after the F1 archive lockout).
Built from FastF1, Jolpica, OpenF1 and the MultiViewer circuit API
([DATA_REFERENCE.md](https://github.com/TracingInsights/2026/blob/main/DATA_REFERENCE.md)).
2026 sessions FP1–3, Q and R per GP, plus pre-season testing.

Checked by hand (Monza race, ALB, lap 30 file): per-lap telemetry with
`time, rpm, speed, gear, throttle, brake, drs, distance, rel_distance,
DriverAhead, DistanceToDriverAhead, acc_x/y/z, x, y, z` (668 samples per lap,
car data and position merged and interpolated).

What it adds that OpenF1 car_data alone doesn't:
- **Elevation `z`.** Gravity on a slope is g·sinθ. A 2 % grade is ~0.2 m/s²,
  the same size as the effects we measure. Monza is fairly flat (~12 m
  range in the sample, units to confirm), but Spa, Austria, Suzuka and Baku
  are not. **Correct for slope in Phase 3 or the drag baseline is biased.**
- **`DistanceToDriverAhead` per sample.** Direct tow and slipstream detection
  for the tow test and the hypothesis controls, with no need to rebuild gaps
  from 4–6 s `intervals`.
- **Corner geometry** (`corners.json`) for labelling straights consistently.
- **A second mirror.** A GitHub repo you can clone, independent of OpenF1
  staying online.
- Caveat: `acc_x` is their own 3-point-smoothed gradient. **Don't use it**: it
  has exactly the leak problem the spike found. Use their speed and z only.

Action: cross-check one race against the OpenF1 backup (same samples?), then
clone the repo (or just the 2026 race and qualifying folders) as a backup.

## 2. Better noisy differentiation: PyNumDiff (medium value, low effort)

[PyNumDiff](https://github.com/florisvb/PyNumDiff) (JOSS 2022, Van Breugel,
Brunton, Kutz): Kalman/RTS smoothing, total-variation regularisation,
Savitzky–Golay and others behind one API, with a single tuning parameter.
- A **Kalman (constant-acceleration) smoother** handles the irregular
  0.16–1.08 s sampling natively, which a fixed-window moving average doesn't.
- **Total-variation** differentiation keeps sharp changes sharp. That's
  what the braking edge needs, and it reduces the leak at its source (keep
  the brake guard anyway).
- Interview value: "I compared three differentiation methods on a synthetic
  straight with known truth and picked X because…" beats "I used a moving
  average".

## 3. Ramp detection with uncertainty (medium value, medium effort)

The cut-off is a ramp (C5.12.6: 50 or 100 kW/s depending on the event). Fit a
**piecewise-linear model** (acceleration flat → ramp down → plateau) per
straight per lap, with the start of the ramp as the cut-off. Use `ruptures`
(changepoint detection) or a direct least-squares hinge fit, and **bootstrap
the laps** for a confidence interval on each car's cut-off distance. That
turns "20–40 m repeatable" into a number with error bars, per car, per race.

## 4. Case-study validation set (high value, low effort)

There's no ground truth, but drivers have described specific moments. Turn the
best documented ones into **spot checks, written down before running the
model**:
- Norris, Suzuka: "5 % of my battery coming out the last corner", so the
  model should show an early or missing deploy on that lap's main straight.
- Hamilton vs Verstappen, Canada, the lap-62 pass (r/F1Technical analysis):
  top speed falls mid-race, then recovers in the attack window.
- Leclerc/Ferrari at Monza: reported to derate earlier than Mercedes
  (Scuderia Fans, from FP2).
For each: expected sign, the lap and straight, pass or fail. A few named
real-world checks make the write-up far more convincing than statistics alone.

## 5. Physical constants with sources (low effort, needed anyway)

- Minimum mass **768 kg without fuel** (722 kg car and driver + 46 kg tyre
  allowance), per Red Bull's regulations guide and F1technical. Race fuel
  ~70 kg was a projection, not a rule, so verify it in Section C before use.
  Fuel burn means the car gets ~8–9 % lighter over a race, which matters for
  acceleration-based estimates. Model mass as falling linearly with laps.
- Drag: no published CdA. Press says straight mode cuts drag ~40–55 %. **Fit
  CdA per car per event from the data** and report it, instead of assuming it.
- Add both to docs/regulations.md with sources.

## 6. Visibility: where to publish once there's a result (career value)

Only with Ali's explicit OK, and only aggregates (D5):
- **[FastF1 discussion #861](https://github.com/theOehrly/Fast-F1/discussions/861)**,
  the place where the community already asked for 2026 ERS data (FastF1 has
  ~5.5k stars). A short post there reaches exactly the right people.
- **r/F1Technical:** similar telemetry posts got 130–400 upvotes this
  season (Monza clipping, the Australian hybrid model, Canada).
- **A short write-up** (blog/Substack) plus a LinkedIn post linking it.
  Recruiters see it, and the method story (fake clip → brake guard → test)
  is the hook.
- Optional, bigger: contribute a small, generic utility upstream (e.g. a
  brake-guarded acceleration helper) to FastF1. A merged PR to a 5k-star repo
  is a strong CV line. Ask the maintainer first; scope it tiny.

## 7. Smaller ideas

- **Pre-season testing data** (in TracingInsights): teams ran deliberate
  energy programmes there. Good for exploring, but kept out of the hypothesis.
- **Weather/wind** per minute (both sources) as a drag-baseline control on
  each straight's heading. TracingInsights gives wind direction, and x/y give
  the straight's direction.
- **The FIA race director's competition notes** are public PDFs per event
  (e.g. [Miami](https://www.fia.com/system/files/decision-document/2026_miami_grand_prix_-_race_directors_competition_notes_.pdf),
  [Canada](https://www.fia.com/system/files/decision-document/2026_canadian_grand_prix_-_race_directors_competition_notes_.pdf)).
  The press reports straight-mode zones per track (Monaco none, Zandvoort two,
  Hungary four, including a new one). Confirms the downloader plan.

## Not worth it (checked)

- More ML (deep models): no labels, ~18 races. It would add risk and no
  credibility.
- Using F1 TV tokens for the locked archive: against F1 TV terms.
- The broadcast battery bar as ground truth: it's FOM's own estimate, and only
  for featured cars.
