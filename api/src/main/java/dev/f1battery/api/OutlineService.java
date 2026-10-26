package dev.f1battery.api;

import java.time.Instant;
import java.util.HashMap;
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
 *
 * <p>The reference lap is the fastest green lap of the circuit (races first) that actually
 * draws the circuit. A fast lap is not enough on its own: the Monaco race feed stops an hour
 * before the end, so its fastest lap has no location rows at all, and the Hungaroring race
 * has a lap clock several minutes off a frozen feed, so its lap window is an open arc that
 * does not start at the line (docs/data-quality-notes.md, D17). Each candidate is therefore
 * checked before it is used: enough samples, a path length close to the circuit's measured
 * lap length, a ring that closes, and a first point close to where the session's other
 * green laps start (their median first sample). That last check catches one lap whose clock
 * is off; it cannot catch a session whose clock is off as a whole, since the reference is
 * the same session. The first candidate that passes is the outline; when none does, there
 * is no outline and the endpoint answers 404, and that answer is cached too.
 */
@Service
public class OutlineService {

    /** Fastest laps tried per session of the circuit (races first) before giving up. */
    static final int PER_SESSION = 8;
    /** A reference lap needs at least this many location samples (a lap has ~250-450). */
    static final int MIN_SAMPLES = 20;
    /** Raw path length must be within this fraction of the circuit's median green lap length. */
    static final double LENGTH_TOLERANCE = 0.03;
    /** The last sample must come back to within this distance of the first (the ring closes). */
    static final double CLOSING_GAP_M = 60.0;
    /** The first sample must lie within this distance of the session's median lap start. */
    static final double START_TOLERANCE_M = 50.0;
    /** OpenF1 location x/y/z are stored in tenths of a metre. */
    static final double UNIT_M = 0.1;

    private record Candidate(int sessionKey, int driver, int lap, Instant start, double duration) {}

    private final JdbcTemplate jdbc;
    private final Schema schema;
    private final double spacing;
    private final Map<Integer, Optional<Map<String, Object>>> cache = new ConcurrentHashMap<>();

    public OutlineService(
            JdbcTemplate jdbc, Schema schema, @Value("${api.outline.spacing-units:500}") double spacing) {
        this.jdbc = jdbc;
        this.schema = schema;
        this.spacing = spacing;
    }

    public Optional<Map<String, Object>> outline(int circuitKey) {
        // Both answers are cached: a circuit with no usable lap would otherwise rerun every
        // candidate query on every request. The cache lives until restart, like the data.
        return cache.computeIfAbsent(circuitKey, this::build);
    }

    private Optional<Map<String, Object>> build(int circuitKey) {
        boolean quality = schema.tableExists("lap_quality");
        List<Candidate> candidates = candidates(circuitKey, quality);
        if (candidates.isEmpty()) {
            return Optional.empty();
        }
        Double referenceM = quality ? referenceLength(circuitKey) : null;
        Map<Integer, double[]> startBySession = new HashMap<>();
        for (Candidate c : candidates) {
            Instant end = c.start().plusMillis(Math.round(c.duration() * 1000));
            List<Downsampler.Sample> samples = jdbc.query(
                    "select x, y, z from location where session_key = ? and driver_number = ? "
                            + "and ts >= ? and ts <= ? and x is not null and y is not null order by ts",
                    (rs, i) -> new Downsampler.Sample(rs.getDouble(1), rs.getDouble(2), rs.getDouble(3)),
                    c.sessionKey(),
                    c.driver(),
                    java.sql.Timestamp.from(c.start()),
                    java.sql.Timestamp.from(end));
            // Cheap checks first; the start-line median is only computed for a lap that passes them.
            if (!drawsTheCircuit(samples, referenceM, null)) {
                continue;
            }
            double[] lineStart = startBySession.computeIfAbsent(c.sessionKey(), k -> lineStart(k, quality));
            if (!drawsTheCircuit(samples, referenceM, lineStart)) {
                continue;
            }
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("session_key", c.sessionKey());
            body.put("driver_number", c.driver());
            body.put("lap_number", c.lap());
            body.put("points", Downsampler.downsample(samples, spacing));
            return Optional.of(body);
        }
        return Optional.empty();
    }

    /**
     * The fastest laps of each session of the circuit, race sessions first. Taking a few per
     * session rather than the fastest overall matters: at Monaco every fast race lap is after
     * the feed stop, so the outline has to come from qualifying. With lap_quality present only
     * green laps whose boundaries come from the lap table qualify (telemetry-derived
     * boundaries, D17, do not match the lap table's timestamps that the window is cut from).
     */
    private List<Candidate> candidates(int circuitKey, boolean quality) {
        String sql = "select session_key, driver_number, lap_number, date_start, lap_duration from ("
                + "select l.session_key, l.driver_number, l.lap_number, l.date_start, l.lap_duration, s.session_name, "
                + "s.date_start as session_start, "
                + "row_number() over (partition by l.session_key order by l.lap_duration, l.driver_number, "
                + "l.lap_number) as rank "
                + "from lap l join session s on s.session_key = l.session_key "
                + (quality
                        ? "join lap_quality q on q.session_key = l.session_key and q.driver_number = l.driver_number "
                                + "and q.lap_number = l.lap_number "
                        : "")
                + "where s.circuit_key = ? and l.lap_duration is not null and l.date_start is not null "
                + "and coalesce(l.is_pit_out_lap, false) = false "
                + (quality ? "and q.green and coalesce(q.boundary_source, 'laps') = 'laps' " : "")
                + ") c where rank <= ? "
                + "order by case when session_name = 'Race' then 0 else 1 end, session_start, lap_duration, "
                + "driver_number, lap_number";
        return jdbc.query(
                sql,
                (rs, i) -> new Candidate(
                        rs.getInt(1),
                        rs.getInt(2),
                        rs.getInt(3),
                        rs.getTimestamp(4).toInstant(),
                        rs.getDouble(5)),
                circuitKey,
                PER_SESSION);
    }

    /** Median speed-integrated length of the circuit's green laps, metres; null when unknown. */
    private Double referenceLength(int circuitKey) {
        return jdbc.queryForObject(
                "select percentile_cont(0.5) within group (order by q.lap_length_m) from lap_quality q "
                        + "join session s on s.session_key = q.session_key "
                        + "where s.circuit_key = ? and q.green and q.lap_length_m is not null",
                Double.class,
                circuitKey);
    }

    /**
     * Where the session's green laps start: the median x/y of the first location sample within
     * 5 s after each lap's date_start (a lap with no sample there, such as after the Monaco feed
     * stop, contributes nothing), over the hundred fastest laps. Null when no lap has location.
     */
    private double[] lineStart(int sessionKey, boolean quality) {
        String laps = "select l.session_key, l.driver_number, l.date_start from lap l "
                + (quality
                        ? "join lap_quality q on q.session_key = l.session_key and q.driver_number = l.driver_number "
                                + "and q.lap_number = l.lap_number "
                        : "")
                + "where l.session_key = ? and l.date_start is not null and l.lap_duration is not null "
                + (quality ? "and q.green " : "")
                + "order by l.lap_duration, l.driver_number, l.lap_number limit 100";
        List<double[]> rows = jdbc.query(
                "select percentile_cont(0.5) within group (order by p.x), "
                        + "percentile_cont(0.5) within group (order by p.y) from (" + laps + ") l "
                        + "join lateral (select x, y from location x where x.session_key = l.session_key "
                        + "and x.driver_number = l.driver_number and x.ts >= l.date_start "
                        + "and x.ts < l.date_start + interval '5 seconds' and x.x is not null "
                        + "order by x.ts limit 1) p on true",
                (rs, i) -> {
                    double x = rs.getDouble(1);
                    boolean nx = rs.wasNull();
                    double y = rs.getDouble(2);
                    return nx || rs.wasNull() ? null : new double[] {x, y};
                },
                sessionKey);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** The checks a candidate lap must pass. Package-private for the unit test. */
    static boolean drawsTheCircuit(List<Downsampler.Sample> samples, Double referenceM, double[] lineStart) {
        if (samples.size() < MIN_SAMPLES) {
            return false;
        }
        Downsampler.Sample first = samples.get(0);
        Downsampler.Sample last = samples.get(samples.size() - 1);
        double path = 0;
        for (int i = 1; i < samples.size(); i++) {
            Downsampler.Sample a = samples.get(i - 1);
            Downsampler.Sample b = samples.get(i);
            path += Math.hypot(b.x() - a.x(), b.y() - a.y());
        }
        path *= UNIT_M;
        if (referenceM != null && Math.abs(path - referenceM) > LENGTH_TOLERANCE * referenceM) {
            return false;
        }
        if (Math.hypot(last.x() - first.x(), last.y() - first.y()) * UNIT_M > CLOSING_GAP_M) {
            return false;
        }
        return lineStart == null
                || Math.hypot(first.x() - lineStart[0], first.y() - lineStart[1]) * UNIT_M <= START_TOLERANCE_M;
    }
}
