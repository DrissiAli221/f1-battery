package dev.f1battery.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Contract of {@link ModelRuns}: the published run is served; a newer run that is unpublished
 * (for example a single-session re-run) does not hide it; the answer is cached for 30 s.
 * Rows are removed afterwards because the container is shared with the other integration tests.
 */
@SpringBootTest
@ActiveProfiles("test")
class ModelRunsIT {

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", TestDb.DB::getJdbcUrl);
        r.add("spring.datasource.username", TestDb.DB::getUsername);
        r.add("spring.datasource.password", TestDb.DB::getPassword);
    }

    @Autowired JdbcTemplate jdbc;

    private final AtomicLong nanos = new AtomicLong();

    @AfterEach
    void clean() {
        jdbc.update("delete from model_run where model_version like 'contract-%'");
    }

    private UUID run(String version, String finished, boolean published) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into model_run (model_version, run_id, started_at, finished_at, published) "
                + "values (?, ?, now() - interval '1 day', ?::timestamptz, ?)", version, id, finished, published);
        return id;
    }

    @Test
    void newerUnpublishedSingleSessionRunDoesNotHideThePublishedRun() {
        UUID published = run("contract-v1", "2026-10-01T00:00:00Z", true);
        run("contract-v1", null, false);
        run("contract-v1", "2026-10-10T00:00:00Z", false);

        var resolved = new ModelRuns(jdbc, nanos::get).resolve("contract-v1");

        assertThat(resolved).hasValueSatisfying(r -> assertThat(r.runId()).isEqualTo(published));
    }

    @Test
    void latestPublishedWinsAndNothingPublishedMeansNoRun() {
        run("contract-v2", "2026-10-01T00:00:00Z", true);
        UUID newer = run("contract-v2", "2026-10-05T00:00:00Z", true);
        run("contract-v3", null, false);
        ModelRuns runs = new ModelRuns(jdbc, nanos::get);

        assertThat(runs.resolve("contract-v2")).hasValueSatisfying(r -> assertThat(r.runId()).isEqualTo(newer));
        assertThat(runs.resolve("contract-v3")).isEmpty();
    }

    @Test
    void resolutionIsCachedForThirtySeconds() {
        UUID first = run("contract-v4", "2026-10-01T00:00:00Z", true);
        ModelRuns runs = new ModelRuns(jdbc, nanos::get);
        assertThat(runs.resolve("contract-v4")).hasValueSatisfying(r -> assertThat(r.runId()).isEqualTo(first));

        UUID second = run("contract-v4", "2026-10-02T00:00:00Z", true);
        nanos.addAndGet(29_000_000_000L);
        assertThat(runs.resolve("contract-v4")).hasValueSatisfying(r -> assertThat(r.runId()).isEqualTo(first));
        nanos.addAndGet(2_000_000_000L);
        assertThat(runs.resolve("contract-v4")).hasValueSatisfying(r -> assertThat(r.runId()).isEqualTo(second));
    }
}
