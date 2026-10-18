package dev.f1battery.replay;

import java.time.Duration;
import java.time.Instant;

/**
 * Maps sample timestamps onto the wall clock. The first sample anchors the schedule; sample
 * {@code t} is due at {@code anchor + (t - t0) / speed}. Scheduling against absolute targets (not
 * "sleep for the gap") keeps the replay from drifting when a publish takes a while.
 */
public final class Pacer {

    /** Time source, replaceable in tests. */
    public interface Clock {
        long nanoTime();

        void sleepNanos(long nanos) throws InterruptedException;

        Clock SYSTEM = new Clock() {
            @Override
            public long nanoTime() {
                return System.nanoTime();
            }

            @Override
            public void sleepNanos(long nanos) throws InterruptedException {
                Thread.sleep(Duration.ofNanos(nanos));
            }
        };
    }

    /** After a stall longer than this (a slow query, a GC pause) the schedule is re-anchored instead of bursting to catch up. */
    static final long MAX_LAG_NANOS = Duration.ofSeconds(5).toNanos();

    private final Clock clock;
    private final double speed;
    private Instant firstTs;
    private long anchorNanos;

    public Pacer(Clock clock, double speed) {
        if (!(speed > 0)) throw new IllegalArgumentException("speed must be positive");
        this.clock = clock;
        this.speed = speed;
    }

    /** Blocks until {@code ts} is due. Returns the nanoseconds slept (0 when already due). */
    public long awaitDue(Instant ts) throws InterruptedException {
        long now = clock.nanoTime();
        if (firstTs == null) {
            firstTs = ts;
            anchorNanos = now;
            return 0;
        }
        long offset = (long) (Duration.between(firstTs, ts).toNanos() / speed);
        long due = anchorNanos + offset;
        long wait = due - now;
        if (wait > 0) {
            clock.sleepNanos(wait);
            return wait;
        }
        if (-wait > MAX_LAG_NANOS) anchorNanos += -wait; // re-anchor so that this sample is due now
        return 0;
    }
}
