package dev.f1battery.ingest.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;

import dev.f1battery.ingest.ratelimit.TokenBucketRateLimiter.Limit;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.Test;

class TokenBucketRateLimiterTest {

    private final FakeClock clock = new FakeClock();

    private TokenBucketRateLimiter openF1(int minuteBurst) {
        return new TokenBucketRateLimiter(
                List.of(new Limit(3, Duration.ofSeconds(1), 1), new Limit(30, Duration.ofMinutes(1), minuteBurst)),
                clock, clock);
    }

    @Test
    void burstIsServedImmediatelyThenThrottled() throws Exception {
        var limiter = new TokenBucketRateLimiter(List.of(new Limit(3, Duration.ofSeconds(1), 3)), clock, clock);
        for (int i = 0; i < 3; i++) {
            limiter.acquire();
        }
        assertThat(clock.sleeps()).isEmpty();
        limiter.acquire();
        assertThat(clock.sleeps()).hasSize(1);
        assertThat(clock.sleeps().get(0).toMillis()).isBetween(333L, 334L);
    }

    @Test
    void perMinuteLimitSpacesRequestsTwoSecondsApart() throws Exception {
        var limiter = openF1(1);
        for (int i = 0; i < 11; i++) {
            limiter.acquire();
        }
        // First is free (one banked token); each of the next ten waits 2 s.
        assertThat(clock.sleeps()).hasSize(10).allSatisfy(d -> assertThat(d.toMillis()).isBetween(1999L, 2001L));
    }

    @Test
    void neverExceedsThirtyPerMinuteOverARollingMinute() throws Exception {
        var limiter = openF1(1);
        List<Long> grantedAtNanos = new ArrayList<>();
        for (int i = 0; i < 95; i++) {
            limiter.acquire();
            grantedAtNanos.add(clock.getAsLong());
        }
        long minute = Duration.ofMinutes(1).toNanos();
        for (int i = 0; i < grantedAtNanos.size(); i++) {
            int inWindow = 0;
            for (int j = i; j < grantedAtNanos.size() && grantedAtNanos.get(j) - grantedAtNanos.get(i) < minute; j++) {
                inWindow++;
            }
            assertThat(inWindow).as("requests in the minute starting at #%d", i).isLessThanOrEqualTo(30);
        }
    }

    @Test
    void perSecondLimitHoldsEvenWhenMinuteBudgetIsLarge() throws Exception {
        var limiter = openF1(30);
        List<Long> granted = new ArrayList<>();
        for (int i = 0; i < 30; i++) {
            limiter.acquire();
            granted.add(clock.getAsLong());
        }
        for (int i = 0; i + 1 < granted.size(); i++) {
            assertThat(granted.get(i + 1) - granted.get(i)).isGreaterThanOrEqualTo(Duration.ofMillis(333).toNanos());
        }
    }

    @Test
    void idleTimeRefillsTokens() throws Exception {
        var limiter = openF1(1);
        limiter.acquire();
        limiter.acquire();
        int sleepsBefore = clock.sleeps().size();
        clock.advance(Duration.ofSeconds(10));
        limiter.acquire();
        assertThat(clock.sleeps()).hasSize(sleepsBefore);
    }

    @Test
    void concurrentCallersShareOneBudget() throws Exception {
        // Real clock: 40 acquires at 200/s with no burst cannot finish in under ~195 ms.
        var limiter = new TokenBucketRateLimiter(List.of(new Limit(200, Duration.ofSeconds(1), 1)),
                System::nanoTime, Sleeper.SYSTEM);
        int threads = 4;
        CountDownLatch start = new CountDownLatch(1);
        List<Thread> workers = new ArrayList<>();
        for (int t = 0; t < threads; t++) {
            Thread w = new Thread(() -> {
                try {
                    start.await();
                    for (int i = 0; i < 10; i++) {
                        limiter.acquire();
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            workers.add(w);
            w.start();
        }
        long t0 = System.nanoTime();
        start.countDown();
        for (Thread w : workers) {
            w.join();
        }
        long elapsedMs = Duration.ofNanos(System.nanoTime() - t0).toMillis();
        assertThat(elapsedMs).isGreaterThanOrEqualTo(180);
    }
}
