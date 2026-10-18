# Phase 5: event and non-event sets

Code: `model/f1battery_model/events.py`; tests: `model/tests/test_events.py`.
Run: `cd model && ../.venv/bin/python -m f1battery_model.events --all` (or `--session <key>`).
Output: `model/out/events/<session>.csv` (pyarrow is not installed in `.venv`, so CSV is
written; the code writes `.parquet` instead when pyarrow imports), plus `summary.csv`.
Race and Sprint sessions only, Hungary race 11342 excluded (D17). Sakhir and Jeddah have no
overtake, lap or telemetry rows and produce nothing.

## Rules as implemented

Event set (one row per `overtake` row that survives):
1. Pit: a `pit.date` of either driver in [t - 120 s, t + 30 s].
2. Penalty: `race_control` message containing "PENALTY" (upper-cased), for either driver, in
   [message, message + 300 s]. A driver is matched by the row's `driver_number` or by "CAR <n>" in
   the text.
3. Chequered: t after the earliest "CHEQUERED FLAG" message.
4. Neutral window: t inside a closed SC/VSC/red window from `alignment.neutral_windows` (imported).
5. Lap not green: the lap of either driver at t is missing from `lap_quality` or not green.
6. Lap 1, and the first green lap starting after the end of each closed window, for either driver.
7. Duplicates: one row per (session, attacker, defender, lap), the earliest kept.
Lap at t = the lap with the latest `lap.date_start` <= t (bisect), for both drivers.

Non-event set: for each follower, consecutive `interval_sample` rows with `interval` < 1.0 s;
the third consecutive sample is the candidate time `t_event`. Leader = the driver one position
ahead from the latest `position` rows at that time. Same rules 1-6 at the candidate time, then no
`overtake` between the pair (either direction) in (t, t + 30 s]. At most one per (pair, lap).

Controls: `pace_delta` = median `lap_duration` of the attacker's previous 3 green laps minus the
defender's; `tyre_age_diff` = attacker minus defender tyre age at the event lap
(`tyre_age_at_start + lap - lap_start`); `overtake_available` = last OVERTAKE ENABLED/DISABLED
message at or before t is ENABLED and the attacker's latest interval at the start of its event lap
(control line crossing ending the previous lap) is < 1.0 s. `cutoff_dev_defender`,
`deploy_rel_diff`, `defender_lift` are NaN placeholders.

## Ambiguities and how they were resolved

1. Track position: the spec says `location` mapped through the alignment. The implementation uses
   the attacker's aligned `car_data` instead (lap distance from `alignment.lap_distance` over the
   integrated lap length, nearest sample within 2 s). The `car_data` and `location` feeds are of the same car
   on the same clock, and the alignment distance is defined on `car_data` only. Lap boundaries are
   the lap-table ones; sessions whose `lap_quality` used telemetry boundaries are not re-derived.
2. Approach straight: the straight whose `end_pct` is the last one at or before the event's lap
   percentage, as specified; before the first end it wraps to the last straight. A pass logged just
   before the braking point therefore maps to the previous straight; no tolerance was added.
3. "PENALTY" is matched literally, so "PENALTY SERVED" and "penalty" in messages about other
   cars count only when the car matches, but served-penalty messages do open a 300 s window.
4. "First lap after a restart": the first green lap of each driver starting after the window end. If
   the lap right after the window is not green, the rule marks the next green lap.
5. Rules 5 and 6 are applied to both drivers' laps (the spec says "either driver" only for the
   green rule).
6. Non-event run: the 3 samples must have the same leader; a missing or non-numeric
   interval (leader, lapped) breaks the run. Samples are the follower's own rows, not a time grid.
7. A (pair, lap) that already has an event is not also a non-event (unit of analysis is the pair on
   a lap; the 30 s rule alone would allow both). The "next 30 s" rule is measured from the
   candidate sample. Among several qualifying candidates in one pair-lap, the first passing all
   rules is kept.
8. Control-line interval: taken at the start of the event lap (end of the previous lap), latest
   sample at or before it, with no staleness limit.
9. `pace_delta` uses up to 3 previous green laps per driver and needs at least 1 for each; NaN otherwise.
10. Rows with no lap at t (before the first lap start) count as not green.
11. Removal counts are attributed to the first rule hit in the order chequered, neutral window,
    pit, penalty, lap 1, restart lap, not green, (duplicate / pass within 30 s / pair-lap event).
    Rules overlap, so the per-rule counts depend on this order; the events and non-events do not.

## Per-session accounting

Events (removed = first rule hit):

| session_key | circuit | session | raw_overtakes | -chequered | -neutral_window | -pit | -penalty | -lap1 | -restart_lap | -lap_not_green | -duplicate | events |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 11234 | Melbourne | Race | 299 | 0 | 0 | 39 | 2 | 182 | 0 | 31 | 5 | 40 |
| 11240 | Shanghai | Sprint | 175 | 0 | 25 | 0 | 2 | 70 | 8 | 51 | 0 | 19 |
| 11245 | Shanghai | Race | 279 | 0 | 23 | 43 | 1 | 102 | 14 | 49 | 3 | 44 |
| 11253 | Suzuka | Race | 218 | 0 | 19 | 48 | 0 | 32 | 13 | 72 | 1 | 33 |
| 11261 | Sakhir | Race | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 11269 | Jeddah | Race | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 11275 | Miami | Sprint | 72 | 2 | 0 | 4 | 0 | 34 | 0 | 2 | 4 | 26 |
| 11280 | Miami | Race | 267 | 2 | 12 | 62 | 0 | 87 | 5 | 26 | 7 | 66 |
| 11286 | Montreal | Sprint | 91 | 1 | 0 | 10 | 2 | 27 | 0 | 19 | 1 | 31 |
| 11291 | Montreal | Race | 243 | 0 | 0 | 91 | 1 | 49 | 0 | 53 | 2 | 47 |
| 11299 | Monte Carlo | Race | 132 | 4 | 12 | 42 | 2 | 36 | 3 | 29 | 0 | 4 |
| 11307 | Catalunya | Race | 296 | 0 | 0 | 169 | 0 | 52 | 0 | 44 | 1 | 30 |
| 11315 | Spielberg | Race | 242 | 0 | 0 | 128 | 0 | 35 | 0 | 19 | 7 | 53 |
| 11321 | Silverstone | Sprint | 94 | 0 | 0 | 0 | 0 | 52 | 0 | 5 | 1 | 36 |
| 11326 | Silverstone | Race | 232 | 6 | 20 | 74 | 1 | 51 | 0 | 30 | 1 | 49 |
| 11334 | Spa-Francorchamps | Race | 214 | 0 | 25 | 73 | 0 | 46 | 13 | 3 | 0 | 54 |
| 11348 | Zandvoort | Sprint | 22 | 0 | 0 | 0 | 0 | 10 | 0 | 1 | 2 | 9 |
| 11353 | Zandvoort | Race | 292 | 0 | 0 | 148 | 14 | 57 | 3 | 38 | 0 | 32 |
| 11361 | Monza | Race | 334 | 0 | 1 | 20 | 0 | 45 | 14 | 133 | 9 | 112 |
| 11369 | Madring | Race | 123 | 0 | 0 | 42 | 0 | 30 | 0 | 38 | 0 | 13 |
| 11377 | Baku | Race | 160 | 1 | 11 | 1 | 0 | 18 | 3 | 75 | 2 | 49 |
| 11383 | Singapore | Sprint | 94 | 0 | 22 | 1 | 0 | 45 | 1 | 20 | 1 | 4 |
| 11388 | Singapore | Race | 191 | 1 | 0 | 94 | 0 | 40 | 0 | 20 | 1 | 35 |
| 11731 | Kuala Lumpur | Race | 505 | 0 | 39 | 228 | 0 | 16 | 21 | 156 | 1 | 44 |
| total |  |  | 4575 | 17 | 209 | 1317 | 25 | 1116 | 98 | 914 | 49 | 830 |

Non-events ("candidates" = pair-laps with a qualifying run of close samples):

| session_key | circuit | session | ne_candidates | -chequered | -neutral_window | -pit | -penalty | -lap1 | -restart_lap | -lap_not_green | -pass_within_30s | -pair_lap_is_event | non_events |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 11234 | Melbourne | Race | 294 | 1 | 0 | 7 | 0 | 42 | 0 | 22 | 15 | 43 | 164 |
| 11240 | Shanghai | Sprint | 364 | 0 | 16 | 0 | 12 | 44 | 32 | 160 | 8 | 24 | 68 |
| 11245 | Shanghai | Race | 455 | 0 | 21 | 10 | 1 | 32 | 43 | 152 | 23 | 44 | 129 |
| 11253 | Suzuka | Race | 566 | 1 | 49 | 8 | 0 | 30 | 35 | 135 | 17 | 33 | 258 |
| 11261 | Sakhir | Race | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 11269 | Jeddah | Race | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 11275 | Miami | Sprint | 216 | 5 | 0 | 0 | 0 | 31 | 0 | 9 | 6 | 31 | 134 |
| 11280 | Miami | Race | 418 | 3 | 41 | 15 | 0 | 34 | 24 | 36 | 20 | 72 | 173 |
| 11286 | Montreal | Sprint | 259 | 1 | 0 | 1 | 5 | 22 | 0 | 5 | 4 | 30 | 191 |
| 11291 | Montreal | Race | 270 | 0 | 0 | 8 | 2 | 23 | 0 | 35 | 11 | 52 | 139 |
| 11299 | Monte Carlo | Race | 394 | 0 | 26 | 15 | 10 | 25 | 14 | 40 | 1 | 4 | 259 |
| 11307 | Catalunya | Race | 306 | 0 | 0 | 37 | 0 | 33 | 0 | 18 | 25 | 29 | 164 |
| 11315 | Spielberg | Race | 346 | 0 | 0 | 15 | 3 | 40 | 0 | 24 | 29 | 41 | 194 |
| 11321 | Silverstone | Sprint | 218 | 2 | 0 | 0 | 0 | 43 | 0 | 12 | 10 | 36 | 115 |
| 11326 | Silverstone | Race | 346 | 1 | 32 | 18 | 6 | 38 | 0 | 26 | 20 | 53 | 152 |
| 11334 | Spa-Francorchamps | Race | 410 | 0 | 29 | 14 | 4 | 37 | 33 | 27 | 33 | 44 | 189 |
| 11348 | Zandvoort | Sprint | 240 | 0 | 0 | 0 | 0 | 20 | 0 | 6 | 3 | 9 | 202 |
| 11353 | Zandvoort | Race | 464 | 1 | 0 | 23 | 13 | 35 | 24 | 78 | 18 | 36 | 236 |
| 11361 | Monza | Race | 530 | 1 | 4 | 6 | 0 | 39 | 29 | 100 | 69 | 72 | 210 |
| 11369 | Madring | Race | 301 | 0 | 0 | 8 | 3 | 28 | 0 | 27 | 7 | 12 | 216 |
| 11377 | Baku | Race | 476 | 3 | 38 | 0 | 0 | 26 | 18 | 46 | 13 | 39 | 293 |
| 11383 | Singapore | Sprint | 139 | 2 | 18 | 0 | 0 | 29 | 15 | 28 | 1 | 2 | 44 |
| 11388 | Singapore | Race | 326 | 1 | 0 | 10 | 0 | 24 | 0 | 28 | 6 | 47 | 210 |
| 11731 | Kuala Lumpur | Race | 483 | 1 | 48 | 9 | 2 | 6 | 63 | 136 | 24 | 45 | 149 |
| total |  |  | 7821 | 23 | 322 | 204 | 61 | 681 | 330 | 1150 | 363 | 798 | 3889 |

## Totals against the HYPOTHESIS minimums

| | count | minimum | met |
|---|---|---|---|
| events | 830 | 150 | yes |
| non-events | 3889 | 300 | yes |

Counts are from the committed code and the database as of this run; they say nothing about the effect.
