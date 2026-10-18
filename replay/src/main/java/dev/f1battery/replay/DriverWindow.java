package dev.f1battery.replay;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Optional;

/**
 * Sliding window of recent samples of one driver. Once five samples are present the middle one is
 * labelled, using the centred difference {@code (v[i+2] - v[i-2]) / (t[i+2] - t[i-2])} as its
 * acceleration. The label therefore lags the newest sample by two samples (about half a second).
 *
 * <p>The window also keeps a running distance, the integral of speed over sample time since the
 * first sample seen by this instance. It is not anchored to the start/finish line (see
 * docs/phase7-replay.md), and gaps longer than {@link #MAX_GAP} do not contribute.
 */
public final class DriverWindow {

    static final int SIZE = 5;
    static final Duration MAX_GAP = Duration.ofSeconds(2);

    /** A labelled sample with its running distance. */
    public record Labelled(Sample sample, String regime, double accel, double distanceM) {}

    private record Entry(Sample sample, double speedMs, double distanceM) {}

    private final Deque<Entry> window = new ArrayDeque<>(SIZE);
    private Instant lastTs;
    private double distance;

    /** Adds a sample; returns the labelled middle sample once the window is full. */
    public Optional<Labelled> add(Sample s) {
        if (s.speed() == null || s.throttle() == null || s.brake() == null) return Optional.empty();
        if (lastTs != null && !s.ts().isAfter(lastTs)) return Optional.empty(); // duplicate or out of order
        double v = s.speed() / 3.6;
        if (lastTs != null) {
            Duration gap = Duration.between(lastTs, s.ts());
            if (gap.compareTo(MAX_GAP) <= 0) {
                Entry prev = window.peekLast();
                distance += 0.5 * (prev.speedMs() + v) * gap.toNanos() / 1e9;
            } else {
                window.clear(); // a gap invalidates the finite difference
            }
        }
        lastTs = s.ts();
        window.addLast(new Entry(s, v, distance));
        if (window.size() > SIZE) window.removeFirst();
        if (window.size() < SIZE) return Optional.empty();

        Entry[] e = window.toArray(new Entry[0]);
        double dt = Duration.between(e[0].sample().ts(), e[SIZE - 1].sample().ts()).toNanos() / 1e9;
        double accel = (e[SIZE - 1].speedMs() - e[0].speedMs()) / dt;
        Entry mid = e[SIZE / 2];
        String regime = RegimeRules.classify(mid.sample().throttle(), mid.sample().brake(), accel);
        return Optional.of(new Labelled(mid.sample(), regime, accel, mid.distanceM()));
    }
}
