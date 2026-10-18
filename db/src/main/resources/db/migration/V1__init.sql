CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE session (
    session_key   int PRIMARY KEY,
    meeting_key   int NOT NULL,
    circuit_key   int,
    session_name  text NOT NULL,
    session_type  text,
    country_name  text,
    circuit_short_name text,
    date_start    timestamptz,
    date_end      timestamptz,
    year          smallint
);

CREATE TABLE driver (
    session_key   int NOT NULL REFERENCES session (session_key),
    driver_number int NOT NULL,
    name_acronym  text,
    full_name     text,
    team_name     text,
    PRIMARY KEY (session_key, driver_number)
);

CREATE TABLE lap (
    session_key    int NOT NULL,
    driver_number  int NOT NULL,
    lap_number     int NOT NULL,
    date_start     timestamptz,
    lap_duration   double precision,
    duration_sector_1 double precision,
    duration_sector_2 double precision,
    duration_sector_3 double precision,
    is_pit_out_lap boolean,
    i1_speed       int,
    i2_speed       int,
    st_speed       int,
    PRIMARY KEY (session_key, driver_number, lap_number)
);

CREATE TABLE stint (
    session_key     int NOT NULL,
    driver_number   int NOT NULL,
    stint_number    int NOT NULL,
    lap_start       int,
    lap_end         int,
    compound        text,
    tyre_age_at_start int,
    PRIMARY KEY (session_key, driver_number, stint_number)
);

CREATE TABLE pit (
    session_key   int NOT NULL,
    driver_number int NOT NULL,
    lap_number    int NOT NULL,
    date          timestamptz,
    pit_duration  double precision,
    PRIMARY KEY (session_key, driver_number, lap_number)
);

CREATE TABLE overtake (
    session_key               int NOT NULL,
    date                      timestamptz NOT NULL,
    overtaking_driver_number  int NOT NULL,
    overtaken_driver_number   int NOT NULL,
    position                  int,
    PRIMARY KEY (session_key, date, overtaking_driver_number, overtaken_driver_number)
);

CREATE TABLE race_control (
    session_key   int NOT NULL,
    date          timestamptz NOT NULL,
    driver_number int,
    lap_number    int,
    category      text,
    flag          text,
    scope         text,
    sector        int,
    message       text
);
CREATE UNIQUE INDEX race_control_uq
    ON race_control (session_key, date, md5(coalesce(message, '')), coalesce(driver_number, -1));

CREATE TABLE interval_sample (
    session_key   int NOT NULL,
    driver_number int NOT NULL,
    date          timestamptz NOT NULL,
    gap_to_leader double precision,
    interval      double precision,
    PRIMARY KEY (session_key, driver_number, date)
);

-- OpenF1 /position: position changes (sparse), used with overtakes and intervals.
CREATE TABLE position (
    session_key   int NOT NULL,
    driver_number int NOT NULL,
    date          timestamptz NOT NULL,
    position      int NOT NULL,
    PRIMARY KEY (session_key, driver_number, date)
);

-- OpenF1 /weather: per-minute; wind feeds the drag baseline (DECISIONS.md D11).
CREATE TABLE weather (
    session_key        int NOT NULL,
    date               timestamptz NOT NULL,
    air_temperature    real,
    track_temperature  real,
    humidity           real,
    pressure           real,
    rainfall           smallint,
    wind_direction     smallint,
    wind_speed         real,
    PRIMARY KEY (session_key, date)
);

CREATE TABLE car_data (
    ts            timestamptz NOT NULL,
    session_key   int NOT NULL,
    driver_number int NOT NULL,
    speed         smallint,
    throttle      smallint,
    brake         smallint,
    rpm           int,
    n_gear        smallint,
    drs           smallint
);
SELECT create_hypertable('car_data', 'ts', chunk_time_interval => interval '1 day');
CREATE UNIQUE INDEX car_data_uq ON car_data (session_key, driver_number, ts);

CREATE TABLE location (
    ts            timestamptz NOT NULL,
    session_key   int NOT NULL,
    driver_number int NOT NULL,
    x             int,
    y             int,
    z             int
);
SELECT create_hypertable('location', 'ts', chunk_time_interval => interval '1 day');
CREATE UNIQUE INDEX location_uq ON location (session_key, driver_number, ts);

CREATE TABLE ingestion_log (
    endpoint      text NOT NULL,
    session_key   int NOT NULL,
    driver_number int,
    window_start  timestamptz NOT NULL,
    window_end    timestamptz NOT NULL,
    source        text NOT NULL CHECK (source IN ('api', 'local')),
    row_count     int NOT NULL,
    fetched_at    timestamptz NOT NULL DEFAULT now(),
    status        text NOT NULL
);
-- driver_number is nullable and NULLs are distinct in a plain unique index,
-- so key on coalesce(driver_number, -1) to make the key effective.
CREATE UNIQUE INDEX ingestion_log_uq
    ON ingestion_log (endpoint, session_key, (coalesce(driver_number, -1)), window_start);

-- The only interface from Python to Java (DECISIONS.md D4).
CREATE TABLE model_result (
    model_version text NOT NULL,
    run_id        uuid NOT NULL,
    session_key   int NOT NULL,
    driver_number int NOT NULL,
    lap_number    int NOT NULL,
    straight_id   smallint,
    variable      text NOT NULL,
    value         double precision,
    ci_low        double precision,
    ci_high       double precision,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_result_idx ON model_result (model_version, session_key, driver_number);
-- A model re-run with the same run_id must be idempotent (same rule as ingestion).
CREATE UNIQUE INDEX model_result_uq
    ON model_result (model_version, run_id, session_key, driver_number, lap_number, (coalesce(straight_id, -1)), variable);
