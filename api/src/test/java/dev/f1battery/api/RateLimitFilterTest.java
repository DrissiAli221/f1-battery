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

    @Test
    void forwardedForIsIgnoredUnlessThePeerIsTrusted() {
        RateLimitFilter none = new RateLimitFilter(1, now::get, "");
        assertThat(none.clientAddress("10.0.0.5", "203.0.113.9")).isEqualTo("10.0.0.5");

        RateLimitFilter proxied = new RateLimitFilter(1, now::get, "10.0.0.0/8, 192.168.1.1");
        assertThat(proxied.clientAddress("10.0.0.5", "203.0.113.9")).isEqualTo("203.0.113.9");
        // A spoofed leftmost entry is skipped: the right-most untrusted hop is the client.
        assertThat(proxied.clientAddress("10.0.0.5", "1.2.3.4, 203.0.113.9, 10.0.0.7")).isEqualTo("203.0.113.9");
        assertThat(proxied.clientAddress("198.51.100.1", "1.2.3.4")).isEqualTo("198.51.100.1");
        assertThat(proxied.clientAddress("10.0.0.5", null)).isEqualTo("10.0.0.5");
    }
}
