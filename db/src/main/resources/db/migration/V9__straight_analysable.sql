-- Whether a straight is long enough for the cut-off detector to work on it at all.
-- The detector needs a full-throttle run of at least 4 s (derate.MIN_RUN_S), about 250 m
-- at 225 kph (straights.MIN_ANALYSABLE_M). Curated section files label every full-throttle
-- stretch "Straight", including ones of 120-250 m that can never produce a cut-off; the
-- view uses this flag to tell "never has a cut-off" from "no data yet". NULL = unknown
-- (no measured lap length for the circuit). straights.py sets it on every load; this
-- backfill gives existing rows a value with the same rule.
ALTER TABLE straight ADD COLUMN analysable boolean;

UPDATE straight st
SET analysable = (
    (CASE WHEN st.end_pct < st.start_pct THEN st.end_pct + 100 - st.start_pct
          ELSE st.end_pct - st.start_pct END) / 100.0 * m.lap_m >= 250.0)
FROM (
    SELECT s.circuit_key, percentile_cont(0.5) WITHIN GROUP (ORDER BY q.lap_length_m) AS lap_m
    FROM lap_quality q JOIN session s USING (session_key)
    WHERE q.green AND q.lap_length_m IS NOT NULL
    GROUP BY s.circuit_key
) m
WHERE m.circuit_key = st.circuit_key;
