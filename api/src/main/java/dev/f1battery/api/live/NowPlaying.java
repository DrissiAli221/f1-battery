package dev.f1battery.api.live;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.OptionalLong;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * Which sessions have a live replay feed right now: the {@code regime-state.<key>} topics whose
 * newest record is younger than {@link #ACTIVE_WITHIN}. The rotating producer plays one session at a
 * time, but the previous topic stays on the broker for hours, so topic existence alone says nothing.
 *
 * <p>Work is bounded: at most {@link #MAX_TOPICS} topics are probed (the highest session keys, the
 * newest sessions), and the answer is kept for {@link #TTL} so polling pages cost one broker round
 * trip per ten seconds, not one per request.
 */
@Service
@ConditionalOnProperty(name = "api.replay.enabled", havingValue = "true")
public class NowPlaying {

    static final Duration ACTIVE_WITHIN = Duration.ofSeconds(120);
    static final Duration TTL = Duration.ofSeconds(10);
    static final int MAX_TOPICS = 50;
    private static final String PREFIX = "regime-state.";

    /** One session with a recent record. {@code ageSeconds} is measured at the time of the lookup. */
    public record Active(int sessionKey, Instant lastTs, long ageSeconds) {}

    private final TopicProbe probe;
    private final Clock clock;
    private List<Active> cached;
    private Instant cachedAt;

    @Autowired
    public NowPlaying(TopicProbe probe) {
        this(probe, Clock.systemUTC());
    }

    NowPlaying(TopicProbe probe, Clock clock) {
        this.probe = probe;
        this.clock = clock;
    }

    /** The active sessions, newest record first. Throws if the broker cannot be reached. */
    public synchronized List<Active> active() throws Exception {
        Instant now = clock.instant();
        if (cached != null && Duration.between(cachedAt, now).compareTo(TTL) < 0) return cached;
        List<Active> out = new ArrayList<>();
        for (int key : sessionKeys(probe.regimeStateTopics())) {
            OptionalLong last = probe.lastRecordMillis(PREFIX + key);
            if (last.isEmpty()) continue;
            Active a = classify(key, last.getAsLong(), now);
            if (a != null) out.add(a);
        }
        out.sort(Comparator.comparing(Active::lastTs).reversed());
        cached = List.copyOf(out);
        cachedAt = now;
        return cached;
    }

    /** Session keys parsed from topic names, non-numeric suffixes dropped, newest (highest) first, capped. */
    static List<Integer> sessionKeys(List<String> topics) {
        List<Integer> keys = new ArrayList<>();
        for (String t : topics) {
            if (!t.startsWith(PREFIX)) continue;
            try {
                keys.add(Integer.parseInt(t.substring(PREFIX.length())));
            } catch (NumberFormatException e) {
                // not a session topic
            }
        }
        keys.sort(Comparator.reverseOrder());
        return keys.size() > MAX_TOPICS ? keys.subList(0, MAX_TOPICS) : keys;
    }

    /** Null when the newest record is older than the activity window; a record dated slightly ahead counts as age 0. */
    static Active classify(int key, long lastMillis, Instant now) {
        Instant last = Instant.ofEpochMilli(lastMillis);
        long age = Math.max(0, Duration.between(last, now).toSeconds());
        return age < ACTIVE_WITHIN.toSeconds() ? new Active(key, last, age) : null;
    }
}
