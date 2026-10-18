package dev.f1battery.api;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Reference data from the Phase 1 and 2 tables. */
@RestController
@RequestMapping("/api")
public class ReferenceController {

    private final JdbcTemplate jdbc;
    private final Schema schema;
    private final OutlineService outlines;

    public ReferenceController(JdbcTemplate jdbc, Schema schema, OutlineService outlines) {
        this.jdbc = jdbc;
        this.schema = schema;
        this.outlines = outlines;
    }

    @GetMapping("/sessions")
    public Page<Map<String, Object>> sessions(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + Page.DEFAULT_SIZE) int size,
            @RequestParam(required = false) Integer year,
            @RequestParam(name = "circuit", required = false) Integer circuitKey) {
        Page.validate(page, size);
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" where true");
        if (year != null) {
            where.append(" and s.year = ?");
            args.add(year);
        }
        if (circuitKey != null) {
            where.append(" and s.circuit_key = ?");
            args.add(circuitKey);
        }
        long total = jdbc.queryForObject("select count(*) from session s" + where, Long.class, args.toArray());
        args.add(size);
        args.add((long) page * size);
        List<Map<String, Object>> items = jdbc.query(
                "select s.session_key, s.meeting_key, s.circuit_key, s.circuit_short_name, s.session_name, "
                        + "s.date_start, s.date_end, s.year, "
                        + "exists(select 1 from model_result m where m.session_key = s.session_key) as has_results "
                        + "from session s" + where + " order by s.date_start desc, s.session_key desc limit ? offset ?",
                Rows.MAP,
                args.toArray());
        return new Page<>(items, page, size, total);
    }

    @GetMapping("/sessions/{key}/drivers")
    public Page<Map<String, Object>> drivers(
            @PathVariable int key,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + Page.DEFAULT_SIZE) int size) {
        Page.validate(page, size);
        schema.requireSession(key);
        long total = jdbc.queryForObject("select count(*) from driver where session_key = ?", Long.class, key);
        List<Map<String, Object>> items = jdbc.query(
                "select driver_number, name_acronym, full_name, team_name from driver "
                        + "where session_key = ? order by driver_number limit ? offset ?",
                Rows.MAP,
                key,
                size,
                (long) page * size);
        return new Page<>(items, page, size, total);
    }

    @GetMapping("/sessions/{key}/laps")
    public Page<Map<String, Object>> laps(
            @PathVariable int key,
            @RequestParam(required = false) Integer driver,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + Page.DEFAULT_SIZE) int size) {
        Page.validate(page, size);
        schema.requireSession(key);
        boolean quality = schema.tableExists("lap_quality");
        List<Object> args = new ArrayList<>();
        args.add(key);
        String where = " where l.session_key = ?";
        if (driver != null) {
            where += " and l.driver_number = ?";
            args.add(driver);
        }
        String from = " from lap l"
                + (quality
                        ? " left join lap_quality q on q.session_key = l.session_key "
                                + "and q.driver_number = l.driver_number and q.lap_number = l.lap_number"
                        : "");
        long total = jdbc.queryForObject("select count(*)" + from + where, Long.class, args.toArray());
        args.add(size);
        args.add((long) page * size);
        List<Map<String, Object>> items = jdbc.query(
                "select l.driver_number, l.lap_number, l.date_start, l.lap_duration, "
                        + (quality ? "q.green as green, q.reason as reason" : "null::boolean as green, null::text as reason")
                        + from + where + " order by l.driver_number, l.lap_number limit ? offset ?",
                Rows.MAP,
                args.toArray());
        return new Page<>(items, page, size, total);
    }

    @GetMapping("/circuits/{circuitKey}/straights")
    public Page<Map<String, Object>> straights(
            @PathVariable int circuitKey,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "" + Page.DEFAULT_SIZE) int size) {
        Page.validate(page, size);
        if (!schema.tableExists("straight")) {
            return new Page<>(List.of(), page, size, 0);
        }
        long total = jdbc.queryForObject("select count(*) from straight where circuit_key = ?", Long.class, circuitKey);
        List<Map<String, Object>> items = jdbc.query(
                "select straight_id, label, start_pct, end_pct from straight where circuit_key = ? "
                        + "order by straight_id limit ? offset ?",
                Rows.MAP,
                circuitKey,
                size,
                (long) page * size);
        return new Page<>(items, page, size, total);
    }

    @GetMapping("/circuits/{circuitKey}/outline")
    public Map<String, Object> outline(@PathVariable int circuitKey) {
        return outlines.outline(circuitKey)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "no outline available for circuit " + circuitKey));
    }

    @GetMapping("/sessions/{key}/regulation")
    public Map<String, Object> regulation(@PathVariable int key) {
        schema.requireSession(key);
        List<Map<String, Object>> rows = jdbc.query(
                "select session_key, issue_in_force, race_recharge_mj, quali_recharge_mj, "
                        + "derate_rate_kw_per_s, limit_known from regulation_event where session_key = ?",
                Rows.MAP,
                key);
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no regulation event for session " + key);
        }
        return rows.get(0);
    }
}
