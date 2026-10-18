package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.PitRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class PitUpserter extends BatchUpserter<PitRecord> {

    public PitUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public PitUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "pit",
                List.of("session_key", "driver_number", "lap_number", "date", "pit_duration"),
                "session_key, driver_number, lap_number", List.of("date", "pit_duration"), Set.of(), batchSize);
    }

    @Override
    List<Object> key(PitRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber(), r.lapNumber());
    }

    @Override
    Object[] values(PitRecord r) {
        return new Object[] {r.sessionKey(), r.driverNumber(), r.lapNumber(), r.date(), r.pitDuration()};
    }
}
