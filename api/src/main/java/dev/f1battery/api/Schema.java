package dev.f1battery.api;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Small lookups shared by controllers. Some tables (lap_quality, straight) are written by
 * other phases and may not exist yet, so the API probes for them instead of failing.
 */
@Component
public class Schema {

    private final JdbcTemplate jdbc;

    public Schema(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean tableExists(String name) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select to_regclass(?) is not null", Boolean.class, name));
    }

    public boolean sessionExists(int key) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject("select exists(select 1 from session where session_key = ?)", Boolean.class, key));
    }

    public void requireSession(int key) {
        if (!sessionExists(key)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown session " + key);
        }
    }

    /** True when lap_quality exists and has at least one row for the session. */
    public boolean hasLapQuality(int sessionKey) {
        return tableExists("lap_quality")
                && Boolean.TRUE.equals(jdbc.queryForObject(
                        "select exists(select 1 from lap_quality where session_key = ?)", Boolean.class, sessionKey));
    }
}
