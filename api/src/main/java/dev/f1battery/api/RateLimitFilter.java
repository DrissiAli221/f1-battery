package dev.f1battery.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Per-client-address token bucket. The bucket holds {@code perMinute} tokens and refills
 * continuously at {@code perMinute / 60} tokens per second; a request that finds the bucket
 * empty gets 429 with a Retry-After header. The client address is the socket peer: behind a
 * reverse proxy the proxy must be configured to hand over the real address (for example via
 * server.forward-headers-strategy) or every client shares one bucket.
 */
public class RateLimitFilter extends OncePerRequestFilter {

    private static final long IDLE_EVICT_NANOS = 10L * 60 * 1_000_000_000L;
    private static final int EVICT_THRESHOLD = 10_000;

    private static final class Bucket {
        double tokens;
        long lastNanos;
    }

    private final int perMinute;
    private final LongSupplier nanoClock;
    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    public RateLimitFilter(int perMinute) {
        this(perMinute, System::nanoTime);
    }

    RateLimitFilter(int perMinute, LongSupplier nanoClock) {
        this.perMinute = perMinute;
        this.nanoClock = nanoClock;
    }

    /** Returns 0 if the request is allowed, otherwise the whole seconds to wait. */
    long tryAcquire(String client) {
        long now = nanoClock.getAsLong();
        if (buckets.size() > EVICT_THRESHOLD) {
            evictIdle(now);
        }
        Bucket b = buckets.computeIfAbsent(client, k -> {
            Bucket nb = new Bucket();
            nb.tokens = perMinute;
            nb.lastNanos = now;
            return nb;
        });
        synchronized (b) {
            double refill = (now - b.lastNanos) / 1e9 * perMinute / 60.0;
            b.tokens = Math.min(perMinute, b.tokens + refill);
            b.lastNanos = now;
            if (b.tokens >= 1) {
                b.tokens -= 1;
                return 0;
            }
            double secondsPerToken = 60.0 / perMinute;
            return Math.max(1, (long) Math.ceil((1 - b.tokens) * secondsPerToken));
        }
    }

    private void evictIdle(long now) {
        for (Iterator<Map.Entry<String, Bucket>> it = buckets.entrySet().iterator(); it.hasNext(); ) {
            Bucket b = it.next().getValue();
            synchronized (b) {
                if (now - b.lastNanos > IDLE_EVICT_NANOS) {
                    it.remove();
                }
            }
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return "OPTIONS".equals(request.getMethod()) || request.getRequestURI().equals("/api/health");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        long wait = tryAcquire(req.getRemoteAddr());
        if (wait > 0) {
            res.setStatus(429);
            res.setHeader("Retry-After", Long.toString(wait));
            res.setContentType("application/json");
            res.getWriter().write("{\"status\":429,\"error\":\"Too Many Requests\"}");
            return;
        }
        chain.doFilter(req, res);
    }
}
