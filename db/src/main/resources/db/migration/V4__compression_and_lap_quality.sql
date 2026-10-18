-- Phase 2 (docs/phase2-alignment.md).

-- Telemetry dominates the database size. Segmenting by (session_key,
-- driver_number) keeps one driver's samples together, which is also the access
-- pattern of the model (one driver at a time, ordered by ts).
ALTER TABLE car_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'session_key, driver_number',
    timescaledb.compress_orderby = 'ts'
);
ALTER TABLE location SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'session_key, driver_number',
    timescaledb.compress_orderby = 'ts'
);
SELECT add_compression_policy('car_data', INTERVAL '1 day', if_not_exists => true);
SELECT add_compression_policy('location', INTERVAL '1 day', if_not_exists => true);

-- Per-lap alignment verdict written by the model (f1battery_model.quality).
-- One row per lap of every driver; `green` is the conjunction of the rule
-- flags and `reason` names the first rule that excluded the lap.
CREATE TABLE lap_quality (
    session_key   int     NOT NULL,
    driver_number int     NOT NULL,
    lap_number    int     NOT NULL,
    green         boolean NOT NULL,
    reason        text,
    n_samples     int,
    lap_length_m  real,
    max_gap_s     real,
    neutralised   boolean,
    pit           boolean,
    out_lap       boolean,
    no_start      boolean,
    PRIMARY KEY (session_key, driver_number, lap_number)
);

-- Straight sections per circuit, as fractions of the lap (0-100 %) from the
-- curated sections files in data/reference/tracinginsights.
CREATE TABLE straight (
    circuit_key  int      NOT NULL,
    straight_id  smallint NOT NULL,
    start_pct    real     NOT NULL,
    end_pct      real     NOT NULL,
    label        text,
    PRIMARY KEY (circuit_key, straight_id)
);
