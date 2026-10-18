package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.TeamRadioRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class TeamRadioUpserter extends BatchUpserter<TeamRadioRecord> {

    public TeamRadioUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public TeamRadioUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "team_radio",
                List.of("session_key", "driver_number", "date", "recording_url"),
                "session_key, driver_number, date", List.of("recording_url"), Set.of(), batchSize);
    }

    @Override
    List<Object> key(TeamRadioRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber(), instant(r.date()));
    }

    @Override
    Object[] values(TeamRadioRecord r) {
        return new Object[] {r.sessionKey(), r.driverNumber(), r.date(), r.recordingUrl()};
    }
}
