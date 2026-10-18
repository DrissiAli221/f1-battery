package dev.f1battery.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class RateLimitFilterTest {

    private final AtomicLong now = new AtomicLong(0);

    @Test
    void allowsBurstUpToCapacityThenRejectsWithRetryAfter() {
        RateLimitFilter f = new RateLimitFilter(3, now::get);
        assertThat(f.tryAcquire("a")).isZero();
        assertThat(f.tryAcquire("a")).isZero();
        assertThat(f.tryAcquire("a")).isZero();
        assertThat(f.tryAcquire("a")).isEqualTo(20); // 3/min -> one token per 20 s
    }

    @Test
    void clientsHaveSeparateBuckets() {
        RateLimitFilter f = new RateLimitFilter(1, now::get);
        assertThat(f.tryAcquire("a")).isZero();
        assertThat(f.tryAcquire("a")).isPositive();
        assertThat(f.tryAcquire("b")).isZero();
    }

    @Test
    void tokensRefillOverTime() {
        RateLimitFilter f = new RateLimitFilter(60, now::get);
        for (int i = 0; i < 60; i++) {
            assertThat(f.tryAcquire("a")).isZero();
        }
        assertThat(f.tryAcquire("a")).isPositive();
        now.addAndGet(2_000_000_000L); // two seconds -> two tokens
        assertThat(f.tryAcquire("a")).isZero();
        assertThat(f.tryAcquire("a")).isZero();
        assertThat(f.tryAcquire("a")).isPositive();
    }
}
