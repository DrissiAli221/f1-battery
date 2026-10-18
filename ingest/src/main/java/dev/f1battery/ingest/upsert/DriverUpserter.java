package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.DriverRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class DriverUpserter extends BatchUpserter<DriverRecord> {

    public DriverUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public DriverUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "driver",
                List.of("session_key", "driver_number", "name_acronym", "full_name", "team_name"),
                "session_key, driver_number", List.of("name_acronym", "full_name", "team_name"), Set.of(), batchSize);
    }

    @Override
    List<Object> key(DriverRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber());
    }

    @Override
    Object[] values(DriverRecord r) {
        return new Object[] {r.sessionKey(), r.driverNumber(), r.nameAcronym(), r.fullName(), r.teamName()};
    }
}
