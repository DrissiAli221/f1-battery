package dev.f1battery.replay;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class PacerTest {

    /** Virtual clock: sleeping advances time, nothing really waits. */
    static final class FakeClock implements Pacer.Clock {
        long now = 1_000;
        long slept;

        @Override
        public long nanoTime() {
            return now;
        }

        @Override
        public void sleepNanos(long n) {
            now += n;
            slept += n;
        }
    }

    static final Instant T0 = Instant.parse("2026-09-06T13:00:00Z");

    @Test
    void firstSampleIsImmediate() throws Exception {
        FakeClock c = new FakeClock();
        assertEquals(0, new Pacer(c, 1.0).awaitDue(T0));
        assertEquals(0, c.slept);
    }

    @Test
    void gapsMatchTimestampGapsAtRealTime() throws Exception {
        FakeClock c = new FakeClock();
        Pacer p = new Pacer(c, 1.0);
        p.awaitDue(T0);
        assertEquals(270_000_000L, p.awaitDue(T0.plusMillis(270)));
        assertEquals(240_000_000L, p.awaitDue(T0.plusMillis(510)));
        assertEquals(510_000_000L, c.slept);
    }

    @Test
    void speedDividesTheGap() throws Exception {
        FakeClock c = new FakeClock();
        Pacer p = new Pacer(c, 20.0);
        p.awaitDue(T0);
        p.awaitDue(T0.plusSeconds(60));
        assertEquals(3_000_000_000L, c.slept);
    }

    @Test
    void workTimeIsNotAddedToTheSchedule() throws Exception {
        FakeClock c = new FakeClock();
        Pacer p = new Pacer(c, 1.0);
        p.awaitDue(T0);
        c.now += 100_000_000L; // publishing took 100 ms
        p.awaitDue(T0.plusMillis(250));
        assertEquals(150_000_000L, c.slept);
    }

    @Test
    void lateSampleIsNotDelayed() throws Exception {
        FakeClock c = new FakeClock();
        Pacer p = new Pacer(c, 1.0);
        p.awaitDue(T0);
        c.now += 2_000_000_000L;
        assertEquals(0, p.awaitDue(T0.plusMillis(250)));
    }

    @Test
    void longStallReanchorsInsteadOfBursting() throws Exception {
        FakeClock c = new FakeClock();
        Pacer p = new Pacer(c, 1.0);
        p.awaitDue(T0);
        c.now += 60_000_000_000L; // 60 s stall
        p.awaitDue(T0.plusSeconds(1));
        // Following sample is 250 ms of session time later: it must wait 250 ms, not zero.
        assertEquals(250_000_000L, p.awaitDue(T0.plusMillis(1250)));
    }
}
