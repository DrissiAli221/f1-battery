package dev.f1battery.ingest.source;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.github.tomakehurst.wiremock.junit5.WireMockExtension;
import com.github.tomakehurst.wiremock.stubbing.Scenario;
import dev.f1battery.ingest.ratelimit.FakeClock;
import dev.f1battery.ingest.ratelimit.RateLimiter;
import dev.f1battery.ingest.ratelimit.TokenBucketRateLimiter;
import dev.f1battery.ingest.ratelimit.TokenBucketRateLimiter.Limit;
import dev.f1battery.ingest.source.OpenF1Records.*;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/**
 * Stubs follow the shapes the live API returns: a gzip-encoded JSON array on
 * 200, {"detail": "No results found."} on 404, plain-text errors on 429/5xx.
 * Time is a fake clock, so backoff and rate limiting are asserted exactly and
 * the tests do not sleep.
 */
class ApiSourceWireMockTest {

    @RegisterExtension
    static WireMockExtension wm = WireMockExtension.newInstance()
            .options(com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig().dynamicPort())
            .build();

    private static final String LAPS_JSON = """
            [{"meeting_key":1279,"session_key":11234,"driver_number":63,"lap_number":2,"lap_duration":81.2,
              "duration_sector_1":25.1,"duration_sector_2":30.0,"duration_sector_3":26.1,"is_pit_out_lap":false,
              "i1_speed":290,"i2_speed":301,"st_speed":322,"date_start":"2026-03-08T04:03:00.123000+00:00",
              "segments_sector_1":[2048,2049],"unknown_new_field":1}]
            """;

    private final SessionRecord session = new SessionRecord(11234, 1279, 10, "Race", "Race", "Australia", "Melbourne",
            OffsetDateTime.parse("2026-03-08T04:00:00Z"), OffsetDateTime.parse("2026-03-08T06:00:00Z"), 2026);

    private FakeClock clock;
    private SimpleMeterRegistry metrics;
    private AtomicInteger permits;

    @BeforeEach
    void setUp() {
        wm.resetAll();
        clock = new FakeClock();
        metrics = new SimpleMeterRegistry();
        permits = new AtomicInteger();
    }

    /** Counts permits only, so backoff sleeps can be asserted on their own. */
    private ApiSource source(RateLimiter limiter) {
        return new ApiSource(ApiSource.Config.of(wm.baseUrl()), ApiSource.defaultHttpClient(), limiter, clock,
                () -> 1.0, metrics);
    }

    private ApiSource source() {
        return source(permits::incrementAndGet);
    }

    private static byte[] gzip(String s) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (GZIPOutputStream g = new GZIPOutputStream(out)) {
            g.write(s.getBytes());
        }
        return out.toByteArray();
    }

    @Test
    void gzipResponseIsDecodedAndParsed() throws Exception {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).withQueryParam("session_key", equalTo("11234"))
                .willReturn(aResponse().withStatus(200).withHeader("Content-Encoding", "gzip")
                        .withHeader("Content-Type", "application/json").withBody(gzip(LAPS_JSON))));

        List<LapRecord> laps = source().fetch(Endpoint.LAPS, session);

        assertThat(laps).hasSize(1);
        assertThat(laps.get(0).stSpeed()).isEqualTo(322);
        assertThat(laps.get(0).durationSector2()).isEqualTo(30.0);
        wm.verify(1, getRequestedFor(urlPathEqualTo("/v1/laps")).withHeader("Accept-Encoding", containing("gzip")));
        assertThat(clock.sleeps()).isEmpty();
    }

    @Test
    void plainJsonIsAlsoAccepted() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).willReturn(okJson(LAPS_JSON)));
        assertThat(source().fetch(Endpoint.LAPS, session)).hasSize(1);
    }

    @Test
    void notFoundIsAnEmptyListWithoutRetry() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).willReturn(
                aResponse().withStatus(404).withBody("{\"detail\":\"No results found.\"}")));

        assertThat(source().fetch(Endpoint.LAPS, session)).isEmpty();

        wm.verify(1, getRequestedFor(urlPathEqualTo("/v1/laps")));
        assertThat(clock.sleeps()).isEmpty();
    }

    @Test
    void tooManyRequestsIsRetriedWithBackoffAndCounted() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).inScenario("429").whenScenarioStateIs(Scenario.STARTED)
                .willReturn(aResponse().withStatus(429).withBody("rate limit")).willSetStateTo("second"));
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).inScenario("429").whenScenarioStateIs("second")
                .willReturn(okJson(LAPS_JSON)));

        assertThat(source().fetch(Endpoint.LAPS, session)).hasSize(1);

        wm.verify(2, getRequestedFor(urlPathEqualTo("/v1/laps")));
        assertThat(clock.sleeps()).containsExactly(Duration.ofSeconds(1));
        assertThat(metrics.counter("ingest.http.429").count()).isEqualTo(1.0);
        assertThat(permits.get()).as("every attempt takes a permit").isEqualTo(2);
    }

    @Test
    void retryAfterHeaderLengthensTheWait() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).inScenario("ra").whenScenarioStateIs(Scenario.STARTED)
                .willReturn(aResponse().withStatus(429).withHeader("Retry-After", "7")).willSetStateTo("ok"));
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).inScenario("ra").whenScenarioStateIs("ok")
                .willReturn(okJson(LAPS_JSON)));

        source().fetch(Endpoint.LAPS, session);

        assertThat(clock.sleeps()).containsExactly(Duration.ofSeconds(7));
    }

    @Test
    void serverErrorIsRetriedThenSucceeds() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).inScenario("502").whenScenarioStateIs(Scenario.STARTED)
                .willReturn(aResponse().withStatus(502)).willSetStateTo("second"));
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).inScenario("502").whenScenarioStateIs("second")
                .willReturn(aResponse().withStatus(502)).willSetStateTo("third"));
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).inScenario("502").whenScenarioStateIs("third")
                .willReturn(okJson(LAPS_JSON)));

        assertThat(source().fetch(Endpoint.LAPS, session)).hasSize(1);

        // Exponential: 1 s, then 2 s (jitter fixed at its maximum in these tests).
        assertThat(clock.sleeps()).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(2));
        assertThat(metrics.counter("ingest.http.429").count()).isZero();
    }

    @Test
    void givesUpAfterSixAttempts() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).willReturn(aResponse().withStatus(429)));

        assertThatThrownBy(() -> source().fetch(Endpoint.LAPS, session)).isInstanceOf(SourceException.class)
                .hasMessageContaining("6 attempts");

        wm.verify(6, getRequestedFor(urlPathEqualTo("/v1/laps")));
        assertThat(clock.sleeps()).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(2),
                Duration.ofSeconds(4), Duration.ofSeconds(8), Duration.ofSeconds(16));
        assertThat(metrics.counter("ingest.http.429").count()).isEqualTo(6.0);
    }

    @Test
    void jitterShortensTheWaitToAtLeastHalf() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).inScenario("j").whenScenarioStateIs(Scenario.STARTED)
                .willReturn(aResponse().withStatus(503)).willSetStateTo("ok"));
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).inScenario("j").whenScenarioStateIs("ok")
                .willReturn(okJson(LAPS_JSON)));
        ApiSource lowJitter = new ApiSource(ApiSource.Config.of(wm.baseUrl()), ApiSource.defaultHttpClient(),
                () -> { }, clock, () -> 0.0, metrics);

        lowJitter.fetch(Endpoint.LAPS, session);

        assertThat(clock.sleeps()).containsExactly(Duration.ofMillis(500));
    }

    @Test
    void otherClientErrorsAreNotRetried() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).willReturn(aResponse().withStatus(422)));

        assertThatThrownBy(() -> source().fetch(Endpoint.LAPS, session)).isInstanceOf(SourceException.class);

        wm.verify(1, getRequestedFor(urlPathEqualTo("/v1/laps")));
        assertThat(clock.sleeps()).isEmpty();
    }

    @Test
    void requestsAreSpacedByTheRateLimiter() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).willReturn(okJson(LAPS_JSON)));
        var limiter = new TokenBucketRateLimiter(
                List.of(new Limit(3, Duration.ofSeconds(1), 1), new Limit(30, Duration.ofMinutes(1), 1)), clock, clock);
        ApiSource api = source(limiter);

        for (int i = 0; i < 4; i++) {
            api.fetch(Endpoint.LAPS, session);
        }

        wm.verify(4, getRequestedFor(urlPathEqualTo("/v1/laps")));
        // The first request is free; the next three each wait for the per-minute bucket (2 s).
        assertThat(clock.sleeps()).hasSize(3).allSatisfy(d -> assertThat(d.toMillis()).isBetween(1999L, 2001L));
    }

    @Test
    void retriesAlsoWaitForTheRateLimiter() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).inScenario("rl").whenScenarioStateIs(Scenario.STARTED)
                .willReturn(aResponse().withStatus(500)).willSetStateTo("ok"));
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).inScenario("rl").whenScenarioStateIs("ok")
                .willReturn(okJson(LAPS_JSON)));
        var limiter = new TokenBucketRateLimiter(List.of(new Limit(30, Duration.ofMinutes(1), 1)), clock, clock);

        source(limiter).fetch(Endpoint.LAPS, session);

        // Backoff of 1 s, then the limiter tops the wait up to the 2 s token spacing.
        assertThat(clock.sleeps()).hasSize(2);
        assertThat(clock.sleeps().get(0)).isEqualTo(Duration.ofSeconds(1));
        assertThat(clock.totalSlept().toMillis()).isBetween(1999L, 2001L);
    }

    @Test
    void telemetryWindowsQueryByDriverAndTimeRange() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).willReturn(okJson(LAPS_JSON)));
        wm.stubFor(get(urlPathEqualTo("/v1/car_data"))
                .withQueryParam("session_key", equalTo("11234"))
                .withQueryParam("driver_number", equalTo("63"))
                .willReturn(okJson("[{\"session_key\":11234,\"driver_number\":63,\"date\":\"2026-03-08T04:10:00.100000+00:00\","
                        + "\"speed\":301,\"throttle\":100,\"brake\":0,\"rpm\":11000,\"n_gear\":7,\"drs\":null}]")));
        ApiSource api = source();

        List<FetchWindow> windows = api.windows(Endpoint.CAR_DATA, session, 63);
        assertThat(windows).hasSize(13); // 04:00 to 06:00 in ten-minute windows, inclusive of the end boundary
        List<CarDataRecord> rows = api.fetch(Endpoint.CAR_DATA, session, 63, windows.get(1));

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).speed()).isEqualTo(301);
        assertThat(rows.get(0).drs()).isNull();
    }

    /** The raw request line, not the decoded parameters: this is what the live service receives. */
    @Test
    void timeFilterIsSentInTheDocumentedForm() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).willReturn(okJson(LAPS_JSON)));
        wm.stubFor(get(urlPathEqualTo("/v1/car_data")).willReturn(okJson("[]")));
        ApiSource api = source();

        api.fetch(Endpoint.CAR_DATA, session, 63, api.windows(Endpoint.CAR_DATA, session, 63).get(1));

        // '>' and '<' are percent-encoded (java.net.URI rejects them raw), '=' of '>=' stays raw, so the
        // decoded query is exactly date>=2026-03-08T04:10:00Z&date<2026-03-08T04:20:00Z.
        wm.verify(1, getRequestedFor(urlEqualTo("/v1/car_data?session_key=11234&driver_number=63"
                + "&date%3E=2026-03-08T04%3A10%3A00Z&date%3C2026-03-08T04%3A20%3A00Z")));
        var raw = wm.getAllServeEvents().stream().map(e -> e.getRequest().getUrl())
                .filter(u -> u.startsWith("/v1/car_data")).findFirst().orElseThrow();
        assertThat(java.net.URLDecoder.decode(raw, java.nio.charset.StandardCharsets.UTF_8))
                .contains("date>=2026-03-08T04:10:00Z&date<2026-03-08T04:20:00Z");
    }

    @Test
    void windowsRunPastTheScheduledEndWhenLapsOverrun() {
        // Scheduled end 06:00; the last lap starts 06:20 and lasts 90 s, so data runs to 06:21:30 (+5 min = 06:26:30).
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).willReturn(okJson("""
                [{"session_key":11234,"driver_number":63,"lap_number":50,"lap_duration":90.0,
                  "date_start":"2026-03-08T06:20:00+00:00"},
                 {"session_key":11234,"driver_number":1,"lap_number":49,"lap_duration":88.0,
                  "date_start":"2026-03-08T06:18:00+00:00"}]""")));

        List<FetchWindow> windows = source().windows(Endpoint.CAR_DATA, session, 63);

        assertThat(windows).hasSize(15); // 04:00 .. 06:20 inclusive
        assertThat(windows.get(14).start()).isEqualTo(OffsetDateTime.parse("2026-03-08T06:20:00Z"));
        assertThat(windows.get(14).end()).isEqualTo(OffsetDateTime.parse("2026-03-08T06:26:30Z"));
        wm.verify(1, getRequestedFor(urlPathEqualTo("/v1/laps")));
    }

    @Test
    void lapsAreFetchedOnceForUnitAndWindows() {
        wm.stubFor(get(urlPathEqualTo("/v1/laps")).willReturn(okJson(LAPS_JSON)));
        ApiSource api = source();

        api.fetch(Endpoint.LAPS, session);
        api.windows(Endpoint.CAR_DATA, session, 63);
        api.windows(Endpoint.LOCATION, session, 63);

        wm.verify(1, getRequestedFor(urlPathEqualTo("/v1/laps")));
    }

    @Test
    void recentSessionsAreSkippedAsProvisional() {
        wm.stubFor(get(urlPathEqualTo("/v1/sessions")).willReturn(okJson("""
                [{"session_key":1,"meeting_key":1,"session_name":"Race","date_start":"2026-03-08T04:00:00+00:00","date_end":"2026-03-08T06:00:00+00:00","year":2026},
                 {"session_key":2,"meeting_key":1,"session_name":"Qualifying","date_start":"2026-03-08T08:00:00+00:00","date_end":"2026-03-08T09:00:00+00:00","year":2026},
                 {"session_key":3,"meeting_key":1,"session_name":"Race","date_start":"2026-03-08T10:00:00+00:00","date_end":null,"year":2026}]""")));
        // 14:59 is just under six hours after the second session ended, 15:01 just over.
        Clock before = Clock.fixed(Instant.parse("2026-03-08T14:59:00Z"), ZoneOffset.UTC);
        Clock after = Clock.fixed(Instant.parse("2026-03-08T15:01:00Z"), ZoneOffset.UTC);
        ApiSource early = new ApiSource(ApiSource.Config.of(wm.baseUrl()), ApiSource.defaultHttpClient(), () -> { },
                clock, () -> 1.0, metrics, before);
        ApiSource late = new ApiSource(ApiSource.Config.of(wm.baseUrl()), ApiSource.defaultHttpClient(), () -> { },
                clock, () -> 1.0, metrics, after);

        assertThat(early.sessions(2026)).extracting(SessionRecord::sessionKey).containsExactly(1);
        assertThat(late.sessions(2026)).extracting(SessionRecord::sessionKey).containsExactly(1, 2);
    }

    @Test
    void sessionsAreListedByYear() {
        wm.stubFor(get(urlPathEqualTo("/v1/sessions")).withQueryParam("year", equalTo("2026"))
                .willReturn(okJson("[{\"session_key\":11234,\"meeting_key\":1279,\"session_name\":\"Race\","
                        + "\"date_start\":\"2026-03-08T04:00:00+00:00\",\"date_end\":\"2026-03-08T06:00:00+00:00\",\"year\":2026}]")));

        assertThat(source().sessions(2026)).extracting(SessionRecord::sessionName).containsExactly("Race");
    }
}
