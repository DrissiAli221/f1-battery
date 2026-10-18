package dev.f1battery.ingest.source;

import dev.f1battery.ingest.source.OpenF1Records.*;

/**
 * An OpenF1 endpoint and the record type its rows parse to. {@code name} is the
 * API path segment, the backup file stem and the ingestion_log endpoint value.
 * {@code perDriver} endpoints (high-rate telemetry) are fetched one driver and
 * one time window at a time; the rest are fetched once per session.
 */
public record Endpoint<T>(String name, Class<T> type, boolean perDriver) {

    public static final Endpoint<SessionRecord> SESSIONS = new Endpoint<>("sessions", SessionRecord.class, false);
    public static final Endpoint<DriverRecord> DRIVERS = new Endpoint<>("drivers", DriverRecord.class, false);
    public static final Endpoint<LapRecord> LAPS = new Endpoint<>("laps", LapRecord.class, false);
    public static final Endpoint<StintRecord> STINTS = new Endpoint<>("stints", StintRecord.class, false);
    public static final Endpoint<PitRecord> PIT = new Endpoint<>("pit", PitRecord.class, false);
    public static final Endpoint<OvertakeRecord> OVERTAKES = new Endpoint<>("overtakes", OvertakeRecord.class, false);
    public static final Endpoint<RaceControlRecord> RACE_CONTROL = new Endpoint<>("race_control", RaceControlRecord.class, false);
    public static final Endpoint<IntervalRecord> INTERVALS = new Endpoint<>("intervals", IntervalRecord.class, false);
    public static final Endpoint<PositionRecord> POSITION = new Endpoint<>("position", PositionRecord.class, false);
    public static final Endpoint<WeatherRecord> WEATHER = new Endpoint<>("weather", WeatherRecord.class, false);
    public static final Endpoint<SessionResultRecord> SESSION_RESULT = new Endpoint<>("session_result", SessionResultRecord.class, false);
    public static final Endpoint<StartingGridRecord> STARTING_GRID = new Endpoint<>("starting_grid", StartingGridRecord.class, false);
    public static final Endpoint<TeamRadioRecord> TEAM_RADIO = new Endpoint<>("team_radio", TeamRadioRecord.class, false);
    public static final Endpoint<CarDataRecord> CAR_DATA = new Endpoint<>("car_data", CarDataRecord.class, true);
    public static final Endpoint<LocationRecord> LOCATION = new Endpoint<>("location", LocationRecord.class, true);
}
