package dev.f1battery.api.live;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/live/demand}: the sessions viewers want, for the replay controller on the VM.
 * Not meant for the public: the Caddy origin answers 404 for this path, and the controller calls
 * the API directly on the compose network. It holds nothing sensitive (session keys and counts).
 */
@RestController
@ConditionalOnProperty(name = "api.replay.enabled", havingValue = "true")
public class DemandController {

    public record Item(
            @JsonProperty("session_key") int sessionKey,
            @JsonProperty("viewers") int viewers,
            @JsonProperty("last_seen") String lastSeen,
            @JsonProperty("since") String since) {}

    public record Body(@JsonProperty("wanted") List<Item> wanted) {}

    private final DemandRegistry demand;

    public DemandController(DemandRegistry demand) {
        this.demand = demand;
    }

    @GetMapping("/api/live/demand")
    public Body demand() {
        return new Body(demand.wanted().stream()
                .map(w -> new Item(w.sessionKey(), w.viewers(), w.lastSeen().toString(), w.since().toString()))
                .toList());
    }
}
