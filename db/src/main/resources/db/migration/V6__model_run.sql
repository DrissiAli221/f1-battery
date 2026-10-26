-- One row per model run. The model writes model_result rows under a run_id and marks the run
-- published only after every session of the run has been committed, so the API never serves a
-- partial run and a newer single-session run cannot hide a complete one (DECISIONS.md D23).
--
-- Contract with the model (estimate.py):
--   1. at start:  INSERT (model_version, run_id, started_at) with published = false;
--   2. while running: write model_result rows; optionally update sessions_done;
--   3. on full success: UPDATE finished_at = now(), published = true, in one statement;
--   4. on failure or a partial run (for example --session): leave published = false.
-- The API serves the published run with the latest finished_at, per model_version if one is asked for.
CREATE TABLE model_run (
    model_version text        NOT NULL,
    run_id        uuid        NOT NULL,
    started_at    timestamptz NOT NULL,
    finished_at   timestamptz,
    published     boolean     NOT NULL DEFAULT false,
    sessions_done int,
    note          text,
    PRIMARY KEY (model_version, run_id)
);

-- Resolution reads only published runs, newest first.
CREATE INDEX model_run_published_idx ON model_run (finished_at DESC) WHERE published;

-- Runs that already exist in model_result predate the table and are treated as published, so the
-- API keeps serving them after this migration.
INSERT INTO model_run (model_version, run_id, started_at, finished_at, published, sessions_done, note)
SELECT model_version, run_id, min(created_at), max(created_at), true, count(DISTINCT session_key),
       'backfilled by V6'
  FROM model_result
 GROUP BY model_version, run_id
ON CONFLICT DO NOTHING;
