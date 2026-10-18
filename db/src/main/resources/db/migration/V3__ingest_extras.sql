-- Phase 1 additions (docs/phase1-ingestion.md).

-- OpenF1 reports lapped cars as text ("+1 LAP") in gap_to_leader and,
-- rarely, interval. The numeric columns stay numeric; the text form is kept
-- beside them so the information is not lost.
ALTER TABLE interval_sample
    ADD COLUMN gap_to_leader_text text,
    ADD COLUMN interval_text      text;

-- OpenF1 /session_result. position is null for non-classified entries and a
-- non-numeric code (e.g. 'RT') once in 2026, hence position_label.
-- duration and gap_to_leader are a scalar in race/sprint sessions and a
-- three-element array (Q1, Q2, Q3) in qualifying, so they are kept as jsonb.
CREATE TABLE session_result (
    session_key    int NOT NULL,
    driver_number  int NOT NULL,
    position       int,
    position_label text,
    number_of_laps int,
    points         real,
    dnf            boolean,
    dns            boolean,
    dsq            boolean,
    duration       jsonb,
    gap_to_leader  jsonb,
    PRIMARY KEY (session_key, driver_number)
);

-- OpenF1 /starting_grid. Empty for race sessions; the grid is read from the
-- qualifying session of the same meeting (docs/data-quality-notes.md).
CREATE TABLE starting_grid (
    session_key   int NOT NULL,
    driver_number int NOT NULL,
    position      int,
    lap_duration  double precision,
    PRIMARY KEY (session_key, driver_number)
);

-- OpenF1 /team_radio. Metadata only; audio is never downloaded.
CREATE TABLE team_radio (
    session_key    int NOT NULL,
    driver_number  int NOT NULL,
    date           timestamptz NOT NULL,
    recording_url  text,
    PRIMARY KEY (session_key, driver_number, date)
);

-- Telemetry windows of different sizes can share a start (a whole-session
-- fetch and a windowed re-fetch of the same driver), so the window label is
-- part of the ingestion_log key. Session-wide units use the label 'session'.
ALTER TABLE ingestion_log ADD COLUMN window_label text NOT NULL DEFAULT 'session';
DROP INDEX ingestion_log_uq;
CREATE UNIQUE INDEX ingestion_log_uq
    ON ingestion_log (endpoint, session_key, (coalesce(driver_number, -1)), window_start, window_label);
