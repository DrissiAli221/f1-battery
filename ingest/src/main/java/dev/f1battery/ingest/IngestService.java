package dev.f1battery.ingest;

import dev.f1battery.ingest.log.IngestionLog;
import dev.f1battery.ingest.log.IngestionLog.Unit;
import dev.f1battery.ingest.source.Endpoint;
import dev.f1battery.ingest.source.FetchWindow;
import dev.f1battery.ingest.source.OpenF1Records.DriverRecord;
import dev.f1battery.ingest.source.OpenF1Records.SessionRecord;
import dev.f1battery.ingest.source.OpenF1Source;
import dev.f1battery.ingest.upsert.Upserter;
import dev.f1battery.ingest.upsert.Upserters;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Drives one ingestion run. For each selected session: the session row, the
 * drivers, the session-wide endpoints, then car_data and location per driver
 * and window. Every fetch unit is checked against the ingestion log first and
 * recorded after, so a rerun only does what is missing.
 *
 * <p>A unit's rows and its log entry are written in one transaction: a crash
 * cannot leave a "complete" entry without its data. A failed unit is logged
 * outside the transaction and does not stop the run; the exit status reports it.
 */
@Service
public class IngestService {

    private static final Logger log = LoggerFactory.getLogger(IngestService.class);
    private static final OffsetDateTime EPOCH = OffsetDateTime.of(1970, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();

    enum Outcome { DONE, SKIPPED, FAILED, DRY_RUN }

    /** Result of a whole run. */
    public record Summary(int sessions, int unitsDone, int unitsSkipped, int unitsFailed) {
        public boolean ok() {
            return unitsFailed == 0;
        }
    }

    private static final class Stats {
        final Map<String, Long> rows = new LinkedHashMap<>();
        int done;
        int skipped;
        int failed;
        long changed;
    }

    private final List<OpenF1Source> sources;
    private final IngestionLog ingestionLog;
    private final Upserters up;
    private final TransactionTemplate tx;
    private final JdbcTemplate jdbc;
    private final MeterRegistry metrics;

    public IngestService(List<OpenF1Source> sources, IngestionLog ingestionLog, Upserters up,
            TransactionTemplate tx, JdbcTemplate jdbc, MeterRegistry metrics) {
        this.sources = sources;
        this.ingestionLog = ingestionLog;
        this.up = up;
        this.tx = tx;
        this.jdbc = jdbc;
        this.metrics = metrics;
    }

    public Summary run(IngestOptions o) {
        OpenF1Source source = sources.stream().filter(s -> s.name().equals(o.source())).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("no source named " + o.source()));
        List<SessionRecord> sessions = source.sessions(o.year()).stream()
                .filter(s -> s.sessionKey() != null && o.accepts(s.sessionName(), s.sessionKey()))
                .toList();
        log.info("event=run_start source={} year={} sessions={} dry_run={}", o.source(), o.year(), sessions.size(), o.dryRun());
        int done = 0;
        int skipped = 0;
        int failed = 0;
        for (SessionRecord s : sessions) {
            Stats st = ingestSession(source, s, o.dryRun(), o.refresh());
            done += st.done;
            skipped += st.skipped;
            failed += st.failed;
        }
        Summary summary = new Summary(sessions.size(), done, skipped, failed);
        log.info("event=run_end sessions={} units_done={} units_skipped={} units_failed={}", sessions.size(), done, skipped, failed);
        log.info("metrics_summary {}", metricsSummary(summary));
        return summary;
    }

    /**
     * One-line JSON summary of the run. The job has no web server, so there is nothing to scrape; the
     * counters live in the in-process registry and are written to the log once, at the end.
     * Rows are the rows actually changed (an unchanged re-upsert counts 0).
     */
    String metricsSummary(Summary s) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("event", "run_metrics");
        out.put("sessions", s.sessions());
        out.put("units_done", s.unitsDone());
        out.put("units_skipped", s.unitsSkipped());
        out.put("units_failed", s.unitsFailed());
        Map<String, Long> rows = new java.util.TreeMap<>();
        metrics.find("ingest.rows.upserted").counters().forEach(c -> {
            String table = c.getId().getTag("table");
            if (table != null) {
                rows.merge(table, (long) c.count(), Long::sum);
            }
        });
        out.put("rows_upserted", rows);
        var c429 = metrics.find("ingest.http.429").counter();
        out.put("http_429", c429 == null ? 0L : (long) c429.count());
        try {
            return JSON.writeValueAsString(out);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            return "{\"event\":\"run_metrics\",\"error\":\"serialisation failed\"}";
        }
    }

    private Stats ingestSession(OpenF1Source src, SessionRecord s, boolean dry, Set<String> refresh) {
        Stats st = new Stats();
        int sk = s.sessionKey();
        OffsetDateTime start = s.dateStart() != null ? s.dateStart() : EPOCH;
        OffsetDateTime end = s.dateEnd() != null ? s.dateEnd() : start;
        log.info("event=session_start session={} name=\"{}\" date_start={}", sk, s.sessionName(), s.dateStart());

        // The session row must exist before drivers (foreign key).
        unit(src, st, dry, refresh, new Unit("sessions", sk, null, start, end, Unit.SESSION), () -> List.of(s), up.session);

        List<DriverRecord> fetched = new ArrayList<>();
        unit(src, st, dry, refresh, new Unit("drivers", sk, null, start, end, Unit.SESSION),
                () -> {
                    List<DriverRecord> rows = src.fetch(Endpoint.DRIVERS, s);
                    fetched.addAll(rows);
                    return rows;
                }, up.driver);

        whole(src, st, dry, refresh, s, Endpoint.LAPS, up.lap);
        whole(src, st, dry, refresh, s, Endpoint.STINTS, up.stint);
        whole(src, st, dry, refresh, s, Endpoint.PIT, up.pit);
        whole(src, st, dry, refresh, s, Endpoint.OVERTAKES, up.overtake);
        whole(src, st, dry, refresh, s, Endpoint.RACE_CONTROL, up.raceControl);
        whole(src, st, dry, refresh, s, Endpoint.INTERVALS, up.interval);
        whole(src, st, dry, refresh, s, Endpoint.POSITION, up.position);
        whole(src, st, dry, refresh, s, Endpoint.WEATHER, up.weather);
        whole(src, st, dry, refresh, s, Endpoint.SESSION_RESULT, up.sessionResult);
        whole(src, st, dry, refresh, s, Endpoint.STARTING_GRID, up.startingGrid);
        whole(src, st, dry, refresh, s, Endpoint.TEAM_RADIO, up.teamRadio);

        // If the drivers unit was skipped as complete, the numbers come from the table.
        List<Integer> drivers = !fetched.isEmpty()
                ? fetched.stream().map(DriverRecord::driverNumber).filter(java.util.Objects::nonNull).distinct().sorted().toList()
                : jdbc.queryForList("SELECT driver_number FROM driver WHERE session_key = ? ORDER BY driver_number", Integer.class, sk);
        for (int d : drivers) {
            telemetry(src, st, dry, refresh, s, d, Endpoint.CAR_DATA, up.carData);
            telemetry(src, st, dry, refresh, s, d, Endpoint.LOCATION, up.location);
        }

        log.info("event=session_summary session={} name=\"{}\" units_done={} units_skipped={} units_failed={} rows_fetched={} rows_changed={}",
                sk, s.sessionName(), st.done, st.skipped, st.failed, st.rows, st.changed);
        return st;
    }

    private <T> void whole(OpenF1Source src, Stats st, boolean dry, Set<String> refresh, SessionRecord s, Endpoint<T> ep, Upserter<T> upserter) {
        OffsetDateTime start = s.dateStart() != null ? s.dateStart() : EPOCH;
        OffsetDateTime end = s.dateEnd() != null ? s.dateEnd() : start;
        unit(src, st, dry, refresh, new Unit(ep.name(), s.sessionKey(), null, start, end, Unit.SESSION), () -> src.fetch(ep, s), upserter);
    }

    private <T> void telemetry(OpenF1Source src, Stats st, boolean dry, Set<String> refresh, SessionRecord s, int driver,
            Endpoint<T> ep, Upserter<T> upserter) {
        for (FetchWindow w : src.windows(ep, s, driver)) {
            unit(src, st, dry, refresh, new Unit(ep.name(), s.sessionKey(), driver, w.start(), w.end(), w.label()),
                    () -> src.fetch(ep, s, driver, w), upserter);
        }
    }

    private <T> Outcome unit(OpenF1Source src, Stats st, boolean dry, Set<String> refresh, Unit u, Supplier<List<T>> fetch,
            Upserter<T> upserter) {
        Outcome outcome;
        int rows = 0;
        String status = null;
        try {
            if (!refresh.contains(u.endpoint()) && ingestionLog.isComplete(u, src.name())) {
                outcome = Outcome.SKIPPED;
            } else if (dry) {
                rows = fetch.get().size();
                outcome = Outcome.DRY_RUN;
            } else {
                List<T> data = fetch.get();
                rows = data.size();
                status = statusOf(data);
                int changed = tx.execute(t -> {
                    int n = upserter.upsert(data);
                    ingestionLog.record(u, src.name(), data.size(), statusOf(data));
                    return n;
                });
                st.changed += changed;
                outcome = Outcome.DONE;
            }
        } catch (RuntimeException e) {
            outcome = Outcome.FAILED;
            status = IngestionLog.FAILED;
            log.error("event=unit_failed endpoint={} session={} driver={} window_start={} error=\"{}\"",
                    u.endpoint(), u.sessionKey(), u.driverNumber(), u.windowStart(), e.toString());
            try {
                ingestionLog.record(u, src.name(), 0, IngestionLog.FAILED);
            } catch (RuntimeException logError) {
                log.error("event=log_write_failed endpoint={} session={} error=\"{}\"", u.endpoint(), u.sessionKey(), logError.toString());
            }
        }
        switch (outcome) {
            case DONE, DRY_RUN -> st.done++;
            case SKIPPED -> st.skipped++;
            case FAILED -> st.failed++;
        }
        st.rows.merge(u.endpoint(), (long) rows, Long::sum);
        metrics.counter("ingest.fetch.units", "status", outcome.name().toLowerCase()).increment();
        log.debug("event=unit endpoint={} session={} driver={} window_start={} rows={} outcome={} status={}",
                u.endpoint(), u.sessionKey(), u.driverNumber(), u.windowStart(), rows, outcome, status);
        return outcome;
    }

    private static String statusOf(List<?> data) {
        return data.isEmpty() ? IngestionLog.NO_DATA : IngestionLog.COMPLETE;
    }
}
