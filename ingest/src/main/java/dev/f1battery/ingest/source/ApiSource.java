package dev.f1battery.ingest.source;

import dev.f1battery.ingest.ratelimit.RateLimiter;
import dev.f1battery.ingest.ratelimit.Sleeper;
import dev.f1battery.ingest.source.OpenF1Records.LapRecord;
import dev.f1battery.ingest.source.OpenF1Records.SessionRecord;
import io.micrometer.core.instrument.MeterRegistry;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.DoubleSupplier;
import java.util.zip.GZIPInputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Live OpenF1 client. Every attempt, including retries, takes a permit from the
 * {@link RateLimiter}, so backoff cannot push the client over the free-tier
 * limits. 429, 5xx and transport errors are retried with exponential backoff and
 * jitter (honouring Retry-After); 404 means "no data" and returns an empty list;
 * any other status fails the fetch.
 *
 * <p><b>Session end.</b> The scheduled {@code date_end} is not the end of the data: after a red
 * flag or a delayed finish the cars keep running past it. Telemetry windows therefore end at
 * {@code max(date_end, last lap end + 5 min)}, where the last lap end comes from the session's own
 * laps (fetched first; the laps unit reuses that response). Sessions that ended less than six
 * hours ago are skipped as provisional: results and late corrections are still being revised and a
 * unit marked complete is never refetched.
 *
 * <p><b>Wire format of the time filter.</b> OpenF1 documents comparison filters as
 * {@code date>=2026-03-08T04:10:00Z&date<2026-03-08T04:20:00Z}. {@code java.net.URI} rejects a
 * literal {@code <} or {@code >}, so those two characters are sent percent-encoded while the
 * {@code =} of {@code >=} stays raw: {@code date%3E=2026-03-08T04%3A10%3A00Z&date%3C2026-03-08T04%3A20%3A00Z}.
 * After percent-decoding this is byte for byte the documented form (an earlier version sent
 * {@code date%3E%3D=...}, which decodes to {@code date>==...}). It has not been exercised against
 * the live service; see docs/phase1-ingestion.md.
 */
public class ApiSource implements OpenF1Source {

    private static final Logger log = LoggerFactory.getLogger(ApiSource.class);

    /** Telemetry window length (DECISIONS.md D9: about ten minutes). */
    public static final int WINDOW_MINUTES = 10;

    /** Telemetry keeps flowing for a while after the last lap ends (in-lap, parc ferme). */
    static final Duration OVERRUN_MARGIN = Duration.ofMinutes(5);

    /** Sessions that ended more recently than this are provisional and skipped. */
    static final Duration MIN_AGE = Duration.ofHours(6);

    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_OFFSET_DATE_TIME;

    public record Config(String baseUrl, int maxAttempts, Duration baseDelay, Duration maxDelay) {
        public static Config of(String baseUrl) {
            return new Config(baseUrl, 6, Duration.ofSeconds(1), Duration.ofSeconds(60));
        }
    }

    private final Config config;
    private final HttpClient client;
    private final RateLimiter limiter;
    private final Sleeper sleeper;
    private final DoubleSupplier jitter;
    private final MeterRegistry metrics;
    private final Clock wallClock;

    /** The last laps response: the laps unit and the window computation share one request. */
    private int lapsSession = -1;
    private List<LapRecord> lapsCache = List.of();

    /** @param jitter returns a value in [0,1); the delay is scaled into [50%, 100%] of the backoff ceiling. */
    public ApiSource(Config config, HttpClient client, RateLimiter limiter, Sleeper sleeper,
            DoubleSupplier jitter, MeterRegistry metrics) {
        this(config, client, limiter, sleeper, jitter, metrics, Clock.systemUTC());
    }

    public ApiSource(Config config, HttpClient client, RateLimiter limiter, Sleeper sleeper,
            DoubleSupplier jitter, MeterRegistry metrics, Clock wallClock) {
        this.wallClock = wallClock;
        this.config = config;
        this.client = client;
        this.limiter = limiter;
        this.sleeper = sleeper;
        this.jitter = jitter;
        this.metrics = metrics;
    }

    public static HttpClient defaultHttpClient() {
        return HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    @Override
    public String name() {
        return "api";
    }

    @Override
    public List<SessionRecord> sessions(int year) {
        OffsetDateTime cutoff = OffsetDateTime.now(wallClock).minus(MIN_AGE);
        List<SessionRecord> out = new ArrayList<>();
        for (SessionRecord s : parse(get("/v1/sessions", Map.of("year", String.valueOf(year))), SessionRecord.class)) {
            if (s.dateEnd() == null || s.dateEnd().isAfter(cutoff)) {
                log.info("event=session_skipped session={} name=\"{}\" date_end={} reason=\"too recent, provisional\"",
                        s.sessionKey(), s.sessionName(), s.dateEnd());
                continue;
            }
            out.add(s);
        }
        return out;
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> List<T> fetch(Endpoint<T> endpoint, SessionRecord session) {
        if (endpoint == Endpoint.LAPS) {
            return (List<T>) loadLaps(session);
        }
        return parse(get("/v1/" + endpoint.name(), Map.of("session_key", String.valueOf(session.sessionKey()))),
                endpoint.type());
    }

    /** Always requests; the response is kept so that the window computation can reuse it. */
    private List<LapRecord> loadLaps(SessionRecord session) {
        int key = session.sessionKey();
        lapsCache = parse(get("/v1/laps", Map.of("session_key", String.valueOf(key))), LapRecord.class);
        lapsSession = key;
        return lapsCache;
    }

    private List<LapRecord> laps(SessionRecord session) {
        return lapsSession == session.sessionKey() ? lapsCache : loadLaps(session);
    }

    /** End of the telemetry to fetch: the later of the scheduled end and the last lap end plus a margin. */
    OffsetDateTime effectiveEnd(SessionRecord session) {
        OffsetDateTime scheduled = LocalBackupSource.end(session);
        OffsetDateTime lastLapEnd = null;
        for (LapRecord lap : laps(session)) {
            if (lap.dateStart() == null) {
                continue;
            }
            long millis = lap.lapDuration() == null ? 0 : Math.round(lap.lapDuration() * 1000);
            OffsetDateTime end = lap.dateStart().plus(Duration.ofMillis(millis));
            if (lastLapEnd == null || end.isAfter(lastLapEnd)) {
                lastLapEnd = end;
            }
        }
        if (lastLapEnd == null) {
            return scheduled;
        }
        OffsetDateTime extended = lastLapEnd.plus(OVERRUN_MARGIN);
        return extended.isAfter(scheduled) ? extended : scheduled;
    }

    @Override
    public List<FetchWindow> windows(Endpoint<?> endpoint, SessionRecord session, int driverNumber) {
        OffsetDateTime start = LocalBackupSource.start(session);
        OffsetDateTime end = effectiveEnd(session);
        List<FetchWindow> out = new ArrayList<>();
        for (int i = 0; !start.plusMinutes((long) WINDOW_MINUTES * i).isAfter(end); i++) {
            out.add(FetchWindow.nominal(WINDOW_MINUTES + "_" + String.format("%02d", i), start, end, WINDOW_MINUTES, i));
        }
        return out;
    }

    @Override
    public <T> List<T> fetch(Endpoint<T> endpoint, SessionRecord session, int driverNumber, FetchWindow window) {
        OffsetDateTime from = window.start();
        // Operator parameters are appended verbatim (see the class comment); only the values are encoded.
        Map<String, String> q = new LinkedHashMap<>();
        q.put("session_key", String.valueOf(session.sessionKey()));
        q.put("driver_number", String.valueOf(driverNumber));
        String query = query(q)
                + "&date%3E=" + encode(ISO.format(from))
                + "&date%3C" + encode(ISO.format(from.plusMinutes(WINDOW_MINUTES)));
        return parse(getRaw("/v1/" + endpoint.name(), query), endpoint.type());
    }

    private <T> List<T> parse(byte[] body, Class<T> type) {
        if (body == null || body.length == 0) {
            return List.of();
        }
        try (InputStream in = new ByteArrayInputStream(body)) {
            return OpenF1Json.parseList(in, type);
        } catch (IOException e) {
            throw new SourceException("cannot parse response as " + type.getSimpleName(), e);
        }
    }

    /** Returns the decoded body, or null for 404. */
    byte[] get(String path, Map<String, String> params) {
        return getRaw(path, query(params));
    }

    private byte[] getRaw(String path, String rawQuery) {
        URI uri = URI.create(config.baseUrl() + path + "?" + rawQuery);
        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofSeconds(90))
                .header("Accept-Encoding", "gzip")
                .header("Accept", "application/json")
                .GET().build();
        String failure = "";
        for (int attempt = 1; attempt <= config.maxAttempts(); attempt++) {
            Duration retryAfter = Duration.ZERO;
            try {
                limiter.acquire();
                HttpResponse<byte[]> resp = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
                int status = resp.statusCode();
                metrics.counter("ingest.http.responses", "status", String.valueOf(status)).increment();
                if (status == 200) {
                    return decode(resp);
                }
                if (status == 404) {
                    return null;
                }
                if (status == 429) {
                    metrics.counter("ingest.http.429").increment();
                }
                if (status != 429 && status < 500) {
                    throw new SourceException("HTTP " + status + " for " + uri);
                }
                failure = "HTTP " + status;
                retryAfter = resp.headers().firstValue("Retry-After").map(ApiSource::parseSeconds).orElse(Duration.ZERO);
            } catch (IOException e) {
                failure = e.toString();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new SourceException("interrupted while fetching " + uri, e);
            }
            if (attempt == config.maxAttempts()) {
                break;
            }
            Duration delay = backoff(attempt, retryAfter);
            log.warn("event=retry uri={} attempt={} reason=\"{}\" delay_ms={}", uri, attempt, failure, delay.toMillis());
            try {
                sleeper.sleep(delay);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new SourceException("interrupted while backing off " + uri, e);
            }
        }
        throw new SourceException("giving up after " + config.maxAttempts() + " attempts (" + failure + "): " + uri);
    }

    Duration backoff(int attempt, Duration retryAfter) {
        double ceiling = Math.min(config.maxDelay().toMillis(),
                config.baseDelay().toMillis() * Math.pow(2, attempt - 1));
        long millis = (long) (ceiling * (0.5 + 0.5 * jitter.getAsDouble()));
        return Duration.ofMillis(Math.max(millis, retryAfter.toMillis()));
    }

    private static Duration parseSeconds(String header) {
        try {
            return Duration.ofSeconds(Long.parseLong(header.trim()));
        } catch (NumberFormatException e) {
            return Duration.ZERO; // HTTP-date form is not worth supporting here
        }
    }

    private static byte[] decode(HttpResponse<byte[]> resp) throws IOException {
        boolean gzip = resp.headers().firstValue("Content-Encoding").map(v -> v.equalsIgnoreCase("gzip")).orElse(false);
        if (!gzip) {
            return resp.body();
        }
        try (InputStream in = new GZIPInputStream(new ByteArrayInputStream(resp.body()))) {
            return in.readAllBytes();
        }
    }

    private static String query(Map<String, String> params) {
        StringBuilder sb = new StringBuilder();
        params.forEach((k, v) -> {
            if (!sb.isEmpty()) {
                sb.append('&');
            }
            sb.append(encode(k)).append('=').append(encode(v));
        });
        return sb.toString();
    }

    private static String encode(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}
