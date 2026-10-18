package dev.f1battery.api;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Builds the track outline for a circuit from a single reference lap. This is the only
 * code path that reads {@code location}; it returns one downsampled lap, never raw samples
 * (DECISIONS.md D9). Outlines are immutable once built, so they are cached per circuit.
 */
@Service
public class OutlineService {

    private final JdbcTemplate jdbc;
    private final Schema schema;
    private final double spacing;
    private final Map<Integer, Map<String, Object>> cache = new ConcurrentHashMap<>();

    public OutlineService(
            JdbcTemplate jdbc, Schema schema, @Value("${api.outline.spacing-units:500}") double spacing) {
        this.jdbc = jdbc;
        this.schema = schema;
        this.spacing = spacing;
    }

    public Optional<Map<String, Object>> outline(int circuitKey) {
        Map<String, Object> cached = cache.get(circuitKey);
        if (cached != null) {
            return Optional.of(cached);
        }
        Optional<Map<String, Object>> built = build(circuitKey);
        built.filter(o -> !((List<?>) o.get("points")).isEmpty()).ifPresent(o -> cache.put(circuitKey, o));
        return built;
    }

    private Optional<Map<String, Object>> build(int circuitKey) {
        List<Integer> sessions = jdbc.queryForList(
                "select session_key from session where circuit_key = ? and session_name = 'Race' "
                        + "order by date_start limit 1",
                Integer.class,
                circuitKey);
        if (sessions.isEmpty()) {
            return Optional.empty();
        }
        int sessionKey = sessions.get(0);

        String base = "select l.driver_number, l.lap_number, l.date_start, l.lap_duration from lap l ";
        String where = "where l.session_key = ? and l.lap_duration is not null and l.date_start is not null "
                + "and coalesce(l.is_pit_out_lap, false) = false ";
        String order = "order by l.lap_duration limit 1";
        List<Map<String, Object>> laps = List.of();
        if (schema.hasLapQuality(sessionKey)) {
            laps = jdbc.query(
                    base + "join lap_quality q using (session_key, driver_number, lap_number) "
                            + where + "and q.green = true " + order,
                    Rows.MAP,
                    sessionKey);
        }
        if (laps.isEmpty()) {
            laps = jdbc.query(base + where + order, Rows.MAP, sessionKey);
        }
        if (laps.isEmpty()) {
            return Optional.empty();
        }
        Map<String, Object> lap = laps.get(0);
        int driver = ((Number) lap.get("driver_number")).intValue();
        Instant start = (Instant) lap.get("date_start");
        double duration = ((Number) lap.get("lap_duration")).doubleValue();
        Instant end = start.plusMillis(Math.round(duration * 1000));

        List<Downsampler.Sample> samples = jdbc.query(
                "select x, y, z from location where session_key = ? and driver_number = ? "
                        + "and ts >= ? and ts <= ? and x is not null and y is not null order by ts",
                (rs, i) -> new Downsampler.Sample(rs.getDouble(1), rs.getDouble(2), rs.getDouble(3)),
                sessionKey,
                driver,
                java.sql.Timestamp.from(start),
                java.sql.Timestamp.from(end));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("session_key", sessionKey);
        body.put("driver_number", driver);
        body.put("lap_number", lap.get("lap_number"));
        body.put("points", Downsampler.downsample(samples, spacing));
        return Optional.of(body);
    }
}
