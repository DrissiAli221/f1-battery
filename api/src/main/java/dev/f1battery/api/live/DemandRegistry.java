package dev.f1battery.api.live;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * Which sessions viewers want to watch right now. The API stays read-only: it does not start
 * anything, it only records that someone has {@code GET /api/live/{key}} open, and the replay
 * controller on the VM polls {@code GET /api/live/demand} (inside the VM network only) to decide
 * which sessions to replay.
 *
 * <p>A session is wanted while at least one stream is open and for {@link #LINGER} after the last
 * one closes, so a page reload or a short disconnect does not tear the replay down. State is in
 * memory: after an API restart the open streams re-register within a keepalive (they are
 * re-opened by the browsers), which is acceptable for a demo.
 */
@Service
@ConditionalOnProperty(name = "api.replay.enabled", havingValue = "true")
public class DemandRegistry {

    static final Duration LINGER = Duration.ofMinutes(5);

    /** {@code since} is when the demand began (oldest first is the controller's start order). */
    public record Wanted(int sessionKey, int viewers, Instant lastSeen, Instant since) {}

    private static final class Entry {
        int viewers;
        Instant lastSeen;
        final Instant since;

        Entry(Instant now) {
            this.since = now;
            this.lastSeen = now;
        }
    }

    private final Map<Integer, Entry> entries = new HashMap<>();
    private final Clock clock;

    @Autowired
    public DemandRegistry() {
        this(Clock.systemUTC());
    }

    DemandRegistry(Clock clock) {
        this.clock = clock;
    }

    /** A stream for the session opened. */
    public synchronized void open(int sessionKey) {
        Instant now = clock.instant();
        purge(now);
        Entry e = entries.computeIfAbsent(sessionKey, k -> new Entry(now));
        e.viewers++;
        e.lastSeen = now;
    }

    /** Called on each keepalive of an open stream. */
    public synchronized void touch(int sessionKey) {
        Entry e = entries.get(sessionKey);
        if (e != null) e.lastSeen = clock.instant();
    }

    /** A stream for the session closed; the session stays wanted for {@link #LINGER}. */
    public synchronized void close(int sessionKey) {
        Entry e = entries.get(sessionKey);
        if (e == null) return;
        e.viewers = Math.max(0, e.viewers - 1);
        e.lastSeen = clock.instant();
    }

    /** The wanted sessions, longest-wanted first. */
    public synchronized List<Wanted> wanted() {
        Instant now = clock.instant();
        purge(now);
        List<Wanted> out = new ArrayList<>();
        entries.forEach((k, e) -> out.add(new Wanted(k, e.viewers, e.lastSeen, e.since)));
        out.sort(Comparator.comparing(Wanted::since).thenComparingInt(Wanted::sessionKey));
        return out;
    }

    /** Drops sessions with no open stream whose last activity is older than the linger time. */
    private void purge(Instant now) {
        entries.values().removeIf(e -> e.viewers == 0 && Duration.between(e.lastSeen, now).compareTo(LINGER) >= 0);
    }
}
