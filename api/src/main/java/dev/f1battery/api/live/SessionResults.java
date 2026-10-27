package dev.f1battery.api.live;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Whether a session has model results, i.e. is selectable on the site and therefore worth replaying. */
@Component
@ConditionalOnProperty(name = "api.replay.enabled", havingValue = "true")
public class SessionResults {

    private final JdbcTemplate jdbc;

    public SessionResults(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean has(int sessionKey) {
        Boolean b = jdbc.queryForObject(
                "select exists (select 1 from model_result where session_key = ?)", Boolean.class, sessionKey);
        return Boolean.TRUE.equals(b);
    }
}
