package dev.f1battery.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.List;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Per-client-address token bucket. The bucket holds {@code perMinute} tokens and refills
 * continuously at {@code perMinute / 60} tokens per second; a request that finds the bucket
 * empty gets 429 with a Retry-After header.
 *
 * <p>The client address is the socket peer, unless the peer is a configured trusted proxy
 * ({@code api.trusted-proxies}: addresses or CIDR ranges). Then X-Forwarded-For is read from the
 * right, skipping trusted hops, and the first untrusted address is the client. Nothing is trusted by
 * default, so a client cannot choose its own bucket by sending the header.
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
    private final List<Cidr> trusted;

    public RateLimitFilter(int perMinute) {
        this(perMinute, System::nanoTime, "");
    }

    public RateLimitFilter(int perMinute, String trustedProxies) {
        this(perMinute, System::nanoTime, trustedProxies);
    }

    RateLimitFilter(int perMinute, LongSupplier nanoClock) {
        this(perMinute, nanoClock, "");
    }

    RateLimitFilter(int perMinute, LongSupplier nanoClock, String trustedProxies) {
        this.perMinute = perMinute;
        this.nanoClock = nanoClock;
        this.trusted = Arrays.stream(trustedProxies.split(","))
                .map(String::trim).filter(x -> !x.isEmpty()).map(Cidr::parse).toList();
    }

    /** Address used as the bucket key for a request from {@code peer} carrying the given X-Forwarded-For. */
    String clientAddress(String peer, String forwardedFor) {
        if (trusted.isEmpty() || forwardedFor == null || !isTrusted(peer)) {
            return peer;
        }
        String[] hops = forwardedFor.split(",");
        for (int i = hops.length - 1; i >= 0; i--) {
            String hop = hops[i].trim();
            if (hop.isEmpty()) {
                continue;
            }
            if (!isTrusted(hop)) {
                return hop;
            }
        }
        return peer;
    }

    private boolean isTrusted(String address) {
        try {
            byte[] a = InetAddress.getByName(address).getAddress();
            return trusted.stream().anyMatch(c -> c.contains(a));
        } catch (UnknownHostException | SecurityException e) {
            return false;
        }
    }

    /** An address with a prefix length; a bare address is a host route. */
    private record Cidr(byte[] network, int bits) {
        static Cidr parse(String text) {
            try {
                int slash = text.indexOf('/');
                byte[] net = InetAddress.getByName(slash < 0 ? text : text.substring(0, slash)).getAddress();
                int bits = slash < 0 ? net.length * 8 : Integer.parseInt(text.substring(slash + 1));
                if (bits < 0 || bits > net.length * 8) {
                    throw new IllegalArgumentException("bad prefix length in trusted proxy '" + text + "'");
                }
                return new Cidr(net, bits);
            } catch (UnknownHostException | NumberFormatException e) {
                throw new IllegalArgumentException("bad trusted proxy '" + text + "'", e);
            }
        }

        boolean contains(byte[] address) {
            if (address.length != network.length) {
                return false;
            }
            for (int i = 0; i < bits; i++) {
                int mask = 0x80 >> (i % 8);
                if ((address[i / 8] & mask) != (network[i / 8] & mask)) {
                    return false;
                }
            }
            return true;
        }
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
        long wait = tryAcquire(clientAddress(req.getRemoteAddr(), req.getHeader("X-Forwarded-For")));
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
