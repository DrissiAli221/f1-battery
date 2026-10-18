package dev.f1battery.ingest.upsert;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** One upserter per table, constructed together. */
@Component
public class Upserters {

    public final SessionUpserter session;
    public final DriverUpserter driver;
    public final LapUpserter lap;
    public final StintUpserter stint;
    public final PitUpserter pit;
    public final OvertakeUpserter overtake;
    public final RaceControlUpserter raceControl;
    public final IntervalSampleUpserter interval;
    public final PositionUpserter position;
    public final WeatherUpserter weather;
    public final SessionResultUpserter sessionResult;
    public final StartingGridUpserter startingGrid;
    public final TeamRadioUpserter teamRadio;
    public final CarDataUpserter carData;
    public final LocationUpserter location;

    public Upserters(JdbcTemplate jdbc, MeterRegistry metrics) {
        this.session = new SessionUpserter(jdbc, metrics);
        this.driver = new DriverUpserter(jdbc, metrics);
        this.lap = new LapUpserter(jdbc, metrics);
        this.stint = new StintUpserter(jdbc, metrics);
        this.pit = new PitUpserter(jdbc, metrics);
        this.overtake = new OvertakeUpserter(jdbc, metrics);
        this.raceControl = new RaceControlUpserter(jdbc, metrics);
        this.interval = new IntervalSampleUpserter(jdbc, metrics);
        this.position = new PositionUpserter(jdbc, metrics);
        this.weather = new WeatherUpserter(jdbc, metrics);
        this.sessionResult = new SessionResultUpserter(jdbc, metrics);
        this.startingGrid = new StartingGridUpserter(jdbc, metrics);
        this.teamRadio = new TeamRadioUpserter(jdbc, metrics);
        this.carData = new CarDataUpserter(jdbc, metrics);
        this.location = new LocationUpserter(jdbc, metrics);
    }
}
