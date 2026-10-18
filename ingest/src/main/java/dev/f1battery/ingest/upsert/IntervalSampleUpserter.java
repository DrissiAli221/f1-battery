package dev.f1battery.ingest.upsert;

import dev.f1battery.ingest.source.OpenF1Records.IntervalRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * OpenF1 reports lapped cars as text ("+1 LAP"). Numeric values go to the
 * numeric columns, anything else to the *_text columns (V3).
 */
public class IntervalSampleUpserter extends BatchUpserter<IntervalRecord> {

    public IntervalSampleUpserter(JdbcTemplate jdbc, MeterRegistry metrics) {
        this(jdbc, metrics, BATCH_SIZE);
    }

    public IntervalSampleUpserter(JdbcTemplate jdbc, MeterRegistry metrics, int batchSize) {
        super(jdbc, metrics, "interval_sample",
                List.of("session_key", "driver_number", "date", "gap_to_leader", "interval",
                        "gap_to_leader_text", "interval_text"),
                "session_key, driver_number, date",
                List.of("gap_to_leader", "interval", "gap_to_leader_text", "interval_text"),
                Set.of(), batchSize);
    }

    @Override
    List<Object> key(IntervalRecord r) {
        return java.util.Arrays.asList(r.sessionKey(), r.driverNumber(), instant(r.date()));
    }

    @Override
    Object[] values(IntervalRecord r) {
        return new Object[] {r.sessionKey(), r.driverNumber(), r.date(),
                number(r.gapToLeader()), number(r.interval()), text(r.gapToLeader()), text(r.interval())};
    }

    private static Double number(Object v) {
        return v instanceof Number n ? n.doubleValue() : null;
    }

    private static String text(Object v) {
        return v == null || v instanceof Number ? null : v.toString();
    }
}
