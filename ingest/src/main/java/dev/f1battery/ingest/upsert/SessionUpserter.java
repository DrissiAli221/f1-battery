package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.SessionRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

public class SessionUpserter extends BatchUpserter<SessionRecord> {

    public SessionUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public SessionUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "session",
                List.of("session_key", "meeting_key", "circuit_key", "session_name", "session_type", "country_name", "circuit_short_name", "date_start", "date_end", "year"),
                "session_key", List.of("meeting_key", "circuit_key", "session_name", "session_type", "country_name", "circuit_short_name", "date_start", "date_end", "year"), Set.of(), batchSize);
    }

    @Override
    List<Object> key(SessionRecord r) {
        return java.util.Arrays.asList(r.sessionKey());
    }

    @Override
    Object[] values(SessionRecord r) {
        return new Object[] {r.sessionKey(), r.meetingKey(), r.circuitKey(), r.sessionName(), r.sessionType(), r.countryName(), r.circuitShortName(), r.dateStart(), r.dateEnd(), r.year()};
    }
}
