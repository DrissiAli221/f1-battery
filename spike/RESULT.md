# Phase S result (2026-10-17)

Data: Monza race (11361) and Singapore race (11388), drivers 63 RUS (Mercedes PU),
44 HAM (Ferrari), 3 VER (Red Bull Ford), 18 STR (Honda), 27 HUL (Audi). Leclerc
and Alonso retired early at Monza and were replaced. Race-window car_data in
10-minute windows, ~26.7k samples per car per race, resampled to a 0.25 s grid,
acceleration from a 9-sample Savitzky–Golay fit. Green laps only (lap 1, pit
in/out, VSC windows and laps slower than 1.07× median removed): 46 per car at
Monza (21 for Stroll), 56–58 at Singapore. Scripts: `fetch.py`, `analyze.py`,
`deploy_cut.py`. Figures and numbers: `out/<session>/`.

## Verdict per exit condition

| # | Condition | Monza | Singapore | Verdict |
|---|---|---|---|---|
| 1 | C5.2.8 taper visible as a slope break in the full-throttle power envelope between 290 and 345 kph | Envelope flat 290–325 kph (~650–700 W/kg), then *rising* to 340 kph. Regulation predicts −6.3 W/kg per kph. Only 43–50 samples above 340 kph | Cars don't exceed 314 kph | **Not demonstrated** |
| 2 | Super-clip segments (full throttle, top gear, decel beyond drag) on ≥ 80 % of green laps within ±50 m | First pass: yes, 80–98 % of laps, −4 to −6 m/s². **Artifact.** Every candidate sat 0.25–1.5 s before brake onset, inside the smoothing window. With a 1.5 s brake guard: 0–11 segments per car, none repeatable | None | **Fail as written** |
| 3 | Lap-to-lap regime agreement ≥ 80 % (full-throttle bins, deploy vs no-deploy) | Mean 0.91–0.94, min 0.79–0.86 | Mean 0.94–0.99, min 0.89–0.95 | **Pass** |

Formal result: 1 of 3. Per PLAN.md, the project continues in
**energy-management-proxy mode** (regimes and deploy boundaries, no
state-of-charge numbers) unless a later check changes that.

## What the data does show

**A repeatable deploy cut-off on long straights.** At full throttle in top
gear above ~300 kph the cars sit at near-zero acceleration (median 0.1–0.7
m/s², against 1.3–1.6 m/s² at 280–300 kph) while C5.2.8 would still allow
≥ 200 kW of MGU-K. So deployment is cut by energy management, not by the
rule. Where the cut happens is consistent lap after lap:

| Monza straight (from lap start) | Cut distance, median per car | Lap-to-lap std | Laps with a cut |
|---|---|---|---|
| T1 → Roggia (1016–1950 m) | 1382–1479 m, at 270–294 kph | 18–41 m | 100 % |
| Lesmo 2 → Ascari (2890–3770 m) | 3525–3595 m, at 290–310 kph | 26–75 m | 91–100 % |
| Ascari → Parabolica (4040–4960 m) | 4491–4829 m | 67–133 m | 87–100 % |
| Main straight | already cut when crossing the line | | |

At Singapore (longest run 580 m, top speed ≤ 314 kph) there is no cut on any
straight: the cars accelerate all the way to the brake point. That is the
expected contrast.

**No harvest-under-throttle at Monza in the race.** Nothing sustained below
−1.5 m/s² at full throttle outside the braking approach. If "super-clipping"
in the 350 kW harvest sense happens, it is not in race data at 3.7 Hz, or it
is hidden by the active-aero mode change before braking.

**Noise.** Raw-minus-smoothed acceleration std at full throttle ≈ 0.9–1.1
m/s² (higher than the 0.42 m/s² quantisation estimate: the sampling is
irregular, 0.16–1.08 s). Deploy-phase signal is 1.5–4 m/s², so regimes are
separable; a 100 kW difference (~1.3 m/s² at 300 kph) is at the edge.

**Distance alignment.** Integrating integer-kph speed gives lap lengths with
std 10–17 m over 5.74 km (Stroll 25 m at Singapore). Good enough for ±50 m
bins; the `location` endpoint should still be used to anchor it in Phase 2.

**Feed timing.** OpenF1 samples every car on identical timestamps (26,698
rows per car at Monza). Cross-car alignment is free.

## Lessons for Gate S

1. The smoothing window leaks the braking onset backwards and fakes a
   "clip" at full throttle. Any decel-under-throttle detector needs a guard
   of at least half the window before brake onset. The first pass "passed"
   because of this; it would have been a fabricated finding.
2. The regulation taper can't be tested on race data without knowing
   Overtake state: the envelope above 320 kph is populated by cars in a tow
   or in Overtake mode. Qualifying or a per-sample Overtake inference is
   needed.
3. The absolute engine/electric split is not identifiable (the measured
   full-deploy envelope is ~700 W/kg against an assumed 950). Only
   *relative* and *where* quantities are robust: cut-off distance, cut-off
   speed, excess energy over the ICE-only plateau per straight.

## Proposed consequences (D10, Ali to confirm)

- Phase 3/4 output = per-straight deploy cut-off distance and speed, deploy
  energy above the plateau (relative units), regime maps. No SoC numbers.
- HYPOTHESIS.md main variables become: defender's cut-off distance on the
  approach straight (earlier cut = less energy), and attacker − defender
  cut-off difference on the previous lap.
- Exit condition 1 moves to a qualifying check in the deferred list.
