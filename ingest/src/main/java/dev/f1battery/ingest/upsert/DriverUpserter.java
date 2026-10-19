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
                List.of("session_key", "driver_number", "name_acronym", "full_name", "team_name", "headshot_url",
                        "team_colour", "first_name", "last_name", "broadcast_name", "country_code"),
                "session_key, driver_number",
                // DO UPDATE (guarded by IS DISTINCT FROM) so re-ingesting fills the detail columns of rows
                // that were stored before they existed.
                List.of("name_acronym", "full_name", "team_name", "headshot_url", "team_colour", "first_name",
                        "last_name", "broadcast_name", "country_code"),
                Set.of(), batchSize);
    }

    @Override
    List<Object> key(DriverRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber());
    }

    @Override
    Object[] values(DriverRecord r) {
        return new Object[] {r.sessionKey(), r.driverNumber(), r.nameAcronym(), r.fullName(), r.teamName(),
                r.headshotUrl(), r.teamColour(), r.firstName(), r.lastName(), r.broadcastName(), r.countryCode()};
    }
}
