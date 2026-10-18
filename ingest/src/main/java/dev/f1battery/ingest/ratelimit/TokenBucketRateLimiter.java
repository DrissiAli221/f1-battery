package dev.f1battery.ingest.ratelimit;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.LongSupplier;

/**
 * Composite token bucket: a request needs one token from every bucket. The
 * OpenF1 free tier is limited per second and per minute, so two buckets run
 * side by side.
 *
 * <p>A caller reserves its token immediately (the bucket may go negative) and
 * then sleeps outside the lock for the time the debt takes to refill. This keeps
 * concurrent callers ordered by arrival and never holds the lock while
 * sleeping.
 *
 * <p>Over any window of length T the bucket admits at most {@code burst +
 * permits * T / period} requests. The per-minute bucket therefore uses a small
 * burst: a capacity of 30 would allow close to 60 requests across a minute
 * boundary.
 */
public final class TokenBucketRateLimiter implements RateLimiter {

    /** {@code permits} tokens are added per {@code period}; at most {@code burst} are banked. */
    public record Limit(int permits, Duration period, int burst) {
        public Limit {
            if (permits <= 0 || burst <= 0 || period.isZero() || period.isNegative()) {
                throw new IllegalArgumentException("permits, burst and period must be positive");
            }
        }
    }

    private static final class Bucket {
        final double capacity;
        final double tokensPerNano;
        double tokens;

        Bucket(Limit l) {
            this.capacity = l.burst();
            this.tokensPerNano = (double) l.permits() / l.period().toNanos();
            this.tokens = l.burst();
        }
    }

    private final List<Bucket> buckets = new ArrayList<>();
    private final LongSupplier nanoClock;
    private final Sleeper sleeper;
    private final Object lock = new Object();
    private long last;

    public TokenBucketRateLimiter(List<Limit> limits, LongSupplier nanoClock, Sleeper sleeper) {
        limits.forEach(l -> buckets.add(new Bucket(l)));
        this.nanoClock = nanoClock;
        this.sleeper = sleeper;
        this.last = nanoClock.getAsLong();
    }

    /**
     * The free-tier limits: {@code perSecond} per second (3) and {@code perMinute} per minute (30).
     * The per-second bucket banks a single token so requests never bunch up.
     */
    public static TokenBucketRateLimiter openF1(int perSecond, int perMinute, int minuteBurst) {
        return new TokenBucketRateLimiter(
                List.of(new Limit(perSecond, Duration.ofSeconds(1), 1),
                        new Limit(perMinute, Duration.ofMinutes(1), minuteBurst)),
                System::nanoTime, Sleeper.SYSTEM);
    }

    @Override
    public void acquire() throws InterruptedException {
        long waitNanos = 0;
        synchronized (lock) {
            long now = nanoClock.getAsLong();
            long elapsed = Math.max(0, now - last);
            last = now;
            for (Bucket b : buckets) {
                b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.tokensPerNano);
                if (b.tokens < 1.0) {
                    waitNanos = Math.max(waitNanos, (long) Math.ceil((1.0 - b.tokens) / b.tokensPerNano));
                }
            }
            for (Bucket b : buckets) {
                b.tokens -= 1.0;
            }
        }
        if (waitNanos > 0) {
            sleeper.sleep(Duration.ofNanos(waitNanos));
        }
    }
}
