package dev.f1battery.ingest.ratelimit;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

/** Manually advanced clock; sleeping moves time forward and is recorded. */
public class FakeClock implements LongSupplier, Sleeper {

    private final AtomicLong nanos = new AtomicLong(1_000_000_000L);
    private final List<Duration> sleeps = new CopyOnWriteArrayList<>();

    @Override
    public long getAsLong() {
        return nanos.get();
    }

    @Override
    public void sleep(Duration d) {
        sleeps.add(d);
        nanos.addAndGet(d.toNanos());
    }

    public void advance(Duration d) {
        nanos.addAndGet(d.toNanos());
    }

    public List<Duration> sleeps() {
        return sleeps;
    }

    public Duration totalSlept() {
        return sleeps.stream().reduce(Duration.ZERO, Duration::plus);
    }
}
