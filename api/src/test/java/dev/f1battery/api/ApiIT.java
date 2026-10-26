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
    /** A qualifying session on a third circuit whose green lap has no location rows. */
    static final int BLIND_SESSION = 9003;
    /** A race on CIRCUIT_Q with no usable lap, and the qualifying that holds its outline. */
    static final int RACE_Q = 9004;
    static final int QUALI_Q = 9005;
    static final int CIRCUIT = 7;
    static final int CIRCUIT_BLIND = 9;
    static final int CIRCUIT_Q = 11;

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
        j.update("insert into driver (session_key, driver_number, name_acronym, full_name, team_name, headshot_url, "
                + "team_colour, first_name, last_name, broadcast_name, country_code) values (?,?,?,?,?,?,?,?,?,?,?)",
                SESSION, 1, "AAA", "Alice A", "Team One", "https://img.example/aaa.png", "f47600", "Alice", "A",
                "A ALICE", "GBR");
        j.update("insert into driver values (?,?,?,?,?)", SESSION, 44, "BBB", "Bob B", "Team Two");
        j.update("insert into session values (?,?,?,?,?,?,?,?,?,?)", BLIND_SESSION, 502, CIRCUIT_BLIND, "Qualifying",
                "Qualifying", "Italy", "Blindtown", ts("2026-08-12T13:00:00Z"), ts("2026-08-12T14:00:00Z"), 2026);
        j.update("insert into session values (?,?,?,?,?,?,?,?,?,?)", RACE_Q, 503, CIRCUIT_Q, "Race", "Race", "Italy",
                "Quietville", ts("2026-08-20T13:00:00Z"), ts("2026-08-20T15:00:00Z"), 2026);
        j.update("insert into session values (?,?,?,?,?,?,?,?,?,?)", QUALI_Q, 503, CIRCUIT_Q, "Qualifying", "Qualifying",
                "Italy", "Quietville", ts("2026-08-19T13:00:00Z"), ts("2026-08-19T14:00:00Z"), 2026);
        // driver 1: lap 1 slow, lap 2 fastest overall but not green, lap 3 green and fast but its
        // location starts a quarter-lap past the line (a lap-clock fault); driver 44: lap 1 green
        // with a full loop of location, lap 2 the fastest green lap with no location at all.
        lap(j, 1, 1, "2026-09-06T13:05:00Z", 95.0);
        lap(j, 1, 2, "2026-09-06T13:06:40Z", 90.0);
        lap(j, 1, 3, "2026-09-06T13:10:00Z", 89.0);
        lap(j, 44, 1, "2026-09-06T13:05:00Z", 92.0);
        lap(j, 44, 2, "2026-09-06T13:06:32Z", 88.0);
        quality(j, 1, 1, true, null);
        quality(j, 1, 2, false, "yellow flag");
        quality(j, 1, 3, true, null);
        quality(j, 44, 1, true, null);
        quality(j, 44, 2, true, null);
        j.update("insert into straight (circuit_key, straight_id, label, start_pct, end_pct) values (?,?,?,?,?)", CIRCUIT, 1, "Main straight", 0.0f, 0.12f);
        j.update("insert into straight (circuit_key, straight_id, label, start_pct, end_pct) values (?,?,?,?,?)", CIRCUIT, 2, "Back straight", 0.4f, 0.55f);
        // A third straight on the fixture circuit with no model rows at all: has_results is false.
        j.update("insert into straight (circuit_key, straight_id, label, start_pct, end_pct) values (?,?,?,?,?)", CIRCUIT, 3, "Short kink", 0.7f, 0.72f);
        // A straight on the circuit of EMPTY_SESSION, which has no results: has_results is unknown there.
        j.update("insert into straight (circuit_key, straight_id, label, start_pct, end_pct) values (?,?,?,?,?)", 8, 1, "Only straight", 0.0f, 0.2f);
        j.update("insert into regulation_event values (?,?,?,?,?,?)", SESSION, 3, 8.5, 9.0, 50, true);
        // The circuit is a 1000-unit (100 m) square, one sample every 100 units, 40 per lap.
        // Driver 44 lap 1 and driver 1 lap 1 start at the line (0,0); driver 1 lap 3 starts at
        // the far corner, so it is a closed lap of the right length that fails the start check.
        long t0 = java.time.Instant.parse("2026-09-06T13:05:00Z").toEpochMilli();
        loop(j, 44, t0, 0);
        loop(j, 1, t0, 0);
        loop(j, 1, java.time.Instant.parse("2026-09-06T13:10:00Z").toEpochMilli(), 20);
        // A location row outside the lap window must not leak into the outline.
        j.update("insert into location values (?,?,?,?,?,?)", new java.sql.Timestamp(t0 + 600_000L), SESSION, 44, 99999,
                99999, 0);
        // CIRCUIT_BLIND: a green lap with no location rows at all (the Monaco race after the feed stop).
        lapIn(j, BLIND_SESSION, 5, 1, "2026-08-12T13:05:00Z", 90.0);
        // CIRCUIT_Q: the race's only green lap is an open arc (a frozen feed), the qualifying lap is a
        // full loop; races are tried first, so the outline must fall through to the qualifying session.
        lapIn(j, RACE_Q, 5, 1, "2026-08-20T13:05:00Z", 90.0);
        loop(j, RACE_Q, 5, java.time.Instant.parse("2026-08-20T13:05:00Z").toEpochMilli(), 0, 30);
        lapIn(j, QUALI_Q, 5, 1, "2026-08-19T13:05:00Z", 91.0);
        loop(j, QUALI_Q, 5, java.time.Instant.parse("2026-08-19T13:05:00Z").toEpochMilli(), 0, 40);
        String run = "11111111-1111-1111-1111-111111111111";
        for (int d : new int[] {1, 44}) {
            // straight 1: three laps analysed and detected, so a median exists.
            res(j, run, d, 1, 1, "cutoff_distance_m", 700.0 + d, 690.0, 710.0);
            res(j, run, d, 2, 1, "cutoff_distance_m", 710.0 + d, 700.0, 720.0);
            res(j, run, d, 3, 1, "cutoff_distance_m", 705.0 + d, 695.0, 715.0);
            res(j, run, d, 0, 1, "cutoff_distance_median_m", 705.0 + d, 695.0, 715.0);
            for (int lap = 1; lap <= 3; lap++) {
                res(j, run, d, lap, 1, "cutoff_detected", 1, null, null);
            }
            // straight 2: three laps analysed, two detected: below the three-lap rule, no median.
            res(j, run, d, 1, 2, "cutoff_detected", 1, null, null);
            res(j, run, d, 2, 2, "cutoff_detected", 1, null, null);
            res(j, run, d, 3, 2, "cutoff_detected", 0, null, null);
            res(j, run, d, 1, 2, "cutoff_distance_m", 400.0, 390.0, 410.0);
            res(j, run, d, 2, 2, "cutoff_distance_m", 402.0, 392.0, 412.0);
            res(j, run, d, 1, null, "regime_share_deploy", 0.4, null, null);
            res(j, run, d, 1, null, "regime_share_plateau", 0.3, null, null);
            res(j, run, d, 1, null, "regime_share_lift", 0.2, null, null);
            res(j, run, d, 1, null, "regime_share_brake", 0.1, null, null);
        }
        res(j, run, 1, 1, null, "regime_bin_0", 0, null, null);
        res(j, run, 1, 1, null, "regime_bin_1", 1, null, null);
        res(j, run, 1, 1, null, "regime_bin_10", 3, null, null);
        res(j, run, 1, 1, null, "regime_bin_2", 2, null, null);
        // Straight profile for driver 1, straight 1 (bin 10 inserted before bin 2 to check numeric order).
        res(j, run, 1, 0, 1, "speed_bin_0", 268.0, null, null);
        res(j, run, 1, 0, 1, "accel_bin_0", 3.2, null, null);
        res(j, run, 1, 0, 1, "speed_bin_10", 301.0, null, null);
        res(j, run, 1, 0, 1, "speed_bin_2", 290.0, null, null);
        res(j, run, 1, 0, 1, "accel_bin_2", 1.0, null, null);
    }

    static java.sql.Timestamp ts(String s) {
        return java.sql.Timestamp.from(java.time.Instant.parse(s));
    }

    static void quality(JdbcTemplate j, int driver, int lap, boolean green, String reason) {
        j.update("insert into lap_quality (session_key, driver_number, lap_number, green, reason, lap_length_m) "
                + "values (?,?,?,?,?,?)", SESSION, driver, lap, green, reason, green ? 400.0f : null);
    }

    /** A green lap in another session, with its lap_quality row. */
    static void lapIn(JdbcTemplate j, int session, int driver, int lap, String start, double dur) {
        j.update("insert into lap (session_key, driver_number, lap_number, date_start, lap_duration, is_pit_out_lap) "
                + "values (?,?,?,?,?,false)", session, driver, lap, ts(start), dur);
        j.update("insert into lap_quality (session_key, driver_number, lap_number, green, reason, lap_length_m) "
                + "values (?,?,?,?,?,?)", session, driver, lap, true, null, 400.0f);
    }

    static void loop(JdbcTemplate j, int driver, long t0, int from) {
        loop(j, SESSION, driver, t0, from, 40);
    }

    /** {@code n} location samples round the square, one per second, starting at sample index {@code from}. */
    static void loop(JdbcTemplate j, int session, int driver, long t0, int from, int n) {
        for (int i = 0; i < n; i++) {
            int k = (from + i) % 40;
            int side = k / 10;
            int along = (k % 10) * 100;
            int x = side == 0 ? along : side == 1 ? 1000 : side == 2 ? 1000 - along : 0;
            int y = side == 0 ? 0 : side == 1 ? along : side == 2 ? 1000 : 1000 - along;
            j.update("insert into location values (?,?,?,?,?,?)", new java.sql.Timestamp(t0 + i * 1000L), session,
                    driver, x, y, 10);
        }
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
                .andExpect(jsonPath("$.total", is(5)))
                .andExpect(jsonPath("$.page", is(0)))
                .andExpect(jsonPath("$.size", is(100)))
                .andExpect(jsonPath("$.items[0].session_key", is(SESSION)))
                .andExpect(jsonPath("$.items[0].has_results", is(true)))
                .andExpect(jsonPath("$.items[1].has_results", is(false)))
                .andExpect(jsonPath("$.items[0].circuit_short_name", is("Testville")));
        mvc.perform(get("/api/sessions?size=1&page=1"))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].session_key", is(EMPTY_SESSION)))
                .andExpect(jsonPath("$.total", is(5)));
        mvc.perform(get("/api/sessions?size=1001")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/sessions?page=-1")).andExpect(status().isBadRequest());
    }

    @Test
    void driversAndLaps() throws Exception {
        mvc.perform(get("/api/sessions/" + SESSION + "/drivers"))
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[1].team_name", is("Team Two")))
                .andExpect(jsonPath("$.items[0].headshot_url", is("https://img.example/aaa.png")))
                .andExpect(jsonPath("$.items[0].team_colour", is("#F47600")))
                .andExpect(jsonPath("$.items[0].first_name", is("Alice")))
                .andExpect(jsonPath("$.items[0].last_name", is("A")))
                .andExpect(jsonPath("$.items[0].broadcast_name", is("A ALICE")))
                .andExpect(jsonPath("$.items[0].country_code", is("GBR")))
                .andExpect(jsonPath("$.items[1].team_colour").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.items[1].headshot_url").value(org.hamcrest.Matchers.nullValue()));
        mvc.perform(get("/api/sessions/" + SESSION + "/laps?driver=1"))
                .andExpect(jsonPath("$.total", is(3)))
                .andExpect(jsonPath("$.items[0].green", is(true)))
                .andExpect(jsonPath("$.items[1].green", is(false)))
                .andExpect(jsonPath("$.items[1].reason", is("yellow flag")));
        mvc.perform(get("/api/sessions/" + SESSION + "/laps")).andExpect(jsonPath("$.total", is(5)));
    }

    @Test
    void straightsAndRegulation() throws Exception {
        mvc.perform(get("/api/circuits/" + CIRCUIT + "/straights"))
                .andExpect(jsonPath("$.items", hasSize(3)))
                .andExpect(jsonPath("$.items[0].label", is("Main straight")))
                .andExpect(jsonPath("$.items[0].has_results", is(true)))
                .andExpect(jsonPath("$.items[1].has_results", is(true)))
                .andExpect(jsonPath("$.items[2].has_results", is(false)))
                .andExpect(jsonPath("$.items[1].start_pct", is(0.4)));
        mvc.perform(get("/api/circuits/8/straights"))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].has_results").value(org.hamcrest.Matchers.nullValue()));
        mvc.perform(get("/api/circuits/999/straights")).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/sessions/" + SESSION + "/regulation"))
                .andExpect(jsonPath("$.issue_in_force", is(3)))
                .andExpect(jsonPath("$.limit_known", is(true)));
        mvc.perform(get("/api/sessions/" + EMPTY_SESSION + "/regulation")).andExpect(status().isNotFound());
    }

    /**
     * The fastest green lap (driver 44 lap 2) has no location rows and the next (driver 1 lap 3)
     * does not start at the line, so the outline comes from driver 44 lap 1.
     */
    @Test
    void outlineUsesFastestGreenLapThatDrawsTheCircuitAndIsDownsampled() throws Exception {
        mvc.perform(get("/api/circuits/" + CIRCUIT + "/outline"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.session_key", is(SESSION)))
                .andExpect(jsonPath("$.driver_number", is(44)))
                .andExpect(jsonPath("$.lap_number", is(1)))
                .andExpect(jsonPath("$.points[0].d", is(0.0)))
                .andExpect(jsonPath("$.points[0].x", is(0.0)))
                .andExpect(jsonPath("$.points[-1].d", is(3900.0)))
                .andExpect(jsonPath("$.points.length()", lessThan(13)));
        mvc.perform(get("/api/circuits/12345/outline")).andExpect(status().isNotFound());
        // No laps at all, and a green lap with no location rows: no outline rather than an empty one.
        mvc.perform(get("/api/circuits/8/outline")).andExpect(status().isNotFound());
        mvc.perform(get("/api/circuits/" + CIRCUIT_BLIND + "/outline")).andExpect(status().isNotFound());
    }

    /** Races come first, but a race whose laps are all open arcs falls through to the qualifying session. */
    @Test
    void outlineFallsThroughToAnotherSessionWhenEveryRaceLapFails() throws Exception {
        mvc.perform(get("/api/circuits/" + CIRCUIT_Q + "/outline"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.session_key", is(QUALI_Q)))
                .andExpect(jsonPath("$.driver_number", is(5)))
                .andExpect(jsonPath("$.points[-1].d", is(3900.0)));
    }

    @Test
    void modelsAndResults() throws Exception {
        mvc.perform(get("/api/models"))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].model_version", is("proxy-v1")));
        mvc.perform(get("/api/results?session=" + SESSION + "&driver=1&variable=cutoff_distance_m"))
                .andExpect(jsonPath("$.total", is(5)))
                .andExpect(jsonPath("$.items[0].straight_id", is(1)))
                .andExpect(jsonPath("$.items[0].ci_low", is(690.0)));
        mvc.perform(get("/api/results?session=" + SESSION + "&size=3&page=1"))
                .andExpect(jsonPath("$.items", hasSize(3)))
                .andExpect(jsonPath("$.total", is(36)));
        mvc.perform(get("/api/results?model=nope")).andExpect(jsonPath("$.items", hasSize(0)));
    }

    @Test
    void summaryAveragesOverGreenLapsOnly() throws Exception {
        mvc.perform(get("/api/sessions/" + SESSION + "/summary"))
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].team_name", is("Team One")))
                .andExpect(jsonPath("$.items[0].straights", hasSize(2)))
                .andExpect(jsonPath("$.items[0].straights[0].straight_id", is(1)))
                .andExpect(jsonPath("$.items[0].straights[0].laps_analysed", is(3)))
                .andExpect(jsonPath("$.items[0].straights[0].laps_detected", is(3)))
                .andExpect(jsonPath("$.items[0].straights[0].cutoff_distance_median_m", is(706.0)))
                .andExpect(jsonPath("$.items[0].straights[0].ci_high", is(715.0)))
                .andExpect(jsonPath("$.items[0].straights[1].straight_id", is(2)))
                .andExpect(jsonPath("$.items[0].straights[1].laps_analysed", is(3)))
                .andExpect(jsonPath("$.items[0].straights[1].laps_detected", is(2)))
                .andExpect(jsonPath("$.items[0].straights[1].cutoff_distance_median_m").value(org.hamcrest.Matchers.nullValue()))
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
    void straightProfileJoinsSpeedAndAccelPerBin() throws Exception {
        mvc.perform(get("/api/sessions/" + SESSION + "/straights/1/profile?driver=1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bin_m", is(50)))
                .andExpect(jsonPath("$.straight_id", is(1)))
                .andExpect(jsonPath("$.model_version", is("proxy-v1")))
                .andExpect(jsonPath("$.bins", hasSize(3)))
                .andExpect(jsonPath("$.bins[0].v_kph", is(268)))
                .andExpect(jsonPath("$.bins[0].a_ms2", is(3.2)))
                .andExpect(jsonPath("$.bins[1].bin", is(2)))
                .andExpect(jsonPath("$.bins[1].d_start_m", is(100)))
                .andExpect(jsonPath("$.bins[2].bin", is(10)))
                .andExpect(jsonPath("$.bins[2].a_ms2").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.cutoff_median_m", is(706.0)))
                .andExpect(jsonPath("$.ci_low_m", is(695.0)))
                .andExpect(jsonPath("$.ci_high_m", is(715.0)));
        // No profile rows: 200 with empty bins, cut-off absent for a straight without one.
        mvc.perform(get("/api/sessions/" + SESSION + "/straights/2/profile?driver=1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bins", hasSize(0)))
                .andExpect(jsonPath("$.cutoff_median_m").value(org.hamcrest.Matchers.nullValue()));
        mvc.perform(get("/api/sessions/" + SESSION + "/straights/1/profile?driver=44"))
                .andExpect(jsonPath("$.bins", hasSize(0)));
    }

    @Test
    void compareReturnsBothSeries() throws Exception {
        mvc.perform(get("/api/compare?session=" + SESSION + "&drivers=1,44&straight=1"))
                .andExpect(jsonPath("$.drivers", hasSize(2)))
                .andExpect(jsonPath("$.drivers[0].name_acronym", is("AAA")))
                .andExpect(jsonPath("$.drivers[0].team_colour", is("#F47600")))
                .andExpect(jsonPath("$.drivers[0].headshot_url", is("https://img.example/aaa.png")))
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
        mvc.perform(get("/api/sessions/424242/straights/1/profile?driver=1")).andExpect(status().isNotFound());
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

    @Test
    void liveEndpointIsDisabledByDefault() throws Exception {
        mvc.perform(get("/api/live/" + SESSION))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error", is("replay disabled")));
    }
}
