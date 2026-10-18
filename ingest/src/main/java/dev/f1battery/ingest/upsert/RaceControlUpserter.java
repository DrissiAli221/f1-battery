package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.RaceControlRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * race_control has no natural primary key: several messages can share a
 * timestamp. The unique index is (session, date, md5(message), driver or -1)
 * (V1), and the in-memory key mirrors it exactly.
 */
public class RaceControlUpserter extends BatchUpserter<RaceControlRecord> {

    public RaceControlUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public RaceControlUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "race_control",
                List.of("session_key", "date", "driver_number", "lap_number", "category", "flag", "scope",
                        "sector", "message"),
                "session_key, date, md5(coalesce(message, '')), coalesce(driver_number, -1)",
                List.of(), Set.of(), batchSize);
    }

    @Override
    List<Object> key(RaceControlRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), instant(r.date()),
                r.message() == null ? "" : r.message(), r.driverNumber() == null ? -1 : r.driverNumber());
    }

    @Override
    Object[] values(RaceControlRecord r) {
        return new Object[] {r.sessionKey(), r.date(), r.driverNumber(), r.lapNumber(), r.category(),
                r.flag(), r.scope(), r.sector(), r.message()};
    }
}
