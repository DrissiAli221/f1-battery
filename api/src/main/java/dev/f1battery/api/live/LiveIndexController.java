package dev.f1battery.api.live;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * {@code GET /api/live}: which sessions are being replayed right now. Present only when replay is
 * enabled; {@link LiveDisabledController} answers the same path with {@code enabled:false} otherwise.
 * A broker that cannot be reached is a 503, so the page can tell "nothing playing" from "unknown".
 */
@RestController
@ConditionalOnProperty(name = "api.replay.enabled", havingValue = "true")
public class LiveIndexController {

    private static final Logger log = LoggerFactory.getLogger(LiveIndexController.class);

    public record Entry(
            @JsonProperty("session_key") int sessionKey,
            @JsonProperty("last_ts") String lastTs,
            @JsonProperty("age_s") long ageSeconds) {}

    public record Body(@JsonProperty("active") List<Entry> active, @JsonProperty("enabled") boolean enabled) {}

    private final NowPlaying nowPlaying;

    public LiveIndexController(NowPlaying nowPlaying) {
        this.nowPlaying = nowPlaying;
    }

    @GetMapping("/api/live")
    public Body index() {
        try {
            List<Entry> entries = nowPlaying.active().stream()
                    .map(a -> new Entry(a.sessionKey(), a.lastTs().toString(), a.ageSeconds()))
                    .toList();
            return new Body(entries, true);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "live index unavailable");
        } catch (Exception e) {
            log.warn("live index failed: {}", e.toString());
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "live index unavailable");
        }
    }
}
