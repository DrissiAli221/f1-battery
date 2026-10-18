package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.StintRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class StintUpserter extends BatchUpserter<StintRecord> {

    public StintUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public StintUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "stint",
                List.of("session_key", "driver_number", "stint_number", "lap_start", "lap_end", "compound", "tyre_age_at_start"),
                "session_key, driver_number, stint_number", List.of("lap_start", "lap_end", "compound", "tyre_age_at_start"), Set.of(), batchSize);
    }

    @Override
    List<Object> key(StintRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber(), r.stintNumber());
    }

    @Override
    Object[] values(StintRecord r) {
        return new Object[] {r.sessionKey(), r.driverNumber(), r.stintNumber(), r.lapStart(), r.lapEnd(), r.compound(), r.tyreAgeAtStart()};
    }
}
