package dev.f1battery.ingest.ratelimit;

import java.time.Duration;

/** Seam over {@link Thread#sleep} so tests can run on a fake clock. */
@FunctionalInterface
public interface Sleeper {

    Sleeper SYSTEM = d -> Thread.sleep(d.toMillis(), (int) (d.toNanos() % 1_000_000));

    void sleep(Duration duration) throws InterruptedException;
}
