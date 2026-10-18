# Pre-registered hypothesis

**Status: FROZEN on 2026-10-18.** This file is not edited after this date.
Deviations are recorded in DECISIONS.md with reasons. No Phase 3 or Phase 4
output existed when it was frozen (the only prior outputs are the Phase S
spike, which this design was written against, and the Phase 2 alignment).

Frozen on: 2026-10-18

## Why this framing

An earlier draft compared attacker − defender *state of charge at the moment
of the pass*. That is close to circular: the energy state is inferred from
acceleration, and the attacker's extra acceleration is largely the Overtake
power curve (C5.2.8.ii) it is granted for being within range. With recharge
capped at about one battery window per lap, state of charge is roughly
periodic, so the instantaneous difference carries little information. The
test uses **lap-level energy behaviour measured before the attack** and the
**defender's behaviour on the approach straight**, with pace and Overtake
availability as controls. In proxy mode (D10) the energy variables are
derating cut-offs and relative deploy energy, not state of charge.

## Question
Does a defender's energy management on the lap before and on the approach
straight (an earlier derating cut-off, i.e. more energy saving on that
straight, or a lower relative deploy energy) predict being passed, after
controlling for pace difference, tyre age and Overtake availability?

## Definitions
- **Event set:** rows of OpenF1 `overtakes` in 2026 sessions with
  `session_name` in {Race, Sprint}, excluding Hungary race 11342 (D17),
  keeping on-track passes only:
  - exclude a row if either driver has a `pit` entry with `date` in
    [t − 120 s, t + 30 s] (pit cycle, not a pass)
  - exclude a row within 300 s after a `race_control` message for either
    driver whose text contains "PENALTY", and any row after the
    "CHEQUERED FLAG" message
  - exclude a row during a closed SC/VSC/red-flag window or when either
    driver's lap is not `green` in `lap_quality`
  - exclude lap 1 and the first lap after any restart (first green lap after
    a neutralised window)
  - keep one row per (session, overtaking driver, overtaken driver, lap).
- **Comparison set (non-events):** close following without a pass:
  `intervals.interval` < 1.0 s for at least 3 consecutive samples of the
  following car (about 10–15 s), with no `overtakes` row involving the pair
  in the following 30 s and the same exclusions as above. At most one
  non-event per (session, pair, lap).
- **Unit of analysis:** the pair (attacker = following car, defender = car
  ahead) on a lap; event = 1 if a pass happened that lap, 0 otherwise.
- **Main variables (from the Phase 3 regime model, measured on the lap
  *before* the event, at the control line):**
  - `cutoff_dev_defender`: defender's derating cut-off on the approach
    straight (the straight that ends at the corner where the pass or the
    close-following sample occurs), as the deviation in metres from that
    car's median cut-off on that straight in that session. Earlier cut =
    negative = more energy saving on that straight.
  - `deploy_rel_diff`: defender − attacker relative deploy energy above the
    ICE-only plateau, summed over the previous lap (relative units).
  - `defender_lift`: whether the defender was below full throttle for ≥ 1 s
    on the approach straight outside the brake guard (binary).
- **Controls:** pace delta (median green-lap time of the attacker minus the
  defender over the previous 3 green laps, seconds); tyre age difference
  from `stints` (laps); session as a fixed effect; lap number; Overtake
  availability (1 if `race_control` has OVERTAKE ENABLED in force and the
  attacker's `interval` at the control line of the previous lap is < 1.0 s).
- **Uncertainty:** Phase 3 bootstrap confidence intervals on the cut-off;
  the test is run three times: point estimates, lower band edge, upper band
  edge. The conclusion must hold for all three to count.
- **Test:** logistic regression (statsmodels), event ~ cutoff_dev_defender +
  deploy_rel_diff + defender_lift + pace_delta + tyre_age_diff + lap_number +
  overtake_available + C(session). Continuous covariates standardised.
- **Negative control:** permute the three main variables across rows within
  each session 1,000 times and refit; the observed coefficient for
  `cutoff_dev_defender` must be more extreme than 95 % of permutations.
- **Minimum sample:** at least 150 clean events with at least 300
  non-events, else the result is reported as "insufficient data".
- **Smallest effect that counts:** odds ratio of being passed ≥ 1.3 per one
  standard deviation of `cutoff_dev_defender` (in the direction earlier cut
  → more likely passed), with the 95 % interval excluding 1, in all three
  uncertainty runs, and the permutation control passed.
- **What counts as no effect:** the 95 % interval includes 1, or the odds
  ratio is below 1.3, in any of the three runs, or the permutation control
  fails.

## Expectation
A weak or null result is likely, and it gets reported honestly. Pace delta
will probably dominate; the question is whether energy behaviour adds
anything on top of it.
