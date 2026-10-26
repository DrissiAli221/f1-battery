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

    /** Team colour as stored by OpenF1 (six hex digits) exposed as {@code #RRGGBB}; null stays null. */
    static final String TEAM_COLOUR =
            "case when team_colour is null then null else '#' || upper(team_colour) end as team_colour";
    /** Driver detail columns for /drivers. Image URLs are passed through; images are never proxied. */
    static final String DRIVER_DETAILS =
            "headshot_url, " + TEAM_COLOUR + ", first_name, last_name, broadcast_name, country_code";
    /** Subset used by the summary rows, qualified for the aliased table {@code d}. */
    static final String DRIVER_DETAILS_D =
            "d.headshot_url, case when d.team_colour is null then null else '#' || upper(d.team_colour) end as team_colour";

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
