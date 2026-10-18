# Phase 3: differentiation method comparison (D11)

Reproduce: `.venv/bin/python -m f1battery_model.eval_differentiation` (from `model/`'s parent, with `PYTHONPATH=model`). Synthetic data: 200 seeded straights (`model/f1battery_model/synthetic.py`); the first 50 tune each method's one parameter, the remaining 150 are scored.

## Recommendation

**Keep Savitzky-Golay on a 0.25 s grid, window 9, polynomial 2 (the spike configuration), and keep the 1.5 s brake-onset guard.**

- Outside the leak region SG-9 is the most accurate method on the synthetic straights: lowest deploy and ramp RMSE and the smallest ramp-start error against the true threshold crossing (mean 0.22 s, p90 0.41 s).
- Its weakness is the leak: within 1.5 s before brake onset its RMSE is about 8.5 m/s². Total-variation (Chartrand, gamma 0.3) cuts that to about 1.0, but the guard discards exactly that region, so the gain is not usable. Window 9 is 2.25 s, half-window 1.1 s, which is inside the 1.5 s guard; that is why the guard stays and must not be shortened.
- Surprise: the PyNumDiff methods do not beat SG-9 where it matters. The Kalman/RTS smoother (best order 1, i.e. acceleration as a random walk) is worse in the deploy and ramp regions and worse on ramp-start timing; order 2 was worse again. TV has more "no estimate" cases and a staircase shape that hovers around the 0.5 m/s² threshold. A wider SG window (31) is biased late on real data (about +75 m) from lag.
- Real Monza car 63 confirms it: SG-9 gives 1475 m, lap-to-lap std 31 m (spike: 1479 m, 39 m); TV gives 1501 m, 39 m; wide SG 1550 m, 25 m (lower std only because it is smoother and later, i.e. biased).
- Caveats: the synthetic truth is idealised (smooth deploy, flat plateau), so it favours a local polynomial; the real plateau regains 0.5-1 m/s² late in the straight. Ramp-start definition matters more than the differentiator: the 0.5 m/s² crossing sits part-way down the ramp (about 3 s after the true ramp start for every method). The derate detector should therefore fit a hinge model (PLAN Phase 3) rather than read off a threshold crossing.
- The tuning objective was the mean of the three regional RMSEs on 50 synthetic straights; scores are on the other 150.

## Synthetic results (RMSE of acceleration vs truth, m/s²)

| method | param | deploy | ramp (±1 s) | leak (1.5 s pre-brake) |
|---|---|---|---|---|
| finite_diff | -=None | 0.36 | 0.34 | 4.48 |
| savgol_9 | -=None | 0.06 | 0.09 | 8.50 |
| savgol_wide | window=31 | 0.32 | 0.41 | 5.12 |
| kalman_rts_o1 | log_qr=-2 | 0.54 | 0.79 | 2.19 |
| kalman_rts_o2 | log_qr=6 | 0.55 | 0.47 | 4.01 |
| tv_chartrand | gamma=0.3 | 0.43 | 0.18 | 1.04 |

## Ramp-start estimate (first point a < 0.5 m/s² and stays, brake guard applied)

Error against the true ramp start (the time the linear drop begins), absolute. The 0.5 m/s² crossing sits part-way down the ramp, so a positive bias is inherent; the last two columns compare to the true crossing time instead, which isolates estimator error.

| method | mean err s | p90 err s | mean err m | p90 err m | signed bias s | vs true crossing: mean s | p90 s | no estimate |
|---|---|---|---|---|---|---|---|---|
| finite_diff | 3.40 | 4.91 | 268 | 389 | +3.40 | 0.39 | 0.90 | 12 |
| savgol_9 | 3.35 | 4.68 | 263 | 377 | +3.35 | 0.22 | 0.41 | 3 |
| savgol_wide | 2.94 | 4.54 | 232 | 358 | +2.94 | 0.41 | 0.84 | 0 |
| kalman_rts_o1 | 2.65 | 3.91 | 209 | 316 | +2.65 | 0.55 | 1.00 | 1 |
| kalman_rts_o2 | 3.61 | 5.09 | 285 | 419 | +3.61 | 0.54 | 1.09 | 18 |
| tv_chartrand | 3.44 | 4.79 | 271 | 386 | +3.44 | 0.31 | 0.56 | 5 |

## Real confirmation: Monza race, car 63, T1 to Roggia (1016-1950 m from lap start)

10 green laps (the first ten passing the filter) with a clean full-throttle, pre-brake run across the window. Ramp start = first lap distance where a falls below 0.5 m/s² (first crossing, not 'stays': the real plateau regains 0.5-1 m/s² late in the straight, which defeats the 'stays' rule; the crossing sits part-way down the ramp). Spike reference with Savitzky–Golay: about 1479 m, std about 39 m (different definition, see spike/RESULT.md).

| lap | tv_chartrand (m) | savgol_wide (m) | savgol_9 (m) |
|---|---|---|---|
| 2 | 1456 | 1567 | 1469 |
| 10 | 1491 | 1554 | 1459 |
| 16 | 1511 | 1534 | 1484 |
| 17 | 1585 | 1585 | 1558 |
| 19 | 1450 | 1593 | 1482 |
| 30 | 1479 | 1515 | 1456 |
| 31 | 1536 | 1536 | 1451 |
| 38 | 1492 | 1538 | 1459 |
| 39 | 1492 | 1528 | 1466 |
| 40 | 1514 | 1547 | 1468 |
| **mean** | 1501 | 1550 | 1475 |
| **n with estimate** | 10 | 10 | 10 |
| **std** | 39 | 25 | 31 |

Figures: `model/out/synthetic_example.png`, `model/out/real_straight.png`.
