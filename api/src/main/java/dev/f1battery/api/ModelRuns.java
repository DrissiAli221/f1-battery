package dev.f1battery.api;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Resolves which (model_version, run_id) a request reads. Results are immutable per run.
 *
 * <p>The model marks a run published in {@code model_run} only after all its sessions are
 * written, so the API serves the published run with the latest {@code finished_at}: a newer,
 * unfinished or single-session run does not hide it. Only when {@code model_run} has no rows at
 * all (a database that predates it) does resolution fall back to the newest run found in
 * {@code model_result}. The answer is cached for {@value #TTL_SECONDS} s per requested model.
 */
@Component
public class ModelRuns {

    public record Run(String modelVersion, UUID runId) {}

    static final int TTL_SECONDS = 30;
    private static final long TTL_NANOS = TTL_SECONDS * 1_000_000_000L;

    private record Cached(Optional<Run> run, long expiresAt) {}

    private final JdbcTemplate jdbc;
    private final LongSupplier nanoClock;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    @Autowired
    public ModelRuns(JdbcTemplate jdbc) {
        this(jdbc, System::nanoTime);
    }

    ModelRuns(JdbcTemplate jdbc, LongSupplier nanoClock) {
        this.jdbc = jdbc;
        this.nanoClock = nanoClock;
    }

    /** True once the database has a {@code model_run} table with at least one row. */
    boolean tracksRuns() {
        return Boolean.TRUE.equals(jdbc.queryForObject("select exists (select 1 from model_run)", Boolean.class));
    }

    /** The run to serve, of the given version if one is named, else of any version. */
    public Optional<Run> resolve(String model) {
        String key = model == null || model.isBlank() ? "" : model;
        long now = nanoClock.getAsLong();
        Cached hit = cache.get(key);
        if (hit != null && now - hit.expiresAt() < 0) {
            return hit.run();
        }
        Optional<Run> run = load(key);
        cache.put(key, new Cached(run, now + TTL_NANOS));
        return run;
    }

    private Optional<Run> load(String model) {
        boolean any = !model.isEmpty();
        Object[] args = any ? new Object[] {model} : new Object[0];
        List<Run> runs;
        if (tracksRuns()) {
            runs = jdbc.query(
                    "select model_version, run_id from model_run where published"
                            + (any ? " and model_version = ?" : "")
                            + " order by finished_at desc nulls last, started_at desc limit 1",
                    (rs, i) -> new Run(rs.getString(1), rs.getObject(2, UUID.class)),
                    args);
        } else {
            runs = jdbc.query(
                    "select model_version, run_id from model_result"
                            + (any ? " where model_version = ?" : "")
                            + " group by model_version, run_id order by max(created_at) desc limit 1",
                    (rs, i) -> new Run(rs.getString(1), rs.getObject(2, UUID.class)),
                    args);
        }
        return runs.stream().findFirst();
    }
}
