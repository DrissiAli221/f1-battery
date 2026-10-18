package dev.f1battery.api;

import java.sql.ResultSetMetaData;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.RowMapper;

/** Row mapper that keeps column names as JSON keys and renders timestamps as ISO instants. */
final class Rows {

    private Rows() {}

    static final RowMapper<Map<String, Object>> MAP = (rs, i) -> {
        ResultSetMetaData md = rs.getMetaData();
        Map<String, Object> row = new LinkedHashMap<>();
        for (int c = 1; c <= md.getColumnCount(); c++) {
            Object v = rs.getObject(c);
            if (v instanceof Timestamp ts) {
                v = ts.toInstant();
            }
            row.put(md.getColumnLabel(c), v);
        }
        return row;
    };
}
