package dev.f1battery.replay;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Per-driver consumer state: the {@link DriverWindow}, the newest sample time seen and the wall
 * time of the last emitted state (the throttle).
 *
 * <p>A sample older than the newest one seen by more than {@link #RESTART_BACKWARDS} means the
 * producer started the session again from the beginning on the same topic. The window and the
 * throttle are then reset, otherwise every sample of the new pass would be dropped as out of order.
 */
final class DriverTrack {

    static final Duration RESTART_BACKWARDS = Duration.ofSeconds(30);

    private static final Logger log = LoggerFactory.getLogger(DriverTrack.class);

    private final int driverNumber;
    private final long minIntervalMs;
    private DriverWindow window = new DriverWindow();
    private Instant newestTs;
    private Long lastEmitNanos;
    private int restarts;

    DriverTrack(int driverNumber, long minIntervalMs) {
        this.driverNumber = driverNumber;
        this.minIntervalMs = minIntervalMs;
    }

    int restarts() {
        return restarts;
    }

    /** Returns the labelled sample to publish now, if any. */
    Optional<DriverWindow.Labelled> add(Sample s, long nowNanos) {
        if (newestTs != null && s.ts().isBefore(newestTs.minus(RESTART_BACKWARDS))) {
            log.info("replay restart detected for driver {}", driverNumber);
            restarts++;
            window = new DriverWindow();
            lastEmitNanos = null;
            newestTs = null;
        }
        if (newestTs == null || s.ts().isAfter(newestTs)) newestTs = s.ts();
        var labelled = window.add(s);
        if (labelled.isEmpty()) return Optional.empty();
        if (lastEmitNanos != null && (nowNanos - lastEmitNanos) / 1_000_000 < minIntervalMs) return Optional.empty();
        lastEmitNanos = nowNanos;
        return labelled;
    }
}
