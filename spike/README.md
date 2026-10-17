# Phase S spike

Throwaway. The goal is a yes/no on feasibility, not good code. See PLAN.md, Phase S.

Suggested steps:
1. Fetch car_data and laps for Monza 2026 (session_key 11361) and 3–5 drivers
   from different power-unit makers. Respect the rate limit (sleep ~2.2 s
   between requests). Cache the JSON in `spike/cache/` (gitignored).
2. Map samples to distance along the lap.
3. Compute acceleration from speed. Compare at least two smoothing methods
   (e.g. a Savitzky–Golay filter versus a rolling mean) and note the trade-off.
4. Plot speed, acceleration, throttle and gear against distance, overlaying many laps.
5. Fit a drag-only acceleration model on full-throttle, top-gear samples below
   290 kph; overlay the C5.2.8 envelope (docs/regulations.md). The taper starts
   at 290 kph, so look for a slope break in 290–345 kph (exit condition 1).
6. Mark candidates: full throttle, top gear, deceleration beyond the drag
   baseline. Count on how many green-flag laps each straight shows one, and
   the spread of its start distance (exit condition 2).
7. Label distance bins deploy / clip / other and measure lap-to-lap agreement
   (exit condition 3). Note any PU-maker differences as an observation.
8. Repeat for Singapore (11388).
9. Write `spike/RESULT.md`: pass or fail on each of the 3 exit conditions
   with the numbers and figures. Then add D8 to DECISIONS.md.

Measured on 2026-10-17: race-window car_data is ~3.7 Hz with no gaps over 2 s
(Monza, Singapore; driver 1).
