# Pre-registered hypothesis

**Status: DRAFT.** Fill in every field, then write the freeze date. After
that, this file is never edited (deviations go in DECISIONS.md). It must be
frozen **before any Phase 4 output exists**.

Frozen on: _not yet_

## Why this framing (review, 2026-10-17)

An earlier draft compared attacker − defender *state of charge at the moment
of the pass*. That is close to circular: the energy state is inferred from
acceleration, and the attacker's extra acceleration is largely the Overtake
power curve (C5.2.8.ii) it is granted for being within range. Also, with
recharge capped at about one battery window per lap, state of charge is
roughly periodic, so the instantaneous difference carries little information.
The test below uses **lap-level energy behaviour measured before the attack**
and the **defender's behaviour on the approach straight**, with pace and
Overtake availability as controls.

## Question
Does a defender's energy management on the lap before and on the approach
straight (super-clipping or lift-and-coast, lower estimated deploy budget)
predict being passed, after controlling for pace difference and tyre age?

## Definitions (to fill)
- **Event set:** OpenF1 `overtakes` in 2026 race sessions (`session_name ==
  "Race"`), keeping on-track passes only. `overtakes` has no reason field, so:
  - exclude a position change if either car has a `pit` entry within ___ s
    before it (rule: ___)
  - exclude changes within ___ s of a `race_control` penalty/post-race message
    (rule: ___)
  - exclude laps under SC, VSC or red flag (from `race_control`; rule: ___)
  - exclude lap 1 and the lap after a restart (rule: ___)
- **Comparison set (non-events):** close following without a pass:
  `intervals.interval` under ___ s for at least ___ consecutive samples
  (intervals arrive every 3–6 s, so N is small), no pass within the next
  ___ s.
- **Main variables (all from the Phase 3/4 estimator, measured at the control
  line of the lap *before* the event):**
  - defender super-clip count and lift-and-coast count on the previous lap
  - defender − attacker estimated net deploy on the previous lap (MJ, with
    uncertainty band)
  - whether the defender clipped or lifted on the approach straight to the
    pass (binary)
- **Controls:** pace delta (median clean-lap time of each car over the previous
  ___ laps), tyre age difference (`stints`), track (fixed effect), lap number,
  Overtake availability (gap under the threshold at the control line, from
  `intervals`).
- **Uncertainty:** Phase 4 bands (method: ___); run the test once with point
  estimates and once with the band edges.
- **Test:** logistic regression, event vs non-event, with the variables and
  controls above (exact spec: ___).
- **Negative control:** permute the energy variables across events within a
  race ___ times; the observed effect must beat ___ % of permutations.
- **Minimum sample:** at least ___ clean on-track passes (rough expectation:
  Monza has 334 `overtakes` rows including pit cycles, perhaps 50–100 real
  passes; a few hundred to ~1,500 across 17 races), else report
  "insufficient data".
- **Smallest effect that counts:** an odds ratio of at least ___ per ___
  (unit) with the 95 % interval excluding 1.
- **What counts as no effect:** ___.

## Expectation
A weak or null result is likely, and it gets reported honestly. Pace delta
will probably dominate; the question is whether energy behaviour adds
anything on top of it.
