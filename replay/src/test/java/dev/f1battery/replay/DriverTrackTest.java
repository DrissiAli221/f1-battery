package dev.f1battery.replay;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class DriverTrackTest {

    static final Instant T0 = Instant.parse("2026-09-06T13:00:00Z");
    static final long MS = 1_000_000L;

    static Sample at(Instant ts) {
        return new Sample(1, 44, ts, 200, 100, 0, 0, 0);
    }

    /** Feeds 250 ms samples from {@code start}; wall clock advances 250 ms per sample. */
    static int feed(DriverTrack t, Instant start, int n, long[] wallMs) {
        int out = 0;
        for (int i = 0; i < n; i++) {
            wallMs[0] += 250;
            if (t.add(at(start.plusMillis(250L * i)), wallMs[0] * MS).isPresent()) out++;
        }
        return out;
    }

    @Test
    void aRestartFromTheStartResumesOutput() {
        DriverTrack t = new DriverTrack(44, 250);
        long[] wall = {0};
        assertTrue(feed(t, T0.plusSeconds(600), 40, wall) > 0);
        assertEquals(0, t.restarts());
        // the same session again from its first sample, 10 minutes earlier
        assertTrue(feed(t, T0, 40, wall) > 0);
        assertEquals(1, t.restarts());
    }

    @Test
    void withoutTheResetTheOldWindowWouldDropEverything() {
        DriverWindow w = new DriverWindow();
        for (int i = 0; i < 10; i++) w.add(at(T0.plusSeconds(600).plusMillis(250L * i)));
        for (int i = 0; i < 10; i++) assertTrue(w.add(at(T0.plusMillis(250L * i))).isEmpty());
    }

    @Test
    void smallBackwardsJumpsAreOrdinaryDisorder() {
        DriverTrack t = new DriverTrack(44, 0);
        long[] wall = {0};
        feed(t, T0, 40, wall);
        t.add(at(T0.plusSeconds(5)), (wall[0] += 250) * MS); // 5 s behind the newest: not a restart
        assertEquals(0, t.restarts());
    }

    @Test
    void theThrottleIsResetOnRestart() {
        DriverTrack t = new DriverTrack(44, 10_000); // at most one state per 10 s wall time
        long wall = 0;
        int out = 0;
        for (int i = 0; i < 10; i++) if (t.add(at(T0.plusSeconds(600).plusMillis(250L * i)), (wall += 1) * MS).isPresent()) out++;
        assertEquals(1, out);
        // restart a moment later: the throttle window of the old pass must not swallow the first state
        int again = 0;
        for (int i = 0; i < 10; i++) if (t.add(at(T0.plusMillis(250L * i)), (wall += 1) * MS).isPresent()) again++;
        assertEquals(1, again);
        assertEquals(1, t.restarts());
    }
}
