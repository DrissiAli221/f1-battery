# Data-quality notes (raw OpenF1, 2026)

Found during the raw backup. Feed-level facts, verified by direct API
probes, for the Phase 2 data-quality report.

| Session | Finding | Verified how | Consequence |
|---|---|---|---|
| Bahrain 11261, Jeddah 11269 | No data at all (404 on every endpoint) | Backup 2026-10-18 | Excluded; the Bahrain round ran at Kuala Lumpur as 11731 |
| Monaco 11299 | `location` has 1,802 samples per driver (identical for all 22), irregular, from 13:02:06 to 14:00:14 only, then nothing until the end of the race at 15:30. `car_data` is complete (33,448 per driver). A whole-window request equals the sum of split windows (1,747 + 55), so this is the feed, not truncation | Direct probes 2026-10-18 | No track-map or slope correction for the Monaco race after 14:00; distance from integrated speed only. Monaco **qualifying** (11295) has full location coverage, so the gap is race-session specific. Flag in the per-race quality report |
| All races | `starting_grid` returns 0 rows on race sessions; it returns 22 rows on the qualifying session | Backup 2026-10-18 | Read the grid from the qualifying session of the same meeting |
| Most sessions | `team_radio` is 0 rows; Canada 33, Monaco 36 | Backup 2026-10-18 | Radio is not a usable validation source, as expected |
| All | `drs` is null on every 2026 sample | Spike cache 2026-10-17 | Column kept nullable, never used |
| All | `location` x, y, z are in **tenths of a metre**: a Monza lap's x/y path length is 57,330 units for a 5,793 m lap (chord sampling at ~3.7 Hz under-reads slightly) | psql on 11361 driver 63 lap 30, 2026-10-18 | Divide by 10 for metres; the API outline's 500-unit spacing is 50 m |
| Kuala Lumpur 11731 | The first backup cut car_data and location at 10:00 (scheduled end + 60 min) while the delayed race ran to 10:21; 185 laps were without samples | Phase 2 quality report, 2026-10-18; fixed the same day by capping the backup window on the last lap end only and refetching (car_data 885,984 → 993,652 rows) | None after the refetch. Lesson: cap fetch windows on observed lap times, not the schedule |
| 13 qualifying sessions | The last lap's recorded `lap_duration` is an in-lap of up to 31 min, which makes "last lap end" overshoot the telemetry by minutes | psql 2026-10-18 | Not missing data; never use the final in-lap's duration as a session end |
| Hungary 11342 | `lap`/`pit` timestamps sit 3–6 min before the matching speed=0 periods in car_data, with a non-constant offset; car_data itself has no gaps > 29 s and spans the session normally | psql 2026-10-18 | The laps clock is unreliable for this session: lap boundaries are derived from start-line crossings in `location` instead (Phase 2, `boundary_source = 'telemetry'`) |
