package dev.f1battery.replay;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Streams one session's samples in time order. A reader thread pulls rows through a server-side
 * cursor (fetch size) into a bounded queue, so memory stays constant however long the session is
 * and the paced consumer decides how fast the cursor advances.
 *
 * <p>car_data and location do not share timestamps (they come from separate OpenF1 feeds with
 * different cadence), so each car_data row takes the latest location row at or before it within
 * two seconds, via the (session, driver, ts) index; with none in range x/y are null.
 */
public final class SampleSource implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(SampleSource.class);

    static final String SQL = """
            select c.ts, c.driver_number, c.speed, c.throttle, c.brake, l.x, l.y
            from car_data c
            left join lateral (
              select x, y from location
              where session_key = c.session_key and driver_number = c.driver_number
                and ts <= c.ts and ts > c.ts - interval '2 seconds'
              order by ts desc limit 1
            ) l on true
            where c.session_key = ? and (cardinality(?::int[]) = 0 or c.driver_number = any(?::int[]))
            order by c.ts, c.driver_number
            """;

    private static final Sample END = new Sample(0, 0, null, null, null, null, null, null);

    private final BlockingQueue<Sample> queue;
    private final Thread reader;
    private volatile Throwable failure;
    private volatile boolean closed;

    public SampleSource(ReplayConfig cfg, int bufferSize) {
        this.queue = new ArrayBlockingQueue<>(bufferSize);
        this.reader = new Thread(() -> read(cfg), "sample-reader");
        this.reader.setDaemon(true);
        this.reader.start();
    }

    private void read(ReplayConfig cfg) {
        try (Connection c = DriverManager.getConnection(cfg.dbUrl(), cfg.dbUser(), cfg.dbPassword())) {
            c.setAutoCommit(false); // PostgreSQL only honours the fetch size inside a transaction
            c.setReadOnly(true);
            try (PreparedStatement ps = c.prepareStatement(SQL)) {
                ps.setFetchSize(5000);
                ps.setInt(1, cfg.sessionKey());
                java.sql.Array arr = c.createArrayOf("int4", cfg.drivers().toArray());
                ps.setArray(2, arr);
                ps.setArray(3, arr);
                try (ResultSet rs = ps.executeQuery()) {
                    while (!closed && rs.next()) {
                        queue.put(new Sample(
                                cfg.sessionKey(),
                                rs.getInt("driver_number"),
                                rs.getTimestamp("ts").toInstant(),
                                nullableInt(rs, "speed"),
                                nullableInt(rs, "throttle"),
                                nullableInt(rs, "brake"),
                                nullableInt(rs, "x"),
                                nullableInt(rs, "y")));
                    }
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        } catch (SQLException | RuntimeException e) {
            failure = e;
            log.error("reading samples failed", e);
        }
        try {
            queue.put(END);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static Integer nullableInt(ResultSet rs, String col) throws SQLException {
        int v = rs.getInt(col);
        return rs.wasNull() ? null : v;
    }

    /** Next sample, or null once the session is exhausted. Throws if the reader failed. */
    public Sample next() throws InterruptedException {
        Sample s = queue.take();
        if (s == END) {
            if (failure != null) throw new IllegalStateException("sample reader failed", failure);
            return null;
        }
        return s;
    }

    @Override
    public void close() {
        closed = true;
        reader.interrupt();
    }
}
