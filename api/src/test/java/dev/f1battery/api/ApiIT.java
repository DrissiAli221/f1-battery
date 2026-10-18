package dev.f1battery.api;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.lessThan;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Applies the real Flyway migrations from the db module to a TimescaleDB container, seeds
 * one race session and exercises every endpoint.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ApiIT {

    static final int SESSION = 9001;
    static final int EMPTY_SESSION = 9002;
    static final int CIRCUIT = 7;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", TestDb.DB::getJdbcUrl);
        r.add("spring.datasource.username", TestDb.DB::getUsername);
        r.add("spring.datasource.password", TestDb.DB::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @BeforeAll
    static void seed(@Autowired JdbcTemplate j) {
        j.update("insert into session values (?,?,?,?,?,?,?,?,?,?)", SESSION, 500, CIRCUIT, "Race", "Race", "Italy",
                "Testville", ts("2026-09-06T13:00:00Z"), ts("2026-09-06T15:00:00Z"), 2026);
        j.update("insert into session values (?,?,?,?,?,?,?,?,?,?)", EMPTY_SESSION, 501, 8, "Qualifying", "Qualifying",
                "Italy", "Otherplace", ts("2026-09-05T13:00:00Z"), ts("2026-09-05T14:00:00Z"), 2026);
        j.update("insert into driver values (?,?,?,?,?)", SESSION, 1, "AAA", "Alice A", "Team One");
        j.update("insert into driver values (?,?,?,?,?)", SESSION, 44, "BBB", "Bob B", "Team Two");
        // driver 1: lap 1 slow, lap 2 fastest overall; driver 44: lap 1 in between.
        lap(j, 1, 1, "2026-09-06T13:05:00Z", 95.0);
        lap(j, 1, 2, "2026-09-06T13:06:40Z", 90.0);
        lap(j, 44, 1, "2026-09-06T13:05:00Z", 92.0);
        j.update("insert into lap_quality (session_key, driver_number, lap_number, green, reason) values (?,?,?,?,?)", SESSION, 1, 1, true, null);
        j.update("insert into lap_quality (session_key, driver_number, lap_number, green, reason) values (?,?,?,?,?)", SESSION, 1, 2, false, "yellow flag");
        j.update("insert into lap_quality (session_key, driver_number, lap_number, green, reason) values (?,?,?,?,?)", SESSION, 44, 1, true, null);
        j.update("insert into straight (circuit_key, straight_id, label, start_pct, end_pct) values (?,?,?,?,?)", CIRCUIT, 1, "Main straight", 0.0f, 0.12f);
        j.update("insert into straight (circuit_key, straight_id, label, start_pct, end_pct) values (?,?,?,?,?)", CIRCUIT, 2, "Back straight", 0.4f, 0.55f);
        j.update("insert into regulation_event values (?,?,?,?,?,?)", SESSION, 3, 8.5, 9.0, 50, true);
        // Reference lap is driver 44's green lap 1 (fastest green); a path of 600 units along x then a diagonal.
        long t0 = java.time.Instant.parse("2026-09-06T13:05:00Z").toEpochMilli();
        for (int i = 0; i <= 12; i++) {
            j.update("insert into location values (?,?,?,?,?,?)", new java.sql.Timestamp(t0 + i * 1000L), SESSION,
                    44, i * 100, i <= 6 ? 0 : (i - 6) * 100, 10);
        }
        // A location row outside the lap window must not leak into the outline.
        j.update("insert into location values (?,?,?,?,?,?)", new java.sql.Timestamp(t0 + 600_000L), SESSION, 44, 99999,
                99999, 0);
        String run = "11111111-1111-1111-1111-111111111111";
        for (int d : new int[] {1, 44}) {
            res(j, run, d, 1, 1, "cutoff_distance_m", 700.0 + d, 690.0, 710.0);
            res(j, run, d, 2, 1, "cutoff_distance_m", 710.0 + d, 700.0, 720.0);
            res(j, run, d, 0, 1, "cutoff_distance_median_m", 705.0 + d, 695.0, 715.0);
            res(j, run, d, 1, null, "regime_share_deploy", 0.4, null, null);
            res(j, run, d, 1, null, "regime_share_plateau", 0.3, null, null);
            res(j, run, d, 1, null, "regime_share_lift", 0.2, null, null);
            res(j, run, d, 1, null, "regime_share_brake", 0.1, null, null);
        }
        res(j, run, 1, 1, null, "regime_bin_0", 0, null, null);
        res(j, run, 1, 1, null, "regime_bin_1", 1, null, null);
        res(j, run, 1, 1, null, "regime_bin_10", 3, null, null);
        res(j, run, 1, 1, null, "regime_bin_2", 2, null, null);
    }

    static java.sql.Timestamp ts(String s) {
        return java.sql.Timestamp.from(java.time.Instant.parse(s));
    }

    static void lap(JdbcTemplate j, int driver, int lap, String start, double dur) {
        j.update("insert into lap (session_key, driver_number, lap_number, date_start, lap_duration, is_pit_out_lap) "
                + "values (?,?,?,?,?,false)", SESSION, driver, lap, ts(start), dur);
    }

    static void res(JdbcTemplate j, String run, int driver, int lap, Integer straight, String variable, double value,
            Double lo, Double hi) {
        j.update("insert into model_result (model_version, run_id, session_key, driver_number, lap_number, "
                + "straight_id, variable, value, ci_low, ci_high) values ('proxy-v1', ?::uuid, ?,?,?,?,?,?,?,?)", run,
                SESSION, driver, lap, straight, variable, value, lo, hi);
    }

    @Test
    void healthIsOk() throws Exception {
        mvc.perform(get("/api/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status", is("ok")));
    }

    @Test
    void sessionsListWithHasResultsAndPagination() throws Exception {
        mvc.perform(get("/api/sessions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", is(2)))
                .andExpect(jsonPath("$.page", is(0)))
                .andExpect(jsonPath("$.size", is(100)))
                .andExpect(jsonPath("$.items[0].session_key", is(SESSION)))
                .andExpect(jsonPath("$.items[0].has_results", is(true)))
                .andExpect(jsonPath("$.items[1].has_results", is(false)))
                .andExpect(jsonPath("$.items[0].circuit_short_name", is("Testville")));
        mvc.perform(get("/api/sessions?size=1&page=1"))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].session_key", is(EMPTY_SESSION)))
                .andExpect(jsonPath("$.total", is(2)));
        mvc.perform(get("/api/sessions?size=1001")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/sessions?page=-1")).andExpect(status().isBadRequest());
    }

    @Test
    void driversAndLaps() throws Exception {
        mvc.perform(get("/api/sessions/" + SESSION + "/drivers"))
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[1].team_name", is("Team Two")));
        mvc.perform(get("/api/sessions/" + SESSION + "/laps?driver=1"))
                .andExpect(jsonPath("$.total", is(2)))
                .andExpect(jsonPath("$.items[0].green", is(true)))
                .andExpect(jsonPath("$.items[1].green", is(false)))
                .andExpect(jsonPath("$.items[1].reason", is("yellow flag")));
        mvc.perform(get("/api/sessions/" + SESSION + "/laps")).andExpect(jsonPath("$.total", is(3)));
    }

    @Test
    void straightsAndRegulation() throws Exception {
        mvc.perform(get("/api/circuits/" + CIRCUIT + "/straights"))
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].label", is("Main straight")))
                .andExpect(jsonPath("$.items[1].start_pct", is(0.4)));
        mvc.perform(get("/api/circuits/999/straights")).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/sessions/" + SESSION + "/regulation"))
                .andExpect(jsonPath("$.issue_in_force", is(3)))
                .andExpect(jsonPath("$.limit_known", is(true)));
        mvc.perform(get("/api/sessions/" + EMPTY_SESSION + "/regulation")).andExpect(status().isNotFound());
    }

    @Test
    void outlineUsesFastestGreenLapAndIsDownsampled() throws Exception {
        mvc.perform(get("/api/circuits/" + CIRCUIT + "/outline"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.session_key", is(SESSION)))
                .andExpect(jsonPath("$.driver_number", is(44)))
                .andExpect(jsonPath("$.lap_number", is(1)))
                .andExpect(jsonPath("$.points[0].d", is(0.0)))
                .andExpect(jsonPath("$.points[-1].d", is(1448.5)))
                .andExpect(jsonPath("$.points.length()", lessThan(13)));
        mvc.perform(get("/api/circuits/12345/outline")).andExpect(status().isNotFound());
    }

    @Test
    void modelsAndResults() throws Exception {
        mvc.perform(get("/api/models"))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].model_version", is("proxy-v1")));
        mvc.perform(get("/api/results?session=" + SESSION + "&driver=1&variable=cutoff_distance_m"))
                .andExpect(jsonPath("$.total", is(2)))
                .andExpect(jsonPath("$.items[0].straight_id", is(1)))
                .andExpect(jsonPath("$.items[0].ci_low", is(690.0)));
        mvc.perform(get("/api/results?session=" + SESSION + "&size=3&page=1"))
                .andExpect(jsonPath("$.items", hasSize(3)))
                .andExpect(jsonPath("$.total", is(18)));
        mvc.perform(get("/api/results?model=nope")).andExpect(jsonPath("$.items", hasSize(0)));
    }

    @Test
    void summaryAveragesOverGreenLapsOnly() throws Exception {
        mvc.perform(get("/api/sessions/" + SESSION + "/summary"))
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].team_name", is("Team One")))
                .andExpect(jsonPath("$.items[0].straights[0].cutoff_distance_median_m", is(706.0)))
                .andExpect(jsonPath("$.items[0].straights[0].ci_high", is(715.0)))
                .andExpect(jsonPath("$.items[0].regime_shares.deploy", is(0.4)));
        mvc.perform(get("/api/sessions/" + EMPTY_SESSION + "/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/sessions/1/summary")).andExpect(status().isNotFound());
    }

    @Test
    void regimesAreOrderedNumericallyWithLabels() throws Exception {
        mvc.perform(get("/api/sessions/" + SESSION + "/laps/1/regimes?driver=1"))
                .andExpect(jsonPath("$.items", hasSize(4)))
                .andExpect(jsonPath("$.items[0].label", is("deploy")))
                .andExpect(jsonPath("$.items[1].d_start_m", is(50)))
                .andExpect(jsonPath("$.items[2].label", is("lift")))
                .andExpect(jsonPath("$.items[3].bin", is(10)))
                .andExpect(jsonPath("$.items[3].label", is("brake")));
        mvc.perform(get("/api/sessions/" + SESSION + "/laps/1/regimes?driver=44"))
                .andExpect(jsonPath("$.items", hasSize(0)));
    }

    @Test
    void compareReturnsBothSeries() throws Exception {
        mvc.perform(get("/api/compare?session=" + SESSION + "&drivers=1,44&straight=1"))
                .andExpect(jsonPath("$.drivers", hasSize(2)))
                .andExpect(jsonPath("$.drivers[0].name_acronym", is("AAA")))
                .andExpect(jsonPath("$.drivers[1].series[0].cutoff_distance_m", is(744.0)));
        mvc.perform(get("/api/compare?session=" + SESSION + "&drivers=1")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/compare?session=" + EMPTY_SESSION + "&drivers=1,44"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.drivers[0].series", hasSize(0)));
    }

    @Test
    void unknownSessionIs404() throws Exception {
        mvc.perform(get("/api/sessions/424242/drivers")).andExpect(status().isNotFound());
        mvc.perform(get("/api/sessions/424242/laps")).andExpect(status().isNotFound());
        mvc.perform(get("/api/sessions/424242/laps/1/regimes?driver=1")).andExpect(status().isNotFound());
    }

    @Test
    void etagGives304OnRepeat() throws Exception {
        String etag = mvc.perform(get("/api/sessions"))
                .andExpect(header().exists("ETag"))
                .andReturn()
                .getResponse()
                .getHeader("ETag");
        mvc.perform(get("/api/sessions").header("If-None-Match", etag)).andExpect(status().isNotModified());
    }

    @Test
    void corsHeaderForConfiguredOrigin() throws Exception {
        mvc.perform(get("/api/sessions").header("Origin", "http://localhost:5173"))
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"));
    }
}
