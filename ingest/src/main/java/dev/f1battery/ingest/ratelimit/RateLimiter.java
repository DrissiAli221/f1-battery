package dev.f1battery.ingest.ratelimit;

/** Blocks the caller until one request may be sent. Implementations are thread-safe. */
public interface RateLimiter {

    void acquire() throws InterruptedException;
}
