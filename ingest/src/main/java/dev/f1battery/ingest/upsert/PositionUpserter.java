package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.PositionRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class PositionUpserter extends BatchUpserter<PositionRecord> {

    public PositionUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public PositionUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "position",
                List.of("session_key", "driver_number", "date", "position"),
                "session_key, driver_number, date", List.of("position"), Set.of(), batchSize);
    }

    @Override
    List<Object> key(PositionRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber(), instant(r.date()));
    }

    @Override
    Object[] values(PositionRecord r) {
        return new Object[] {r.sessionKey(), r.driverNumber(), r.date(), r.position()};
    }
}
