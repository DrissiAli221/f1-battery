# Data-quality notes (raw OpenF1, 2026)

Found during the raw backup. Feed-level facts, verified by direct API
probes, for the Phase 2 data-quality report.

| Session | Finding | Verified how | Consequence |
|---|---|---|---|
| Bahrain 11261, Jeddah 11269 | No data at all (404 on every endpoint) | Backup 2026-10-18 | Excluded; the Bahrain round ran at Kuala Lumpur as 11731 |
| Monaco 11299 | `location` has 1,802 samples per driver (identical for all 22), irregular, from 13:02:06 to 14:00:14 only, then nothing until the end of the race at 15:30. `car_data` is complete (33,448 per driver). A whole-window request equals the sum of split windows (1,747 + 55), so this is the feed, not truncation | Direct probes 2026-10-18 | No track-map or slope correction for Monaco after 14:00; distance from integrated speed only. Flag in the per-race quality report |
| All sessions so far | `starting_grid` returns 0 rows for 2026 races | Backup 2026-10-18 | Use `session_result` of the qualifying session instead |
| Most sessions | `team_radio` is 0 rows; Canada 33, Monaco 36 | Backup 2026-10-18 | Radio is not a usable validation source, as expected |
| All | `drs` is null on every 2026 sample | Spike cache 2026-10-17 | Column kept nullable, never used |
