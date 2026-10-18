package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.OvertakeRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class OvertakeUpserter extends BatchUpserter<OvertakeRecord> {

    public OvertakeUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public OvertakeUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "overtake",
                List.of("session_key", "date", "overtaking_driver_number", "overtaken_driver_number", "position"),
                "session_key, date, overtaking_driver_number, overtaken_driver_number", List.of("position"), Set.of(), batchSize);
    }

    @Override
    List<Object> key(OvertakeRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), instant(r.date()), r.overtakingDriverNumber(), r.overtakenDriverNumber());
    }

    @Override
    Object[] values(OvertakeRecord r) {
        return new Object[] {r.sessionKey(), r.date(), r.overtakingDriverNumber(), r.overtakenDriverNumber(), r.position()};
    }
}
