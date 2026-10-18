-- Which clock produced the lap boundaries used for a lap: the `lap` table
-- ('laps') or start/finish-line crossings detected in `location`
-- ('telemetry'); see docs/phase2-alignment.md.
ALTER TABLE lap_quality ADD COLUMN boundary_source text;
UPDATE lap_quality SET boundary_source = 'laps';
-- A straight that crosses the start/finish line is stored with start_pct > end_pct.
COMMENT ON COLUMN straight.start_pct IS 'Percent of the lap; start_pct > end_pct means the straight wraps over the start/finish line.';
