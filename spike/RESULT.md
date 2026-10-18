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

**A repeatable deploy cut-off on long straights** (the known effect called
**derating**; see DECISIONS.md D1 addendum). At full throttle in top
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
−1.5 m/s² at full throttle outside the braking approach. Reported
explanation (r/F1Technical thread "How did teams avoid serious super
clipping at Monza?", and GrandPrix.com; figures 5 MJ vs 6–6.5 MJ disagree,
none verified): the FIA set a lower per-lap harvest limit at Monza, so
teams did not need to harvest under throttle. If "super-clipping"
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

## Tow test: is the cut-off a distance decision or a speed limit? (2026-10-17)

Per car and straight at Monza, cut-off distance and cut-off speed were
regressed on entry speed (speed 150 m into the full-throttle run; spread of
10–40 kph across laps from tows and traffic). Script: `tow_test.py`, numbers in
`out/11361/tow_test.json`.

| Straight | Cut distance vs entry speed | Cut speed vs entry speed | Reading |
|---|---|---|---|
| T1 → Roggia | slope 0.3 to 2.4 m per kph, r 0.02–0.33 | r 0.24–0.62, +2 to +6 kph on fast laps | **Distance-fixed.** A faster entry just arrives at the same point faster. Energy decision |
| Lesmo 2 → Ascari | slope −3 m per kph, r −0.2 to −0.3 | r ≈ 0 | **Distance-fixed**, slightly earlier when entering faster |
| Ascari → Parabolica | slope −5 to −18 m per kph, r −0.2 to −0.66; fast-entry laps cut ~230 m earlier | flat at 302–313 kph | **Speed-targeted.** Deploy stops once ~305–313 kph is reached, wherever that is |
| Main straight | not testable: the run is split by the lap boundary and the car is already cut at the line | | Treat 5250 → 740 m as one straight in Phase 2 |

Conclusion: the cut-off is **not** the car's top speed (the same cars reach
320–350 kph elsewhere on the lap) and on two of three straights it is a fixed
place on the track, so it is an energy-management decision. On the third it
follows a target speed. Consequence for HYPOTHESIS.md: the per-straight
variable must be expressed relative to the car's own median for that straight
and controlled for entry speed, not as a raw distance.

## Active-aero zones vs cut-offs (2026-10-17)

Monza's 2026 straight-mode zones are published only qualitatively (PlanetF1,
formula1news.co.uk; one source says two zones, the better-supported count is
four): main straight from the line; Curva Grande exit → Roggia entry;
Lesmo 2 → Ascari; Ascari exit → Parabolica entry. No metre markers, no FIA
document reached. Each zone ends at the entry to the next corner, i.e. at or
after the braking point. The measured cut-offs sit mid-zone: ~470 m before
Roggia, ~200 m before Ascari, 130–470 m before Parabolica. So the cut-off is
not an aero-mode change at a zone boundary. Caveat: a driver may close the
wing early inside a zone; that cannot be seen in this data. Zone definitions
with metres are an open item for Phase 2 (`docs/regulations.md`, per event).

## Method notes

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

## Consequences (D10)

- Phase 3/4 output = per-straight deploy cut-off distance and speed, deploy
  energy above the plateau (relative units), regime maps. No SoC numbers.
- HYPOTHESIS.md main variables become: defender's cut-off distance on the
  approach straight (earlier cut = less energy), and attacker − defender
  cut-off difference on the previous lap.
- Exit condition 1 moves to a qualifying check in the deferred list.
