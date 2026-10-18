package dev.f1battery.ingest.upsert;

import com.fasterxml.jackson.databind.JsonNode;
import dev.f1battery.ingest.source.OpenF1Records.SessionResultRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * duration and gap_to_leader are a scalar in races and a [Q1, Q2, Q3] array in
 * qualifying, stored as jsonb. position is an integer, null or a status code
 * such as "RT" (kept in position_label).
 */
public class SessionResultUpserter extends BatchUpserter<SessionResultRecord> {

    public SessionResultUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public SessionResultUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "session_result",
                List.of("session_key", "driver_number", "position", "position_label", "number_of_laps",
                        "points", "dnf", "dns", "dsq", "duration", "gap_to_leader"),
                "session_key, driver_number",
                List.of("position", "position_label", "number_of_laps", "points", "dnf", "dns", "dsq",
                        "duration", "gap_to_leader"),
                Set.of("duration", "gap_to_leader"), batchSize);
    }

    @Override
    List<Object> key(SessionResultRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber());
    }

    @Override
    Object[] values(SessionResultRecord r) {
        Integer position = r.position() instanceof Number n ? Integer.valueOf(n.intValue()) : null;
        String label = r.position() instanceof String s ? s : null;
        return new Object[] {r.sessionKey(), r.driverNumber(), position, label, r.numberOfLaps(), r.points(),
                r.dnf(), r.dns(), r.dsq(), json(r.duration()), json(r.gapToLeader())};
    }

    private static String json(JsonNode n) {
        return n == null || n.isNull() || n.isMissingNode() ? null : n.toString();
    }
}
