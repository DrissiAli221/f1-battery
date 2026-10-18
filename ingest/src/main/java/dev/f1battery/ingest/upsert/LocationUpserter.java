package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.LocationRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class LocationUpserter extends BatchUpserter<LocationRecord> {

    public LocationUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public LocationUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "location",
                List.of("ts", "session_key", "driver_number", "x", "y", "z"),
                "session_key, driver_number, ts", List.of(), Set.of(), batchSize);
    }

    @Override
    List<Object> key(LocationRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber(), instant(r.date()));
    }

    @Override
    Object[] values(LocationRecord r) {
        return new Object[] {r.date(), r.sessionKey(), r.driverNumber(), r.x(), r.y(), r.z()};
    }
}
