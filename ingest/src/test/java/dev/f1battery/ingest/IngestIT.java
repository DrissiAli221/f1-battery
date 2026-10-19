package dev.f1battery.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.MeterRegistry;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Runs the whole pipeline twice against the fixture backup
 * (src/test/resources/backup: session 11234 with two drivers, and session 11257
 * which has no data). The fixture contains an overlapping windowed re-fetch for
 * one driver, so run 1 also exercises the in-memory dedupe.
 */
@Testcontainers
@SpringBootTest(properties = {
        "ingest.run-on-startup=false",
        "ingest.local.root=src/test/resources/backup"})
class IngestIT {

    @Container
    static final PostgreSQLContainer<?> DB = new PostgreSQLContainer<>(
            DockerImageName.parse("timescale/timescaledb:latest-pg16")
                    .asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", DB::getJdbcUrl);
        r.add("spring.datasource.username", DB::getUsername);
        r.add("spring.datasource.password", DB::getPassword);
    }

    @Autowired IngestService service;
    @Autowired JdbcTemplate jdbc;
    @Autowired MeterRegistry metrics;

    private static final IngestOptions LOCAL = new IngestOptions("local", 2026, null, java.util.List.of(), false);

    /** Tests share one database; each starts from an empty one. */
    @org.junit.jupiter.api.BeforeEach
    void clean() {
        jdbc.execute("TRUNCATE session, ingestion_log CASCADE");
    }

    private long count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Long.class);
    }

    private double upserted() {
        return metrics.getMeters().stream()
                .filter(m -> m.getId().getName().equals("ingest.rows.upserted"))
                .mapToDouble(m -> ((io.micrometer.core.instrument.Counter) m).count()).sum();
    }

    @Test
    void loadsTheFixtureOnceAndASecondRunChangesNothing() {
        IngestService.Summary first = service.run(LOCAL);

        assertThat(first.ok()).isTrue();
        assertThat(first.sessions()).isEqualTo(2);
        Map<String, Long> expected = Map.ofEntries(
                Map.entry("session", 2L), Map.entry("driver", 2L), Map.entry("lap", 6L),
                Map.entry("stint", 3L), Map.entry("pit", 2L), Map.entry("overtake", 3L),
                Map.entry("race_control", 3L), Map.entry("interval_sample", 4L), Map.entry("position", 3L),
                Map.entry("weather", 3L), Map.entry("session_result", 2L), Map.entry("starting_grid", 0L),
                Map.entry("team_radio", 0L),
                // Driver 10: 12 rows + 12 rows with 4 overlapping = 20; driver 63: 5.
                Map.entry("car_data", 25L), Map.entry("location", 25L));
        expected.forEach((table, rows) -> assertThat(count(table)).as(table).isEqualTo(rows));
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM interval_sample WHERE gap_to_leader_text = '+1 LAP' AND gap_to_leader IS NULL",
                Long.class)).isEqualTo(1L);

        // 32 units: 18 with data are 'complete'; 14 empty ones are 'no_data'.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ingestion_log WHERE status = 'complete' AND source = 'local'",
                Long.class)).isEqualTo(18L);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ingestion_log WHERE status = 'no_data'", Long.class))
                .isEqualTo(14L);
        assertThat(first.unitsDone()).isEqualTo(32);
        assertThat(first.unitsSkipped()).isZero();

        long logRows = count("ingestion_log");
        double changedAfterFirst = upserted();

        IngestService.Summary second = service.run(LOCAL);

        assertThat(second.ok()).isTrue();
        assertThat(second.unitsSkipped()).as("complete units are skipped").isEqualTo(18);
        expected.forEach((table, rows) -> assertThat(count(table)).as("after run 2: " + table).isEqualTo(rows));
        assertThat(count("ingestion_log")).isEqualTo(logRows);
        assertThat(upserted()).as("no row inserted or changed by the second run").isEqualTo(changedAfterFirst);
    }

    @Test
    void driverDetailsRoundTripAndRefreshBackfillsExistingRows() {
        service.run(LOCAL);
        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM driver WHERE session_key = 11234 AND driver_number = 10");
        assertThat(row.get("first_name")).isEqualTo("Pierre");
        assertThat(row.get("last_name")).isEqualTo("Gasly");
        assertThat(row.get("broadcast_name")).isEqualTo("P GASLY");
        assertThat(row.get("team_colour")).isEqualTo("00A1E8");
        assertThat((String) row.get("headshot_url")).startsWith("https://media.formula1.com/");

        // Simulate rows stored before V8, then show a plain rerun skips them and --refresh=drivers fills them.
        jdbc.update("UPDATE driver SET headshot_url = NULL, team_colour = NULL, first_name = NULL, last_name = NULL, "
                + "broadcast_name = NULL, country_code = NULL");
        service.run(LOCAL);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM driver WHERE team_colour IS NULL", Long.class)).isEqualTo(2L);

        IngestService.Summary refreshed = service.run(new IngestOptions("local", 2026, null, java.util.List.of(), false,
                java.util.Set.of("drivers")));
        assertThat(refreshed.ok()).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM driver WHERE team_colour IS NOT NULL AND headshot_url IS NOT NULL",
                Long.class)).isEqualTo(2L);
        assertThat(jdbc.queryForObject("SELECT first_name FROM driver WHERE session_key = 11234 AND driver_number = 10",
                String.class)).isEqualTo("Pierre");
    }

    @Test
    void dryRunWritesNothing() {
        long before = count("ingestion_log");
        IngestService.Summary s = service.run(new IngestOptions("local", 2026, 11234, java.util.List.of(), true));
        assertThat(s.ok()).isTrue();
        assertThat(count("ingestion_log")).isEqualTo(before);
    }
}
