package dev.f1battery.ingest.upsert;

import io.micrometer.core.instrument.MeterRegistry;
import java.sql.Statement;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Shared mechanics for the per-table upserters: in-memory dedupe on the natural
 * key, one prepared INSERT ... ON CONFLICT statement, JDBC batching.
 *
 * <p>Dedupe happens before the statement is sent because the backup holds
 * overlapping windowed files and the API can repeat a timestamp; neither should
 * reach the database as a conflict. The last occurrence of a key wins.
 *
 * <p>Tables that can legitimately change (laps, stints, ...) use DO UPDATE
 * guarded by IS DISTINCT FROM, so an unchanged row is not rewritten and is not
 * counted. Append-only telemetry and log-like tables use DO NOTHING.
 *
 * <p>The returned count is exact with the default driver settings. Enabling the
 * driver's reWriteBatchedInserts makes it report "unknown" per statement, which
 * is counted here as one row each.
 */
abstract class BatchUpserter<T> implements Upserter<T> {

    static final int BATCH_SIZE = 5000;

    private final JdbcTemplate jdbc;
    private final MeterRegistry metrics;
    private final String table;
    private final String sql;
    private final int batchSize;

    /**
     * @param conflictTarget the column list or expression list of the unique index
     * @param updateColumns  columns refreshed on conflict; empty means DO NOTHING
     * @param jsonbColumns   columns bound as text and cast to jsonb
     */
    BatchUpserter(JdbcTemplate jdbc, MeterRegistry metrics, String table, List<String> columns,
            String conflictTarget, List<String> updateColumns, Set<String> jsonbColumns, int batchSize) {
        this.jdbc = jdbc;
        this.metrics = metrics;
        this.table = table;
        this.batchSize = batchSize;
        String placeholders = columns.stream()
                .map(c -> jsonbColumns.contains(c) ? "CAST(? AS jsonb)" : "?")
                .collect(Collectors.joining(", "));
        StringBuilder b = new StringBuilder("INSERT INTO ").append(table)
                .append(" (").append(String.join(", ", columns)).append(") VALUES (").append(placeholders)
                .append(") ON CONFLICT (").append(conflictTarget).append(") ");
        if (updateColumns.isEmpty()) {
            b.append("DO NOTHING");
        } else {
            b.append("DO UPDATE SET ")
                    .append(updateColumns.stream().map(c -> c + " = EXCLUDED." + c).collect(Collectors.joining(", ")))
                    .append(" WHERE (")
                    .append(updateColumns.stream().map(c -> table + "." + c).collect(Collectors.joining(", ")))
                    .append(") IS DISTINCT FROM (")
                    .append(updateColumns.stream().map(c -> "EXCLUDED." + c).collect(Collectors.joining(", ")))
                    .append(")");
        }
        this.sql = b.toString();
    }

    /** The natural key, matching the unique index; null elements make the row invalid. */
    abstract List<Object> key(T row);

    /** Values in column order. */
    abstract Object[] values(T row);

    /** Rows with an unusable key are dropped (they could not be stored). */
    boolean valid(T row) {
        return key(row).stream().noneMatch(java.util.Objects::isNull);
    }

    @Override
    public String table() {
        return table;
    }

    @Override
    public int upsert(List<T> rows) {
        Map<List<Object>, T> unique = new LinkedHashMap<>();
        for (T row : rows) {
            if (valid(row)) {
                unique.put(key(row), row);
            }
        }
        if (unique.isEmpty()) {
            return 0;
        }
        int[][] results = jdbc.batchUpdate(sql, new ArrayList<>(unique.values()), batchSize, (ps, row) -> {
            Object[] v = values(row);
            for (int i = 0; i < v.length; i++) {
                ps.setObject(i + 1, v[i]);
            }
        });
        int changed = 0;
        for (int[] batch : results) {
            for (int r : batch) {
                changed += r >= 0 ? r : (r == Statement.SUCCESS_NO_INFO ? 1 : 0);
            }
        }
        metrics.counter("ingest.rows.upserted", "table", table).increment(changed);
        return changed;
    }

    /** Timestamps are compared as instants so offsets cannot split a key. */
    static Object instant(OffsetDateTime t) {
        return t == null ? null : t.toInstant();
    }
}
