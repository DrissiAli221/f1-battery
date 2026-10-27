package dev.f1battery.api.live;

import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Answers the live endpoint with a clear 404 while replay is off (the default), so the view can explain it. */
@RestController
@ConditionalOnProperty(name = "api.replay.enabled", havingValue = "false", matchIfMissing = true)
public class LiveDisabledController {

    /** The index answers 200 with nothing playing, so the page can say so instead of treating it as an error. */
    @GetMapping("/api/live")
    public Map<String, Object> index() {
        return Map.of("enabled", false, "active", List.of(), "capacity", Map.of("max", 0, "used", 0));
    }

    @GetMapping("/api/live/{sessionKey}")
    public ResponseEntity<Map<String, String>> disabled() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "replay disabled"));
    }
}
