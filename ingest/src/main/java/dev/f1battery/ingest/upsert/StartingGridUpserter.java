package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.StartingGridRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class StartingGridUpserter extends BatchUpserter<StartingGridRecord> {

    public StartingGridUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public StartingGridUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "starting_grid",
                List.of("session_key", "driver_number", "position", "lap_duration"),
                "session_key, driver_number", List.of("position", "lap_duration"), Set.of(), batchSize);
    }

    @Override
    List<Object> key(StartingGridRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber());
    }

    @Override
    Object[] values(StartingGridRecord r) {
        return new Object[] {r.sessionKey(), r.driverNumber(), r.position(), r.lapDuration()};
    }
}
