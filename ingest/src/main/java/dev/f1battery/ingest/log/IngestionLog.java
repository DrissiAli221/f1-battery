package dev.f1battery.ingest.log;

import java.time.OffsetDateTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The ingestion_log table: one row per fetch unit. It is what makes a run
 * resumable. The unique key is (endpoint, session, coalesce(driver, -1),
 * window_start, window_label), so recording the same unit again updates its row.
 */
@Repository
public class IngestionLog {

    public static final String COMPLETE = "complete";
    public static final String FAILED = "failed";
    public static final String NO_DATA = "no_data";

    /** Identity of a fetch unit. driverNumber is null for session-wide endpoints. */
    public record Unit(String endpoint, int sessionKey, Integer driverNumber,
            OffsetDateTime windowStart, OffsetDateTime windowEnd, String windowLabel) {
        public static final String SESSION = "session";
    }

    private final JdbcTemplate jdbc;

    public IngestionLog(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** True if the unit was fetched and stored. Failed and empty units are retried. */
    public boolean isComplete(Unit u) {
        Boolean found = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM ingestion_log
                 WHERE endpoint = ? AND session_key = ? AND coalesce(driver_number, -1) = ?
                   AND window_start = ? AND window_label = ? AND status = 'complete')
                """, Boolean.class, u.endpoint(), u.sessionKey(),
                u.driverNumber() == null ? -1 : u.driverNumber(), u.windowStart(), u.windowLabel());
        return Boolean.TRUE.equals(found);
    }

    public void record(Unit u, String source, int rowCount, String status) {
        jdbc.update("""
                INSERT INTO ingestion_log (endpoint, session_key, driver_number, window_start, window_end, window_label,
                                           source, row_count, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (endpoint, session_key, (coalesce(driver_number, -1)), window_start, window_label)
                DO UPDATE SET window_end = EXCLUDED.window_end, source = EXCLUDED.source,
                              row_count = EXCLUDED.row_count, status = EXCLUDED.status, fetched_at = now()
                """, u.endpoint(), u.sessionKey(), u.driverNumber(), u.windowStart(), u.windowEnd(), u.windowLabel(),
                source, rowCount, status);
    }
}
