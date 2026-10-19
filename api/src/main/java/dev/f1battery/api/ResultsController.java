package dev.f1battery.api;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Endpoints over model_result. A request reads one run (model_version + run_id); when the
 * table holds nothing yet every endpoint answers with empty lists rather than an error.
 */
@RestController
@RequestMapping("/api")
public class ResultsController {

    /** Width of a regime bin along the lap; matches the Phase 4 binning. */
    static final int BIN_METRES = 50;

    private static final String[] REGIME_LABELS = {"deploy", "plateau", "lift", "brake"};
    private static final List<String> REGIME_SHARES =
            List.of("regime_share_deploy", "regime_share_plateau", "regime_share_lift", "regime_share_brake");

    private final JdbcTemplate jdbc;
    private final Schema schema;
    private final ModelRuns runs;

    public ResultsController(JdbcTemplate jdbc, Schema schema, ModelRuns runs) {
        this.jdbc = jdbc;
        this.schema = schema;
        this.runs = runs;
    }

    @GetMapping("/models")
    public Page<Map<String, Object>> models(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + Page.DEFAULT_SIZE) int size) {
        Page.validate(page, size);
        if (runs.tracksRuns()) {
            // Published runs only; no scan of model_result.
            long published = jdbc.queryForObject("select count(*) from model_run where published", Long.class);
            List<Map<String, Object>> rows = jdbc.query(
                    "select model_version, run_id, coalesce(finished_at, started_at) as created_at from model_run "
                            + "where published order by finished_at desc nulls last, started_at desc limit ? offset ?",
                    Rows.MAP,
                    size,
                    (long) page * size);
            return new Page<>(rows, page, size, published);
        }
        long total = jdbc.queryForObject(
                "select count(*) from (select 1 from model_result group by model_version, run_id) t", Long.class);
        List<Map<String, Object>> items = jdbc.query(
                "select model_version, run_id, max(created_at) as created_at from model_result "
                        + "group by model_version, run_id order by max(created_at) desc limit ? offset ?",
                Rows.MAP,
                size,
                (long) page * size);
        return new Page<>(items, page, size, total);
    }

    @GetMapping("/results")
    public Page<Map<String, Object>> results(
            @RequestParam(required = false) Integer session,
            @RequestParam(required = false) Integer driver,
            @RequestParam(required = false) String variable,
            @RequestParam(required = false) Integer straight,
            @RequestParam(required = false) Integer lap,
            @RequestParam(required = false) String model,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + Page.DEFAULT_SIZE) int size) {
        Page.validate(page, size);
        Optional<ModelRuns.Run> run = runs.resolve(model);
        if (run.isEmpty()) {
            return new Page<>(List.of(), page, size, 0);
        }
        List<Object> args = new ArrayList<>();
        args.add(run.get().modelVersion());
        args.add(run.get().runId());
        StringBuilder where = new StringBuilder(" where model_version = ? and run_id = ?");
        if (session != null) {
            where.append(" and session_key = ?");
            args.add(session);
        }
        if (driver != null) {
            where.append(" and driver_number = ?");
            args.add(driver);
        }
        if (variable != null) {
            where.append(" and variable = ?");
            args.add(variable);
        }
        if (straight != null) {
            where.append(" and straight_id = ?");
            args.add(straight);
        }
        if (lap != null) {
            where.append(" and lap_number = ?");
            args.add(lap);
        }
        long total = jdbc.queryForObject("select count(*) from model_result" + where, Long.class, args.toArray());
        args.add(size);
        args.add((long) page * size);
        List<Map<String, Object>> items = jdbc.query(
                "select model_version, run_id, session_key, driver_number, lap_number, straight_id, variable, "
                        + "value, ci_low, ci_high from model_result" + where
                        + " order by session_key, driver_number, lap_number, straight_id nulls first, variable "
                        + "limit ? offset ?",
                Rows.MAP,
                args.toArray());
        return new Page<>(items, page, size, total);
    }

    /**
     * Per driver: the bootstrap median cut-off per straight (stored at lap_number 0) and the
     * regime shares averaged over green laps. When the session has no lap_quality rows the
     * average is over every lap, which is the only option available.
     */
    @GetMapping("/sessions/{key}/summary")
    public Page<Map<String, Object>> summary(
            @PathVariable int key,
            @RequestParam(required = false) String model,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + Page.DEFAULT_SIZE) int size) {
        Page.validate(page, size);
        schema.requireSession(key);
        Optional<ModelRuns.Run> run = runs.resolve(model);
        if (run.isEmpty()) {
            return new Page<>(List.of(), page, size, 0);
        }
        return summaryFor(key, run.get(), page, size);
    }

    private Page<Map<String, Object>> summaryFor(int key, ModelRuns.Run run, int page, int size) {
        Object[] runArgs = {run.modelVersion(), run.runId(), key};
        List<Map<String, Object>> drivers = jdbc.query(
                "select d.driver_number, d.name_acronym, d.full_name, d.team_name from driver d "
                        + "where d.session_key = ? and exists (select 1 from model_result m "
                        + "where m.model_version = ? and m.run_id = ? and m.session_key = d.session_key "
                        + "and m.driver_number = d.driver_number) order by d.driver_number",
                Rows.MAP,
                key,
                run.modelVersion(),
                run.runId());

        Map<Integer, List<Map<String, Object>>> straights = new LinkedHashMap<>();
        jdbc.query(
                "select driver_number, straight_id, value, ci_low, ci_high from model_result "
                        + "where model_version = ? and run_id = ? and session_key = ? and lap_number = 0 "
                        + "and variable = 'cutoff_distance_median_m' order by driver_number, straight_id",
                rs -> {
                    Map<String, Object> s = new LinkedHashMap<>();
                    s.put("straight_id", rs.getObject("straight_id"));
                    s.put("cutoff_distance_median_m", rs.getObject("value"));
                    s.put("ci_low", rs.getObject("ci_low"));
                    s.put("ci_high", rs.getObject("ci_high"));
                    straights.computeIfAbsent(rs.getInt("driver_number"), k -> new ArrayList<>()).add(s);
                },
                runArgs);

        boolean green = schema.hasLapQuality(key);
        Map<Integer, Map<String, Object>> shares = new LinkedHashMap<>();
        jdbc.query(
                "select m.driver_number, m.variable, avg(m.value) as v from model_result m "
                        + "where m.model_version = ? and m.run_id = ? and m.session_key = ? and m.lap_number > 0 "
                        + "and m.variable in ('regime_share_deploy','regime_share_plateau','regime_share_lift','regime_share_brake') "
                        + (green
                                ? "and exists (select 1 from lap_quality q where q.session_key = m.session_key "
                                        + "and q.driver_number = m.driver_number and q.lap_number = m.lap_number and q.green) "
                                : "")
                        + "group by m.driver_number, m.variable",
                rs -> {
                    String name = rs.getString("variable").substring("regime_share_".length());
                    shares.computeIfAbsent(rs.getInt("driver_number"), k -> new LinkedHashMap<>())
                            .put(name, rs.getObject("v"));
                },
                runArgs);

        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> d : drivers) {
            int n = ((Number) d.get("driver_number")).intValue();
            Map<String, Object> item = new LinkedHashMap<>(d);
            item.put("straights", straights.getOrDefault(n, List.of()));
            item.put("regime_shares", shares.getOrDefault(n, Map.of()));
            items.add(item);
        }
        return Page.of(items, page, size);
    }

    @GetMapping("/sessions/{key}/laps/{lap}/regimes")
    public Page<Map<String, Object>> regimes(
            @PathVariable int key,
            @PathVariable int lap,
            @RequestParam int driver,
            @RequestParam(required = false) String model,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + Page.DEFAULT_SIZE) int size) {
        Page.validate(page, size);
        schema.requireSession(key);
        Optional<ModelRuns.Run> run = runs.resolve(model);
        if (run.isEmpty()) {
            return new Page<>(List.of(), page, size, 0);
        }
        List<Map<String, Object>> bins = new ArrayList<>();
        jdbc.query(
                "select variable, value from model_result where model_version = ? and run_id = ? "
                        + "and session_key = ? and driver_number = ? and lap_number = ? and variable like 'regime\\_bin\\_%'",
                rs -> {
                    String v = rs.getString("variable");
                    double value = rs.getDouble("value");
                    int code = (int) Math.round(value);
                    if (rs.wasNull() || code < 0 || code >= REGIME_LABELS.length) {
                        return;
                    }
                    try {
                        int bin = Integer.parseInt(v.substring("regime_bin_".length()));
                        Map<String, Object> b = new LinkedHashMap<>();
                        b.put("bin", bin);
                        b.put("d_start_m", bin * BIN_METRES);
                        b.put("label", REGIME_LABELS[code]);
                        bins.add(b);
                    } catch (NumberFormatException ignored) {
                        // not a bin variable
                    }
                },
                run.get().modelVersion(),
                run.get().runId(),
                key,
                driver,
                lap);
        bins.sort(Comparator.comparingInt(b -> (Integer) b.get("bin")));
        return Page.of(bins, page, size);
    }

    /** Per-lap cut-off series of two drivers on the same session (and optionally one straight). */
    @GetMapping("/compare")
    public Map<String, Object> compare(
            @RequestParam int session,
            @RequestParam String drivers,
            @RequestParam(required = false) Integer straight,
            @RequestParam(required = false) String model) {
        schema.requireSession(session);
        List<Integer> numbers = new ArrayList<>();
        try {
            for (String s : drivers.split(",")) {
                numbers.add(Integer.parseInt(s.trim()));
            }
        } catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "drivers must be two comma-separated numbers");
        }
        if (numbers.size() != 2 || numbers.get(0).equals(numbers.get(1))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "drivers must be two distinct driver numbers");
        }
        Optional<ModelRuns.Run> run = runs.resolve(model);
        List<Map<String, Object>> out = new ArrayList<>();
        for (int n : numbers) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("driver_number", n);
            List<Map<String, Object>> names = jdbc.query(
                    "select name_acronym, team_name from driver where session_key = ? and driver_number = ?",
                    Rows.MAP,
                    session,
                    n);
            d.put("name_acronym", names.isEmpty() ? null : names.get(0).get("name_acronym"));
            d.put("team_name", names.isEmpty() ? null : names.get(0).get("team_name"));
            List<Map<String, Object>> series = List.of();
            if (run.isPresent()) {
                List<Object> args = new ArrayList<>(
                        List.of(run.get().modelVersion(), run.get().runId(), session, n));
                String sf = "";
                if (straight != null) {
                    sf = " and straight_id = ?";
                    args.add(straight);
                }
                series = jdbc.query(
                        "select lap_number, straight_id, value as cutoff_distance_m, ci_low, ci_high from model_result "
                                + "where model_version = ? and run_id = ? and session_key = ? and driver_number = ? "
                                + "and lap_number > 0 and variable = 'cutoff_distance_m'" + sf
                                + " order by lap_number, straight_id",
                        Rows.MAP,
                        args.toArray());
            }
            d.put("series", series);
            out.add(d);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("session_key", session);
        body.put("model_version", run.map(ModelRuns.Run::modelVersion).orElse(null));
        body.put("straight_id", straight);
        body.put("drivers", out);
        return body;
    }
}
